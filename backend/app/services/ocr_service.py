"""
OCR Service for EvidenceBridge.
Extracts verbatim text from prescription slips, medical invoices, and discharge summaries
using RapidOCR (ONNX runtime).
"""

import base64
import io
from pathlib import Path
from typing import Any, Optional
import numpy as np
from PIL import Image

from app.utils.logger import logger


class OCRService:
    """Service wrapping RapidOCR onnxruntime for document text extraction."""

    def __init__(self):
        self._engine = None

    def _load_engine(self) -> None:
        if self._engine is not None:
            return
        try:
            from rapidocr_onnxruntime import RapidOCR
            self._engine = RapidOCR()
            logger.info("RapidOCR engine initialized successfully.")
        except Exception as e:
            logger.error(f"Failed to initialize RapidOCR: {e}")
            raise

    def extract_text_from_image_bytes(self, image_bytes: bytes) -> dict[str, Any]:
        """
        Extract text from raw image bytes (JPEG, PNG, WebP).
        Returns extracted verbatim text, line records, and average confidence.
        """
        self._load_engine()
        try:
            img = Image.open(io.BytesIO(image_bytes))
            # Convert to RGB if needed
            if img.mode != "RGB":
                img = img.convert("RGB")
            img_np = np.array(img)

            ocr_results, elapse_list = self._engine(img_np)
            if not ocr_results:
                return {
                    "text": "",
                    "lines": [],
                    "confidence": 0.0,
                    "box_count": 0
                }

            lines = []
            confidences = []
            for box, text, score in ocr_results:
                clean_text = str(text).strip()
                if clean_text:
                    lines.append(clean_text)
                    confidences.append(float(score))

            full_text = "\n".join(lines)
            mean_conf = round(float(np.mean(confidences)), 4) if confidences else 0.0

            return {
                "text": full_text,
                "lines": lines,
                "confidence": mean_conf,
                "box_count": len(lines)
            }
        except Exception as e:
            logger.error(f"Error during OCR extraction: {e}")
            return {
                "text": "",
                "lines": [],
                "confidence": 0.0,
                "error": str(e)
            }

    def extract_text_from_base64(self, b64_string: str) -> dict[str, Any]:
        """Extract text from base64 data url or raw base64 string."""
        if "," in b64_string:
            b64_string = b64_string.split(",", 1)[1]
        raw_bytes = base64.b64decode(b64_string)
        return self.extract_text_from_image_bytes(raw_bytes)


ocr_service = OCRService()
