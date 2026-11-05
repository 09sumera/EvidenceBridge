"""
Comprehensive Unit & Integration Tests for All Five Integrated AI Models in EvidenceBridge.
Validates:
1. Model 1: BioBERT NER extraction on Indian healthcare text.
2. Model 2: BGE embedding generation, normalization, and semantic retrieval.
3. Model 3: DeBERTa NLI cross-examination (entailment, contradiction, neutral, review required).
4. Model 4: Provider-level anomaly detection (Isolation Forest V3).
5. Model 5: Claim-level anomaly detection (Isolation Forest V3 Strict & V4-A).
6. Preserved Model 5: Medicine substitution & brand/generic matching.
7. RapidOCR document extraction.
8. Unified audit orchestrator pipeline.
9. FastAPI dedicated model endpoints.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.ner import ner_service
from app.services.embedding import embedding_service
from app.services.nli import nli_service
from app.services.provider_anomaly import provider_anomaly_service
from app.services.claim_anomaly import claim_anomaly_service
from app.services.medicine_service import medicine_service
from app.services.ocr_service import ocr_service
from app.services.audit_orchestrator import audit_orchestrator


@pytest.fixture
def client():
    return TestClient(app)


# ---------------------------------------------------------------------------
# 1. Model 1: BioBERT NER Tests
# ---------------------------------------------------------------------------

def test_model_1_biobert_ner_extraction():
    """Verify Model 1 extracts Indian healthcare entities with labels and confidence."""
    sample_text = """
    APOLLO HOSPITALS BANGALORE
    Patient: Ramesh Kumar
    Date: 12/10/2026
    Rx: Paracetamol 500 mg tablets, 2 times daily.
    Total Amount: INR 450
    """
    res = ner_service.extract_entities(sample_text)
    assert res is not None
    assert res.total_entities > 0
    assert len(res.entities) == res.total_entities
    for ent in res.entities:
        assert ent.entity is not None
        assert ent.text is not None
        assert 0.0 <= ent.confidence <= 1.0


# ---------------------------------------------------------------------------
# 2. Model 2: BGE Retrieval Tests
# ---------------------------------------------------------------------------

def test_model_2_bge_embedding_and_retrieval():
    """Verify Model 2 produces 384-d normalized embeddings and ranks passages."""
    texts = ["Patient with type 2 diabetes started metformin.", "Knee replacement surgery guidelines."]
    embs = embedding_service.encode(texts, normalize=True)
    assert len(embs) == 2
    assert len(embs[0]) == 384
    # Check L2 normalization: norm should be ~1.0
    norm = sum(x**2 for x in embs[0]) ** 0.5
    assert abs(norm - 1.0) < 0.01

    corpus = [
        {"id": "G1", "title": "Diabetes Guidelines", "text": "Metformin is first-line for type 2 diabetes.", "source": "ADA"},
        {"id": "G2", "title": "Orthopedic Guidelines", "text": "Total knee arthroplasty indications.", "source": "AAOS"}
    ]
    results = embedding_service.retrieve_passages("Metformin dosage for diabetes", corpus, top_k=2)
    assert len(results) == 2
    assert results[0].passage_id == "G1"
    assert results[0].similarity_score > results[1].similarity_score


# ---------------------------------------------------------------------------
# 3. Model 3: DeBERTa NLI Tests
# ---------------------------------------------------------------------------

def test_model_3_deberta_nli_entailment_and_contradiction():
    """Verify Model 3 classifies premise and hypothesis into NLI classes."""
    # Entailment
    premise_ent = "Metformin is indicated as first-line pharmacotherapy for Type 2 Diabetes Mellitus."
    hypothesis_ent = "Patient was prescribed Metformin for glycemic control in Type 2 Diabetes."
    res_ent = nli_service.predict(premise=premise_ent, hypothesis=hypothesis_ent)
    assert res_ent.predicted_class in ("entailment", "neutral")
    assert 0.0 <= res_ent.confidence <= 1.0

    # Contradiction
    premise_contra = "Antibiotics are strictly contraindicated and ineffective for viral acute bronchitis."
    hypothesis_contra = "Prescribed oral Azithromycin 500mg to cure acute viral bronchitis."
    res_contra = nli_service.predict(premise=premise_contra, hypothesis=hypothesis_contra)
    assert res_contra.predicted_class in ("contradiction", "neutral")
    assert "contradiction" in res_contra.probabilities


# ---------------------------------------------------------------------------
# 4. Model 4: Provider Anomaly Tests
# ---------------------------------------------------------------------------

def test_model_4_provider_anomaly_v3():
    """Verify Model 4 calculates anomaly score on 9 provider features."""
    normal_provider = {
        "Tot_Benes": 150.0,
        "Tot_Srvcs": 300.0,
        "Tot_Bene_Day_Srvcs": 280.0,
        "Avg_Sbmtd_Chrg": 120.0,
        "Avg_Mdcr_Alowd_Amt": 80.0,
        "Services_Per_Beneficiary": 2.0,
        "Bene_Days_Per_Beneficiary": 1.86,
        "Medicare_Payment_Ratio": 0.78,
        "Submitted_To_Allowed_Ratio": 1.5,
    }
    res_normal = provider_anomaly_service.evaluate_provider(normal_provider)
    assert res_normal.has_sufficient_data is True
    assert isinstance(res_normal.is_anomaly, bool)
    assert isinstance(res_normal.anomaly_score, float)
    assert len(res_normal.features_used) == 9

    # Test missing data handling (does not invent arbitrary zeros)
    empty_provider = {}
    res_empty = provider_anomaly_service.evaluate_provider(empty_provider)
    assert res_empty.has_sufficient_data is False
    assert res_empty.screening_flag == "Insufficient provider data"


# ---------------------------------------------------------------------------
# 5. Model 5: Claim Anomaly Tests
# ---------------------------------------------------------------------------

def test_model_5_claim_anomaly_v3_strict():
    """Verify Model 5 evaluates claim features with V3 Strict Temporal benchmark."""
    sample_claim = {
        "CLM_ID": "CLM_TEST_001",
        "DESYNPUF_ID": "BENE_001",
        "PRVDR_NUM": "210001",
        "CLM_ADMSN_DT": "20260110",
        "CLM_FROM_DT": "20260110",
        "CLM_THRU_DT": "20260115",
        "NCH_BENE_DSCHRG_DT": "20260115",
        "CLM_PASS_THRU_PER_DIEM_AMT": 0.0,
        "NCH_BENE_PTA_COINSRNC_LBLTY_AM": 0.0,
        "NCH_BENE_BLOOD_DDCTBL_LBLTY_AM": 0.0,
        "CLM_UTLZTN_DAY_CNT": 5,
        "CLM_DRG_CD": "194",
        "diagnosis_codes": ["486", "49390"],
        "procedure_codes": ["9904"],
    }
    res = claim_anomaly_service.evaluate_claim(sample_claim)
    assert res.has_sufficient_data is True
    assert isinstance(res.is_anomaly, bool)
    assert isinstance(res.anomaly_score, float)
    assert res.v3_score is not None
    assert len(res.features_used) == 13


# ---------------------------------------------------------------------------
# 6. Preserved Model 5: Medicine Substitution Tests
# ---------------------------------------------------------------------------

def test_preserved_medicine_matcher():
    """Verify preserved Model 5 matches brand to generic medicine names."""
    res = medicine_service.match_medicines("paracetamol", "calpol")
    assert res is not None
    assert 0.0 <= res.match_probability <= 1.0
    assert isinstance(res.is_match, bool)


# ---------------------------------------------------------------------------
# 7. RapidOCR Service Tests
# ---------------------------------------------------------------------------

def test_ocr_service_initialization():
    """Verify RapidOCR engine is initialized and available."""
    assert ocr_service is not None
    # Test blank image handling
    from PIL import Image
    import io
    img = Image.new("RGB", (100, 40), color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    res = ocr_service.extract_text_from_image_bytes(buf.getvalue())
    assert isinstance(res, dict)
    assert "text" in res


# ---------------------------------------------------------------------------
# 8. Unified Pipeline Orchestration Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_unified_audit_pipeline():
    """Verify complete 12-step audit orchestrator execution."""
    sample_text = (
        "Patient presented to Fortis Hospital with acute type 2 diabetes decompensation. "
        "Initiated on Metformin 1,000 mg twice daily. Billed charge was INR 150."
    )
    report = await audit_orchestrator.run_pipeline(
        text=sample_text,
        source_type="clinical_note",
        store_claim=False
    )
    assert report is not None
    assert report.claim_id.startswith("clm_")
    assert report.ner_result is not None
    assert report.overall_verdict is not None
    assert report.overall_action is not None
    assert len(report.summary_markdown) > 50


# ---------------------------------------------------------------------------
# 9. API Endpoints Tests
# ---------------------------------------------------------------------------

def test_api_models_status_endpoint(client):
    """Verify GET /models/status reports all models as available."""
    res = client.get("/models/status")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ready"
    assert "models" in data
    assert data["models"]["model_1_ner"]["available"] is True
    assert data["models"]["model_2_retrieval"]["available"] is True
    assert data["models"]["model_3_nli"]["available"] is True
    assert data["models"]["model_4_provider_anomaly"]["available"] is True
    assert data["models"]["model_5_claim_anomaly"]["available"] is True
    assert data["models"]["medicine_matcher"]["available"] is True


def test_api_models_ner_endpoint(client):
    """Verify POST /models/ner/extract endpoint."""
    res = client.post("/models/ner/extract", json={"text": "Paracetamol 500 mg at Apollo Hospital"})
    assert res.status_code == 200
    data = res.json()
    assert "entities" in data
    assert "total_entities" in data


def test_api_models_nli_endpoint(client):
    """Verify POST /models/nli/predict endpoint."""
    payload = {
        "premise": "Metformin lowers blood glucose in type 2 diabetes.",
        "hypothesis": "Patient was given Metformin to manage diabetes."
    }
    res = client.post("/models/nli/predict", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert "predicted_class" in data
    assert "confidence" in data
    assert "probabilities" in data


def test_api_models_provider_anomaly_endpoint(client):
    """Verify POST /models/anomaly/provider endpoint."""
    payload = {
        "Tot_Benes": 100.0,
        "Tot_Srvcs": 200.0,
        "Tot_Bene_Day_Srvcs": 180.0,
        "Avg_Sbmtd_Chrg": 150.0,
        "Avg_Mdcr_Alowd_Amt": 100.0
    }
    res = client.post("/models/anomaly/provider", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert "is_anomaly" in data
    assert "anomaly_score" in data
    assert data["has_sufficient_data"] is True


def test_api_models_claim_anomaly_endpoint(client):
    """Verify POST /models/anomaly/claim endpoint."""
    payload = {
        "CLM_ID": "CLM_001",
        "DESYNPUF_ID": "BENE_001",
        "PRVDR_NUM": "210001",
        "admission_date": "2026-02-01",
        "discharge_date": "2026-02-05",
        "CLM_PASS_THRU_PER_DIEM_AMT": 0.0,
        "diagnosis_codes": ["486"],
        "procedure_codes": ["9904"]
    }
    res = client.post("/models/anomaly/claim", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert "is_anomaly" in data
    assert "anomaly_score" in data
    assert data["has_sufficient_data"] is True


def test_api_medicine_match_endpoint(client):
    """Verify POST /models/medicine/match endpoint."""
    payload = {
        "query_medicine": "paracetamol",
        "target_medicine": "calpol"
    }
    res = client.post("/models/medicine/match", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert "match_probability" in data
    assert "is_match" in data
