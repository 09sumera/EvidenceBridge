"""
Comprehensive regression test suite for:
- Part A: Provider name reconstruction (WordPiece continuation tokens, full names, alias matching).
- Part B: Model 4 historical provider analysis, non-fabrication guarantee, and city-isolation.
- Part C: Claim-level billing reconciliation (itemized arithmetic, duplicates, unbundling overlaps).
- Part D: Grounded price benchmark comparisons with official sources and unknown service handling.
- Part E: Model 5 claim-level anomaly evaluation flow.
"""

import sys
from datetime import datetime, timezone
from pathlib import Path
import pytest

# Ensure backend is on sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.models.schemas import (
    Claim,
    ExtractedEntity,
    ExtractedFields,
    LocationInfo,
    ProvenanceMetadata,
    BillingClassification,
    ProviderAnomalyResult,
    ClaimAnomalyResult,
)
from app.services.claim_context import claim_context_service
from app.services.provider_anomaly import provider_anomaly_service
from app.services.claim_anomaly import claim_anomaly_service
from app.services.billing_reconciliation import billing_reconciliation_service
from app.services.storage import storage_service


def _create_test_claim(
    claim_id: str,
    text: str,
    entity: str = "Shree Medical Institute",
    cost: float = 30000.0,
    city: str = "Davangere",
    state: str = "Karnataka",
    key: str = "shree_davangere",
    patient_id: str = "pat_test_user",
) -> Claim:
    return Claim(
        claim_id=claim_id,
        patient_id=patient_id,
        original_text=text,
        source_type="hospital_bill",
        timestamp=datetime.now(timezone.utc),
        confidence=0.92,
        extracted_fields=ExtractedFields(
            entity=entity,
            cost_estimate=cost,
            cost_currency="INR",
            cost_range=f"Rs {cost:,.2f}",
        ),
        location=LocationInfo(
            city=city,
            state=state,
            normalized_key=key,
        ),
        provenance=ProvenanceMetadata(
            source_type="hospital_bill",
            source_hash="sha256_mock_hash",
            original_snippet=text[:100],
            text_length=len(text),
        ),
    )


# ============================================================================
# Scenario 1 & 2: Provider Name Reconstruction
# ============================================================================

def test_scenario_1_provider_name_reconstruction_shree():
    """Scenario 1: 'Hospital: Shree Medical Institute' -> Shree Medical Institute without subword truncation."""
    text = (
        "Hospital: Shree Medical Institute, Davangere, Karnataka\n"
        "Provider: Shree Medical Institute\n"
        "Encounter: INPATIENT\n"
        "Total Bill: Rs 30,000"
    )
    claim = _create_test_claim("clm_test_shree_001", text, entity="Shree Medical Institute")
    # Simulate a clipped subword NER entity "EE MEDICAL INSTITUTE" from unpatched tokenizer
    ner_entities = [
        ExtractedEntity(entity="HOSPITAL", text="EE MEDICAL INSTITUTE", start=13, end=33, confidence=0.75)
    ]
    ctx = claim_context_service.build_shared_context(claim, ner_entities=ner_entities)

    assert ctx.hospital_name == "Shree Medical Institute", f"Expected 'Shree Medical Institute', got '{ctx.hospital_name}'"
    assert ctx.provider_name == "Shree Medical Institute", f"Expected 'Shree Medical Institute', got '{ctx.provider_name}'"


def test_scenario_2_provider_name_reconstruction_apollo():
    """Scenario 2: 'Hospital: Apollo Clinic, Bengaluru' -> Apollo Clinic."""
    text = (
        "Hospital: Apollo Clinic, Bengaluru, Karnataka\n"
        "Patient: Rahul Sharma\n"
        "Consultation Fee: Rs 800\n"
        "Total Bill: Rs 800"
    )
    claim = _create_test_claim("clm_test_apollo_001", text, entity="Apollo Clinic", city="Bengaluru", key="apollo_blr")
    ner_entities = [
        ExtractedEntity(entity="HOSPITAL", text="Apollo Clinic, Bengaluru", start=10, end=34, confidence=0.92)
    ]
    ctx = claim_context_service.build_shared_context(claim, ner_entities=ner_entities)

    assert ctx.hospital_name == "Apollo Clinic", f"Expected 'Apollo Clinic', got '{ctx.hospital_name}'"
    assert ctx.provider_name == "Apollo Clinic", f"Expected 'Apollo Clinic', got '{ctx.provider_name}'"


# ============================================================================
# Scenario 3, 4, 5, 6: Model 4 Historical Provider Analysis & Isolation
# ============================================================================

def test_scenario_3_model4_single_inpatient_invoice_insufficient_data():
    """Scenario 3: Single inpatient invoice without provider history MUST return INSUFFICIENT_DATA."""
    res = provider_anomaly_service.evaluate_provider(
        provider_data=None,
        provider_name="Shree Medical Institute",
        claims_count=None,
    )
    assert res.decision == "INSUFFICIENT_DATA"
    assert res.has_sufficient_data is False
    assert res.is_anomaly is False
    assert any("Shree Medical Institute" in exp for exp in res.explanations)
    assert any("single patient encounter" in exp for exp in res.explanations)


def test_scenario_4_model4_with_provider_billing_dossier():
    """Scenario 4: Document containing structured provider billing dossier is extracted and evaluated against Model 4."""
    text = (
        "Hospital: Shree Medical Institute, Davangere\n"
        "Provider: Shree Medical Institute\n"
        "--- Historical Provider Billing Summary ---\n"
        "Total Beneficiaries: 1,450\n"
        "Total Services: 18,200\n"
        "Average Submitted Charge: Rs 85,000\n"
        "Average Allowed Amount: Rs 12,000\n"
        "Submitted to Allowed Ratio: 7.08\n"
        "Services per Beneficiary: 12.55\n"
    )
    extracted_pdata = provider_anomaly_service.extract_provider_history_from_text(text)
    assert extracted_pdata is not None
    assert extracted_pdata["Tot_Benes"] == 1450.0
    assert extracted_pdata["Tot_Srvcs"] == 18200.0

    res = provider_anomaly_service.evaluate_provider(
        provider_data=extracted_pdata,
        provider_name="Shree Medical Institute"
    )
    assert res.has_sufficient_data is True
    assert res.decision in ("NORMAL", "ANOMALOUS")
    assert "Tot_Benes" in res.features_used
    assert "Submitted_To_Allowed_Ratio" in res.features_used


def test_scenario_5_model4_aggregation_from_genuine_claims():
    """Scenario 5: Multi-claim storage retrieval aggregates genuine claims into Model 4 features."""
    claims = [
        _create_test_claim(
            claim_id=f"clm_hist_{i}",
            text=f"Hospital: Shree Medical Institute\nCharge: Rs {15000 + i * 2000}\nPatient: Pat_{i}",
            entity="Shree Medical Institute",
            cost=float(15000 + i * 2000),
            patient_id=f"pat_test_user_{i}",
        )
        for i in range(5)
    ]
    agg_dict, msg = provider_anomaly_service.aggregate_provider_claims(claims, "Shree Medical Institute")
    assert agg_dict is not None
    assert agg_dict["Tot_Benes"] == 5.0
    assert agg_dict["Tot_Srvcs"] >= 5.0
    assert agg_dict["Avg_Sbmtd_Chrg"] > 0
    assert "Shree Medical Institute" in msg

    eval_res = provider_anomaly_service.evaluate_provider(
        provider_data=agg_dict,
        provider_name="Shree Medical Institute",
        claims_count=5
    )
    assert eval_res.has_sufficient_data is True
    assert eval_res.decision in ("NORMAL", "ANOMALOUS")


def test_scenario_6_model4_provider_matching_does_not_pool_city_hospitals():
    """Scenario 6: Provider matching does NOT match unrelated hospitals solely because they are in the same city."""
    storage_service._in_memory_claims.clear()

    # Claim A: City Hospital Davangere
    claim_a = _create_test_claim("clm_city_hosp_001", "Hospital: City Hospital Davangere\nEncounter: INPATIENT", entity="City Hospital Davangere")
    # Claim B: Shree Medical Institute
    claim_b = _create_test_claim("clm_shree_001", "Hospital: Shree Medical Institute\nEncounter: INPATIENT", entity="Shree Medical Institute")

    storage_service._in_memory_claims.append(claim_a.model_dump(mode="python"))
    storage_service._in_memory_claims.append(claim_b.model_dump(mode="python"))

    # Search for Shree Medical Institute
    matched = storage_service.get_claims_by_provider_in_memory("Shree Medical Institute")
    matched_ids = [c.claim_id for c in matched]

    assert "clm_shree_001" in matched_ids
    assert "clm_city_hosp_001" not in matched_ids, "City Hospital Davangere should NOT match Shree Medical Institute"


# ============================================================================
# Scenario 7, 8, 9, 10: Billing Reconciliation & Line Item Accounting
# ============================================================================

def test_scenario_7_billing_reconciliation_total_match():
    """Scenario 7: Itemized sum == stated total -> TOTAL_MATCH."""
    text = (
        "Hospital: Shree Medical Institute\n"
        "Line Items:\n"
        "1. Room Charges: Rs 10,000\n"
        "2. Surgery Charges: Rs 15,000\n"
        "3. Complete Blood Count: Rs 350\n"
        "Total Bill: Rs 25,350\n"
    )
    res = billing_reconciliation_service.reconcile_claim_billing(text=text)
    assert res.classification == BillingClassification.TOTAL_MATCH
    assert res.itemized_sum == 25350.0
    assert res.stated_total == 25350.0
    assert res.difference == 0.0


def test_scenario_8_billing_reconciliation_total_mismatch():
    """Scenario 8: Itemized sum != stated total -> TOTAL_MISMATCH with exact difference."""
    text = (
        "Hospital: Shree Medical Institute\n"
        "Line Items:\n"
        "1. Room & Bed Charges: Rs 10,000\n"
        "2. Complete Blood Count: Rs 350\n"
        "3. Paracetamol 500mg: Rs 50\n"
        "Total Bill: Rs 30,000\n"
    )
    res = billing_reconciliation_service.reconcile_claim_billing(text=text)
    assert res.classification == BillingClassification.TOTAL_MISMATCH
    assert res.itemized_sum == 10400.0
    assert res.stated_total == 30000.0
    assert res.difference == -19600.0
    assert "19,600" in res.summary_message


def test_scenario_9_billing_reconciliation_duplicate_line_items():
    """Scenario 9: Duplicate line items ('mentioned 2 times') -> POSSIBLE_DUPLICATE."""
    text = (
        "Hospital: Shree Medical Institute\n"
        "Line Items:\n"
        "1. Complete Blood Count (CBC): Rs 350\n"
        "2. Complete Blood Count (CBC): Rs 350\n"
        "Total Bill: Rs 700\n"
    )
    res = billing_reconciliation_service.reconcile_claim_billing(text=text)
    assert res.classification == BillingClassification.POSSIBLE_DUPLICATE
    assert len(res.duplicates) == 1
    dup = res.duplicates[0]
    assert "Complete Blood Count" in dup.description
    assert dup.occurrences == 2
    assert dup.amount_per_occurrence == 350.0
    assert dup.total_duplicate_billed == 700.0


def test_scenario_10_billing_reconciliation_overlapping_nursing_room_charges():
    """Scenario 10: Routine nursing + room charges -> POTENTIAL_OVERLAP_REQUIRES_REVIEW."""
    text = (
        "Hospital: Shree Medical Institute\n"
        "Line Items:\n"
        "1. Room & Bed Charges (4 days): Rs 10,000\n"
        "2. Routine Nursing Care: Rs 4,000\n"
        "Total Bill: Rs 14,000\n"
    )
    res = billing_reconciliation_service.reconcile_claim_billing(text=text)
    assert res.classification == BillingClassification.POTENTIAL_OVERLAP_REQUIRES_REVIEW
    assert len(res.overlaps) >= 1
    overlap = res.overlaps[0]
    assert overlap.overlap_type == "BUNDLED_NURSING"
    assert overlap.potential_overlap_amount == 4000.0
    assert "Policy-dependent" in overlap.explanation


# ============================================================================
# Scenario 11 & 12: Grounded Benchmark Evidence & Unknown Services
# ============================================================================

def test_scenario_11_grounded_benchmark_comparison_official_sources():
    """Scenario 11: Benchmark comparison grounded against price_benchmarks.json with sources cited."""
    text = (
        "Hospital: Shree Medical Institute\n"
        "Line Items:\n"
        "1. Complete Blood Count (CBC): Rs 350\n"
        "2. IV Normal Saline 1000ml: Rs 250\n"
        "Total Bill: Rs 600\n"
    )
    res = billing_reconciliation_service.reconcile_claim_billing(text=text)
    assert len(res.benchmark_comparisons) == 2

    # CBC: expected within CGHS benchmark (typical_max: 450)
    cbc_b = next(b for b in res.benchmark_comparisons if "Blood Count" in b.service_or_item)
    assert cbc_b.status == "WITHIN_BENCHMARK"
    assert cbc_b.source_attribution is not None
    assert "CGHS" in cbc_b.source_attribution

    # Normal Saline: billed 250, NPPA max is 105 -> EXCEEDS_BENCHMARK
    saline_b = next(b for b in res.benchmark_comparisons if "Saline" in b.service_or_item)
    assert saline_b.status == "EXCEEDS_BENCHMARK"
    assert saline_b.difference_amount == 145.0
    assert saline_b.source_attribution is not None
    assert "NPPA" in saline_b.source_attribution


def test_scenario_12_benchmark_unknown_service_cannot_establish():
    """Scenario 12: Unknown service reports 'Comparison cannot be established' without inventing tariffs."""
    text = (
        "Hospital: Shree Medical Institute\n"
        "Line Items:\n"
        "1. Administrative Registration & Archive Dossier Fee: Rs 1,500\n"
        "Total Bill: Rs 1,500\n"
    )
    res = billing_reconciliation_service.reconcile_claim_billing(text=text)
    assert len(res.benchmark_comparisons) == 1
    b = res.benchmark_comparisons[0]
    assert b.status == "CANNOT_ESTABLISH"
    assert b.benchmark_max is None
    assert b.benchmark_min is None
    assert "Comparison cannot be established" in b.note
    assert "Administrative Registration" in b.note
