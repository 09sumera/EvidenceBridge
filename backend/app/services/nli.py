"""
Model 3: DeBERTa NLI Verification Service.
Compares claim hypothesis against retrieved evidence premise
to classify as ENTAILMENT, CONTRADICTION, or NEUTRAL.
Requires human review when confidence is below threshold or contradiction is detected.
NEUTRAL is never interpreted as proof of falsehood.
"""

from pathlib import Path
from typing import Any, Optional
import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer

from app.config import get_settings
from app.models.schemas import NLIResult
from app.utils.logger import logger


class DeBERTaNLIService:
    """Service wrapping Model 3 DeBERTa-v3-small NLI."""

    def __init__(
        self,
        model_path: Optional[str] = None,
        threshold: Optional[float] = None,
        device: Optional[str] = None
    ):
        self.settings = get_settings()
        self.raw_path = model_path or self.settings.MODEL_3_DEBERTA_PATH
        self.model_path = self._resolve_model_path(self.raw_path)
        self.threshold = threshold if threshold is not None else self.settings.MODEL_3_CONFIDENCE_THRESHOLD
        self.configured_device = device or self.settings.AI_DEVICE
        self._device = None
        self._tokenizer = None
        self._model = None
        self.max_length = 256

    def _resolve_model_path(self, path_str: str) -> Path:
        """Resolve path relative to project root or cwd."""
        p = Path(path_str)
        if p.is_absolute() and p.exists():
            return p
        root = Path(__file__).resolve().parent.parent.parent.parent
        candidate = root / path_str
        if candidate.exists():
            return candidate
        cwd_candidate = Path.cwd() / path_str
        if cwd_candidate.exists():
            return cwd_candidate
        return p

    def is_available(self) -> bool:
        """Check if local model checkpoint files exist."""
        return (self.model_path / "model.safetensors").exists() or (self.model_path / "pytorch_model.bin").exists()

    def _load_model(self) -> None:
        """Lazy load tokenizer and sequence classification model."""
        if self._model is not None:
            return

        if not self.is_available():
            raise FileNotFoundError(f"Model 3 DeBERTa checkpoint not found at: {self.model_path}")

        target_device = "cuda" if (self.configured_device == "cuda" and torch.cuda.is_available()) else "cpu"
        self._device = torch.device(target_device)
        logger.info(f"Loading Model 3 DeBERTa from '{self.model_path}' onto {self._device}...")

        self._tokenizer = AutoTokenizer.from_pretrained(str(self.model_path), local_files_only=True)
        self._model = AutoModelForSequenceClassification.from_pretrained(str(self.model_path), local_files_only=True)
        self._model.to(self._device)
        self._model.eval()
        logger.info(f"Model 3 DeBERTa initialized successfully. Labels: {self._model.config.id2label}")

    def predict(self, premise: str, hypothesis: str) -> NLIResult:
        """
        Evaluate entailment relationship between premise (evidence) and hypothesis (claim).

        Premise: Authoritative evidence passage or clinical guideline.
        Hypothesis: Extracted statement or claim.
        """
        if not premise or not hypothesis:
            return NLIResult(
                decision="review_required",
                predicted_class="neutral",
                confidence=0.0,
                requires_human_review=True,
                probabilities={"contradiction": 0.0, "entailment": 0.0, "neutral": 1.0},
                threshold_applied=self.threshold,
                notes="Missing premise or hypothesis for NLI evaluation."
            )

        try:
            self._load_model()
        except Exception as e:
            logger.error(f"Failed to load Model 3 DeBERTa: {e}")
            return NLIResult(
                decision="review_required",
                predicted_class="neutral",
                confidence=0.0,
                requires_human_review=True,
                probabilities={},
                threshold_applied=self.threshold,
                notes=f"Model 3 loading error: {e}"
            )

        try:
            # Inputs: Premise first, Hypothesis second
            inputs = self._tokenizer(
                premise,
                hypothesis,
                return_tensors="pt",
                truncation=True,
                max_length=self.max_length
            ).to(self._device)

            with torch.no_grad():
                logits = self._model(**inputs).logits
                probs = torch.softmax(logits, dim=-1)[0]

            predicted_id = int(probs.argmax().item())
            confidence = float(probs[predicted_id].item())
            label = self._model.config.id2label.get(predicted_id, "neutral").lower()

            # Rule: Require human review if confidence < threshold OR if contradiction
            requires_review = (confidence < self.threshold) or (label == "contradiction")

            # Decision: review_required if flagged, otherwise predicted label
            decision = "review_required" if requires_review else label

            id2label = self._model.config.id2label
            prob_dict = {
                id2label[i].lower(): round(float(probs[i].item()), 4)
                for i in range(len(probs))
            }

            notes = []
            if label == "contradiction":
                notes.append("Clinical contradiction detected with retrieved evidence; mandatory human review.")
            elif confidence < self.threshold:
                notes.append(f"Confidence ({confidence:.2f}) below threshold ({self.threshold:.2f}); human review recommended.")
            if label == "neutral":
                notes.append("Neutral finding: evidence does not directly corroborate or refute; not proof of falsehood.")

            return NLIResult(
                decision=decision,
                predicted_class=label,
                confidence=round(confidence, 4),
                requires_human_review=requires_review,
                probabilities=prob_dict,
                threshold_applied=self.threshold,
                notes=" ".join(notes) if notes else "High-confidence finding."
            )
        except Exception as e:
            logger.error(f"Error during DeBERTa NLI inference: {e}")
            return NLIResult(
                decision="review_required",
                predicted_class="neutral",
                confidence=0.0,
                requires_human_review=True,
                probabilities={},
                threshold_applied=self.threshold,
                notes=f"Inference error: {e}"
            )


nli_service = DeBERTaNLIService()
