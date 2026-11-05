"""
Comprehensive Tests for Model 6: Image-Based Medical Document AI (ResNet18).

Validates:
1. Model 6 Checkpoint loading and initialization from C:\\Users\\tejes\\Downloads\\EvidenceBridge_Model6_COMPLETE.
2. Inference on supported Invoice/Receipt image -> 'invoice_or_receipt' (Medical Invoice / Receipt).
3. Inference on supported Prescription image -> 'prescription' (Prescription).
4. Inference on supported Laboratory Report image -> 'laboratory_report' (Laboratory Report).
5. Safe handling of low-confidence/uncertain images (solid noise or ambiguous documents).
6. Base64 string decoding and classification via classify_base64().
7. Integration with RapidOCR in process-image endpoint flow.
8. Preservation of manual text submission and Models 1–5 integrity.
"""

import base64
import io
from pathlib import Path
import pytest
from PIL import Image

from app.config import get_settings
from app.services.image_document_model import (
    image_document_model_service,
    CLASSES,
    CLASS_LABELS,
    SOURCE_TYPE_MAPPING,
)
from app.models.schemas import Model6PredictionResult, Claim, ExtractedFields, LocationInfo, ProvenanceMetadata


MODEL6_ROOT = Path(r"C:\Users\tejes\Downloads\EvidenceBridge_Model6_COMPLETE\EvidenceBridge_Model6")
INVOICE_IMAGE = MODEL6_ROOT / "dataset" / "labels" / "review_images" / "invoice_or_receipt" / "MEDOCR_TRAIN_0227.jpg"
PRESCRIPTION_IMAGE = MODEL6_ROOT / "dataset" / "labels" / "review_images" / "prescription" / "MEDOCR_TRAIN_0068.jpg"
LAB_REPORT_IMAGE = MODEL6_ROOT / "dataset" / "labels" / "review_images" / "laboratory_report" / "MEDOCR_TRAIN_0040.jpg"


def _image_to_base64(path: Path) -> str:
    """Helper to convert image file on disk to data URL."""
    with open(path, "rb") as f:
        data = f.read()
    b64 = base64.b64encode(data).decode("utf-8")
    return f"data:image/jpeg;base64,{b64}"


def _create_synthetic_noise_image() -> bytes:
    """Create a 224x224 synthetic uniform noise image."""
    img = Image.new("RGB", (224, 224), color=(128, 128, 128))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


# ============================================================================
# Scenario 1: Model 6 Availability and Architecture Verification
# ============================================================================

def test_scenario_1_model6_checkpoint_availability():
    """Verify Model 6 trained ResNet18 checkpoint exists and is accessible."""
    assert image_document_model_service.is_available() is True
    assert image_document_model_service.model_path.exists()
    assert image_document_model_service.model_path.is_file()
    assert set(CLASSES) == {"prescription", "laboratory_report", "invoice_or_receipt"}


# ============================================================================
# Scenario 2: Supported Medical Invoice / Receipt Image Inference
# ============================================================================

def test_scenario_2_classify_invoice_image():
    """Verify genuine medical invoice image is classified as invoice_or_receipt."""
    if not INVOICE_IMAGE.exists():
        pytest.skip(f"Test image not found at {INVOICE_IMAGE}")

    res = image_document_model_service.classify_image(INVOICE_IMAGE)
    assert isinstance(res, Model6PredictionResult)
    assert res.document_category == "invoice_or_receipt"
    assert res.category_label == "Medical Invoice / Receipt"
    assert res.model_score >= 0.90, f"Expected high confidence, got {res.model_score}"
    assert res.is_supported is True
    assert res.suggested_source_type == "hospital_bill"
    assert "invoice_or_receipt" in res.all_probabilities
    assert res.all_probabilities["invoice_or_receipt"] >= 0.90


# ============================================================================
# Scenario 3: Supported Prescription Image Inference
# ============================================================================

def test_scenario_3_classify_prescription_image():
    """Verify genuine prescription image is classified as prescription."""
    if not PRESCRIPTION_IMAGE.exists():
        pytest.skip(f"Test image not found at {PRESCRIPTION_IMAGE}")

    res = image_document_model_service.classify_image(PRESCRIPTION_IMAGE)
    assert isinstance(res, Model6PredictionResult)
    assert res.document_category == "prescription"
    assert res.category_label == "Prescription"
    assert res.model_score >= 0.90, f"Expected high confidence, got {res.model_score}"
    assert res.is_supported is True
    assert res.suggested_source_type == "prescription"
    assert "prescription" in res.all_probabilities
    assert res.all_probabilities["prescription"] >= 0.90


# ============================================================================
# Scenario 4: Supported Laboratory Report Image Inference
# ============================================================================

def test_scenario_4_classify_laboratory_report_image():
    """Verify genuine laboratory report image is classified as laboratory_report."""
    if not LAB_REPORT_IMAGE.exists():
        pytest.skip(f"Test image not found at {LAB_REPORT_IMAGE}")

    res = image_document_model_service.classify_image(LAB_REPORT_IMAGE)
    assert isinstance(res, Model6PredictionResult)
    assert res.document_category == "laboratory_report"
    assert res.category_label == "Laboratory Report"
    assert res.model_score >= 0.90, f"Expected high confidence, got {res.model_score}"
    assert res.is_supported is True
    assert res.suggested_source_type == "clinical_note"
    assert "laboratory_report" in res.all_probabilities
    assert res.all_probabilities["laboratory_report"] >= 0.90


# ============================================================================
# Scenario 5: Base64 Input Decoding and Classification
# ============================================================================

def test_scenario_5_classify_base64_data_url():
    """Verify classify_base64() decodes data URL and runs Model 6 inference."""
    if not INVOICE_IMAGE.exists():
        pytest.skip(f"Test image not found at {INVOICE_IMAGE}")

    b64_url = _image_to_base64(INVOICE_IMAGE)
    res = image_document_model_service.classify_base64(b64_url)
    assert res.document_category == "invoice_or_receipt"
    assert res.is_supported is True
    assert res.model_score >= 0.90


def test_scenario_6_corrupt_base64_handled_safely():
    """Verify corrupt or un-parseable base64 does not crash and returns safe fallback."""
    res = image_document_model_service.classify_base64("data:image/jpeg;base64,invalid_gibberish_12345!@#$")
    assert res.document_category == "uncertain_or_unsupported"
    assert res.is_supported is False
    assert res.model_score == 0.0


# ============================================================================
# Scenario 7: Low Confidence / Neutral Noise Image Handling
# ============================================================================

def test_scenario_7_low_confidence_noise_handling():
    """Verify uniform grey synthetic image is evaluated safely with valid probability output."""
    noise_bytes = _create_synthetic_noise_image()
    res = image_document_model_service.classify_image(noise_bytes)
    assert isinstance(res, Model6PredictionResult)
    # The output should have all 3 class probabilities summing to ~1.0
    assert len(res.all_probabilities) == 3
    prob_sum = sum(res.all_probabilities.values())
    assert 0.98 <= prob_sum <= 1.02


# ============================================================================
# Scenario 8: Integration with Unified Process Image Endpoint Logic
# ============================================================================

def test_scenario_8_document_process_image_endpoint_logic():
    """Verify combined Model 6 classification + RapidOCR text extraction logic."""
    if not INVOICE_IMAGE.exists():
        pytest.skip(f"Test image not found at {INVOICE_IMAGE}")

    from app.services.ocr_service import ocr_service

    b64_url = _image_to_base64(INVOICE_IMAGE)
    m6_res = image_document_model_service.classify_base64(b64_url)
    assert m6_res.is_supported is True
    assert m6_res.document_category == "invoice_or_receipt"

    ocr_res = ocr_service.extract_text_from_base64(b64_url)
    assert "text" in ocr_res
    assert isinstance(ocr_res["lines"], list)


# ============================================================================
# Scenario 9: Preservation of Manual Text Submission and Models 1–5 Integrity
# ============================================================================

def test_scenario_9_manual_text_submission_models_unaffected():
    """Verify text-based claims continue functioning through Models 1-5 without images."""
    from app.services.claim_context import claim_context_service
    from app.services.provider_anomaly import provider_anomaly_service
    from app.services.claim_anomaly import claim_anomaly_service
    from datetime import datetime, timezone

    manual_text = (
        "INPATIENT CLINICAL SUMMARY & BILLING AUDIT\n"
        "Hospital: Shree Medical Institute, Davangere\n"
        "Encounter Type: INPATIENT\n"
        "Admission Date: 10 February 2026\n"
        "Discharge Date: 14 February 2026\n"
        "Length of stay: 4 days\n"
        "Primary Diagnosis: Bacterial Pneumonia\n"
        "Total Bill: ₹30,000.00\n"
    )

    claim = Claim(
        claim_id="clm_manual_text_test_001",
        patient_id="pat_manual_user",
        original_text=manual_text,
        source_type="hospital_bill",
        timestamp=datetime.now(timezone.utc),
        confidence=0.95,
        extracted_fields=ExtractedFields(
            entity="Shree Medical Institute",
            cost_estimate=30000.0,
            cost_currency="INR",
            confidence=0.95,
        ),
        location=LocationInfo(
            city="Davangere",
            state="Karnataka",
            country="India",
            normalized_key="shree_davangere",
        ),
        provenance=ProvenanceMetadata(
            source_type="hospital_bill",
            source_hash="mock_hash_123",
            original_snippet=manual_text[:100],
            text_length=len(manual_text),
        ),
    )

    # 1. Shared Context builds cleanly
    ctx = claim_context_service.build_shared_context(claim=claim)
    assert ctx.hospital_name == "Shree Medical Institute"
    assert not ctx.hospital_name.startswith("EE ")

    # 2. Model 4 Provider Anomaly evaluates without crashing
    m4_res = provider_anomaly_service.evaluate_provider(provider_data=None, provider_name="Shree Medical Institute")
    assert m4_res.decision == "INSUFFICIENT_DATA"

    # 3. Model 5 Claim Anomaly evaluates 4-day inpatient stay
    claim_data = claim_anomaly_service.derive_claim_data_from_claim(claim)
    assert claim_data["CLM_UTLZTN_DAY_CNT"] == 4
    m5_res = claim_anomaly_service.evaluate_claim(claim_data=claim_data, claim=claim)
    assert m5_res.decision in ("NOT_FLAGGED", "REVIEW_RECOMMENDED")
