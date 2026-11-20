"""EvidenceBridge Model 6 Inference Package."""

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

__all__ = [
    "Model6Service",
    "model6_service",
    "CLASSES",
    "CLASS_LABELS",
    "SOURCE_TYPE_MAPPING",
    "Model6PredictionResult",
    "Model6DocumentCategory",
]
