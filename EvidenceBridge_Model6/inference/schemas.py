"""
Model 6: Document Image Classification Schemas.
Compatible with EvidenceBridge backend and frontend schemas.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class Model6DocumentCategory(str, Enum):
    """Document classification categories for Model 6 MobileNetV3-Small."""
    DISCHARGE_SUMMARY = "discharge_summary"
    LABORATORY_REPORT = "laboratory_report"
    MEDICAL_BILLING = "medical_billing"
    OTHER_UNSUPPORTED = "other_unsupported"
    PRESCRIPTION = "prescription"

    # Backward compatibility aliases
    INVOICE_OR_RECEIPT = "invoice_or_receipt"
    UNCERTAIN = "uncertain_or_unsupported"


class Model6PredictionResult(BaseModel):
    """
    Inference result from Model 6 (MobileNetV3-Small Document Image Classifier).
    Classifies raw uploaded or camera-captured document images into:
    - discharge_summary
    - laboratory_report
    - medical_billing
    - prescription
    - other_unsupported
    """
    model_config = ConfigDict(extra="ignore")

    predicted_class: str = Field(
        ...,
        description="Class predicted by Model 6 ONNX model"
    )
    document_category: str = Field(
        ...,
        description="Standardized category identifier compatible with EvidenceBridge"
    )
    category_label: str = Field(
        ...,
        description="Human-friendly label for display in EvidenceBridge UI"
    )
    confidence: float = Field(
        ...,
        description="Confidence score (probability) of the top prediction [0.0, 1.0]"
    )
    model_score: float = Field(
        ...,
        description="Softmax probability score of the predicted class (0.0 to 1.0)"
    )
    probabilities: dict[str, float] = Field(
        default_factory=dict,
        description="Softmax probability distribution across the 5 trained classes"
    )
    all_probabilities: dict[str, float] = Field(
        default_factory=dict,
        description="Softmax probability distribution across classes including compatibility aliases"
    )
    is_supported: bool = Field(
        default=True,
        description="True if model confidence satisfies threshold and category is a supported medical document"
    )
    suggested_source_type: str = Field(
        default="clinical_note",
        description="Mapped EvidenceBridge source_type ('hospital_bill', 'prescription', 'clinical_note', or 'other')"
    )
    model_name: str = "EvidenceBridge Model 6 (MobileNetV3-Small Document AI)"
    message: Optional[str] = None
    processed_at: Optional[datetime] = Field(default_factory=lambda: datetime.now(timezone.utc))
