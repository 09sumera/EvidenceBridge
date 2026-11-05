"""
Pytest configuration and shared fixtures for EvidenceBridge tests.
"""

from datetime import datetime, timezone
import os
os.environ["TESTING"] = "1"
os.environ["TQDM_DISABLE"] = "1"
os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
import sys
from pathlib import Path
import pytest

# Ensure backend root is on Python module search path
backend_dir = Path(__file__).parent.parent
sys.path.insert(0, str(backend_dir))

from app.models.schemas import ExtractedFields, SentimentType, SourceType


@pytest.fixture
def sample_clinical_text() -> str:
    return (
        "PATIENT PROGRESS NOTE: 58-year-old male with poorly controlled Type 2 Diabetes Mellitus. "
        "Started on Metformin 1,000 mg twice daily with evening meals 3 months ago. "
        "Repeat laboratory evaluation demonstrates a reduction in HbA1c from 8.9% down to 7.1%. "
        "Patient tolerates therapy well with no hypoglycemic events or gastrointestinal distress reported."
    )


@pytest.fixture
def sample_bill_text() -> str:
    return (
        "MEMORIAL REGIONAL MEDICAL CENTER - ATLANTA, GA. ITEM NUMBER: 99285-ER-ACUTE. "
        "Description: Emergency Department Visit, Level 5 Comprehensive Evaluation & Management. "
        "Billed Charge: $4,850.00. Facility Fee: $1,975.00. Total Patient Responsibility: $6,825.00."
    )


@pytest.fixture
def sample_extracted_fields() -> ExtractedFields:
    return ExtractedFields(
        entity="Metformin 1,000 mg",
        effect_or_outcome="Reduction in HbA1c from 8.9% to 7.1%",
        cost_range=None,
        location_city=None,
        sentiment=SentimentType.POSITIVE,
        reasoning="Patient showed significant glycemic improvement with no adverse effects."
    )
