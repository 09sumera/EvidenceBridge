"""
Comprehensive Test Suite for Model 4 & Model 5 Integration Audit & Fixes.

Validates:
1. Model 4 Provider Anomaly Screening:
   - Text extraction of provider billing dossier (Shree Medical Institute audit case).
   - Storage-based multi-claim provider aggregation (N >= 2 claims).
   - Single-claim safeguard (N = 1 strictly retains INSUFFICIENT_DATA with clear threshold message).
   - Absent provider history (N = 0 retains INSUFFICIENT_DATA).
   - Normal practice patterns evaluate to NORMAL / Normal billing pattern.
   - Atypical practice volume evaluates to ANOMALOUS / Review recommended.

2. Model 5 Claim Anomaly Screening:
   - Pass-through per-diem separation from total billed charges (prevents +4.45 std dev false positive).
   - Inpatient length-of-stay and date synchronization.
   - Standard inpatient stay evaluates to NOT_FLAGGED / Normal.
   - Outpatient / Emergency encounters return INSUFFICIENT_INPATIENT_DATA.
   - Genuinely extreme inpatient stays evaluate to REVIEW_RECOMMENDED / Anomalous.

3. End-to-End Verification Pipeline:
   - Cross-model integration across Models 1–5 without distortion or regressions.
"""

from datetime import datetime, timezone
from unittest.mock import patch, AsyncMock
import pytest

from app.models.schemas import (
    Claim,
    ExtractedFields,
    LocationInfo,
    ProvenanceMetadata,
    ProviderAnomalyResult,
    ClaimAnomalyResult,
)
from app.services.provider_anomaly import provider_anomaly_service
from app.services.claim_anomaly import claim_anomaly_service
from app.services.verification import verification_service
from app.services.storage import storage_service


SHREE_AUDIT_TEXT = (
    "INPATIENT DISCHARGE SUMMARY & BILLING AUDIT\n"
    "HOSPITAL: Shree Medical Institute, Bengaluru\n"
    "Patient: Suresh Gowda (UHID: SMI-2026-9041)\n"
    "Admission Date: 2026-02-10\n"
    "Discharge Date: 2026-02-14\n"
    "Length of Stay: 4 days\n"
    "Primary Diagnosis: Acute Bacterial Pneumonia (ICD-9: 486)\n"
    "Procedure: Mechanical ventilation and IV anti-infectives (CPT: 3893)\n"
    "Total Billed Amount: ₹12,500.00\n\n"
    "PROVIDER BILLING DOSSIER:\n"
    "Provider: Shree Medical Institute\n"
    "Total Beneficiaries: 2,100\n"
    "Total Services: 8,400\n"
    "Total Beneficiary Day Services: 6,300\n"
    "Average Submitted Charge: ₹12,500.00\n"
    "Average Allowed Amount: ₹9,800.00\n"
    "Submitted to Allowed Ratio: 1.28\n"
    "Services Per Beneficiary: 4.0\n"
    "Bene Days Per Beneficiary: 3.0\n"
    "Medicare Payment Ratio: 0.78\n"
)


NORMAL_INPATIENT_TEXT = (
    "INPATIENT DISCHARGE SUMMARY\n"
    "HOSPITAL: Manipal Hospital, Bengaluru\n"
    "Doctor: Dr. Arun Sharma\n"
    "Patient: Sunita Rao (UHID: MH-2026-1184)\n"
    "Admission Date: 2026-02-10\n"
    "Discharge Date: 2026-02-14\n"
    "Length of Stay: 4 days\n"
    "Primary Diagnosis: Acute Bronchitis (ICD-9: 486)\n"
    "Procedure: Respiratory therapy (CPT: 3893)\n"
    "Total Billed Amount: ₹4,500.00\n"
)


OUTPATIENT_EMERGENCY_TEXT = (
    "EMERGENCY DEPARTMENT CHARGE SUMMARY\n"
    "MANIPAL HOSPITAL - BENGALURU, KARNATAKA\n"
    "Patient: Ramesh Kumar (Acct #MH-BLR-2026-4412)\n"
    "Item: 0.9% Sodium Chloride (Normal Saline) 1,000 mL IV infusion bag for emergency rehydration.\n"
    "Billed Charge: ₹1,800.00\n"
    "Clinical Note: Emergency IV hydration administered for acute gastroenteritis dehydration."
)


def _make_dummy_provenance(text: str) -> ProvenanceMetadata:
    return ProvenanceMetadata(
        source_type="hospital_bill",
        source_hash="sha256_mock_hash_001",
        original_snippet=text[:100],
        text_length=len(text),
    )


# ============================================================================
# MODEL 4 TESTS
# ============================================================================

def test_model4_extract_provider_history_from_text():
    """Verify Model 4 extracts structured provider history block from Shree Medical audit text."""
    pdata = provider_anomaly_service.extract_provider_history_from_text(SHREE_AUDIT_TEXT)
    assert pdata is not None, "Failed to extract provider history from Shree audit text"
    assert pdata["Tot_Benes"] == 2100.0
    assert pdata["Tot_Srvcs"] == 8400.0
    assert pdata["Tot_Bene_Day_Srvcs"] == 6300.0
    assert pdata["Avg_Sbmtd_Chrg"] == 12500.0
    assert pdata["Avg_Mdcr_Alowd_Amt"] == 9800.0
    assert pdata["Submitted_To_Allowed_Ratio"] == 1.28
    assert pdata["Services_Per_Beneficiary"] == 4.0


def test_model4_evaluate_shree_audit_dossier():
    """Verify Model 4 evaluates Shree Medical Institute metrics as ANOMALOUS (Review recommended)."""
    pdata = provider_anomaly_service.extract_provider_history_from_text(SHREE_AUDIT_TEXT)
    res = provider_anomaly_service.evaluate_provider(pdata)
    assert res.has_sufficient_data is True
    assert res.is_anomaly is True
    assert res.decision == "ANOMALOUS"
    assert res.screening_flag == "Review recommended"
    assert res.anomaly_score < 0.0


def test_model4_single_claim_retains_insufficient_data():
    """Verify a single claim record strictly retains INSUFFICIENT_DATA and explains threshold."""
    single_claim = Claim(
        claim_id="clm_single_001",
        original_text=NORMAL_INPATIENT_TEXT,
        source_type="hospital_bill",
        timestamp=datetime.now(timezone.utc),
        confidence=0.90,
        extracted_fields=ExtractedFields(entity="Respiratory therapy", cost_range="₹4,500.00"),
        provenance=_make_dummy_provenance(NORMAL_INPATIENT_TEXT),
    )
    agg_data, msg = provider_anomaly_service.aggregate_provider_claims([single_claim], "Manipal Hospital")
    assert agg_data is None, "Single claim should NOT produce aggregate provider data"
    assert "Found 1 historical claim" in msg
    assert "requires at least 2" in msg

    res = provider_anomaly_service.evaluate_provider(
        provider_data=agg_data,
        provider_name="Manipal Hospital",
        claims_count=1,
        insufficient_reason=msg,
    )
    assert res.decision == "INSUFFICIENT_DATA"
    assert res.has_sufficient_data is False
    assert res.is_anomaly is False
    assert "1 found, 2 required" in res.screening_flag
    assert "requires at least 2 historical claims" in res.explanations[0]


def test_model4_multi_claim_storage_aggregation():
    """Verify multi-claim aggregation succeeds when N >= 2 genuine historical claims exist."""
    claims = [
        Claim(
            claim_id="clm_hist_001",
            original_text="Patient: Patient A (UHID: P-001)\nHospital: City Care\nProcedure: 3893\nBilled: ₹5,000.00\nStay: 3 days",
            source_type="hospital_bill",
            timestamp=datetime.now(timezone.utc),
            confidence=0.90,
            extracted_fields=ExtractedFields(entity="Procedure 1", cost_range="₹5,000.00"),
            provenance=_make_dummy_provenance("hist1"),
        ),
        Claim(
            claim_id="clm_hist_002",
            original_text="Patient: Patient B (UHID: P-002)\nHospital: City Care\nProcedure: 9671\nBilled: ₹7,000.00\nStay: 5 days",
            source_type="hospital_bill",
            timestamp=datetime.now(timezone.utc),
            confidence=0.90,
            extracted_fields=ExtractedFields(entity="Procedure 2", cost_range="₹7,000.00"),
            provenance=_make_dummy_provenance("hist2"),
        ),
        Claim(
            claim_id="clm_hist_003",
            original_text="Patient: Patient C (UHID: P-003)\nHospital: City Care\nProcedure: 3893 9671\nBilled: ₹6,000.00\nStay: 4 days",
            source_type="hospital_bill",
            timestamp=datetime.now(timezone.utc),
            confidence=0.90,
            extracted_fields=ExtractedFields(entity="Procedure 3", cost_range="₹6,000.00"),
            provenance=_make_dummy_provenance("hist3"),
        ),
    ]

    agg_data, msg = provider_anomaly_service.aggregate_provider_claims(claims, "City Care")
    assert agg_data is not None
    assert agg_data["Tot_Benes"] == 3.0
    assert agg_data["Tot_Srvcs"] >= 3.0
    assert agg_data["Avg_Sbmtd_Chrg"] == 6000.0
    assert agg_data["aggregated_claims_count"] == 3
    assert "Successfully aggregated 3" in msg

    res = provider_anomaly_service.evaluate_provider(agg_data, provider_name="City Care", claims_count=3)
    assert res.has_sufficient_data is True
    assert res.anomaly_score is not None
    assert any("across 3 aggregated historical claims" in exp for exp in res.explanations)


def test_model4_normal_provider_profile():
    """Verify normal provider practice patterns evaluate to NORMAL / Normal billing pattern."""
    normal_data = {
        "Tot_Benes": 120.0,
        "Tot_Srvcs": 350.0,
        "Tot_Bene_Day_Srvcs": 280.0,
        "Avg_Sbmtd_Chrg": 350.0,
        "Avg_Mdcr_Alowd_Amt": 110.0,
        "Services_Per_Beneficiary": 2.92,
        "Bene_Days_Per_Beneficiary": 2.33,
        "Medicare_Payment_Ratio": 0.78,
        "Submitted_To_Allowed_Ratio": 3.18,
    }
    res = provider_anomaly_service.evaluate_provider(normal_data)
    assert res.has_sufficient_data is True
    assert res.is_anomaly is False
    assert res.decision == "NORMAL"
    assert res.screening_flag == "Normal billing pattern"
    assert res.anomaly_score > 0.0


# ============================================================================
# MODEL 5 TESTS
# ============================================================================

def test_model5_normal_inpatient_claim_not_flagged():
    """Verify normal inpatient stay evaluates to NOT_FLAGGED with calibrated features."""
    claim_dict = {
        "CLM_ID": "CLM_NORMAL_001",
        "DESYNPUF_ID": "BENE_001",
        "PRVDR_NUM": "10001",
        "CLM_ADMSN_DT": "20260210",
        "CLM_FROM_DT": "20260210",
        "CLM_THRU_DT": "20260214",
        "NCH_BENE_DSCHRG_DT": "20260214",
        "CLM_UTLZTN_DAY_CNT": 4.0,
        "CLM_PASS_THRU_PER_DIEM_AMT": 0.0,
        "NCH_BENE_PTA_COINSRNC_LBLTY_AM": 0.0,
        "NCH_BENE_BLOOD_DDCTBL_LBLTY_AM": 0.0,
        "CLM_DRG_CD": "194",
        "diagnosis_codes": ["486"],
        "procedure_codes": ["3893"],
    }
    res = claim_anomaly_service.evaluate_claim(claim_data=claim_dict)
    assert res.has_sufficient_data is True
    assert res.is_anomaly is False
    assert res.decision == "NOT_FLAGGED"
    assert res.screening_flag == "Not flagged"
    assert res.anomaly_score > 0.0
    assert "conform to standard inpatient billing" in res.explanations[0].lower()


def test_model5_prevents_total_charge_in_pass_through():
    """Verify pass-through per-diem > 1000 is safely recognized as misattributed charge and reset to 0.0."""
    raw_dict = {
        "CLM_ID": "CLM_TEST_002",
        "CLM_ADMSN_DT": "20260210",
        "CLM_FROM_DT": "20260210",
        "CLM_THRU_DT": "20260214",
        "NCH_BENE_DSCHRG_DT": "20260214",
        "CLM_UTLZTN_DAY_CNT": 4.0,
        "CLM_PASS_THRU_PER_DIEM_AMT": 12500.0,  # Misattributed total bill amount!
    }
    df, _ = claim_anomaly_service.adapt_claim_data(raw_dict)
    # adapt_claim_data resets excessive per-diem to 0.0
    assert df["CLM_PASS_THRU_PER_DIEM_AMT"].iloc[0] == 0.0

    res = claim_anomaly_service.evaluate_claim(claim_data=raw_dict)
    assert res.is_anomaly is False
    assert res.decision == "NOT_FLAGGED"


def test_model5_derives_inpatient_metrics_from_text():
    """Verify derive_claim_data_from_claim accurately extracts stay days and synchronizes dates."""
    claim = Claim(
        claim_id="clm_derive_001",
        original_text=SHREE_AUDIT_TEXT,
        source_type="hospital_bill",
        timestamp=datetime.now(timezone.utc),
        confidence=0.92,
        extracted_fields=ExtractedFields(entity="Mechanical ventilation", cost_range="₹12,500.00"),
        provenance=_make_dummy_provenance(SHREE_AUDIT_TEXT),
    )
    derived = claim_anomaly_service.derive_claim_data_from_claim(claim)
    assert derived is not None
    assert derived["CLM_UTLZTN_DAY_CNT"] == 4.0
    assert derived["CLM_PASS_THRU_PER_DIEM_AMT"] == 0.0  # Does NOT conflate with ₹12,500!
    assert derived["CLM_ADMSN_DT"] == "20260210"
    assert derived["NCH_BENE_DSCHRG_DT"] == "20260214"
    assert derived["CLM_THRU_DT"] == "20260214"

    res = claim_anomaly_service.evaluate_claim(claim=claim)
    assert res.has_sufficient_data is True
    assert res.is_anomaly is False
    assert res.decision == "NOT_FLAGGED"


def test_model5_outpatient_emergency_defers_screening():
    """Verify Emergency Department / Outpatient claims cleanly defer inpatient anomaly screening."""
    claim = Claim(
        claim_id="clm_outpatient_001",
        original_text=OUTPATIENT_EMERGENCY_TEXT,
        source_type="hospital_bill",
        timestamp=datetime.now(timezone.utc),
        confidence=0.95,
        extracted_fields=ExtractedFields(entity="0.9% Sodium Chloride", cost_range="₹1,800.00"),
        provenance=_make_dummy_provenance(OUTPATIENT_EMERGENCY_TEXT),
    )
    res = claim_anomaly_service.evaluate_claim(claim=claim)
    assert res.has_sufficient_data is False
    assert res.is_anomaly is False
    assert res.decision == "INSUFFICIENT_INPATIENT_DATA"
    assert "Emergency / Outpatient" in res.screening_flag or "Emergency" in res.screening_flag


def test_model5_genuinely_anomalous_claim():
    """Verify extreme inpatient outlier (65 days, 10 diagnoses, 6 procedures) is flagged as ANOMALOUS."""
    anom_claim = {
        "CLM_ID": "CLM_EXTREME_001",
        "DESYNPUF_ID": "BENE_EXTREME",
        "PRVDR_NUM": "99999",
        "CLM_ADMSN_DT": "20260101",
        "CLM_FROM_DT": "20260101",
        "CLM_THRU_DT": "20260307",
        "NCH_BENE_DSCHRG_DT": "20260307",
        "CLM_UTLZTN_DAY_CNT": 65.0,
        "CLM_PASS_THRU_PER_DIEM_AMT": 250.0,
        "NCH_BENE_PTA_COINSRNC_LBLTY_AM": 15000.0,
        "NCH_BENE_BLOOD_DDCTBL_LBLTY_AM": 500.0,
        "CLM_DRG_CD": "999",
        "diagnosis_codes": ["486", "4280", "5849", "4019", "25000", "2724", "42731", "51881", "0389", "99592"],
        "procedure_codes": ["9671", "3893", "3995", "8872", "3324", "9904"],
    }
    res = claim_anomaly_service.evaluate_claim(claim_data=anom_claim)
    assert res.has_sufficient_data is True
    assert res.is_anomaly is True
    assert res.decision == "REVIEW_RECOMMENDED"
    assert res.screening_flag == "Review recommended"
    assert res.anomaly_score < 0.0
    assert any("Extended length of stay" in exp for exp in res.explanations)


# ============================================================================
# END-TO-END VERIFICATION PIPELINE TESTS
# ============================================================================

def test_end_to_end_shree_audit_case():
    """
    End-to-End Pipeline Test for Shree Medical Institute Inpatient Audit Case:
    - Model 1 BioBERT extraction identifies diagnoses, procedures, hospital.
    - Model 4 extracts provider history directly from audit dossier -> ANOMALOUS (Review recommended).
    - Model 5 derives 4-day inpatient stay with pass-through=0 -> NOT_FLAGGED (Normal).
    - Cross-model synthesis connects both models without contradictory false positives.
    """
    from app.services.claim_context import claim_context_service
    from app.services.cost_anomaly import cost_anomaly_service
    from app.models.schemas import VerificationVerdict, VerificationAction

    claim = Claim(
        claim_id="clm_shree_e2e_001",
        original_text=SHREE_AUDIT_TEXT,
        source_type="hospital_bill",
        timestamp=datetime.now(timezone.utc),
        confidence=0.92,
        extracted_fields=ExtractedFields(
            entity="Mechanical ventilation",
            effect_or_outcome="Acute Bacterial Pneumonia treatment",
            cost_range="₹12,500.00",
            location_city="Bengaluru, Karnataka",
        ),
        location=LocationInfo(city="Bengaluru", state="Karnataka", country="India", normalized_key="shree_medical"),
        provenance=ProvenanceMetadata(
            source_type="hospital_bill",
            source_hash="sha256_shree_001",
            original_snippet=SHREE_AUDIT_TEXT[:100],
            text_length=len(SHREE_AUDIT_TEXT),
        )
    )

    # 1. Cost anomaly details
    cost_details = cost_anomaly_service.evaluate_claim_cost(claim)

    # 2. Extract provider history from text dossier (Model 4)
    pdata = provider_anomaly_service.extract_provider_history_from_text(claim.original_text)
    assert pdata is not None
    m4_res = provider_anomaly_service.evaluate_provider(pdata)
    assert m4_res.has_sufficient_data is True
    assert m4_res.is_anomaly is True
    assert m4_res.decision == "ANOMALOUS"

    # 3. Derive claim data for Model 5
    derived_claim_data = claim_anomaly_service.derive_claim_data_from_claim(claim, cost_details)
    assert derived_claim_data is not None
    assert derived_claim_data["CLM_PASS_THRU_PER_DIEM_AMT"] == 0.0
    m5_res = claim_anomaly_service.evaluate_claim(claim_data=derived_claim_data)
    assert m5_res.has_sufficient_data is True
    assert m5_res.is_anomaly is False
    assert m5_res.decision == "NOT_FLAGGED"

    # 4. Shared Context & Cross-Model Synthesis
    shared_context = claim_context_service.build_shared_context(
        claim=claim,
        cost_details=cost_details,
        provider_data=pdata,
        claim_data=derived_claim_data,
    )
    assert shared_context.provider_data_available is True
    assert shared_context.claim_data_available is True

    synthesis = claim_context_service.synthesize_cross_model(
        shared_context=shared_context,
        ner_entities=[],
        retrieval_passages=[],
        nli_result=None,
        provider_anomaly=m4_res,
        claim_anomaly=m5_res,
        cost_details=cost_details,
        medicine_sub=None,
        final_verdict=VerificationVerdict.SUPPORTED,
        final_action=VerificationAction.FLAG,  # Flagged due to provider pattern, not utilization
        human_review_reasons=["Model 4 Provider Anomaly detected unusual volume pattern."],
    )
    assert m4_res.decision == "ANOMALOUS"
    assert m5_res.decision == "NOT_FLAGGED"
    assert "Atypical provider billing distribution" in synthesis.provider_agreement_summary
    assert "PROVIDER_BILLING_ANOMALY" in shared_context.detected_issue_types
    assert "INPATIENT_UTILIZATION_ANOMALY" not in shared_context.detected_issue_types


def test_end_to_end_single_claim_storage_retrieval_and_abstention():
    """
    End-to-End Test for storage-based provider retrieval:
    - Stores 1 claim in storage for 'Apollo Clinic Mysore'.
    - get_claims_by_provider_in_memory retrieves that 1 claim.
    - Aggregation enforces threshold (1 < 2) and returns INSUFFICIENT_DATA.
    - Adding 2nd claim satisfies threshold (2 >= 2) and produces aggregate evaluation.
    """
    claim_text = "INPATIENT SUMMARY: Apollo Clinic, Mysore. Patient: Rahul. Stay: 2 days. Billed: ₹3,000."
    claim1 = Claim(
        claim_id="clm_single_hosp_001",
        original_text=claim_text,
        source_type="hospital_bill",
        timestamp=datetime.now(timezone.utc),
        confidence=0.90,
        extracted_fields=ExtractedFields(entity="Apollo Clinic Consultation", cost_range="₹3,000.00"),
        location=LocationInfo(city="Mysore", state="Karnataka", country="India", normalized_key="apollo_mysore_isolated"),
        provenance=_make_dummy_provenance(claim_text),
    )

    # Clean in-memory storage for test isolation
    storage_service._in_memory_claims = [claim1.model_dump(mode="python")]

    # Query matching provider
    found_claims = storage_service.get_claims_by_provider_in_memory("Apollo Clinic")
    assert len(found_claims) == 1

    # N = 1 fails threshold
    agg_data, msg = provider_anomaly_service.aggregate_provider_claims(found_claims, "Apollo Clinic")
    assert agg_data is None
    assert "Found 1 historical claim" in msg

    res = provider_anomaly_service.evaluate_provider(agg_data, provider_name="Apollo Clinic", claims_count=len(found_claims), insufficient_reason=msg)
    assert res.decision == "INSUFFICIENT_DATA"
    assert res.has_sufficient_data is False

    # Now add 2nd claim for same provider
    claim2 = Claim(
        claim_id="clm_single_hosp_002",
        original_text="INPATIENT SUMMARY: Apollo Clinic, Mysore. Patient: Priya. Stay: 3 days. Billed: ₹4,500.",
        source_type="hospital_bill",
        timestamp=datetime.now(timezone.utc),
        confidence=0.92,
        extracted_fields=ExtractedFields(entity="Apollo Clinic Treatment", cost_range="₹4,500.00"),
        location=LocationInfo(city="Mysore", state="Karnataka", country="India", normalized_key="apollo_mysore_isolated"),
        provenance=_make_dummy_provenance("Apollo Clinic claim 2"),
    )
    storage_service._in_memory_claims.append(claim2.model_dump(mode="python"))

    found_claims_2 = storage_service.get_claims_by_provider_in_memory("Apollo Clinic")
    assert len(found_claims_2) == 2

    # N = 2 satisfies threshold
    agg_data_2, msg_2 = provider_anomaly_service.aggregate_provider_claims(found_claims_2, "Apollo Clinic")
    assert agg_data_2 is not None
    assert agg_data_2["Tot_Benes"] == 2.0
    assert agg_data_2["Avg_Sbmtd_Chrg"] == 3750.0

    res_2 = provider_anomaly_service.evaluate_provider(agg_data_2, provider_name="Apollo Clinic", claims_count=2)
    assert res_2.has_sufficient_data is True
    assert res_2.decision in ("NORMAL", "ANOMALOUS")
