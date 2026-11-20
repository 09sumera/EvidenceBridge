"""
Model 6: Image-Based Medical Document AI Service (MobileNetV3-Small).
Integrates the trained MobileNetV3-Small ONNX model to classify medical document images
into discharge_summary, laboratory_report, medical_billing, prescription, or other_unsupported.
"""

import base64
import io
import json
import logging
from pathlib import Path
from typing import Any, Optional, Union
import numpy as np
import onnxruntime as ort
from PIL import Image

from app.config import get_settings
from app.models.schemas import Model6PredictionResult
from app.utils.logger import logger


# The 5 trained classes in exact model index order
CLASSES = [
    "discharge_summary",
    "laboratory_report",
    "medical_billing",
    "other_unsupported",
    "prescription",
]

CLASS_LABELS: dict[str, str] = {
    "discharge_summary": "Discharge Summary",
    "laboratory_report": "Laboratory Report",
    "medical_billing": "Medical Billing / Invoice",
    "prescription": "Prescription",
    "other_unsupported": "Unsupported Document",
    "uncertain_or_unsupported": "Uncertain Document Type",
    # Legacy alias
    "invoice_or_receipt": "Medical Billing / Invoice",
}

SOURCE_TYPE_MAPPING: dict[str, str] = {
    "discharge_summary": "clinical_note",
    "laboratory_report": "clinical_note",
    "medical_billing": "hospital_bill",
    "prescription": "prescription",
    "other_unsupported": "other",
    "uncertain_or_unsupported": "other",
    # Legacy alias
    "invoice_or_receipt": "hospital_bill",
}

CATEGORY_DESCRIPTIONS: dict[str, str] = {
    "discharge_summary": "Classified as Inpatient Discharge Summary. Audited for admission/discharge dates, clinical courses, and discharge diagnoses.",
    "laboratory_report": "Classified as Diagnostic Laboratory Report. Audited for clinical findings, reference ranges, and diagnostic consistency.",
    "medical_billing": "Classified as Medical Billing or Invoice. Audited for itemized billing charges and pricing benchmarks.",
    "prescription": "Classified as Medical Prescription. Audited for drug indications, dosages, and guideline compliance.",
    "other_unsupported": "Classified as Non-Medical or Unsupported Document. Document will not enter medical extraction pipelines.",
    # Legacy alias
    "invoice_or_receipt": "Classified as Medical Billing or Invoice. Audited for itemized billing charges and pricing benchmarks.",
}


def _get_project_root() -> Path:
    """Find EvidenceBridge repository root."""
    # From backend/app/services -> backend/app -> backend -> evidencebridge root
    return Path(__file__).resolve().parents[3]


class ImageDocumentModelService:
    """
    Inference service for Model 6: Image-Based Medical Document AI (MobileNetV3-Small).
    Loads and runs the trained ONNX model using ONNX Runtime.
    """

    def __init__(self, model_path: Optional[str] = None, device: Optional[str] = None):
        self.settings = get_settings()
        self.raw_path = model_path or self.settings.MODEL_6_DOCUMENT_AI_PATH

        # Resolve path relative to project root if relative
        candidate = Path(self.raw_path)
        if not candidate.is_absolute():
            self.model_path = _get_project_root() / candidate
        else:
            self.model_path = candidate

        self.configured_device = device or self.settings.MODEL_6_DEVICE or "cpu"
        self.confidence_threshold = self.settings.MODEL_6_CONFIDENCE_THRESHOLD

        self._session: Optional[ort.InferenceSession] = None
        self._input_name: Optional[str] = None
        self._output_name: Optional[str] = None

        # Preprocessing normalization constants (ImageNet defaults from preprocessing.json)
        self.target_size = (224, 224)
        self.mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        self.std = np.array([0.229, 0.224, 0.225], dtype=np.float32)

    def is_available(self) -> bool:
        """Check if trained Model 6 ONNX model exists on disk."""
        try:
            return self.model_path.exists() and self.model_path.is_file()
        except Exception:
            return False

    def _load_model(self) -> None:
        """Initialize ONNX session once and cache."""
        if self._session is not None:
            return

        if not self.is_available():
            raise FileNotFoundError(
                f"Model 6 ONNX model not found at: {self.model_path.name}. "
                "Ensure EvidenceBridge_Model6/model/mobilenetv3_small.onnx is present."
            )

        providers = ["CPUExecutionProvider"]
        logger.info(f"Loading Model 6 MobileNetV3-Small ONNX model from '{self.model_path}'...")
        session = ort.InferenceSession(str(self.model_path), providers=providers)

        inputs = session.get_inputs()
        outputs = session.get_outputs()
        self._input_name = inputs[0].name
        self._output_name = outputs[0].name
        self._session = session
        logger.info(
            f"Model 6 ONNX session initialized successfully (input: '{self._input_name}', output: '{self._output_name}')"
        )

    def _preprocess(self, img: Image.Image) -> np.ndarray:
        """
        Preprocess PIL image into NCHW float32 numpy array matching preprocessing.json:
        1. Convert to RGB
        2. Resize to 224x224
        3. Convert to float32 and scale / 255.0
        4. Normalize using ImageNet mean & std
        5. Transpose HWC to NCHW
        6. Expand batch dimension
        """
        if img.mode != "RGB":
            img = img.convert("RGB")

        if img.size != self.target_size:
            img = img.resize(self.target_size, Image.Resampling.BILINEAR)

        arr = np.asarray(img, dtype=np.float32) / 255.0
        arr = (arr - self.mean) / self.std
        arr = np.transpose(arr, (2, 0, 1))
        arr = np.expand_dims(arr, axis=0).astype(np.float32)
        return arr

    def classify_image(self, image_input: Union[bytes, Image.Image, Path, str]) -> Model6PredictionResult:
        """
        Run inference on image bytes, PIL Image, or file path.
        Returns Model6PredictionResult with category, probabilities, confidence, and source type mapping.
        """
        try:
            self._load_model()
        except Exception as e:
            logger.error(f"Failed to load Model 6: {e}")
            return Model6PredictionResult(
                predicted_class="other_unsupported",
                document_category="uncertain_or_unsupported",
                category_label="Model 6 Unavailable",
                confidence=0.0,
                model_score=0.0,
                probabilities={},
                all_probabilities={},
                is_supported=False,
                suggested_source_type="other",
                message=f"Model 6 checkpoint could not be loaded: {e}",
            )

        # 1. Load image into PIL Image
        try:
            if isinstance(image_input, Image.Image):
                img = image_input
            elif isinstance(image_input, bytes):
                if not image_input or len(image_input) < 8:
                    raise ValueError("Empty or truncated image bytes")
                img = Image.open(io.BytesIO(image_input))
                img.verify()
                img = Image.open(io.BytesIO(image_input))
            elif isinstance(image_input, (str, Path)):
                p = Path(image_input)
                if not p.exists() or not p.is_file():
                    raise FileNotFoundError(f"Image file does not exist: {p.name}")
                img = Image.open(p)
                img.verify()
                img = Image.open(p)
            else:
                raise ValueError(f"Unsupported image input type: {type(image_input)}")
        except Exception as img_err:
            logger.error(f"Failed to decode image for Model 6: {img_err}")
            return Model6PredictionResult(
                predicted_class="other_unsupported",
                document_category="uncertain_or_unsupported",
                category_label="Invalid Image",
                confidence=0.0,
                model_score=0.0,
                probabilities={},
                all_probabilities={},
                is_supported=False,
                suggested_source_type="other",
                message=f"Could not decode image file: {img_err}",
            )

        # 2. Preprocess using exact pipeline
        try:
            tensor = self._preprocess(img)
        except Exception as prep_err:
            logger.error(f"Failed to preprocess image for Model 6: {prep_err}")
            return Model6PredictionResult(
                predicted_class="other_unsupported",
                document_category="uncertain_or_unsupported",
                category_label="Preprocessing Error",
                confidence=0.0,
                model_score=0.0,
                probabilities={},
                all_probabilities={},
                is_supported=False,
                suggested_source_type="other",
                message=f"Image preprocessing failed: {prep_err}",
            )

        # 3. Model forward pass through ONNX Runtime
        try:
            logits = self._session.run([self._output_name], {self._input_name: tensor})[0][0]
        except Exception as inf_err:
            logger.error(f"ONNX inference failed: {inf_err}")
            return Model6PredictionResult(
                predicted_class="other_unsupported",
                document_category="uncertain_or_unsupported",
                category_label="Inference Error",
                confidence=0.0,
                model_score=0.0,
                probabilities={},
                all_probabilities={},
                is_supported=False,
                suggested_source_type="other",
                message=f"Inference error: {inf_err}",
            )

        # 4. Numerically stable softmax
        exp_logits = np.exp(logits - np.max(logits))
        probs = exp_logits / np.sum(exp_logits)

        # 5. Map probabilities across classes
        raw_prob_dict: dict[str, float] = {}
        all_prob_dict: dict[str, float] = {}
        for idx, cls_name in enumerate(CLASSES):
            prob_val = round(float(probs[idx]), 4)
            raw_prob_dict[cls_name] = prob_val
            all_prob_dict[cls_name] = prob_val

        # Provide legacy alias for frontend backward compatibility
        if "medical_billing" in all_prob_dict:
            all_prob_dict["invoice_or_receipt"] = all_prob_dict["medical_billing"]

        best_idx = int(np.argmax(probs))
        predicted_class = CLASSES[best_idx]
        best_score = float(probs[best_idx])
        conf_float = round(best_score, 4)

        # 6. Explicitly handle unsupported documents
        if predicted_class == "other_unsupported":
            logger.info(f"Model 6 classified document as '{predicted_class}' ({conf_float:.1%})")
            return Model6PredictionResult(
                predicted_class=predicted_class,
                document_category="other_unsupported",
                category_label=CLASS_LABELS["other_unsupported"],
                confidence=conf_float,
                model_score=conf_float,
                probabilities=raw_prob_dict,
                all_probabilities=all_prob_dict,
                is_supported=False,
                suggested_source_type="other",
                message=(
                    f"Document image was classified as '{CLASS_LABELS['other_unsupported']}' ({conf_float:.1%} confidence). "
                    "This document type is not supported for automated clinical or billing extraction."
                ),
            )

        # 7. Handle low confidence or ambiguous predictions safely
        if best_score < self.confidence_threshold:
            logger.info(
                f"Model 6 low confidence prediction: {predicted_class} ({conf_float:.3f} < {self.confidence_threshold})"
            )
            return Model6PredictionResult(
                predicted_class=predicted_class,
                document_category="uncertain_or_unsupported",
                category_label=CLASS_LABELS["uncertain_or_unsupported"],
                confidence=conf_float,
                model_score=conf_float,
                probabilities=raw_prob_dict,
                all_probabilities=all_prob_dict,
                is_supported=False,
                suggested_source_type="other",
                message=(
                    f"Image does not definitively match standard clinical templates "
                    f"(top match '{CLASS_LABELS.get(predicted_class, predicted_class)}' at {conf_float:.1%} confidence). "
                    "Please verify or select document type manually."
                ),
            )

        # 8. Return successfully classified result
        category_label = CLASS_LABELS.get(predicted_class, predicted_class)
        suggested_source = SOURCE_TYPE_MAPPING.get(predicted_class, "clinical_note")
        message = CATEGORY_DESCRIPTIONS.get(predicted_class, f"Identified as {category_label}.")

        return Model6PredictionResult(
            predicted_class=predicted_class,
            document_category=predicted_class,
            category_label=category_label,
            confidence=conf_float,
            model_score=conf_float,
            probabilities=raw_prob_dict,
            all_probabilities=all_prob_dict,
            is_supported=True,
            suggested_source_type=suggested_source,
            message=message,
        )

    def classify_base64(self, b64_string: str) -> Model6PredictionResult:
        """Classify a document image provided as a base64 string or Data URL."""
        if not b64_string or not isinstance(b64_string, str):
            return Model6PredictionResult(
                predicted_class="other_unsupported",
                document_category="uncertain_or_unsupported",
                category_label="Invalid Base64 Image",
                confidence=0.0,
                model_score=0.0,
                probabilities={},
                all_probabilities={},
                is_supported=False,
                suggested_source_type="other",
                message="Base64 input string was empty or invalid.",
            )

        clean_b64 = b64_string.strip()
        if "," in clean_b64:
            clean_b64 = clean_b64.split(",", 1)[1]
        try:
            image_bytes = base64.b64decode(clean_b64)
            return self.classify_image(image_bytes)
        except Exception as e:
            logger.error(f"Failed to decode base64 string for Model 6: {e}")
            return Model6PredictionResult(
                predicted_class="other_unsupported",
                document_category="uncertain_or_unsupported",
                category_label="Invalid Base64 Image",
                confidence=0.0,
                model_score=0.0,
                probabilities={},
                all_probabilities={},
                is_supported=False,
                suggested_source_type="other",
                message=f"Base64 image decoding failed: {e}",
            )


image_document_model_service = ImageDocumentModelService()
