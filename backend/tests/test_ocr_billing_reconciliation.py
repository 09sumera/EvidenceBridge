"""
Tests for OCR-to-Billing Reconciliation Pipeline & Provider Identity Integrity.
Validates:
1. Exact inpatient document line-item extraction (6 items totaling Rs 29,500).
2. Proper identification of Stated Total (Rs 30,000) and Patient Payable.
3. Accurate arithmetic discrepancy calculation (Rs 500 difference / TOTAL_MISMATCH).
4. Exclusion of summary footers from line items.
5. Detection of duplicate line items ('mentioned 2 times').
6. Detection of potentially overlapping charges (bundled nursing/monitoring).
7. Target Provider identity preservation ('Shree Medical Institute', never 'EE MEDICAL INSTITUTE').
"""

from datetime import datetime, timezone
import pytest
from app.services.billing_reconciliation import billing_reconciliation_service
from app.services.claim_context import ClaimContextService
from app.services.provider_anomaly import provider_anomaly_service
from app.models.schemas import (
    Claim,
    ProvenanceMetadata,
    ExtractedFields,
    ExtractedEntity,
    BillingClassification,
    LocationInfo,
)


@pytest.fixture
def shree_inpatient_text():
    return (
        "Hospital: Shree Medical Institute, Davangere, Karnataka\n"
        "Patient: Ramesh Kumar | Age: 52 | Gender: Male\n"
        "Encounter: INPATIENT | Admission: 10 Feb 2026 | Discharge: 14 Feb 2026\n\n"
        "Line items:\n"
        "1. Room & Nursing Charges (4 Days): ₹10,000\n"
        "2. Bedside Monitoring & Nursing Handover: ₹6,000\n"
        "3. Physician Consultation: ₹5,000\n"
        "4. Laboratory Investigations: ₹2,500\n"
        "5. Medicines & Consumables: ₹3,800\n"
        "6. Oxygen & Respiratory Support: ₹2,200\n\n"
        "Total (Itemized): ₹29,500\n"
        "Stated Total Billed Amount: ₹30,000\n"
        "Patient Payable: ₹30,000"
    )


def test_shree_line_items_count_and_sum(shree_inpatient_text):
    """6 clinical service line items must be parsed without summary footers."""
    items = billing_reconciliation_service.parse_line_items(shree_inpatient_text)
    assert len(items) == 6, f"Expected exactly 6 line items, got {len(items)}"
    descriptions = [it.description for it in items]
    assert any("Room & Nursing" in d for d in descriptions)
    assert any("Bedside Monitoring" in d for d in descriptions)
    assert any("Physician Consultation" in d for d in descriptions)
    assert any("Laboratory Investigations" in d for d in descriptions)
    assert any("Medicines & Consumables" in d for d in descriptions)
    assert any("Oxygen & Respiratory Support" in d for d in descriptions)

    # Summary footers must NOT be parsed as line items
    for it in items:
        assert "Total" not in it.description
        assert "Payable" not in it.description

    itemized_sum = sum(it.amount for it in items)
    assert itemized_sum == 29500.0, f"Expected itemized sum 29,500.0, got {itemized_sum}"


def test_shree_stated_total_extraction(shree_inpatient_text):
    """Stated Total must prioritize Stated Total Billed Amount (30,000), not Total (Itemized) (29,500)."""
    stated = billing_reconciliation_service.extract_stated_total(shree_inpatient_text)
    assert stated == 30000.0, f"Expected stated total 30,000.0, got {stated}"


def test_shree_reconciliation_result(shree_inpatient_text):
    """Full reconciliation must report TOTAL_MISMATCH with exact 500 arithmetic discrepancy."""
    rec = billing_reconciliation_service.reconcile_claim_billing(text=shree_inpatient_text)
    assert rec.itemized_sum == 29500.0
    assert rec.stated_total == 30000.0
    assert rec.difference == -500.0
    assert rec.classification == BillingClassification.TOTAL_MISMATCH
    assert "Unexplained difference of" in rec.summary_message
    assert any("500.00" in exp for exp in rec.explanations)


def test_shree_potential_overlapping_charges(shree_inpatient_text):
    """Bedside Monitoring & Nursing Handover should be detected as potential overlap with Room & Nursing Charges."""
    rec = billing_reconciliation_service.reconcile_claim_billing(text=shree_inpatient_text)
    assert len(rec.overlaps) >= 1
    overlap = rec.overlaps[0]
    assert "Bedside Monitoring" in overlap.item_a
    assert "Room & Nursing" in overlap.item_b
    assert overlap.potential_overlap_amount == 6000.0


def test_duplicate_line_items_detection():
    """Detect line items mentioned multiple times ('mentioned 2 times')."""
    dup_text = (
        "Hospital: City Clinic\n"
        "Line items:\n"
        "1. Complete Blood Count: ₹400\n"
        "2. Chest X-Ray: ₹800\n"
        "3. Complete Blood Count: ₹400\n\n"
        "Total Billed: ₹1,600"
    )
    rec = billing_reconciliation_service.reconcile_claim_billing(text=dup_text)
    assert len(rec.duplicates) == 1
    dup = rec.duplicates[0]
    assert "Complete Blood Count" in dup.description
    assert dup.occurrences == 2
    assert dup.amount_per_occurrence == 400.0
    assert dup.total_duplicate_billed == 800.0
    assert rec.classification == BillingClassification.POSSIBLE_DUPLICATE


def test_perfect_reconciliation():
    """When line items exactly sum to stated total, status is TOTAL_MATCH."""
    balanced_text = (
        "Hospital: Davangere General Hospital\n"
        "1. Consultation: ₹500\n"
        "2. Ultrasound Scan: ₹1,500\n"
        "Total Billed: ₹2,000"
    )
    rec = billing_reconciliation_service.reconcile_claim_billing(text=balanced_text)
    assert rec.itemized_sum == 2000.0
    assert rec.stated_total == 2000.0
    assert rec.difference == 0.0
    assert rec.classification == BillingClassification.TOTAL_MATCH


def test_provider_identity_never_clipped_to_ee():
    """Ensure provider identity is reconstructed as 'Shree Medical Institute' even if NER produced 'EE MEDICAL INSTITUTE'."""
    claim_ctx_service = ClaimContextService()
    claim = Claim(
        claim_id="clm_shree_test",
        user_id="test_user",
        original_text="Hospital: Shree Medical Institute, Davangere, Karnataka\nTotal: 30000",
        source_type="hospital_bill",
        extracted_fields=ExtractedFields(entity="Inpatient", cost_range="30000"),
        location=LocationInfo(city="Davangere", state="Karnataka", normalized_key="davangere_karnataka"),
        timestamp=datetime.now(timezone.utc),
        confidence=0.95,
        provenance=ProvenanceMetadata(
            source_hash="sha256_mock_hash",
            original_snippet="Hospital: Shree Medical Institute",
            text_length=50,
            source_type="hospital_bill",
            extraction_timestamp=datetime.now(timezone.utc)
        )
    )
    ner_entities = [
        ExtractedEntity(entity="HOSPITAL", text="EE MEDICAL INSTITUTE", start=10, end=33, confidence=0.88)
    ]
    ctx = claim_ctx_service.build_shared_context(claim=claim, ner_entities=ner_entities)
    assert ctx.hospital_name == "Shree Medical Institute"
    assert not ctx.hospital_name.startswith("EE ")

    # Model 4 evaluation must use unclipped provider name
    m4_res = provider_anomaly_service.evaluate_provider(provider_data=None, provider_name=ctx.hospital_name)
    assert "EE MEDICAL INSTITUTE" not in m4_res.explanations[1]
    assert "Shree Medical Institute" in m4_res.explanations[1]


def test_complete_shree_reproducible_case():
    """
    Test the exact 18-point verification case from the prompt:
    - Text without explicit 'Hospital:' prefix
    - PIN code '577004' must not be parsed as a line item charge
    - Stated total = 30,000, Itemized sum = 29,500, Difference = -500
    - Status = TOTAL_MISMATCH
    - Bedside monitoring flagged as overlap with room charges
    - Provider identity preserved as 'Shree Medical Institute'
    """
    exact_text = (
        "Shree Medical Institute\n"
        "Davangere, Karnataka – 577004\n"
        "Patient: Ramesh Kumar\n"
        "Age: 52 years\n"
        "Encounter: INPATIENT\n"
        "Diagnosis: Community-Acquired Pneumonia\n"
        "Admission: 10 February 2026\n"
        "Discharge: 14 February 2026\n"
        "Length of Stay: 4 days\n\n"
        "Six line items:\n"
        "- Room and Nursing Charges: ₹10,000\n"
        "- Bedside Monitoring and Nursing Handover: ₹6,000\n"
        "- Physician Consultation: ₹5,000\n"
        "- Laboratory Investigations: ₹2,500\n"
        "- Medicines and Consumables: ₹3,800\n"
        "- Oxygen and Respiratory Support: ₹2,200\n\n"
        "Itemized total: ₹29,500\n"
        "Stated billed amount: ₹30,000\n"
        "Patient payable: ₹30,000"
    )

    # 1. Billing Reconciliation
    rec = billing_reconciliation_service.reconcile_claim_billing(text=exact_text)
    assert len(rec.line_items) == 6
    assert rec.itemized_sum == 29500.0
    assert rec.stated_total == 30000.0
    assert rec.patient_payable == 30000.0
    assert rec.difference == -500.0
    assert rec.classification == BillingClassification.TOTAL_MISMATCH

    # Check descriptions
    descriptions = [it.description for it in rec.line_items]
    assert any("Room and Nursing Charges" in d for d in descriptions)
    assert any("Bedside Monitoring and Nursing Handover" in d for d in descriptions)
    assert any("Physician Consultation" in d for d in descriptions)
    assert any("Laboratory Investigations" in d for d in descriptions)
    assert any("Medicines and Consumables" in d for d in descriptions)
    assert any("Oxygen and Respiratory Support" in d for d in descriptions)

    # Ensure PIN code 577004 is NOT a line item
    assert not any("577004" in d for d in descriptions)

    # Overlaps
    assert len(rec.overlaps) >= 1
    assert any("Bedside Monitoring" in o.item_a for o in rec.overlaps)

    # 2. Context Service
    claim = Claim(
        claim_id="clm_exact_shree_001",
        user_id="test_user",
        original_text=exact_text,
        source_type="hospital_bill",
        extracted_fields=ExtractedFields(entity="Community-Acquired Pneumonia", cost_range="30000"),
        location=LocationInfo(city="Davangere", state="Karnataka", normalized_key="davangere_karnataka"),
        timestamp=datetime.now(timezone.utc),
        confidence=0.95,
        provenance=ProvenanceMetadata(
            source_hash="sha256_mock_hash",
            original_snippet="Shree Medical Institute",
            text_length=len(exact_text),
            source_type="hospital_bill",
            extraction_timestamp=datetime.now(timezone.utc)
        )
    )

    ccs = ClaimContextService()
    ctx = ccs.build_shared_context(claim=claim)
    assert ctx.hospital_name == "Shree Medical Institute"
    assert ctx.provider_name == "Shree Medical Institute"
    assert "Community-Acquired Pneumonia" in ctx.diagnoses
    assert not any("4 days" in m.lower() for m in ctx.medicines)
    assert "received Oxygen and Respiratory Support" in ctx.clinical_statement or "admitted for inpatient" in ctx.clinical_statement


def test_trailing_slash_dash_and_multi_line_ocr_reconciliation():
    """Verify parsing handles both trailing '/-' and multi-line OCR layouts."""
    # 1. Multi-line layout with trailing /-
    multi_line_text = (
        "Hospital: Shree Medical Institute\n"
        "Davangere, Karnataka - 577004\n"
        "Patient: Ramesh Kumar\n"
        "Age: 52 years\n"
        "Encounter: INPATIENT\n"
        "Diagnosis: Community-Acquired Pneumonia\n\n"
        "Line items:\n"
        "1. Room & Nursing Charges (4 Days)\n"
        "₹10,000/-\n"
        "2. Bedside Monitoring & Nursing Handover\n"
        "₹6,000/-\n"
        "3. Physician Consultation\n"
        "₹5,000/-\n"
        "4. Laboratory Investigations\n"
        "₹2,500/-\n"
        "5. Medicines & Consumables\n"
        "₹3,800/-\n"
        "6. Oxygen & Respiratory Support\n"
        "₹2,200/-\n\n"
        "Total (Itemized)\n"
        "₹29,500/-\n"
        "Stated Total Billed Amount\n"
        "₹30,000/-\n"
        "Patient Payable\n"
        "₹30,000/-"
    )

    rec = billing_reconciliation_service.reconcile_claim_billing(text=multi_line_text)
    assert len(rec.line_items) == 6
    assert rec.itemized_sum == 29500.0
    assert rec.stated_total == 30000.0
    assert rec.patient_payable == 30000.0
    assert rec.difference == -500.0
    assert rec.classification == BillingClassification.TOTAL_MISMATCH


def test_model1_ner_grouping_procedure_and_encounter():
    """Ensure supportive billing items are not misclassified as clinical procedures and encounter is Inpatient."""
    from app.services.ner import ner_service

    invoice_text = (
        "Hospital: Shree Medical Institute\n"
        "Davangere, Karnataka – 577004\n"
        "Patient: Ramesh Kumar\n"
        "Age: 52 years\n"
        "Encounter: INPATIENT\n"
        "Diagnosis: Community-Acquired Pneumonia\n"
        "Admission: 10 February 2026\n"
        "Discharge: 14 February 2026\n"
        "Length of Stay: 4 days\n\n"
        "1. Room & Nursing Charges (4 Days): ₹10,000\n"
        "2. Bedside Monitoring & Nursing Handover: ₹6,000\n"
        "3. Physician Consultation: ₹5,000\n"
        "4. Laboratory Investigations: ₹2,500\n"
        "5. Medicines & Consumables: ₹3,800\n"
        "6. Oxygen & Respiratory Support: ₹2,200\n"
    )

    grouped = ner_service.group_medical_information(invoice_text, [])
    assert grouped.hospital.hospital_name.value == "Shree Medical Institute"
    assert "Davangere" in grouped.hospital.location.value
    assert "Karnataka" in grouped.hospital.location.value
    assert grouped.hospital.patient_name.value == "Ramesh Kumar"
    assert "Inpatient" in grouped.clinical.encounter_type.value
    assert grouped.clinical.diagnosis.value == "Community-Acquired Pneumonia"
    assert grouped.clinical.admission_date.value == "10 February 2026"
    assert grouped.clinical.discharge_date.value == "14 February 2026"
    assert grouped.clinical.length_of_stay.value == "4 Days"
    # Procedure should be None (not '& Respiratory Support' or 'Oxygen & Respiratory Support')
    assert grouped.clinical.procedure is None
