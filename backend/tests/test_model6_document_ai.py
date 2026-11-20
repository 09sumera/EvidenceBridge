"""
Comprehensive Tests for Model 6: Image-Based Medical Document AI (MobileNetV3-Small).

Validates:
1. Model 6 Checkpoint loading and initialization from EvidenceBridge_Model6.
2. Inference on supported Medical Billing / Invoice image -> 'medical_billing' ('hospital_bill').
3. Inference on supported Prescription image -> 'prescription' ('prescription').
4. Inference on supported Laboratory Report image -> 'laboratory_report' ('clinical_note').
5. Inference on supported Discharge Summary image -> 'discharge_summary' ('clinical_note').
6. Safe handling of Unsupported Document images -> 'other_unsupported' (is_supported=False).
7. Base64 string decoding and classification via classify_base64().
8. Corrupt or unparseable base64 handled safely without crashing.
9. Low-confidence/synthetic noise image handling with valid probability outputs.
10. Integration with RapidOCR in process-image endpoint flow.
11. Preservation of manual text submission and Models 1–5 integrity.
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


MODEL6_ROOT = Path(__file__).resolve().parents[2] / "EvidenceBridge_Model6"
SAMPLES_DIR = MODEL6_ROOT / "tests" / "samples"

INVOICE_IMAGE = SAMPLES_DIR / "medical_billing_sample.png"
PRESCRIPTION_IMAGE = SAMPLES_DIR / "prescription_sample.jpg"
LAB_REPORT_IMAGE = SAMPLES_DIR / "laboratory_report_sample.jpg"
DISCHARGE_IMAGE = SAMPLES_DIR / "discharge_summary_sample.jpg"
UNSUPPORTED_IMAGE = SAMPLES_DIR / "other_unsupported_sample.jpg"


def _image_to_base64(path: Path) -> str:
    """Helper to convert image file on disk to data URL."""
    with open(path, "rb") as f:
        data = f.read()
    b64 = base64.b64encode(data).decode("utf-8")
    ext = "png" if path.suffix.lower() == ".png" else "jpeg"
    return f"data:image/{ext};base64,{b64}"


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
    """Verify Model 6 trained MobileNetV3-Small ONNX model exists and is accessible."""
    assert image_document_model_service.is_available() is True
    assert image_document_model_service.model_path.exists()
    assert image_document_model_service.model_path.is_file()
    assert set(CLASSES) == {
        "discharge_summary",
        "laboratory_report",
        "medical_billing",
        "other_unsupported",
        "prescription",
    }


# ============================================================================
# Scenario 2: Supported Medical Invoice / Billing Image Inference
# ============================================================================

def test_scenario_2_classify_invoice_image():
    """Verify genuine medical invoice image is classified as medical_billing."""
    if not INVOICE_IMAGE.exists():
        pytest.skip(f"Test image not found at {INVOICE_IMAGE}")

    res = image_document_model_service.classify_image(INVOICE_IMAGE)
    assert isinstance(res, Model6PredictionResult)
    assert res.document_category == "medical_billing"
    assert res.category_label == "Medical Billing / Invoice"
    assert res.model_score >= 0.55, f"Expected confidence >= threshold, got {res.model_score}"
    assert res.is_supported is True
    assert res.suggested_source_type == "hospital_bill"
    assert "medical_billing" in res.all_probabilities
    assert res.all_probabilities["medical_billing"] >= 0.55
    # Verify legacy alias for backward compatibility
    assert "invoice_or_receipt" in res.all_probabilities
    assert res.all_probabilities["invoice_or_receipt"] == res.all_probabilities["medical_billing"]


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
    assert res.model_score >= 0.55, f"Expected confidence >= threshold, got {res.model_score}"
    assert res.is_supported is True
    assert res.suggested_source_type == "prescription"
    assert "prescription" in res.all_probabilities
    assert res.all_probabilities["prescription"] >= 0.55


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
    assert res.model_score >= 0.55, f"Expected confidence >= threshold, got {res.model_score}"
    assert res.is_supported is True
    assert res.suggested_source_type == "clinical_note"
    assert "laboratory_report" in res.all_probabilities
    assert res.all_probabilities["laboratory_report"] >= 0.55


# ============================================================================
# Scenario 5: Supported Discharge Summary Image Inference
# ============================================================================

def test_scenario_5_classify_discharge_summary_image():
    """Verify genuine discharge summary image is classified as discharge_summary."""
    if not DISCHARGE_IMAGE.exists():
        pytest.skip(f"Test image not found at {DISCHARGE_IMAGE}")

    res = image_document_model_service.classify_image(DISCHARGE_IMAGE)
    assert isinstance(res, Model6PredictionResult)
    assert res.document_category == "discharge_summary"
    assert res.category_label == "Discharge Summary"
    assert res.model_score >= 0.55, f"Expected confidence >= threshold, got {res.model_score}"
    assert res.is_supported is True
    assert res.suggested_source_type == "clinical_note"
    assert "discharge_summary" in res.all_probabilities
    assert res.all_probabilities["discharge_summary"] >= 0.55


# ============================================================================
# Scenario 6: Unsupported Document Handling
# ============================================================================

def test_scenario_6_classify_unsupported_document():
    """Verify unsupported non-medical image is gated safely with is_supported=False."""
    if not UNSUPPORTED_IMAGE.exists():
        pytest.skip(f"Test image not found at {UNSUPPORTED_IMAGE}")

    res = image_document_model_service.classify_image(UNSUPPORTED_IMAGE)
    assert isinstance(res, Model6PredictionResult)
    assert res.document_category == "other_unsupported"
    assert res.is_supported is False
    assert res.suggested_source_type == "other"


# ============================================================================
# Scenario 7: Base64 Input Decoding and Classification
# ============================================================================

def test_scenario_7_classify_base64_data_url():
    """Verify classify_base64() decodes data URL and runs Model 6 inference."""
    if not INVOICE_IMAGE.exists():
        pytest.skip(f"Test image not found at {INVOICE_IMAGE}")

    b64_url = _image_to_base64(INVOICE_IMAGE)
    res = image_document_model_service.classify_base64(b64_url)
    assert res.document_category == "medical_billing"
    assert res.is_supported is True
    assert res.model_score >= 0.55


def test_scenario_8_corrupt_base64_handled_safely():
    """Verify corrupt or un-parseable base64 does not crash and returns safe fallback."""
    res = image_document_model_service.classify_base64("data:image/jpeg;base64,invalid_gibberish_12345!@#$")
    assert res.document_category == "uncertain_or_unsupported"
    assert res.is_supported is False
    assert res.model_score == 0.0


# ============================================================================
# Scenario 9: Low Confidence / Neutral Noise Image Handling
# ============================================================================

def test_scenario_9_low_confidence_noise_handling():
    """Verify uniform grey synthetic image is evaluated safely with valid probability output."""
    noise_bytes = _create_synthetic_noise_image()
    res = image_document_model_service.classify_image(noise_bytes)
    assert isinstance(res, Model6PredictionResult)
    assert len(res.all_probabilities) >= 5
    prob_sum = sum(res.probabilities.values()) if res.probabilities else sum(res.all_probabilities.values())
    assert 0.98 <= prob_sum <= 1.02


# ============================================================================
# Scenario 10: Integration with Unified Process Image Endpoint Logic
# ============================================================================

def test_scenario_10_document_process_image_endpoint_logic():
    """Verify combined Model 6 classification + RapidOCR text extraction logic."""
    if not INVOICE_IMAGE.exists():
        pytest.skip(f"Test image not found at {INVOICE_IMAGE}")

    from app.services.ocr_service import ocr_service

    b64_url = _image_to_base64(INVOICE_IMAGE)
    m6_res = image_document_model_service.classify_base64(b64_url)
    assert m6_res.is_supported is True
    assert m6_res.document_category == "medical_billing"

    ocr_res = ocr_service.extract_text_from_base64(b64_url)
    assert "text" in ocr_res
    assert isinstance(ocr_res["lines"], list)


# ============================================================================
# Scenario 11: Preservation of Manual Text Submission and Models 1–5 Integrity
# ============================================================================

def test_scenario_11_manual_text_submission_models_unaffected():
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
        "Total Bill: INR 30,000.00\n"
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
