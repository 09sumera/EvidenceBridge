"""
Regression Test Suite for the Five-Model Integration Debugging & Alignments.

Verifies fixes for the 7 identified integration problems:
1. Model 1 BioBERT span reconstruction and compound entity preservation.
2. Model 2 target entity extraction from shared clinical context.
3. ChromaDB status and Indian evidence source citations (IP / MoHFW NHM).
4. Model 3 DeBERTa hypothesis construction and clinical entailment (without forced entailment).
5. Model 4 Provider Isolation Forest INSUFFICIENT_DATA preservation.
6. Model 5 Claim Isolation Forest encounter-type handling (INSUFFICIENT_INPATIENT_DATA).
7. Financial audit NPPA benchmark, 5% GST tax treatment, and 17.1x markup arithmetic.
"""

from datetime import datetime, timezone
from unittest.mock import patch, MagicMock
import pytest

from app.models.schemas import (
    Claim,
    ExtractedFields,
    ProvenanceMetadata,
    VerificationVerdict,
    VerificationAction,
)
from app.services.ner import ner_service
from app.services.claim_context import claim_context_service
from app.services.cost_anomaly import cost_anomaly_service
from app.services.provider_anomaly import provider_anomaly_service
from app.services.claim_anomaly import claim_anomaly_service
from app.services.vector_store import vector_store_service
from app.services.verification import verification_service
from app.services.nli import nli_service


REPRODUCTION_TEXT = (
    "EMERGENCY DEPARTMENT CHARGE SUMMARY\n"
    "MANIPAL HOSPITAL - BENGALURU, KARNATAKA\n"
    "Patient: Ramesh Kumar (Acct #MH-BLR-2026-4412)\n\n"
    "Item: 0.9% Sodium Chloride (Normal Saline) 1,000 mL IV infusion bag for emergency rehydration.\n"
    "Billed Charge: ₹1,800.00\n"
    "Clinical Note: Emergency IV hydration administered for acute gastroenteritis dehydration."
)


@pytest.fixture
def reproduction_claim():
    return Claim(
        claim_id="clm_605f0975285a4b25",
        original_text=REPRODUCTION_TEXT,
        source_type="hospital_bill",
        timestamp=datetime.now(timezone.utc),
        confidence=0.95,
        extracted_fields=ExtractedFields(
            entity="0.9% Sodium Chloride (Normal Saline)",
            effect_or_outcome="Emergency rehydration",
            cost_range="₹1,800.00",
            location_city="Bengaluru, Karnataka",
        ),
        provenance=ProvenanceMetadata(
            source_type="hospital_bill",
            source_hash="sha256_mock_repr_001",
            original_snippet=REPRODUCTION_TEXT[:100],
            text_length=len(REPRODUCTION_TEXT),
        )
    )


def test_problem_1_biobert_span_reconstruction():
    """Verify BioBERT decodes compound medicines cleanly without fragmented 0., 9, or )."""
    res = ner_service.extract_entities(REPRODUCTION_TEXT)
    entity_texts = [e.text for e in res.entities]

    # Verify compound formulation was reconstructed
    assert any("0.9% Sodium Chloride" in t for t in entity_texts), f"Compound medicine missing in {entity_texts}"

    # Verify isolated punctuation/fragments are not treated as confident unflagged entities
    for e in res.entities:
        if e.text in (")", "(", ".", "-"):
            assert e.requires_human_review is True


def test_problem_2_model_2_target_entity_extraction(reproduction_claim):
    """Verify Model 2 receives meaningful clinical entities rather than fragmented 0."""
    ner_res = ner_service.extract_entities(REPRODUCTION_TEXT)
    cost_details = cost_anomaly_service.evaluate_claim_cost(reproduction_claim)

    shared_ctx = claim_context_service.build_shared_context(
        claim=reproduction_claim,
        ner_entities=ner_res.entities,
        cost_details=cost_details,
    )

    assert len(shared_ctx.medicines) > 0
    primary_med = shared_ctx.medicines[0]
    assert primary_med != "0.", f"Target medicine should not be '0.', got: '{primary_med}'"
    assert "Sodium Chloride" in primary_med or "Normal Saline" in primary_med

    assert len(shared_ctx.diagnoses) > 0
    primary_diag = shared_ctx.diagnoses[0]
    assert primary_diag != ")", f"Target diagnosis should not be stray punctuation, got: '{primary_diag}'"
    assert "gastroenteritis" in primary_diag or "dehydration" in primary_diag


def test_problem_3_chromadb_health_and_indian_guidelines():
    """Verify local ChromaDB status and Indian evidence sources (IP & NHM MoHFW)."""
    health = vector_store_service.check_health()
    assert health["status"] in ("healthy", "ready")

    # Verify Indian clinical guideline metadata in knowledge base
    saline_guides = [g for g in verification_service.guidelines if g.get("guideline_id") == "GUIDE-INFUS-012"]
    assert len(saline_guides) > 0
    g = saline_guides[0]
    assert "Indian Pharmacopoeia" in g["title"] or "National Health Mission" in g["source"]
    assert "MoHFW" in g["source"]
    assert "gastroenteritis" in g["topics"]


def test_problem_4_deberta_hypothesis_and_clinical_entailment(reproduction_claim):
    """Verify Model 3 receives a grammatical clinical statement and yields entailment without forcing it."""
    ner_res = ner_service.extract_entities(REPRODUCTION_TEXT)
    cost_details = cost_anomaly_service.evaluate_claim_cost(reproduction_claim)

    shared_ctx = claim_context_service.build_shared_context(
        claim=reproduction_claim,
        ner_entities=ner_res.entities,
        cost_details=cost_details,
    )

    # Hypothesis must not be malformed "Patient diagnosed with rehydration received 0.."
    stmt = shared_ctx.clinical_statement
    assert "received 0.." not in stmt
    assert "0.9% Sodium Chloride" in stmt or "Normal Saline" in stmt

    premise = (
        "Sodium Chloride Intravenous Infusion IP (0.9% w/v Normal Saline) is an essential isotonic crystalloid fluid "
        "indicated for urgent intravenous rehydration in acute dehydration secondary to acute gastroenteritis."
    )

    # DeBERTa on correct hypothesis yields entailment
    nli_res = nli_service.predict(premise=premise, hypothesis=stmt)
    assert nli_res.predicted_class == "entailment"
    assert nli_res.confidence > 0.85

    # Verify the malformed hypothesis that occurred previously resulted in contradiction
    malformed_stmt = "Patient diagnosed with rehydration received 0.."
    malformed_res = nli_service.predict(premise=premise, hypothesis=malformed_stmt)
    assert malformed_res.predicted_class == "contradiction"

    # Verify neutral/abstention behavior when evidence does not support the claim
    unrelated_premise = "The outpatient registration counter is open Monday through Saturday for appointments."
    unrelated_res = nli_service.predict(premise=unrelated_premise, hypothesis=stmt)
    assert unrelated_res.predicted_class != "entailment"

    # Verify contradiction when clinical premise contradicts indication
    contra_premise = "0.9% Sodium Chloride is strictly contraindicated for dehydration in acute gastroenteritis."
    contra_res = nli_service.predict(premise=contra_premise, hypothesis=stmt)
    assert contra_res.predicted_class == "contradiction"


def test_problem_5_model_4_insufficient_provider_history():
    """Verify Model 4 strictly returns INSUFFICIENT_DATA when multi-claim provider history is absent."""
    res = provider_anomaly_service.evaluate_provider(None)
    assert res.decision == "INSUFFICIENT_DATA"
    assert res.has_sufficient_data is False
    assert res.is_anomaly is False
    assert res.anomaly_score == 0.0


def test_problem_6_model_5_encounter_type_outpatient_emergency(reproduction_claim):
    """Verify Model 5 returns INSUFFICIENT_INPATIENT_DATA for Emergency Department encounter without inpatient stay."""
    cost_details = cost_anomaly_service.evaluate_claim_cost(reproduction_claim)
    ner_res = ner_service.extract_entities(REPRODUCTION_TEXT)

    res = claim_anomaly_service.evaluate_claim(
        claim=reproduction_claim,
        cost_details=cost_details,
        ner_entities=ner_res.entities,
    )

    assert res.has_sufficient_data is False
    assert res.is_anomaly is False
    assert res.decision == "INSUFFICIENT_INPATIENT_DATA"
    assert "Emergency Department / Outpatient" in res.screening_flag or "Emergency" in res.screening_flag


def test_problem_7_financial_audit_benchmark_and_multiplier(reproduction_claim):
    """Verify NPPA benchmark (₹105 incl 5% GST) and 17.1x multiplier arithmetic."""
    cost_details = cost_anomaly_service.evaluate_claim_cost(reproduction_claim)
    assert cost_details.benchmark_matched is True
    assert cost_details.currency == "INR"
    assert cost_details.benchmark_max == 105.00
    assert "NPPA DPCO" in cost_details.benchmark_source
    assert "5% GST" in cost_details.benchmark_source

    # Exact arithmetic: 1800.00 / 105.00 = 17.14
    expected_mult = round(1800.00 / 105.00, 2)
    assert cost_details.multiplier == expected_mult
    assert cost_details.multiplier == 17.14
    assert cost_details.is_anomaly is True
    assert cost_details.severity == "extreme"
