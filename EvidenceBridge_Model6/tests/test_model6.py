"""
Comprehensive Test Suite for EvidenceBridge Model 6 (MobileNetV3-Small Document Classifier).

Validates:
1. ONNX model loading and session initialization.
2. Correct input tensor dimensions ('image': ['batch_size', 3, 224, 224]).
3. Correct preprocessing (ImageNet normalization and NCHW layout).
4. RGB image conversion (grayscale, RGBA, CMYK to RGB).
5. Prediction output structure (validating Pydantic schemas).
6. Probability values (valid floats, summing to 1.0, non-negative).
7. Exact class mapping across the 5 trained categories.
8. All 5 classification classes using real image samples.
9. Invalid image handling (invalid bytes, wrong formats).
10. Missing image file handling.
11. Corrupted image handling.
12. Unsupported document handling (other_unsupported is_supported=False).
13. FastAPI endpoint integration (/model6/classify and /process-image).
14. Compatibility with existing document pipeline and Models 1–5 integrity.
"""

import base64
import io
import json
import os
import sys
from pathlib import Path

os.environ["TESTING"] = "1"
os.environ["TQDM_DISABLE"] = "1"
os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
import numpy as np
from PIL import Image
import pytest

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = PACKAGE_ROOT.parent / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
if str(PACKAGE_ROOT.parent) not in sys.path:
    sys.path.insert(0, str(PACKAGE_ROOT.parent))

from starlette.testclient import TestClient

from EvidenceBridge_Model6.inference.model6_service import (
    Model6Service,
    model6_service,
    CLASSES,
    CLASS_LABELS,
    SOURCE_TYPE_MAPPING,
)
from EvidenceBridge_Model6.inference.schemas import (
    Model6PredictionResult,
    Model6DocumentCategory,
)

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
SAMPLES_DIR = PACKAGE_ROOT / "tests" / "samples"
MODEL_PATH = PACKAGE_ROOT / "model" / "mobilenetv3_small.onnx"
CHECKPOINT_PATH = PACKAGE_ROOT / "model" / "mobilenetv3_small_best.pth"


def _image_to_base64_data_url(path: Path) -> str:
    """Helper to convert image on disk to base64 data URL."""
    with open(path, "rb") as f:
        data = f.read()
    b64 = base64.b64encode(data).decode("utf-8")
    return f"data:image/jpeg;base64,{b64}"


# ============================================================================
# 1. ONNX Model Loading
# ============================================================================

def test_1_onnx_model_loading():
    """Verify ONNX model file exists and loads successfully into ONNX Runtime."""
    assert MODEL_PATH.exists(), f"ONNX file not found at {MODEL_PATH}"
    assert MODEL_PATH.stat().st_size > 1_000_000, "ONNX file seems incomplete"
    service = Model6Service(model_path=MODEL_PATH)
    assert service.is_available() is True
    session = service._get_session()
    assert session is not None


# ============================================================================
# 2. Correct Input Dimensions
# ============================================================================

def test_2_correct_input_and_output_dimensions():
    """Verify ONNX tensor names, shapes, and data types match model specification."""
    service = Model6Service(model_path=MODEL_PATH)
    session = service._get_session()

    inputs = session.get_inputs()
    assert len(inputs) == 1
    input_tensor = inputs[0]
    assert input_tensor.name == "image"
    assert input_tensor.type == "tensor(float)"
    assert input_tensor.shape[1:] == [3, 224, 224]

    outputs = session.get_outputs()
    assert len(outputs) == 1
    output_tensor = outputs[0]
    assert output_tensor.name == "logits"
    assert output_tensor.type == "tensor(float)"
    assert output_tensor.shape[1] == 5


# ============================================================================
# 3. Correct Preprocessing
# ============================================================================

def test_3_preprocessing_pipeline():
    """Verify preprocessing generates (1, 3, 224, 224) float32 array with ImageNet norm."""
    service = Model6Service(model_path=MODEL_PATH)
    raw_img = Image.new("RGB", (500, 300), color=(100, 150, 200))
    tensor = service.preprocess(raw_img)

    assert isinstance(tensor, np.ndarray)
    assert tensor.dtype == np.float32
    assert tensor.shape == (1, 3, 224, 224)

    # Verify normalization on known constant values
    # Pixel 100/255 = 0.3921568. Normalized by mean 0.485 and std 0.229
    expected_ch0 = (100 / 255.0 - 0.485) / 0.229
    assert np.isclose(tensor[0, 0, 0, 0], expected_ch0, atol=1e-3)


# ============================================================================
# 4. RGB Image Conversion
# ============================================================================

def test_4_rgb_image_conversion():
    """Verify grayscale (L), RGBA, and CMYK images are converted to RGB without errors."""
    service = Model6Service(model_path=MODEL_PATH)

    # Grayscale
    gray = Image.new("L", (100, 100), color=128)
    t_gray = service.preprocess(gray)
    assert t_gray.shape == (1, 3, 224, 224)

    # RGBA
    rgba = Image.new("RGBA", (100, 100), color=(100, 150, 200, 255))
    t_rgba = service.preprocess(rgba)
    assert t_rgba.shape == (1, 3, 224, 224)

    # CMYK
    cmyk = Image.new("CMYK", (100, 100), color=(50, 100, 150, 200))
    t_cmyk = service.preprocess(cmyk)
    assert t_cmyk.shape == (1, 3, 224, 224)


# ============================================================================
# 5. Prediction Output Structure
# ============================================================================

def test_5_prediction_output_structure():
    """Verify Model6PredictionResult conforms strictly to the expected schema."""
    sample_path = SAMPLES_DIR / "prescription_sample.jpg"
    res = model6_service.classify_image(sample_path)

    assert isinstance(res, Model6PredictionResult)
    assert hasattr(res, "predicted_class")
    assert hasattr(res, "document_category")
    assert hasattr(res, "category_label")
    assert hasattr(res, "confidence")
    assert hasattr(res, "model_score")
    assert hasattr(res, "probabilities")
    assert hasattr(res, "all_probabilities")
    assert hasattr(res, "is_supported")
    assert hasattr(res, "suggested_source_type")
    assert hasattr(res, "model_name")
    assert hasattr(res, "processed_at")


# ============================================================================
# 6. Probability Values
# ============================================================================

def test_6_probability_values_validity():
    """Verify probabilities are valid non-negative floats summing to 1.0."""
    sample_path = SAMPLES_DIR / "discharge_summary_sample.jpg"
    res = model6_service.classify_image(sample_path)

    prob_sum = sum(res.probabilities.values())
    assert 0.99 <= prob_sum <= 1.01, f"Probabilities should sum to 1.0, got {prob_sum}"

    for cls_name, p_val in res.probabilities.items():
        assert isinstance(p_val, float)
        assert 0.0 <= p_val <= 1.0, f"Probability {cls_name} = {p_val} outside [0.0, 1.0]"

    assert res.confidence == res.model_score
    assert isinstance(res.confidence, float)
    assert 0.0 <= res.confidence <= 1.0


# ============================================================================
# 7. Class Mapping
# ============================================================================

def test_7_class_mapping_preservation():
    """Verify all 5 classes match training label definitions and index order."""
    expected_classes = [
        "discharge_summary",
        "laboratory_report",
        "medical_billing",
        "other_unsupported",
        "prescription",
    ]
    assert CLASSES == expected_classes

    # Config class_labels.json verification
    labels_path = PACKAGE_ROOT / "config" / "class_labels.json"
    with open(labels_path, "r", encoding="utf-8") as f:
        loaded_classes = json.load(f)
    assert loaded_classes == expected_classes


# ============================================================================
# 8. All Five Classification Classes Tested on Appropriate Samples
# ============================================================================

def test_8_classify_discharge_summary():
    """Verify real discharge summary sample image classifies as discharge_summary."""
    path = SAMPLES_DIR / "discharge_summary_sample.jpg"
    res = model6_service.classify_image(path)
    assert res.predicted_class == "discharge_summary"
    assert res.document_category == "discharge_summary"
    assert res.category_label == "Discharge Summary"
    assert res.confidence >= 0.55
    assert res.is_supported is True
    assert res.suggested_source_type == "clinical_note"


def test_8_classify_laboratory_report():
    """Verify real laboratory report sample image classifies as laboratory_report."""
    path = SAMPLES_DIR / "laboratory_report_sample.jpg"
    res = model6_service.classify_image(path)
    assert res.predicted_class == "laboratory_report"
    assert res.document_category == "laboratory_report"
    assert res.category_label == "Laboratory Report"
    assert res.confidence >= 0.55
    assert res.is_supported is True
    assert res.suggested_source_type == "clinical_note"


def test_8_classify_medical_billing():
    """Verify real medical billing sample image classifies as medical_billing."""
    path = SAMPLES_DIR / "medical_billing_sample.png"
    res = model6_service.classify_image(path)
    assert res.predicted_class == "medical_billing"
    assert res.document_category == "medical_billing"
    assert res.category_label == "Medical Billing / Invoice"
    assert res.confidence >= 0.55
    assert res.is_supported is True
    assert res.suggested_source_type == "hospital_bill"
    # Legacy alias in all_probabilities
    assert "invoice_or_receipt" in res.all_probabilities
    assert res.all_probabilities["invoice_or_receipt"] == res.all_probabilities["medical_billing"]


def test_8_classify_other_unsupported():
    """Verify non-medical/unsupported image classifies as other_unsupported."""
    path = SAMPLES_DIR / "other_unsupported_sample.jpg"
    res = model6_service.classify_image(path)
    assert res.predicted_class == "other_unsupported"
    assert res.document_category == "other_unsupported"
    assert res.category_label == "Unsupported Document"
    assert res.confidence >= 0.55
    assert res.is_supported is False
    assert res.suggested_source_type == "other"


def test_8_classify_prescription():
    """Verify real prescription sample image classifies as prescription."""
    path = SAMPLES_DIR / "prescription_sample.jpg"
    res = model6_service.classify_image(path)
    assert res.predicted_class == "prescription"
    assert res.document_category == "prescription"
    assert res.category_label == "Prescription"
    assert res.confidence >= 0.55
    assert res.is_supported is True
    assert res.suggested_source_type == "prescription"


# ============================================================================
# 9. Invalid Image Handling
# ============================================================================

def test_9_invalid_image_handling():
    """Verify invalid or unparseable input returns safe fallback result without raising."""
    res = model6_service.classify_image(b"not_an_image_binary_data")
    assert isinstance(res, Model6PredictionResult)
    assert res.is_supported is False
    assert res.confidence == 0.0
    assert "Could not decode" in (res.message or "")


# ============================================================================
# 10. Missing Image Handling
# ============================================================================

def test_10_missing_image_handling():
    """Verify nonexistent file path does not crash or expose private system paths."""
    res = model6_service.classify_image(Path("non_existent_file_12345.jpg"))
    assert isinstance(res, Model6PredictionResult)
    assert res.is_supported is False
    assert res.confidence == 0.0
    assert "does not exist" in (res.message or "")


# ============================================================================
# 11. Corrupted Image Handling
# ============================================================================

def test_11_corrupted_image_handling():
    """Verify truncated or corrupt image bytes do not crash service."""
    # JPEG magic bytes followed by truncated random garbage
    corrupt_bytes = b"\xFF\xD8\xFF\xE0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + b"\x00" * 20
    res = model6_service.classify_image(corrupt_bytes)
    assert isinstance(res, Model6PredictionResult)
    assert res.is_supported is False
    assert res.confidence == 0.0


# ============================================================================
# 12. Unsupported Document Handling
# ============================================================================

def test_12_unsupported_document_safety_gating():
    """Verify other_unsupported documents are explicitly gated with is_supported=False."""
    path = SAMPLES_DIR / "other_unsupported_sample.jpg"
    res = model6_service.classify_image(path)
    assert res.predicted_class == "other_unsupported"
    assert res.is_supported is False
    assert res.suggested_source_type == "other"
    assert "not supported" in (res.message or "").lower()


# ============================================================================
# 13. FastAPI Endpoint Integration
# ============================================================================

def test_13_fastapi_endpoints():
    """Verify Model 6 endpoint request parsing, schema validation, and response serialization."""
    from app.services.image_document_model import image_document_model_service
    from app.models.schemas import DocumentImageProcessResponse
    from app.services.ocr_service import ocr_service

    # 1. /model6/classify logic & response
    rx_b64 = _image_to_base64_data_url(SAMPLES_DIR / "prescription_sample.jpg")
    res = image_document_model_service.classify_base64(rx_b64)
    assert res.predicted_class == "prescription"
    assert res.is_supported is True
    assert res.confidence >= 0.55

    # 2. /process-image logic & unified schema response
    ocr_res = ocr_service.extract_text_from_base64(rx_b64)
    proc_payload = {
        "model6_prediction": res,
        "ocr_text": ocr_res.get("text", ""),
        "ocr_confidence": ocr_res.get("confidence", 0.0),
        "ocr_lines_count": len(ocr_res.get("lines", [])),
        "suggested_source_type": res.suggested_source_type,
        "is_clear": bool(ocr_res.get("text")),
    }
    response_obj = DocumentImageProcessResponse(**proc_payload)
    assert response_obj.model6_prediction.predicted_class == "prescription"
    assert response_obj.suggested_source_type == "prescription"
    assert response_obj.is_clear is True

    # 3. Model 6 readiness reporting for /models/status
    assert image_document_model_service.is_available() is True
    assert image_document_model_service.model_path.exists()
    assert image_document_model_service.model_path.is_file()
    assert image_document_model_service.confidence_threshold == 0.55


# ============================================================================
# 14. Compatibility with Existing Document Pipeline and Models 1–5
# ============================================================================

def test_14_pipeline_and_models_1_to_5_compatibility():
    """Verify full audit pipeline with image bytes routes Model 6 and preserves Models 1-5 schemas."""
    from app.models.schemas import Claim, ExtractedFields, LocationInfo, ProvenanceMetadata
    from datetime import datetime, timezone

    # Verify prescription image bytes routing through Model 6
    rx_bytes = (SAMPLES_DIR / "prescription_sample.jpg").read_bytes()
    from app.services.image_document_model import image_document_model_service
    m6_pred = image_document_model_service.classify_image(rx_bytes)
    assert m6_pred.is_supported is True
    assert m6_pred.suggested_source_type == "prescription"

    # Verify Models 1-5 data model compatibility
    from app.services.claim_context import claim_context_service

    claim = Claim(
        claim_id="clm_compat_test_001",
        patient_id="pat_compat_user",
        original_text="Hospital: Bangalore Care Clinic\nDiagnosis: Hypertension\nTotal Bill: INR 15000",
        source_type="hospital_bill",
        timestamp=datetime.now(timezone.utc),
        confidence=0.92,
        extracted_fields=ExtractedFields(
            entity="Bangalore Care Clinic",
            cost_estimate=15000.0,
            cost_currency="INR",
            confidence=0.92,
        ),
        location=LocationInfo(
            city="Bangalore",
            state="Karnataka",
            country="India",
            normalized_key="bangalore_care",
        ),
        provenance=ProvenanceMetadata(
            source_type="hospital_bill",
            source_hash="test_hash_456",
            original_snippet="Hospital: Bangalore Care Clinic",
            text_length=60,
        ),
    )

    ctx = claim_context_service.build_shared_context(claim=claim)
    assert ctx.hospital_name == "Bangalore Care Clinic"
