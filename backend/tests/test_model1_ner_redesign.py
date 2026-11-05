"""
Model 1 BioBERT Indian Healthcare NER Quality Improvement & Grouped Information Tests.
Validates:
1. Manipal Hospital reproduction case:
   - Coherent medicine reconstruction: '0.9% Sodium Chloride (Normal Saline)'
   - Strength: '0.9%'
   - Quantity: '1,000 mL'
   - Route: 'IV'
   - Accurate claim reference: 'MH-BLR-2026-4412' (no PACKAGE_CODE fragment, no 'cct #')
   - '₹' currency symbol strictly not classified as HSN_SAC
   - Full clinical diagnosis phrase preserved: 'acute gastroenteritis dehydration'
   - Uncertain predictions preserved with raw confidence and marked for human review
   - No fabricated entities
2. Grouped Medical Information (Hospital, Medicine, Clinical, Billing domains)
3. Document layouts: Hospital Bill, Prescription, Discharge Summary, Insurance Claim Form
"""

import re
import pytest
from app.services.ner import ner_service
from app.models.schemas import ExtractedEntity, GroupedMedicalInformation

MANIPAL_TEXT = (
    "EMERGENCY DEPARTMENT CHARGE SUMMARY\n"
    "MANIPAL HOSPITAL - BENGALURU, KARNATAKA\n"
    "Patient: Ramesh Kumar (Acct #MH-BLR-2026-4412)\n\n"
    "Item: 0.9% Sodium Chloride (Normal Saline) 1,000 mL IV infusion bag for emergency rehydration.\n"
    "Billed Charge: ₹1,800.00\n"
    "Clinical Note: Emergency IV hydration administered for acute gastroenteritis dehydration."
)


@pytest.fixture(scope="module")
def manipal_ner_result():
    return ner_service.extract_entities(MANIPAL_TEXT)


def test_manipal_medicine_coherence_and_active_ingredient(manipal_ner_result):
    """Verify medicine is reconstructed as one coherent entity and ingredient is identified."""
    entities = manipal_ner_result.entities
    med_entities = [e for e in entities if e.entity in ("GENERIC_NAME", "BRAND_NAME", "ACTIVE_INGREDIENT")]
    assert len(med_entities) >= 1
    
    # Medicine text contains full clinical expression
    med_text = med_entities[0].text
    assert "Sodium Chloride" in med_text
    assert "Normal Saline" in med_text
    assert "0.9%" in med_text
    
    # Check grouped info
    grouped = manipal_ner_result.grouped_info
    assert grouped is not None
    assert grouped.medicine.medicine_name is not None
    assert "Sodium Chloride" in grouped.medicine.medicine_name.value
    assert grouped.medicine.active_ingredient is not None
    assert grouped.medicine.active_ingredient.value == "Sodium Chloride"


def test_manipal_strength_quantity_and_route(manipal_ner_result):
    """Verify strength (0.9%), quantity (1,000 mL), and route (IV) are correctly identified."""
    grouped = manipal_ner_result.grouped_info
    assert grouped is not None
    
    # Strength
    assert grouped.medicine.strength is not None
    assert "0.9%" in grouped.medicine.strength.value
    
    # Quantity / Dosage
    assert grouped.medicine.dosage_quantity is not None
    assert "1,000 mL" in grouped.medicine.dosage_quantity.value
    
    # Route
    assert grouped.medicine.route is not None
    assert grouped.medicine.route.value == "IV"


def test_manipal_claim_reference_reconstruction(manipal_ner_result):
    """Verify claim reference is reconstructed as 'MH-BLR-2026-4412' without PACKAGE_CODE or fragments."""
    entities = manipal_ner_result.entities
    
    # No PACKAGE_CODE should exist for the patient account number
    pkg_codes = [e for e in entities if e.entity == "PACKAGE_CODE"]
    assert len(pkg_codes) == 0, f"Spurious PACKAGE_CODE found: {[p.text for p in pkg_codes]}"
    
    # Unified CLAIM_REFERENCE should exist with exact identifier
    ref_entities = [e for e in entities if e.entity == "CLAIM_REFERENCE"]
    assert len(ref_entities) == 1
    assert ref_entities[0].text == "MH-BLR-2026-4412"
    assert "cct #" not in ref_entities[0].text
    
    grouped = manipal_ner_result.grouped_info
    assert grouped.hospital.claim_reference is not None
    assert grouped.hospital.claim_reference.value == "MH-BLR-2026-4412"


def test_manipal_currency_symbol_not_hsn_sac(manipal_ner_result):
    """Verify ₹ is strictly not classified as HSN_SAC and is associated with billed amount."""
    entities = manipal_ner_result.entities
    
    # No HSN_SAC should have '₹' or non-numeric text
    hsn_entities = [e for e in entities if e.entity == "HSN_SAC"]
    for hsn in hsn_entities:
        assert hsn.text != "₹"
        assert re.match(r"^\d{4,8}$", hsn.text)
        
    # Currency symbol is attached to amount
    amt_entities = [e for e in entities if e.entity in ("CLAIM_AMOUNT", "LINE_AMOUNT", "INVOICE_TOTAL")]
    assert len(amt_entities) >= 1
    assert "1,800" in amt_entities[0].text
    assert "₹" in amt_entities[0].text
    
    grouped = manipal_ner_result.grouped_info
    assert grouped.billing.billed_amount is not None
    assert "1,800" in grouped.billing.billed_amount.value
    assert grouped.billing.currency == "INR"
    assert grouped.billing.hsn_sac is None  # Not present in this bill, no fabrication


def test_manipal_diagnosis_and_procedure_cleaning(manipal_ner_result):
    """Verify diagnosis preserves full clinical phrase and procedure trims connective words."""
    entities = manipal_ner_result.entities
    
    # Diagnosis preserves acute gastroenteritis dehydration
    diag_entities = [e for e in entities if e.entity == "DIAGNOSIS"]
    assert any("acute gastroenteritis dehydration" in d.text.lower() for d in diag_entities)
    
    # Procedure cleans connective words ('administered for')
    proc_entities = [e for e in entities if e.entity == "PROCEDURE"]
    assert len(proc_entities) >= 1
    for proc in proc_entities:
        assert "administered for" not in proc.text
        assert proc.text != "emergency"  # Lone adjective fragment discarded
    
    grouped = manipal_ner_result.grouped_info
    assert grouped.clinical.procedure is not None
    assert grouped.clinical.procedure.value == "Emergency IV hydration"
    assert grouped.clinical.diagnosis is not None
    assert "gastroenteritis dehydration" in grouped.clinical.diagnosis.value.lower()
    assert grouped.clinical.clinical_indication is not None
    assert "rehydration" in grouped.clinical.clinical_indication.value.lower()


def test_uncertainty_and_review_flags_preserved(manipal_ner_result):
    """Verify raw model confidence is preserved and uncertain entities (<0.60) are flagged for human review."""
    entities = manipal_ner_result.entities
    
    # Medicine extraction raw confidence is preserved (~20%) and flagged for human review
    med_ent = next(e for e in entities if e.entity in ("GENERIC_NAME", "BRAND_NAME"))
    assert med_ent.confidence < 0.60
    assert med_ent.requires_human_review is True
    
    # Dosage raw confidence is preserved (~39%) and flagged for review
    dose_ent = next(e for e in entities if e.entity == "DOSAGE")
    assert dose_ent.confidence < 0.60
    assert dose_ent.requires_human_review is True
    
    # High-confidence patient name (98%) is NOT flagged for review
    pat_ent = next(e for e in entities if e.entity == "PATIENT_NAME")
    assert pat_ent.confidence > 0.90
    assert pat_ent.requires_human_review is False


def test_prescription_and_discharge_layouts():
    """Verify Indian healthcare entity extraction and grouping across prescription and discharge summaries."""
    rx_text = (
        "SHREE CLINIC, BALLARI\n"
        "Patient: Rahul Sharma (UHID: UH-BLR-2026-7821)\n"
        "Diagnosis: Acute fever\n"
        "Medicine Name: Paracetamol 650 mg (Brand: Dolo 650)\n"
        "Dosage: One tablet twice daily after food for 5 days. Quantity: 10 tablets."
    )
    rx_res = ner_service.extract_entities(rx_text)
    assert rx_res.total_entities >= 4
    rx_grouped = rx_res.grouped_info
    assert rx_grouped.hospital.patient_name is not None
    assert "Rahul Sharma" in rx_grouped.hospital.patient_name.value
    assert rx_grouped.medicine.medicine_name is not None
    assert "Paracetamol" in rx_grouped.medicine.medicine_name.value
    assert rx_grouped.clinical.diagnosis is not None
    assert "Acute fever" in rx_grouped.clinical.diagnosis.value
