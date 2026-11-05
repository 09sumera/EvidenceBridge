"""
Model 6: Image-Based Medical Document AI Service.
Integrates trained ResNet18 model to classify medical document images
into prescription, laboratory report, or invoice/receipt.
"""

import base64
import io
from pathlib import Path
from typing import Any, Optional, Union
import torch
import torch.nn as nn
from torchvision import models, transforms
from PIL import Image

from app.config import get_settings
from app.models.schemas import Model6PredictionResult
from app.utils.logger import logger


CLASSES = ["prescription", "laboratory_report", "invoice_or_receipt"]

CLASS_LABELS: dict[str, str] = {
    "invoice_or_receipt": "Medical Invoice / Receipt",
    "prescription": "Prescription",
    "laboratory_report": "Laboratory Report",
    "uncertain_or_unsupported": "Uncertain Document Type",
}

SOURCE_TYPE_MAPPING: dict[str, str] = {
    "invoice_or_receipt": "hospital_bill",
    "prescription": "prescription",
    "laboratory_report": "clinical_note",
    "uncertain_or_unsupported": "clinical_note",
}

CATEGORY_DESCRIPTIONS: dict[str, str] = {
    "invoice_or_receipt": "Classified as Medical Invoice or Bill. Audited for itemized billing charges and pricing benchmarks.",
    "prescription": "Classified as Medical Prescription. Audited for drug indications, dosages, and guideline compliance.",
    "laboratory_report": "Classified as Diagnostic Laboratory Report. Audited for clinical findings, ranges, and diagnostic consistency.",
}


class ImageDocumentModelService:
    """
    Inference service for Model 6: Image-Based Medical Document AI.
    Loads and runs the existing trained ResNet-18 checkpoint from its original disk location.
    """

    def __init__(self, model_path: Optional[str] = None, device: Optional[str] = None):
        self.settings = get_settings()
        self.raw_path = model_path or self.settings.MODEL_6_DOCUMENT_AI_PATH
        self.model_path = Path(self.raw_path)
        self.configured_device = device or self.settings.MODEL_6_DEVICE or "cpu"
        self.confidence_threshold = self.settings.MODEL_6_CONFIDENCE_THRESHOLD

        self._model: Optional[nn.Module] = None
        self._device: Optional[torch.device] = None

        # Exact transforms from Model 6 training
        self._transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize(
                mean=[0.485, 0.456, 0.406],
                std=[0.229, 0.224, 0.225]
            )
        ])

    def is_available(self) -> bool:
        """Check if trained Model 6 checkpoint exists on disk."""
        return self.model_path.exists() and self.model_path.is_file()

    def _load_model(self) -> None:
        """Load trained ResNet18 weights once onto configured device and cache."""
        if self._model is not None:
            return

        if not self.is_available():
            raise FileNotFoundError(
                f"Model 6 checkpoint not found at: {self.model_path}. "
                "Ensure C:\\Users\\tejes\\Downloads\\EvidenceBridge_Model6_COMPLETE is present."
            )

        target_device = "cuda" if (self.configured_device == "cuda" and torch.cuda.is_available()) else "cpu"
        self._device = torch.device(target_device)
        logger.info(f"Loading Model 6 ResNet18 from '{self.model_path}' onto {self._device}...")

        model = models.resnet18(weights=None)
        model.fc = nn.Linear(model.fc.in_features, len(CLASSES))

        checkpoint = torch.load(str(self.model_path), map_location=self._device, weights_only=False)
        state_dict = checkpoint.get("model_state_dict", checkpoint)
        model.load_state_dict(state_dict)
        model.to(self._device)
        model.eval()

        self._model = model
        logger.info(f"Model 6 ResNet18 initialized successfully with classes: {CLASSES}")

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
                document_category="uncertain_or_unsupported",
                category_label="Model 6 Unavailable",
                model_score=0.0,
                all_probabilities={},
                is_supported=False,
                suggested_source_type="clinical_note",
                message=f"Model 6 checkpoint could not be loaded: {e}",
            )

        # 1. Load image into PIL Image in RGB mode
        try:
            if isinstance(image_input, Image.Image):
                img = image_input.convert("RGB")
            elif isinstance(image_input, bytes):
                img = Image.open(io.BytesIO(image_input)).convert("RGB")
            elif isinstance(image_input, (str, Path)):
                img = Image.open(str(image_input)).convert("RGB")
            else:
                raise ValueError(f"Unsupported image input type: {type(image_input)}")
        except Exception as img_err:
            logger.error(f"Failed to decode image for Model 6: {img_err}")
            return Model6PredictionResult(
                document_category="uncertain_or_unsupported",
                category_label="Invalid Image",
                model_score=0.0,
                all_probabilities={},
                is_supported=False,
                suggested_source_type="clinical_note",
                message=f"Could not decode image file: {img_err}",
            )

        # 2. Preprocess using exact training pipeline
        tensor = self._transform(img).unsqueeze(0).to(self._device)

        # 3. Model forward pass
        with torch.no_grad():
            logits = self._model(tensor)
            probs = torch.softmax(logits, dim=1)[0]

        # 4. Map probabilities across classes
        prob_dict: dict[str, float] = {}
        for idx, cls_name in enumerate(CLASSES):
            prob_dict[cls_name] = round(float(probs[idx]), 4)

        best_idx = int(probs.argmax())
        best_class = CLASSES[best_idx]
        best_score = float(probs[best_idx])

        # 5. Handle low confidence or ambiguous predictions safely
        if best_score < self.confidence_threshold:
            logger.info(
                f"Model 6 low confidence prediction: {best_class} ({best_score:.3f} < {self.confidence_threshold})"
            )
            return Model6PredictionResult(
                document_category="uncertain_or_unsupported",
                category_label="Uncertain Document Type",
                model_score=round(best_score, 4),
                all_probabilities=prob_dict,
                is_supported=False,
                suggested_source_type="clinical_note",
                message=(
                    f"Image does not definitively match standard prescription, laboratory report, or invoice templates "
                    f"(top match '{CLASS_LABELS.get(best_class, best_class)}' at {best_score:.1%} confidence). "
                    "Please verify or select document type manually."
                ),
            )

        # 6. Return successful classified result
        category_label = CLASS_LABELS.get(best_class, best_class)
        suggested_source = SOURCE_TYPE_MAPPING.get(best_class, "clinical_note")
        message = CATEGORY_DESCRIPTIONS.get(best_class, f"Identified as {category_label}.")

        return Model6PredictionResult(
            document_category=best_class,
            category_label=category_label,
            model_score=round(best_score, 4),
            all_probabilities=prob_dict,
            is_supported=True,
            suggested_source_type=suggested_source,
            message=message,
        )

    def classify_base64(self, b64_string: str) -> Model6PredictionResult:
        """Classify a document image provided as a base64 string or Data URL."""
        clean_b64 = b64_string.strip()
        if "," in clean_b64:
            clean_b64 = clean_b64.split(",", 1)[1]
        try:
            image_bytes = base64.b64decode(clean_b64)
            return self.classify_image(image_bytes)
        except Exception as e:
            logger.error(f"Failed to decode base64 string for Model 6: {e}")
            return Model6PredictionResult(
                document_category="uncertain_or_unsupported",
                category_label="Invalid Base64 Image",
                model_score=0.0,
                all_probabilities={},
                is_supported=False,
                suggested_source_type="clinical_note",
                message=f"Base64 image decoding failed: {e}",
            )


image_document_model_service = ImageDocumentModelService()
