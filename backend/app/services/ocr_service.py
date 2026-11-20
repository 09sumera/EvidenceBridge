"""
OCR Service for EvidenceBridge.
Extracts verbatim text from prescription slips, medical invoices, and discharge summaries
using RapidOCR (ONNX runtime).
"""

import base64
import io
import re
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

            # 2D spatial clustering and reading order recovery to preserve table rows and columns
            class OCRBox:
                def __init__(self, box, text, score):
                    self.box = box
                    self.text = str(text).strip()
                    self.score = float(score)
                    self.x_min = min(pt[0] for pt in box)
                    self.x_max = max(pt[0] for pt in box)
                    self.y_min = min(pt[1] for pt in box)
                    self.y_max = max(pt[1] for pt in box)
                    self.y_center = (self.y_min + self.y_max) / 2.0
                    self.height = max(1.0, self.y_max - self.y_min)

            boxes = [OCRBox(b, t, s) for b, t, s in ocr_results if str(t).strip()]
            boxes.sort(key=lambda b: (b.y_center, b.x_min))

            rows: list[list[OCRBox]] = []
            for b in boxes:
                matched_row = None
                for r in rows:
                    r_y_min = min(item.y_min for item in r)
                    r_y_max = max(item.y_max for item in r)
                    r_y_center = sum(item.y_center for item in r) / len(r)
                    r_h = max(item.height for item in r)
                    overlap = min(b.y_max, r_y_max) - max(b.y_min, r_y_min)
                    if abs(b.y_center - r_y_center) < (r_h * 0.65) or (overlap > 0.35 * min(b.height, r_h)):
                        matched_row = r
                        break
                if matched_row is not None:
                    matched_row.append(b)
                else:
                    rows.append([b])

            lines = []
            confidences = [b.score for b in boxes]
            for r in rows:
                r.sort(key=lambda item: item.x_min)
                merged_cells: list[OCRBox] = []
                for item in r:
                    if (
                        merged_cells
                        and abs(item.x_min - merged_cells[-1].x_min) < 35
                        and (item.y_min >= merged_cells[-1].y_max - 8)
                    ):
                        merged_cells[-1].text += " " + item.text
                        merged_cells[-1].y_max = max(merged_cells[-1].y_max, item.y_max)
                    else:
                        merged_cells.append(item)

                row_str = ""
                for idx, cell in enumerate(merged_cells):
                    clean_cell = cell.text
                    clean_cell = re.sub(r"\bineachnostril\b", "in each nostril", clean_cell, flags=re.I)
                    if idx == 0:
                        row_str = clean_cell
                    else:
                        prev_cell = merged_cells[idx - 1]
                        gap = cell.x_min - prev_cell.x_max
                        if gap >= 15:
                            row_str += " | " + clean_cell
                        else:
                            row_str += " " + clean_cell
                if row_str.strip():
                    lines.append(row_str.strip())

            full_text = "\n".join(lines)
            mean_conf = round(float(np.mean(confidences)), 4) if confidences else 0.0

            return {
                "text": full_text,
                "lines": lines,
                "confidence": mean_conf,
                "box_count": len(boxes)
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
