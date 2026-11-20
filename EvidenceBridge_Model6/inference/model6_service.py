"""
Model 6: Image-Based Medical Document AI Service (MobileNetV3-Small).
Production ONNX Runtime inference service for classifying medical document images into:
1. discharge_summary
2. laboratory_report
3. medical_billing
4. other_unsupported
5. prescription
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

try:
    from app.utils.logger import logger
except ImportError:
    logger = logging.getLogger("model6_service")
    if not logger.handlers:
        logging.basicConfig(level=logging.INFO)

from EvidenceBridge_Model6.inference.schemas import Model6PredictionResult

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL_PATH = PACKAGE_ROOT / "model" / "mobilenetv3_small.onnx"
DEFAULT_CONFIG_PATH = PACKAGE_ROOT / "config" / "preprocessing.json"
DEFAULT_LABELS_PATH = PACKAGE_ROOT / "config" / "class_labels.json"

# Exact 5 classes from model training
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
}


class Model6Service:
    """
    Production ONNX Runtime inference service for Model 6 (MobileNetV3-Small).
    Maintains a singleton ONNX session and precomputed normalization constants.
    """

    def __init__(
        self,
        model_path: Optional[Union[str, Path]] = None,
        confidence_threshold: float = 0.55,
        providers: Optional[list[str]] = None,
    ):
        self.model_path = Path(model_path) if model_path else DEFAULT_MODEL_PATH
        self.confidence_threshold = confidence_threshold
        self.providers = providers or ["CPUExecutionProvider"]

        self._session: Optional[ort.InferenceSession] = None
        self._input_name: Optional[str] = None
        self._output_name: Optional[str] = None
        self._input_shape: Optional[list[Any]] = None

        # Load preprocessing configurations
        self._load_preprocessing_config()

    def _load_preprocessing_config(self) -> None:
        """Load preprocessing parameters from config or use verified defaults."""
        config_path = DEFAULT_CONFIG_PATH
        if config_path.exists():
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                self.target_size = tuple(cfg.get("image_size", [224, 224]))
                self.mean = np.array(cfg.get("normalization", {}).get("mean", [0.485, 0.456, 0.406]), dtype=np.float32)
                self.std = np.array(cfg.get("normalization", {}).get("std", [0.229, 0.224, 0.225]), dtype=np.float32)
                return
            except Exception as e:
                logger.warning(f"Could not read preprocessing.json ({e}), using verified ImageNet defaults.")

        self.target_size = (224, 224)
        self.mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        self.std = np.array([0.229, 0.224, 0.225], dtype=np.float32)

    def is_available(self) -> bool:
        """Check if the ONNX model file exists on disk."""
        return self.model_path.exists() and self.model_path.is_file()

    def _get_session(self) -> ort.InferenceSession:
        """Initialize or retrieve cached ONNX Runtime InferenceSession."""
        if self._session is not None:
            return self._session

        if not self.is_available():
            raise FileNotFoundError(f"Model 6 ONNX model file not found at: {self.model_path}")

        logger.info(f"Initializing Model 6 ONNX session from '{self.model_path}' with providers {self.providers}...")
        session = ort.InferenceSession(str(self.model_path), providers=self.providers)

        # Inspect verified metadata
        inputs = session.get_inputs()
        outputs = session.get_outputs()

        self._input_name = inputs[0].name
        self._input_shape = inputs[0].shape
        self._output_name = outputs[0].name

        self._session = session
        logger.info(
            f"Model 6 ONNX session ready. Input: '{self._input_name}' {self._input_shape}, "
            f"Output: '{self._output_name}' {outputs[0].shape}"
        )
        return self._session

    def preprocess(self, img: Image.Image) -> np.ndarray:
        """
        Preprocess PIL image into NCHW float32 numpy array:
        1. RGB mode
        2. Resize to 224x224
        3. Convert to float32 [0.0, 1.0]
        4. Normalize by ImageNet mean & std
        5. Transpose HWC -> NCHW
        6. Expand batch dimension -> (1, 3, 224, 224)
        """
        if img.mode != "RGB":
            img = img.convert("RGB")

        if img.size != self.target_size:
            img = img.resize(self.target_size, Image.Resampling.BILINEAR)

        # Pixel values in [0.0, 1.0]
        arr = np.asarray(img, dtype=np.float32) / 255.0

        # Standard ImageNet normalization: (x - mean) / std
        arr = (arr - self.mean) / self.std

        # HWC (224, 224, 3) -> CHW (3, 224, 224)
        arr = np.transpose(arr, (2, 0, 1))

        # Add batch dimension -> NCHW (1, 3, 224, 224)
        arr = np.expand_dims(arr, axis=0).astype(np.float32)
        return arr

    def classify_image(self, image_input: Union[bytes, Image.Image, Path, str]) -> Model6PredictionResult:
        """
        Run inference on image bytes, PIL Image, or file path.
        Returns Model6PredictionResult with predicted_class, confidence, probabilities, and mapped source type.
        """
        # 1. Load ONNX session
        try:
            session = self._get_session()
        except Exception as e:
            logger.error(f"Failed to initialize Model 6 ONNX session: {e}")
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
                message=f"Model 6 ONNX session could not be initialized: {e}",
            )

        # 2. Decode image safely
        try:
            if isinstance(image_input, Image.Image):
                img = image_input
            elif isinstance(image_input, bytes):
                if not image_input or len(image_input) < 8:
                    raise ValueError("Empty or truncated image bytes")
                img = Image.open(io.BytesIO(image_input))
                img.verify()  # verify integrity
                img = Image.open(io.BytesIO(image_input))  # reopen after verify
            elif isinstance(image_input, (str, Path)):
                p = Path(image_input)
                if not p.exists() or not p.is_file():
                    raise FileNotFoundError(f"Image file does not exist: {p.name}")
                img = Image.open(p)
                img.verify()
                img = Image.open(p)
            else:
                raise ValueError(f"Unsupported image input type: {type(image_input).__name__}")
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
                message=f"Could not decode image: {img_err}",
            )

        # 3. Preprocess image
        try:
            input_tensor = self.preprocess(img)
        except Exception as prep_err:
            logger.error(f"Preprocessing failed for Model 6: {prep_err}")
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
                message=f"Preprocessing failed: {prep_err}",
            )

        # 4. ONNX forward pass
        try:
            ort_inputs = {self._input_name: input_tensor}
            ort_outputs = session.run([self._output_name], ort_inputs)
            logits = ort_outputs[0][0]  # shape (5,)
        except Exception as inf_err:
            logger.error(f"ONNX inference failed for Model 6: {inf_err}")
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
                message=f"ONNX inference error: {inf_err}",
            )

        # 5. Numerically stable softmax
        exp_logits = np.exp(logits - np.max(logits))
        probs = exp_logits / np.sum(exp_logits)

        # 6. Map probabilities
        raw_prob_dict: dict[str, float] = {}
        all_prob_dict: dict[str, float] = {}
        for idx, cls_name in enumerate(CLASSES):
            prob_val = round(float(probs[idx]), 4)
            raw_prob_dict[cls_name] = prob_val
            all_prob_dict[cls_name] = prob_val

        # Add backward-compatibility alias for medical_billing -> invoice_or_receipt
        if "medical_billing" in all_prob_dict:
            all_prob_dict["invoice_or_receipt"] = all_prob_dict["medical_billing"]

        best_idx = int(np.argmax(probs))
        predicted_class = CLASSES[best_idx]
        best_score = float(probs[best_idx])
        conf_float = round(best_score, 4)

        # 7. Check if predicted class is other_unsupported
        if predicted_class == "other_unsupported":
            logger.info(f"Model 6 detected unsupported document type with {conf_float:.1%} confidence")
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

        # 8. Check confidence threshold
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

        # 9. Successful supported prediction
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


# Module-level default instance
model6_service = Model6Service()
