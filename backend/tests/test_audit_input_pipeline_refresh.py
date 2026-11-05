"""
Tests for Audit Input Pipeline Refresh and Mismatch Fixes.

Verifies:
1. Shree Medical Institute report parsing:
   - Eliminates subword token truncation ("EE MEDICAL INSTITUTE" -> "Shree Medical Institute").
   - Strips trailing location/district suffixes (e.g., "Davangere, Karnataka").
2. Provider dossier parsing & mathematical derivation:
   - Parses: Tot_Benes=120, Tot_Srvcs=480, Avg_Sbmtd_Chrg=6250, Submitted_To_Allowed_Ratio=1.15.
   - Derives Avg_Mdcr_Alowd_Amt = 6250 / 1.15 (~5434.78) and remaining features.
   - Model 4 evaluates successfully with has_sufficient_data=True (no "No provider billing summary supplied").
3. Model 5 Inpatient feature derivation:
   - Parses dates ("10 February 2026" / "14 February 2026").
   - Length of stay = 4 days.
   - Separates pass-through per-diem (0.0) from total billed charges (30,000.0).
4. Sequential pipeline execution:
   - Consecutive audits do not retain stale Claim IDs, stale provider names, or stale model anomaly flags.
"""

from datetime import datetime, timezone
import pytest

from app.models.schemas import (
    Claim,
    ExtractedFields,
    LocationInfo,
    ProvenanceMetadata,
)
from app.services.provider_anomaly import provider_anomaly_service
from app.services.claim_anomaly import claim_anomaly_service
from app.services.claim_context import claim_context_service
from app.services.verification import verification_service
from app.services.ner import ner_service


USER_SUBMITTED_SHREE_REPORT = """
INPATIENT CLINICAL SUMMARY & BILLING AUDIT
Hospital: Shree Medical Institute, Davangere, Karnataka
Encounter Type: INPATIENT
Patient Name: Ramesh Gowda
Admission Date: 10 February 2026
Discharge Date: 14 February 2026
Length of stay: 4 days
Primary Diagnosis: Lobar Pneumonia (ICD-9: 486)
Procedures: Sputum culture, IV antibiotics, supportive oxygen therapy (CPT: 3893)
Total Bill: ₹30,000.00

PROVIDER BILLING DOSSIER:
Provider: Shree Medical Institute
Tot_Benes = 120
Tot_Srvcs = 480
Avg_Sbmtd_Chrg = ₹6,250.00
Submitted_To_Allowed_Ratio = 1.15
"""

PREVIOUS_STALE_CLAIM_REPORT = """
EMERGENCY ROOM CHARGE SUMMARY
Hospital: City General Care, Bengaluru, Karnataka
Encounter Type: EMERGENCY
Patient Name: Anand Kumar
Date: 01 February 2026
Total Bill: ₹8,500.00
Clinical Note: Emergency IV hydration for gastroenteritis.
"""


def _make_provenance(text: str) -> ProvenanceMetadata:
    return ProvenanceMetadata(
        source_type="hospital_bill",
        source_hash="sha256_mock_hash",
        original_snippet=text[:100],
        text_length=len(text),
    )


def _make_claim(
    claim_id: str,
    text: str,
    entity: str = "Shree Medical Institute",
    cost: float = 30000.0,
    city: str = "Davangere",
    state: str = "Karnataka",
    key: str = "shree_davangere",
) -> Claim:
    return Claim(
        claim_id=claim_id,
        patient_id="pat_test_user",
        original_text=text,
        source_type="hospital_bill",
        timestamp=datetime.now(timezone.utc),
        confidence=0.92,
        extracted_fields=ExtractedFields(
            entity=entity,
            cost_estimate=cost,
            cost_currency="INR",
            confidence=0.92,
        ),
        location=LocationInfo(
            city=city,
            state=state,
            country="India",
            normalized_key=key,
        ),
        provenance=_make_provenance(text),
        status="pending",
    )


class TestProviderParsingAndDerivation:
    """Tests for Model 4 provider dossier extraction and mathematical derivations."""

    def test_provider_name_cleanly_extracted(self):
        """Provider name must be 'Shree Medical Institute' without subword truncation or trailing location."""
        history = provider_anomaly_service.extract_provider_history_from_text(USER_SUBMITTED_SHREE_REPORT)
        assert history is not None
        assert history.get("provider_name") == "Shree Medical Institute"
        assert not history.get("provider_name", "").startswith("EE ")

    def test_provider_dossier_fields_extracted(self):
        """Tot_Benes, Tot_Srvcs, Avg_Sbmtd_Chrg, and Submitted_To_Allowed_Ratio must be extracted."""
        history = provider_anomaly_service.extract_provider_history_from_text(USER_SUBMITTED_SHREE_REPORT)
        assert history is not None
        assert history.get("Tot_Benes") == 120.0
        assert history.get("Tot_Srvcs") == 480.0
        assert history.get("Avg_Sbmtd_Chrg") == 6250.0
        assert history.get("Submitted_To_Allowed_Ratio") == 1.15

    def test_adapt_provider_features_derives_missing_allowed_amt(self):
        """Missing Avg_Mdcr_Alowd_Amt must be derived from Avg_Sbmtd_Chrg / Submitted_To_Allowed_Ratio."""
        raw_data = {
            "provider_name": "Shree Medical Institute",
            "Tot_Benes": 120,
            "Tot_Srvcs": 480,
            "Avg_Sbmtd_Chrg": 6250.0,
            "Submitted_To_Allowed_Ratio": 1.15,
        }
        features_df, missing = provider_anomaly_service.adapt_provider_features(raw_data)
        assert features_df is not None
        assert len(missing) == 0
        row = features_df.iloc[0]

        expected_allowed = 6250.0 / 1.15
        assert abs(row["Avg_Mdcr_Alowd_Amt"] - expected_allowed) < 1.0
        assert row["Tot_Benes"] == 120.0
        assert row["Tot_Srvcs"] == 480.0
        assert row["Avg_Sbmtd_Chrg"] == 6250.0
        assert row["Submitted_To_Allowed_Ratio"] == 1.15
        assert row["Services_Per_Beneficiary"] == 4.0
        assert row["Bene_Days_Per_Beneficiary"] == 3.0
        assert row["Medicare_Payment_Ratio"] == 0.78

    def test_model4_evaluates_shree_dossier_with_sufficient_data(self):
        """Model 4 must evaluate successfully with has_sufficient_data=True."""
        history = provider_anomaly_service.extract_provider_history_from_text(USER_SUBMITTED_SHREE_REPORT)
        assert history is not None

        res = provider_anomaly_service.evaluate_provider(
            provider_data=history,
            provider_name="Shree Medical Institute",
        )

        assert res.has_sufficient_data is True
        assert res.decision in ("NORMAL", "ANOMALOUS")
        assert res.model_version == "V3"
        assert "No provider billing summary supplied" not in " ".join(res.explanations)


class TestClaimAnomalyDerivation:
    """Tests for Model 5 inpatient claim feature derivation."""

    def test_inpatient_dates_and_stay_derived(self):
        """Admission, discharge dates and 4-day stay must be extracted from the clinical summary."""
        claim = _make_claim("clm_shree_test_002", USER_SUBMITTED_SHREE_REPORT)

        claim_data = claim_anomaly_service.derive_claim_data_from_claim(claim)
        assert claim_data is not None
        assert claim_data["CLM_ADMSN_DT"] == "20260210"
        assert claim_data["NCH_BENE_DSCHRG_DT"] == "20260214"
        assert claim_data["CLM_UTLZTN_DAY_CNT"] == 4
        # Crucial safeguard: Pass through per diem must NOT be set to total bill ₹30,000
        assert claim_data["CLM_PASS_THRU_PER_DIEM_AMT"] == 0.0

    def test_model5_evaluates_shree_inpatient_stay(self):
        """Model 5 must evaluate the 4-day stay without returning stale anomaly results."""
        claim = _make_claim("clm_shree_test_003", USER_SUBMITTED_SHREE_REPORT)

        claim_data = claim_anomaly_service.derive_claim_data_from_claim(claim)
        res = claim_anomaly_service.evaluate_claim(claim_data=claim_data, claim=claim)
        assert res.decision in ("NOT_FLAGGED", "REVIEW_RECOMMENDED")
        assert "V3 Strict" in res.model_version


class TestPipelineRefreshAndNoStaleLeakage:
    """Verifies end-to-end sequential submissions generate independent, fresh results."""

    @pytest.mark.asyncio
    async def test_sequential_submissions_have_distinct_claim_ids_and_no_stale_data(self):
        """Submitting claim 1 then claim 2 must produce distinct claim IDs and not bleed context."""
        # Claim 1: Previous emergency claim
        claim1 = _make_claim(
            claim_id="clm_ddf1101de2574927",
            text=PREVIOUS_STALE_CLAIM_REPORT,
            entity="City General Care",
            cost=8500.0,
            city="Bengaluru",
            state="Karnataka",
            key="city_blr",
        )

        res1 = await verification_service.verify_claim(claim1)
        assert res1.claim_id == "clm_ddf1101de2574927"

        # Claim 2: New Shree Medical Institute claim
        claim2 = _make_claim(
            claim_id="clm_shree_fresh_9988",
            text=USER_SUBMITTED_SHREE_REPORT,
            entity="Shree Medical Institute",
            cost=30000.0,
            city="Davangere",
            state="Karnataka",
            key="shree_davangere",
        )

        res2 = await verification_service.verify_claim(claim2)

        # 1. Distinct claim IDs
        assert res2.claim_id != res1.claim_id
        assert res2.claim_id == "clm_shree_fresh_9988"

        # 2. Model 4 target provider is Shree Medical Institute, not stale or clipped
        assert res2.provider_anomaly is not None
        assert res2.provider_anomaly.has_sufficient_data is True
        assert res2.provider_anomaly.decision in ("NORMAL", "ANOMALOUS")

        # 3. Model 5 evaluates fresh inpatient claim
        assert res2.claim_anomaly is not None
        assert res2.claim_anomaly.decision in ("NOT_FLAGGED", "REVIEW_RECOMMENDED")

        # 4. Shared context reflects Shree Medical Institute
        assert res2.shared_context is not None
        assert res2.shared_context.hospital_name == "Shree Medical Institute"
        assert not res2.shared_context.hospital_name.startswith("EE ")


class TestNerWordBoundarySafeguard:
    """Verifies subword token boundary expansion prevents truncated provider names."""

    def test_subword_boundary_expansion(self):
        """Tokens like '##ee' must expand back to full word 'Shree'."""
        claim = _make_claim("clm_subword_001", USER_SUBMITTED_SHREE_REPORT)
        ctx = claim_context_service.build_shared_context(claim=claim)
        assert ctx.hospital_name == "Shree Medical Institute"
        assert not ctx.hospital_name.startswith("EE ")
        assert ctx.provider_name == "Shree Medical Institute"
