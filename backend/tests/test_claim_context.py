"""
Unit and Integration Tests for Shared Claim Context & Issue-Aware Cross-Model Synthesis.

Validates:
1. Same claim ID and document provenance across all five AI model outputs.
2. Entity extraction and relationship preservation without detached fragments.
3. Clinical support vs excessive pricing anomaly cross-model reconciliation (e.g., Saline 16x markup).
4. Insufficient provider history handling without data fabrication.
5. Inpatient utilization and missing feature handling.
6. Issue-specific routing (Clinical Indication Mismatch, Pricing Markup, Substitution Mismatch).
7. Unified decision consistency between safety gates, model verdicts, and final action.
"""

from datetime import datetime, timezone
import inspect
import time
from unittest.mock import patch, MagicMock, AsyncMock
import httpx
import pytest

from app.models.schemas import (
    Claim,
    CostAnomalyDetails,
    EvidencePassage,
    ExtractedEntity,
    ExtractedFields,
    LocationInfo,
    NLIResult,
    ProvenanceMetadata,
    ProviderAnomalyResult,
    ClaimAnomalyResult,
    MedicineSubstitutionResult,
    SentimentType,
    VerificationAction,
    VerificationVerdict,
)
from app.services.claim_context import claim_context_service
from app.services.cost_anomaly import cost_anomaly_service
from app.services.provider_anomaly import provider_anomaly_service
from app.services.claim_anomaly import claim_anomaly_service
from app.services.nli import nli_service
from app.services.audit import AuditService, audit_service
from app.services.storage import storage_service
from app.services.verification import VerificationService, verification_service


def _run_coroutine_with_timeout(coro, timeout_seconds: float = 15.0):
    """
    Drive an async coroutine synchronously to completion without initializing
    Windows Proactor/Selector event loop socketpairs that hang in sandboxed environments.
    Enforces a strict timeout to fail fast with diagnostic information.
    """
    start_time = time.time()
    stack = [coro]
    val = None
    exc = None
    while stack:
        if time.time() - start_time > timeout_seconds:
            raise TimeoutError(
                f"verify_claim exceeded {timeout_seconds}s timeout while executing coroutine stack: {stack}"
            )
        curr = stack[-1]
        try:
            if exc is not None:
                sub = curr.throw(exc)
                exc = None
            else:
                sub = curr.send(val)
                val = None
            if inspect.iscoroutine(sub):
                stack.append(sub)
            else:
                val = sub
        except StopIteration as e:
            stack.pop()
            val = e.value
        except Exception as e:
            stack.pop()
            exc = e
            if not stack:
                raise
    return val


@pytest.fixture
def saline_encounter_claim():
    """Create a realistic claim: Normal Saline IV infusion with 16x pricing markup."""
    text = (
        "MEMORIAL REGIONAL MEDICAL CENTER - ATLANTA, GA\n"
        "Patient: John Doe | Attending: Dr. Alan Grant\n"
        "Clinical Diagnosis: Acute Dehydration secondary to viral gastroenteritis\n"
        "Administered: 0.9% Sodium Chloride Normal Saline 1,000 mL IV infusion\n"
        "CPT Code: 96360\n"
        "Total Billed Charge: $720.00\n"
    )
    return Claim(
        claim_id="clm_saline_test_001",
        original_text=text,
        source_type="hospital_bill",
        source_url="ehr://memorial/enc-9912",
        timestamp=datetime.now(timezone.utc),
        extracted_fields=ExtractedFields(
            entity="0.9% Sodium Chloride Normal Saline 1,000 mL IV",
            effect_or_outcome="Rehydration achieved without adverse reaction",
            cost_range="$720.00",
            location_city="Atlanta",
            sentiment=SentimentType.NEUTRAL,
            reasoning="IV saline indicated for acute volume depletion.",
        ),
        confidence=0.92,
        location=LocationInfo(
            city="Atlanta",
            state_or_region="GA",
            normalized_key="atlanta_ga",
            country="United States",
        ),
        provenance=ProvenanceMetadata(
            source_hash="sha256_mock_hash_saline_001",
            original_snippet=text[:100],
            text_length=len(text),
            source_type="hospital_bill",
            source_url="ehr://memorial/enc-9912",
            source_timestamp=datetime.now(timezone.utc).isoformat(),
            ingested_at=datetime.now(timezone.utc).isoformat(),
        ),
    )


@pytest.fixture
def saline_ner_entities():
    """Simulated Model 1 BioBERT entities extracted from the saline encounter."""
    return [
        ExtractedEntity(entity="HOSPITAL_NAME", text="MEMORIAL REGIONAL MEDICAL CENTER", confidence=0.96, start_char=0, end_char=32),
        ExtractedEntity(entity="DOCTOR_NAME", text="Dr. Alan Grant", confidence=0.94, start_char=68, end_char=82),
        ExtractedEntity(entity="DIAGNOSIS", text="Acute Dehydration", confidence=0.91, start_char=103, end_char=120),
        ExtractedEntity(entity="MEDICINE_NAME", text="0.9% Sodium Chloride Normal Saline", confidence=0.97, start_char=178, end_char=212),
        ExtractedEntity(entity="PROCEDURE", text="96360", confidence=0.98, start_char=242, end_char=247),
        ExtractedEntity(entity="AMOUNT", text="$720.00", confidence=0.99, start_char=270, end_char=277),
    ]


# ---------------------------------------------------------------------------
# 1. Shared Context & Provenance Alignment Tests
# ---------------------------------------------------------------------------

def test_shared_claim_context_construction(saline_encounter_claim, saline_ner_entities):
    """Verify that SharedClaimContext normalizes all model inputs under the exact same claim."""
    cost_details = cost_anomaly_service.evaluate_claim_cost(saline_encounter_claim)
    assert cost_details.is_anomaly is True
    expected_multiplier = round(cost_details.extracted_amount / cost_details.benchmark_max, 1)
    assert cost_details.multiplier == expected_multiplier

    context = claim_context_service.build_shared_context(
        claim=saline_encounter_claim,
        ner_entities=saline_ner_entities,
        cost_details=cost_details,
    )

    assert context.claim_id == saline_encounter_claim.claim_id
    assert context.hospital_name == "MEMORIAL REGIONAL MEDICAL CENTER"
    assert context.provider_name == "Dr. Alan Grant"
    assert "Acute Dehydration" in context.diagnoses
    assert "0.9% Sodium Chloride Normal Saline" in context.medicines
    assert "96360" in context.procedures
    assert context.billed_amount == 720.0
    assert context.currency == "USD"
    assert "Acute Dehydration" in context.clinical_statement
    assert "Sodium Chloride" in context.clinical_statement


# ---------------------------------------------------------------------------
# 2. Clinical Support vs Excessive Pricing Reconciliation
# ---------------------------------------------------------------------------

def test_clinical_support_vs_pricing_reconciliation(saline_encounter_claim, saline_ner_entities):
    """
    Verify cross-model reconciliation where M3 confirms clinical indication (SUPPORTED)
    while pricing benchmark flags an extreme markup anomaly (FLAG).
    The synthesis must explain both findings without treating them as contradictory.
    """
    cost_details = cost_anomaly_service.evaluate_claim_cost(saline_encounter_claim)
    assert cost_details.is_anomaly is True
    expected_multiplier = round(cost_details.extracted_amount / cost_details.benchmark_max, 1)
    assert cost_details.multiplier == expected_multiplier

    # Simulated M3 DeBERTa NLI: Entailment (treatment indicated for dehydration)
    nli_result = NLIResult(
        model_name="EvidenceBridge DeBERTa-v3-small NLI",
        decision="entailment",
        predicted_class="entailment",
        confidence=0.998,
        requires_human_review=False,
        probabilities={"entailment": 0.998, "contradiction": 0.001, "neutral": 0.001},
    )

    context = claim_context_service.build_shared_context(
        claim=saline_encounter_claim,
        ner_entities=saline_ner_entities,
        cost_details=cost_details,
    )

    synthesis = claim_context_service.synthesize_cross_model(
        shared_context=context,
        ner_entities=saline_ner_entities,
        retrieval_passages=[{"title": "CDC Fluid Resuscitation Guidelines"}],
        nli_result=nli_result,
        provider_anomaly=None,
        claim_anomaly=None,
        cost_details=cost_details,
        medicine_sub=None,
        final_verdict=VerificationVerdict.SUPPORTED,
        final_action=VerificationAction.FLAG,
        human_review_reasons=[f"Price anomaly detected: extreme cost markup ({cost_details.multiplier:.1f}x benchmark)."],
    )

    assert synthesis.claim_id == saline_encounter_claim.claim_id
    assert "EXCESSIVE_PRICING_MARKUP" in synthesis.detected_issues
    assert synthesis.primary_trigger_issue == "EXCESSIVE_PRICING_MARKUP"
    assert synthesis.human_review_required is True
    # Verify clinical agreement notes clinical indication is supported
    assert "Clinically Supported" in synthesis.clinical_agreement_summary
    # Verify financial agreement notes excessive markup
    assert "Pricing Markup Alert" in synthesis.financial_agreement_summary
    # Verify cross-model reconciliation markdown explains that findings do not contradict
    assert "Cross-Model Reconciliation" in synthesis.synthesis_markdown


# ---------------------------------------------------------------------------
# 3. Model 4: Insufficient Provider History Handling
# ---------------------------------------------------------------------------

def test_model_4_insufficient_provider_history():
    """Verify Model 4 reports INSUFFICIENT_DATA and never invents provider metrics."""
    # Empty provider payload
    res = provider_anomaly_service.evaluate_provider({})
    assert res.has_sufficient_data is False
    assert res.decision == "INSUFFICIENT_DATA"
    assert res.screening_flag == "Insufficient provider data"
    assert res.is_anomaly is False
    assert res.anomaly_score == 0.0
    assert len(res.explanations) > 0

    # Incomplete provider payload (missing required 9 features)
    res_partial = provider_anomaly_service.evaluate_provider({"Tot_Benes": 10})
    assert res_partial.has_sufficient_data is False
    assert res_partial.decision == "INSUFFICIENT_DATA"
    assert res_partial.screening_flag == "Insufficient provider data"


# ---------------------------------------------------------------------------
# 4. Model 5: Claim Anomaly Evaluation on Shared Context
# ---------------------------------------------------------------------------

def test_model_5_inpatient_claim_screening(saline_encounter_claim, saline_ner_entities):
    """Verify Model 5 evaluates claim metrics from the shared context using V3 Strict."""
    cost_details = cost_anomaly_service.evaluate_claim_cost(saline_encounter_claim)
    res = claim_anomaly_service.evaluate_claim(
        claim=saline_encounter_claim,
        cost_details=cost_details,
        ner_entities=saline_ner_entities,
    )
    assert res is not None
    assert res.model_version.startswith("V3 Strict Temporal")
    assert isinstance(res.anomaly_score, float)
    assert res.decision in ("NOT_FLAGGED", "REVIEW_RECOMMENDED", "INSUFFICIENT_DATA", "INSUFFICIENT_INPATIENT_DATA")


# ---------------------------------------------------------------------------
# 5. Issue-Specific Model Routing Tests
# ---------------------------------------------------------------------------

def test_issue_detection_clinical_contradiction():
    """Verify CLINICAL_INDICATION_MISMATCH is detected when M3 predicts contradiction."""
    nli_contra = NLIResult(
        model_name="DeBERTa-v3-small",
        decision="contradiction",
        predicted_class="contradiction",
        confidence=0.985,
        requires_human_review=True,
    )
    issues = claim_context_service.detect_issue_types(
        cost_details=None,
        nli_result=nli_contra,
        provider_anomaly=None,
        claim_anomaly=None,
        medicine_sub=None,
        usable_passages_count=2,
    )
    assert "CLINICAL_INDICATION_MISMATCH" in issues


def test_issue_detection_medicine_mismatch():
    """Verify MEDICINE_SUBSTITUTION_MISMATCH is flagged when medicines do not match."""
    med_sub = MedicineSubstitutionResult(
        query_medicine="Azithromycin",
        target_medicine="Amoxicillin",
        match_probability=0.08,
        is_match=False,
        explanation="Incompatible drug classes.",
    )
    issues = claim_context_service.detect_issue_types(
        cost_details=None,
        nli_result=None,
        provider_anomaly=None,
        claim_anomaly=None,
        medicine_sub=med_sub,
        usable_passages_count=1,
    )
    assert "MEDICINE_SUBSTITUTION_MISMATCH" in issues


# ---------------------------------------------------------------------------
# 6. Complete Verification Pipeline Context Integration (Mocked NLI)
# ---------------------------------------------------------------------------

def test_full_verification_pipeline_binds_shared_context(saline_encounter_claim, saline_ner_entities):
    """
    Mocked NLI integration test (not actual DeBERTa inference validation):
    Verifies that verify_claim executes the deterministic fallback path with a mocked Model 3 NLI service,
    exercises verification_service decision-handling logic, passes real shared context features into
    real Model 4 and Model 5 Isolation Forests, and binds cross-model synthesis to VerificationResult.
    """
    sample_passage = EvidencePassage(
        passage_id="pas_infus_012",
        guideline_id="GUIDE-INFUS-012",
        title="USP & CDC Clinical Guidelines: 0.9% Sodium Chloride (Normal Saline) IV Solution",
        source="CDC Guidelines",
        text="Normal saline (0.9% NaCl) intravenous infusion is indicated for acute dehydration, fluid resuscitation, and volume depletion.",
        relevance_score=0.92,
        used_in_decision=True,
    )

    # Deterministic mocked NLI prediction (labeled clearly: Mocked NLI integration test)
    mock_nli = NLIResult(
        model_name="EvidenceBridge DeBERTa-v3-small NLI (Mocked Integration)",
        decision="entailment",
        predicted_class="entailment",
        confidence=0.992,
        requires_human_review=False,
        probabilities={"entailment": 0.992, "contradiction": 0.004, "neutral": 0.004},
    )

    async def mock_call_gemini(*args, **kwargs):
        raise RuntimeError("Gemini offline for deterministic test")

    async def mock_call_ollama(*args, **kwargs):
        raise RuntimeError("Ollama offline for deterministic test")

    async def mock_save_audit(*args, **kwargs):
        return None

    async def mock_insert_audit(*args, **kwargs):
        return None

    with patch.object(nli_service, "predict", return_value=mock_nli), \
         patch.object(
             verification_service,
             "retrieve_hybrid_passages",
             return_value=[sample_passage],
         ), patch.object(
             verification_service,
             "_call_ollama_verification",
             side_effect=mock_call_ollama,
         ), patch.object(
             verification_service,
             "_call_gemini_verification",
             side_effect=mock_call_gemini,
         ), patch.object(
             VerificationService,
             "_call_ollama_verification",
             side_effect=mock_call_ollama,
         ), patch.object(
             VerificationService,
             "_call_gemini_verification",
             side_effect=mock_call_gemini,
         ), patch.object(
             httpx.AsyncClient,
             "post",
             side_effect=httpx.ConnectError("Network offline for deterministic test"),
         ), patch.object(
             audit_service,
             "save_audit_trail",
             side_effect=mock_save_audit,
         ), patch.object(
             AuditService,
             "save_audit_trail",
             side_effect=mock_save_audit,
         ), patch.object(
             storage_service,
             "insert_audit_trail",
             side_effect=mock_insert_audit,
         ), patch.object(
             provider_anomaly_service,
             "evaluate_provider",
             wraps=provider_anomaly_service.evaluate_provider,
         ) as spy_m4, patch.object(
             claim_anomaly_service,
             "evaluate_claim",
             wraps=claim_anomaly_service.evaluate_claim,
         ) as spy_m5:
        coro = verification_service.verify_claim(
            claim=saline_encounter_claim,
            ner_entities=saline_ner_entities,
        )
        verif = _run_coroutine_with_timeout(coro, timeout_seconds=15.0)

    # 1. Verify shared context bindings and provenance
    assert verif.claim_id == saline_encounter_claim.claim_id
    assert verif.shared_context is not None
    assert verif.shared_context.claim_id == saline_encounter_claim.claim_id
    assert verif.shared_context.hospital_name == "MEMORIAL REGIONAL MEDICAL CENTER"
    assert "Acute Dehydration" in verif.shared_context.diagnoses
    assert "0.9% Sodium Chloride Normal Saline" in verif.shared_context.medicines

    # 2. Verify pricing multiplier dynamically computed from fixture and benchmark
    assert verif.cost_anomaly_flag is True
    assert verif.anomaly_details is not None
    expected_mult = round(verif.anomaly_details.extracted_amount / verif.anomaly_details.benchmark_max, 1)
    assert verif.anomaly_details.multiplier == expected_mult

    # 3. Verify actual DeBERTa fallback path and decision handling was exercised
    assert verif.verdict == VerificationVerdict.SUPPORTED
    assert verif.action == VerificationAction.FLAG
    assert "DeBERTa NLI" in verif.reasoning
    assert verif.nli_result is not None
    assert verif.nli_result.predicted_class == "entailment"

    # 4. Verify real Model 4 received provider input and returned canonical contract
    spy_m4.assert_called_once_with(None)
    assert verif.provider_anomaly is not None
    assert verif.provider_anomaly.has_sufficient_data is False
    assert verif.provider_anomaly.decision == "INSUFFICIENT_DATA"
    assert verif.provider_anomaly.screening_flag == "Insufficient provider data"

    # 5. Verify real Model 5 received claim context and executed real Isolation Forest inference
    spy_m5.assert_called_once()
    assert verif.claim_anomaly is not None
    assert verif.claim_anomaly.model_version.startswith("V3 Strict Temporal")
    assert isinstance(verif.claim_anomaly.anomaly_score, float)

    # 6. Verify Cross-Model Synthesis reconciled clinical support vs pricing anomaly
    assert verif.synthesis is not None
    assert verif.synthesis.claim_id == saline_encounter_claim.claim_id
    assert "EXCESSIVE_PRICING_MARKUP" in verif.synthesis.detected_issues
    assert verif.synthesis.primary_trigger_issue == "EXCESSIVE_PRICING_MARKUP"
    assert verif.requires_human_review is True
