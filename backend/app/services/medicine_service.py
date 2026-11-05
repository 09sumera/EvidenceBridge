"""
Preserved Model 5: Medicine Substitution & Matching Service.
Wraps the TF-IDF + Logistic Regression pipeline from models/EvidenceBridge_BioBERT/model_5_medicine.
Evaluates brand vs generic equivalence and drug substitution feasibility.
"""

from pathlib import Path
from typing import Optional
import joblib

from app.config import get_settings
from app.models.schemas import MedicineSubstitutionResult
from app.utils.logger import logger


class MedicineSubstitutionService:
    """Service wrapping preserved Model 5 medicine matcher."""

    def __init__(self, model_path: Optional[str] = None):
        self.settings = get_settings()
        self.raw_path = model_path or self.settings.MODEL_5_MEDICINE_MATCHER_PATH
        self.model_path = self._resolve_path(self.raw_path)
        self._pipeline = None

    def _resolve_path(self, path_str: str) -> Path:
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
        return self.model_path.exists()

    def _load_model(self) -> None:
        if self._pipeline is not None:
            return

        if not self.is_available():
            raise FileNotFoundError(f"Medicine matcher model not found at: {self.model_path}")

        logger.info(f"Loading preserved Medicine Matcher pipeline from '{self.model_path}'...")
        self._pipeline = joblib.load(str(self.model_path))
        logger.info("Medicine Matcher pipeline loaded successfully.")

    def match_medicines(self, query_medicine: str, target_medicine: str) -> MedicineSubstitutionResult:
        """
        Evaluate if query medicine matches or can substitute target medicine.
        Uses character n-gram TF-IDF and trained logistic regression on RxNorm data.
        """
        if not query_medicine or not target_medicine:
            return MedicineSubstitutionResult(
                query_medicine=query_medicine or "",
                target_medicine=target_medicine or "",
                match_probability=0.0,
                is_match=False,
                explanation="Missing medicine names for substitution evaluation."
            )

        try:
            self._load_model()
            text_input = f"{query_medicine.strip().lower()} {target_medicine.strip().lower()}"
            probs = self._pipeline.predict_proba([text_input])[0]
            match_prob = float(probs[1]) if len(probs) > 1 else float(probs[0])
            is_match = match_prob >= 0.50

            explanation = (
                f"High confidence match ({match_prob:.1%}): valid active ingredient or generic equivalent."
                if is_match
                else f"Low confidence match ({match_prob:.1%}): distinct chemical entity or non-interchangeable formulation."
            )

            return MedicineSubstitutionResult(
                query_medicine=query_medicine,
                target_medicine=target_medicine,
                match_probability=round(match_prob, 4),
                is_match=is_match,
                explanation=explanation
            )
        except Exception as e:
            logger.error(f"Error during medicine matching: {e}")
            return MedicineSubstitutionResult(
                query_medicine=query_medicine,
                target_medicine=target_medicine,
                match_probability=0.0,
                is_match=False,
                explanation=f"Error evaluating medicine substitution: {e}"
            )


medicine_service = MedicineSubstitutionService()
