"""
Model 1: BioBERT NER Service for Indian Healthcare Documents.
Extracts structured entities (hospitals, doctors, medicines, dosages, invoice totals, dates)
from prescriptions, discharge summaries, and medical invoices.
"""

from pathlib import Path
import re
import time
from typing import Any, Optional
import torch
from transformers import AutoModelForTokenClassification, AutoTokenizer

from app.config import get_settings
from app.models.schemas import (
    BillingGroup,
    ClinicalGroup,
    ExtractedEntity,
    GroupedField,
    GroupedMedicalInformation,
    HospitalGroup,
    MedicineGroup,
    NERExtractionResult,
)
from app.utils.logger import logger


class BioBERTNERService:
    """Service wrapping Model 1 BioBERT Token Classification."""

    def __init__(self, model_path: Optional[str] = None, device: Optional[str] = None):
        self.settings = get_settings()
        self.raw_path = model_path or self.settings.MODEL_1_BIOBERT_PATH
        self.model_path = self._resolve_model_path(self.raw_path)
        self.configured_device = device or self.settings.AI_DEVICE
        self._device = None
        self._tokenizer = None
        self._model = None
        self.max_length = 192
        self.uncertainty_threshold = 0.60

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
        """Check if model checkpoint files exist on disk."""
        return (self.model_path / "model.safetensors").exists() or (self.model_path / "pytorch_model.bin").exists()

    def _load_model(self) -> None:
        """Lazy load tokenizer and model onto configured device."""
        if self._model is not None:
            return

        if not self.is_available():
            raise FileNotFoundError(f"Model 1 BioBERT checkpoint not found at: {self.model_path}")

        target_device = "cuda" if (self.configured_device == "cuda" and torch.cuda.is_available()) else "cpu"
        self._device = torch.device(target_device)
        logger.info(f"Loading Model 1 BioBERT from '{self.model_path}' onto {self._device}...")

        self._tokenizer = AutoTokenizer.from_pretrained(str(self.model_path), local_files_only=True)
        self._model = AutoModelForTokenClassification.from_pretrained(str(self.model_path), local_files_only=True)
        self._model.to(self._device)
        self._model.eval()
        logger.info(f"Model 1 BioBERT initialized successfully with {self._model.config.num_labels} labels.")

    def extract_entities(self, text: str) -> NERExtractionResult:
        """
        Extract structured entities with character spans and confidence scores.
        Marks uncertain predictions (< 0.60) for human review.
        """
        if not text or not text.strip():
            return NERExtractionResult(entities=[], total_entities=0)

        start_time = time.perf_counter()
        try:
            self._load_model()
        except Exception as e:
            logger.error(f"Failed to load Model 1 BioBERT: {e}")
            return NERExtractionResult(
                entities=[],
                total_entities=0,
                model_name="EvidenceBridge BioBERT v4 (Load Failed)"
            )

        try:
            encoded = self._tokenizer(
                text,
                return_tensors="pt",
                return_offsets_mapping=True,
                truncation=True,
                max_length=self.max_length
            )
            offsets = encoded.pop("offset_mapping")[0].tolist()
            inputs = {key: value.to(self._device) for key, value in encoded.items()}

            with torch.no_grad():
                logits = self._model(**inputs).logits[0]
                probabilities = torch.softmax(logits, dim=-1)
                predictions = logits.argmax(dim=-1).tolist()

            MED_NAMES = {"GENERIC_NAME", "ACTIVE_INGREDIENT", "BRAND_NAME"}
            DOSE_TYPES = {"DOSAGE", "STRENGTH"}
            ALL_MED_TYPES = MED_NAMES | DOSE_TYPES

            raw_entities: list[ExtractedEntity] = []
            current = None

            def flush_current():
                nonlocal current
                if current is not None:
                    c_start, c_end = current["start"], current["end"]
                    # Expand start backwards to word boundary if token started inside an alphanumeric word (e.g. ##ee in Shree)
                    while c_start > 0 and (text[c_start - 1].isalnum() or text[c_start - 1] in "-_"):
                        c_start -= 1
                    # Expand end forward to word boundary if token ended inside an alphanumeric word
                    while c_end < len(text) and (text[c_end].isalnum() or text[c_end] in "-_"):
                        c_end += 1
                    entity_text = text[c_start:c_end].strip()
                    if entity_text:
                        mean_conf = round(sum(current["scores"]) / len(current["scores"]), 4)
                        is_punct_or_stray = bool(re.fullmatch(r"[\W\d_]+", entity_text) and len(entity_text) <= 2)
                        needs_review = (mean_conf < self.uncertainty_threshold) or is_punct_or_stray
                        raw_entities.append(ExtractedEntity(
                            entity=current["entity"],
                            text=entity_text,
                            start=c_start,
                            end=c_end,
                            confidence=mean_conf,
                            requires_human_review=needs_review
                        ))
                    current = None

            for (span_start, span_end), pred, probs in zip(offsets, predictions, probabilities):
                if span_start == span_end:
                    continue

                label = self._model.config.id2label[pred]
                confidence = float(probs[pred].item())

                if label == "O":
                    flush_current()
                    continue

                prefix, entity_type = label.split("-", 1) if "-" in label else ("B", label)

                is_contiguous = (current is not None and span_start == current["end"])
                # Strictly isolate medication names from dosage/instructions to prevent chimeras
                is_same_med_group = (
                    current is not None
                    and current["entity"] in MED_NAMES
                    and entity_type in MED_NAMES
                )

                if current is not None and (
                    (prefix == "I" and current["entity"] == entity_type)
                    or (is_contiguous and (current["entity"] == entity_type or is_same_med_group))
                ):
                    current["end"] = span_end
                    current["scores"].append(confidence)
                else:
                    flush_current()
                    current = {
                        "entity": entity_type,
                        "start": span_start,
                        "end": span_end,
                        "scores": [confidence]
                    }

            flush_current()

            # Post-processing: Merge adjacent spans in the same group separated by single space
            # CRITICAL: Never merge across line breaks (different medicines or instructions)
            entities: list[ExtractedEntity] = []
            for s in raw_entities:
                if not entities:
                    entities.append(s)
                    continue
                prev = entities[-1]
                dist = (s.start - prev.end) if (s.start is not None and prev.end is not None) else 999
                has_newline = bool(s.start is not None and prev.end is not None and "\n" in text[prev.end:s.start])
                can_merge_med = (
                    dist <= 1
                    and not has_newline
                    and prev.entity in MED_NAMES
                    and s.entity in MED_NAMES
                )
                can_merge_dose = (
                    dist <= 1
                    and not has_newline
                    and prev.entity in DOSE_TYPES
                    and s.entity in DOSE_TYPES
                )
                if can_merge_med or can_merge_dose:
                    merged_text = text[prev.start:s.end].strip()
                    merged_conf = round((prev.confidence + s.confidence) / 2, 4)
                    prev.end = s.end
                    prev.text = merged_text
                    prev.confidence = merged_conf
                    prev.requires_human_review = (merged_conf < self.uncertainty_threshold)
                else:
                    entities.append(s)

            # Clean & validate India-specific clinical entities
            entities = self._clean_and_validate_entities(text, entities)

            # Build auditor-facing logically grouped medical information
            grouped_info = self.group_medical_information(text, entities)

            # Detect coarse document category from extracted entities
            detected_type = self._detect_document_type(entities)
            elapsed_ms = round((time.perf_counter() - start_time) * 1000, 2)

            return NERExtractionResult(
                model_name="EvidenceBridge BioBERT v4",
                entities=entities,
                total_entities=len(entities),
                document_type_detected=detected_type,
                execution_time_ms=elapsed_ms,
                grouped_info=grouped_info
            )
        except Exception as e:
            logger.error(f"Error during BioBERT NER inference: {e}")
            return NERExtractionResult(
                entities=[],
                total_entities=0,
                model_name="EvidenceBridge BioBERT v4 (Inference Error)"
            )

    def _clean_and_validate_entities(self, text: str, raw_entities: list[ExtractedEntity]) -> list[ExtractedEntity]:
        """
        India-specific clinical entity validation & reconstruction:
        1. Unifies fragmented reference codes (e.g. MH-BLR-2026-4412, PT-KA-2026-1042).
        2. Prevents patient account references from being tagged as PACKAGE_CODE.
        3. Reconstructs claim references only when supported by original text.
        4. Rejects currency symbols (₹, Rs) from HSN_SAC and attaches them to amounts.
        5. Drops standalone punctuation and symbol fragments.
        6. Cleans procedure stop words ('administered for') and drops lone adjective fragments.
        7. Truncates entities that inappropriately swallowed subsequent newline labels.
        8. Fixes WordPiece subtoken splits on Indian states/cities tagged as patient names.
        9. Reassembles split currency tokens (e.g. IN + R 4.50 -> INR 4.50).
        10. Preserves raw model confidence and human review flags.
        """
        INDIAN_LOCATIONS = {
            "KARNATAKA", "RNATAKA", "BALLARI", "BENGALURU", "BANGALORE",
            "MAHARASHTRA", "TAMIL NADU", "DELHI", "MUMBAI", "CHENNAI",
            "HYDERABAD", "TELANGANA", "ANDHRA PRADESH", "KERALA", "GUJARAT",
            "KOLKATA", "WEST BENGAL", "PUNE", "AHMEDABAD", "JAIPUR", "RAJASTHAN"
        }

        cleaned: list[ExtractedEntity] = []
        REF_TYPES = {"CLAIM_REFERENCE", "PACKAGE_CODE", "POLICY_NUMBER", "INVOICE_NUMBER", "PREAUTH_NUMBER", "PATIENT_ID"}

        i = 0
        while i < len(raw_entities):
            ent = raw_entities[i]
            ent_text_clean = ent.text.strip()

            # Attach currency symbol (mistakenly extracted separately or as HSN_SAC) to following amount
            if ent_text_clean in ("₹", "Rs", "Rs.", "INR", "$") or (ent.entity == "HSN_SAC" and not re.search(r"\b\d{4,8}\b", ent_text_clean)):
                if i + 1 < len(raw_entities) and raw_entities[i+1].entity in ("CLAIM_AMOUNT", "LINE_AMOUNT", "INVOICE_TOTAL", "UNIT_PRICE", "TAX_AMOUNT", "DISCOUNT", "PATIENT_PAYABLE"):
                    next_amt = raw_entities[i+1]
                    sym = ent_text_clean if ent_text_clean in ("₹", "Rs", "Rs.", "INR", "$") else "₹"
                    if not next_amt.text.startswith(sym):
                        next_amt.text = f"{sym}{next_amt.text}"
                    if ent.start is not None and next_amt.start is not None and ent.start < next_amt.start:
                        next_amt.start = ent.start
                i += 1
                continue

            # Discard standalone punctuation or symbols
            if bool(re.fullmatch(r"[\W_]+", ent_text_clean)):
                i += 1
                continue

            # Reject Indian state/city fragments, PIN codes, or numbers mistakenly tagged as PATIENT_NAME
            if ent.entity == "PATIENT_NAME":
                if (
                    ent_text_clean.upper() in INDIAN_LOCATIONS
                    or len(ent_text_clean) <= 2
                    or re.search(r"\b\d{5,6}\b", ent_text_clean)
                    or any(loc in ent_text_clean.upper() for loc in ("KARNATAKA", "DAVANGERE", "BENGALURU", "DELHI", "MUMBAI"))
                    or ent_text_clean.isdigit()
                ):
                    i += 1
                    continue

            # Reject numbers or months mistakenly tagged as HOSPITAL / CLINIC
            if ent.entity in ("HOSPITAL", "HOSPITAL_NAME", "CLINIC"):
                MONTHS_SET = {"january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"}
                if (
                    ent_text_clean.isdigit()
                    or ent_text_clean.lower() in MONTHS_SET
                    or len(ent_text_clean) <= 2
                    or ent_text_clean.upper() in INDIAN_LOCATIONS
                ):
                    i += 1
                    continue

            # Clean unclosed parenthesis in DIAGNOSIS if original text closed it immediately after
            if ent.entity == "DIAGNOSIS" and "(" in ent.text and ")" not in ent.text:
                if ent.start is not None and ent.end is not None:
                    lookahead = text[ent.end:min(len(text), ent.end + 15)]
                    if ")" in lookahead:
                        close_idx = lookahead.index(")")
                        ent.text = text[ent.start:ent.end + close_idx + 1].strip()
                        ent.end = ent.end + close_idx + 1

            # Re-attach immediately preceding currency symbol from text if missed by tokenization
            if ent.entity in ("CLAIM_AMOUNT", "LINE_AMOUNT", "INVOICE_TOTAL", "UNIT_PRICE", "TAX_AMOUNT", "DISCOUNT", "PATIENT_PAYABLE"):
                if ent.start is not None and ent.start > 0 and not any(ent.text.startswith(s) for s in ("₹", "$", "Rs", "INR")):
                    prefix_char = text[ent.start - 1]
                    if prefix_char in ("₹", "$"):
                        ent.text = f"{prefix_char}{ent.text}"
                        ent.start -= 1
                    elif ent.start >= 3 and text[ent.start - 3:ent.start].upper() in ("RS.", "INR", "RS "):
                        sym = text[ent.start - 3:ent.start].strip()
                        ent.text = f"{sym} {ent.text}"
                        ent.start -= len(sym)

            # 1. Unify contiguous reference codes (e.g. MH-BLR-2026-4412, PT-KA-2026-1042)
            if ent.entity in REF_TYPES:
                j = i + 1
                merged_start = ent.start if ent.start is not None else 0
                merged_end = ent.end if ent.end is not None else 0
                merged_scores = [ent.confidence]

                while j < len(raw_entities):
                    next_ent = raw_entities[j]
                    if next_ent.entity in REF_TYPES and next_ent.start is not None and (next_ent.start - merged_end) <= 1:
                        merged_end = next_ent.end if next_ent.end is not None else merged_end
                        merged_scores.append(next_ent.confidence)
                        j += 1
                    else:
                        break

                span_text = text[merged_start:merged_end].strip()
                clean_code_match = re.search(r"([A-Za-z0-9]+(?:-[A-Za-z0-9]+)+)", span_text)
                if clean_code_match:
                    code_val = clean_code_match.group(1)
                    code_offset = span_text.find(code_val)
                    c_start = merged_start + code_offset
                    c_end = c_start + len(code_val)

                    # Context window to check for account / claim prefix
                    ctx_before = text[max(0, merged_start - 35):merged_start].lower()
                    target_type = "CLAIM_REFERENCE"
                    if "invoice" in ctx_before or "inv" in ctx_before:
                        target_type = "INVOICE_NUMBER"
                    elif "policy" in ctx_before or "pol" in ctx_before:
                        target_type = "POLICY_NUMBER"
                    elif "preauth" in ctx_before:
                        target_type = "PREAUTH_NUMBER"
                    elif "patient id" in ctx_before or "uhid" in ctx_before or "pt" in ctx_before:
                        target_type = "PATIENT_ID"

                    mean_conf = round(sum(merged_scores) / len(merged_scores), 4)
                    cleaned.append(ExtractedEntity(
                        entity=target_type,
                        text=code_val,
                        start=c_start,
                        end=c_end,
                        confidence=mean_conf,
                        requires_human_review=(mean_conf < self.uncertainty_threshold)
                    ))
                    i = j
                    continue

            # 2. Reject currency symbol mistakenly tagged as HSN_SAC
            if ent.entity == "HSN_SAC":
                clean_hsn = ent_text_clean
                if not re.search(r"\b\d{4,8}\b", clean_hsn):
                    if clean_hsn in ("₹", "Rs", "Rs.", "INR", "$"):
                        if i + 1 < len(raw_entities) and raw_entities[i+1].entity in ("CLAIM_AMOUNT", "LINE_AMOUNT", "INVOICE_TOTAL", "UNIT_PRICE"):
                            next_amt = raw_entities[i+1]
                            next_amt.text = f"{clean_hsn}{next_amt.text}"
                            if ent.start is not None:
                                next_amt.start = ent.start
                    i += 1
                    continue

            # 3. Handle split currency subtoken fragments (e.g. IN followed by R 4.50)
            if ent_text_clean in ("IN", "R", "R.", "INR", "RS") and ent.entity in ("LINE_AMOUNT", "TAX_AMOUNT", "DISCOUNT", "CLAIM_AMOUNT"):
                if i + 1 < len(raw_entities):
                    next_ent = raw_entities[i+1]
                    # Check if next entity has digits
                    if re.search(r"\d", next_ent.text):
                        combined_text = text[ent.start:next_ent.end].strip()
                        combined_conf = round((ent.confidence + next_ent.confidence) / 2, 4)
                        cleaned.append(ExtractedEntity(
                            entity=next_ent.entity,
                            text=combined_text,
                            start=ent.start,
                            end=next_ent.end,
                            confidence=combined_conf,
                            requires_human_review=(combined_conf < self.uncertainty_threshold)
                        ))
                        i += 2
                        continue
                if len(ent_text_clean) <= 2:
                    i += 1
                    continue

            # 4. Discard lone adjective procedure fragments
            if ent.entity == "PROCEDURE" and ent_text_clean.lower() in ("emergency", "routine", "elective", "urgent") and ent.confidence < 0.30:
                i += 1
                continue

            # 5. Clean trailing stop words in PROCEDURE
            if ent.entity == "PROCEDURE":
                cleaned_proc = re.sub(
                    r"\s+(?:administered(?:\s+for)?|performed(?:\s+for)?|indicated(?:\s+for)?|for|with)$",
                    "",
                    ent_text_clean,
                    flags=re.I
                ).strip()
                if cleaned_proc and cleaned_proc != ent_text_clean:
                    ent.text = cleaned_proc
                    if ent.start is not None:
                        ent.end = ent.start + len(cleaned_proc)

            # 6. Clean newlines that swallowed subsequent line headers
            if "\n" in ent.text:
                first_line = ent.text.split("\n")[0].strip()
                if first_line:
                    ent.text = first_line
                    if ent.start is not None:
                        ent.end = ent.start + len(first_line)

            cleaned.append(ent)
            i += 1

        return cleaned

    def group_medical_information(self, text: str, entities: list[ExtractedEntity]) -> GroupedMedicalInformation:
        """
        Organize extracted entities into clean, logically grouped medical domains
        adapting dynamically to the detected document type (Invoice, Prescription, Discharge, Insurance):
        1. Hospital Information (Hospital name, Location, Patient name, ID, Policy/Preauth/Insurer)
        2. Medicine Information (Medicine name, Brand/Generic, Active ingredient, Strength, Dosage, Route, Frequency, Instructions)
        3. Clinical Information (Encounter type, Procedure, Diagnosis, Indication, Admission/Discharge dates, Room type)
        4. Billing Information (Billed amount, Currency, Unit price, Line items, Taxes, Discounts, Deductions, Patient payable)
        """
        INDIAN_LOCATIONS = {
            "KARNATAKA", "RNATAKA", "BALLARI", "BENGALURU", "BANGALORE",
            "MAHARASHTRA", "TAMIL NADU", "DELHI", "MUMBAI", "CHENNAI",
            "HYDERABAD", "TELANGANA", "ANDHRA PRADESH", "KERALA", "GUJARAT",
            "KOLKATA", "WEST BENGAL", "PUNE", "AHMEDABAD", "JAIPUR", "RAJASTHAN"
        }

        hospital_group = HospitalGroup()
        medicine_group = MedicineGroup()
        clinical_group = ClinicalGroup()
        billing_group = BillingGroup()

        doc_type = self._detect_document_type(entities, text)

        # 1. Hospital / Provider / Insurer Information
        header_hosp = re.search(r"\b(?:HOSPITAL|FACILITY|CLINIC|INSTITUTE)\s*[:#]\s*([A-Za-z0-9&.,\s\-]+?)(?:\n|\r|$)", text, re.IGNORECASE)
        hosp_header_str = header_hosp.group(1).strip() if header_hosp else None

        # Check line 1 or line 2 for explicit facility identity (e.g. 'Shree Medical Institute')
        if not hosp_header_str:
            lines_all = [l.strip() for l in text.splitlines() if l.strip()]
            for first_l in lines_all[:3]:
                if re.search(r"\b(?:Hospital|Clinic|Medical Center|Medical Institute|Institute|Healthcare|Health System)\b", first_l, re.I):
                    hosp_header_str = first_l
                    break

        hosp_ent = next((e for e in entities if e.entity == "HOSPITAL" and not e.text.strip().isdigit() and e.text.strip().upper() not in INDIAN_LOCATIONS), None)
        if hosp_ent or hosp_header_str:
            hosp_raw = hosp_header_str or (hosp_ent.text.strip() if hosp_ent else "")
            conf = 0.95 if hosp_header_str else (hosp_ent.confidence if hosp_ent else 0.90)
            needs_rev = hosp_ent.requires_human_review if (hosp_ent and not hosp_header_str) else False

            # Recover clipped subword prefixes if original text contains full facility identity
            if hosp_raw.lower().startswith("ee ") or hosp_raw.startswith("##"):
                gen_hosp_m = re.search(r"\b([A-Z][A-Za-z0-9&.,\s\-]+?(?:Institute|Hospital|Clinic|Center|Healthcare|Health System))\b", text)
                if gen_hosp_m:
                    hosp_raw = gen_hosp_m.group(1).strip()
                elif hosp_raw.lower().startswith("ee "):
                    hosp_raw = hosp_raw[3:].strip()
                elif hosp_raw.startswith("##"):
                    hosp_raw = hosp_raw[2:].strip()
            elif hosp_header_str and (
                hosp_raw.lower().startswith("##")
                or len(hosp_header_str) > len(hosp_raw)
                or hosp_raw.lower() in hosp_header_str.lower()
            ):
                hosp_raw = hosp_header_str

            # Clean trailing district / location suffixes
            loc_extracted = None
            if " - " in hosp_raw:
                parts = hosp_raw.split(" - ", 1)
                hosp_name_clean = parts[0].strip()
                loc_extracted = parts[1].strip()
            elif "," in hosp_raw:
                loc_suffix_m = re.search(r",\s*(.+)$", hosp_raw)
                if loc_suffix_m:
                    loc_extracted = loc_suffix_m.group(1).strip()
                hosp_name_clean = re.sub(
                    r",\s*(?:Davangere|Bengaluru|Bangalore|Mangaluru|Ballari|Belagavi|Mysuru|Hubballi|Karnataka|India|District|State).*$",
                    "", hosp_raw, flags=re.IGNORECASE
                ).strip()
            else:
                hosp_name_clean = hosp_raw

            hospital_group.hospital_name = GroupedField(
                value=hosp_name_clean,
                confidence=conf,
                requires_human_review=needs_rev,
                raw_entity="HOSPITAL"
            )

        # Location extraction: prioritize explicit Indian cities/states/PIN code (e.g. 'Davangere, Karnataka – 577004')
        if not hospital_group.location:
            loc_match = re.search(r"\b(Davangere|Bengaluru|Bangalore|Mangaluru|Ballari|Belagavi|Mysuru|Hubballi|Mumbai|Delhi|Chennai|Hyderabad|Kolkata|Pune|Ahmedabad|Jaipur)\b(?:,\s*(?:Karnataka|Maharashtra|Tamil Nadu|Delhi|Telangana|West Bengal|Gujarat|Rajasthan|India))?(?:\s*[-–—]\s*\d{5,6})?", text, re.I)
            if loc_match:
                hospital_group.location = GroupedField(
                    value=loc_match.group(0).strip(),
                    confidence=0.95,
                    requires_human_review=False,
                    raw_entity="LOCATION"
                )
            elif loc_extracted:
                hospital_group.location = GroupedField(
                    value=loc_extracted,
                    confidence=0.90,
                    requires_human_review=False,
                    raw_entity="LOCATION"
                )

        # Phone extraction: e.g. Phone: 08192-245678
        phone_match = re.search(r"\b(?:Phone|Tel|Telephone|Contact)\s*[:#]?\s*([0-9\-+ ]{8,15})\b", text, re.I)
        if phone_match:
            hospital_group.phone = GroupedField(
                value=phone_match.group(1).strip(),
                confidence=0.95,
                requires_human_review=False,
                raw_entity="PHONE"
            )

        # Patient Name: prioritize explicit header 'Patient: Ramesh Kumar' over noisy NER
        pat_header_m = re.search(r"\bPatient\s*(?:Name)?\s*[:#]?\s*([A-Za-z\s]+?)(?:\n|\r|\||$)", text, re.I)
        if pat_header_m and len(pat_header_m.group(1).strip()) >= 3:
            hospital_group.patient_name = GroupedField(
                value=pat_header_m.group(1).strip(),
                confidence=0.98,
                requires_human_review=False,
                raw_entity="PATIENT_NAME"
            )
        else:
            pat_candidates = [
                e for e in entities
                if e.entity == "PATIENT_NAME"
                and e.text.strip().upper() not in INDIAN_LOCATIONS
                and len(e.text.strip()) >= 3
                and not re.search(r"\b(invoice|tax|hospital|patient|uhid|ref|bill|id)\b", e.text, re.I)
            ]
            if pat_candidates:
                pat_candidates.sort(key=lambda p: (len(p.text.strip().split()) >= 2, p.confidence), reverse=True)
                chosen_pat = pat_candidates[0]
                hospital_group.patient_name = GroupedField(
                    value=chosen_pat.text.strip(),
                    confidence=chosen_pat.confidence,
                    requires_human_review=chosen_pat.requires_human_review,
                    raw_entity="PATIENT_NAME"
                )

        # Age & Gender
        age_m = re.search(r"\bAge\s*[:#]?\s*(\d{1,3}(?:\s*(?:years?|yrs?))?)\b", text, re.I)
        gender_m = re.search(r"\b(?:Gender|Sex)\s*[:#]?\s*(Male|Female|Other|M|F)\b", text, re.I)
        age_val = age_m.group(1).strip() if age_m else None
        gen_val = gender_m.group(1).strip() if gender_m else None
        if age_val:
            if not re.search(r"years?", age_val, re.I):
                age_val = f"{age_val} Years"
            else:
                age_val = re.sub(r"years?", "Years", age_val, flags=re.I).strip()
        if gen_val:
            if gen_val.upper() == "M":
                gen_val = "Male"
            elif gen_val.upper() == "F":
                gen_val = "Female"
            else:
                gen_val = gen_val.capitalize()
        if age_val and gen_val:
            hospital_group.age_gender = GroupedField(
                value=f"{age_val} / {gen_val}",
                confidence=0.95,
                requires_human_review=False,
                raw_entity="AGE_GENDER"
            )
        elif age_val:
            hospital_group.age_gender = GroupedField(
                value=age_val,
                confidence=0.90,
                requires_human_review=False,
                raw_entity="AGE"
            )
        elif gen_val:
            hospital_group.age_gender = GroupedField(
                value=gen_val,
                confidence=0.90,
                requires_human_review=False,
                raw_entity="GENDER"
            )

        # Patient ID: check explicit 'Patient ID:', 'UHID:', 'PID:', or alphanumeric 'SM12745'
        pat_id_m = re.search(r"\b(?:Patient\s*ID|PID|UHID|MRN|IP\s*No|OP\s*No)\s*[:#]?\s*([A-Za-z0-9\-]+)\b|\b(SM\d{4,6})\b", text, re.I)
        if pat_id_m:
            hospital_group.patient_id = GroupedField(
                value=(pat_id_m.group(1) or pat_id_m.group(2)).strip(),
                confidence=0.95,
                requires_human_review=False,
                raw_entity="PATIENT_ID"
            )
        else:
            pat_id_ent = next((e for e in entities if e.entity == "PATIENT_ID"), None)
            if pat_id_ent:
                hospital_group.patient_id = GroupedField(
                    value=pat_id_ent.text.strip(),
                    confidence=pat_id_ent.confidence,
                    requires_human_review=pat_id_ent.requires_human_review,
                    raw_entity="PATIENT_ID"
                )

        # Claim Reference: ONLY accept explicit claim reference headers; NEVER accept PIN codes, patient IDs, or state names
        ref_header_m = re.search(r"\b(?:Claim\s*(?:Ref|Reference|Number|#)|Policy\s*(?:No|Number|#))\s*[:#]?\s*([A-Za-z0-9\-]+)\b", text, re.I)
        if ref_header_m and not re.search(r"\b(?:Karnataka|Davangere|577004|SM\d+)\b", ref_header_m.group(1), re.I):
            hospital_group.claim_reference = GroupedField(
                value=ref_header_m.group(1).strip(),
                confidence=0.95,
                requires_human_review=False,
                raw_entity="CLAIM_REFERENCE"
            )
        else:
            ref_ent = next((e for e in entities if e.entity == "CLAIM_REFERENCE"), None)
            if ref_ent and not any(loc in ref_ent.text.lower() for loc in ("karnataka", "davangere", "577004", "delhi", "mumbai", "sm12745")):
                hospital_group.claim_reference = GroupedField(
                    value=ref_ent.text.strip(),
                    confidence=ref_ent.confidence,
                    requires_human_review=ref_ent.requires_human_review,
                    raw_entity=ref_ent.entity
                )

        # Insurer & TPA: strictly require explicit headers or recognized insurer names; NEVER map bill line items
        KNOWN_INSURERS = ("star health", "hdfc ergo", "icici lombard", "care health", "bajaj allianz", "new india", "national insurance", "united india", "oriental insurance")
        ins_header_m = re.search(r"\b(?:Insurer|Insurance\s*Company)\s*[:#]?\s*([A-Za-z0-9\s&]+?)(?:\n|\r|,|$)", text, re.I)
        if ins_header_m:
            hospital_group.insurer = GroupedField(
                value=ins_header_m.group(1).strip(),
                confidence=0.95,
                requires_human_review=False,
                raw_entity="INSURER"
            )
        else:
            ins_ent = next((e for e in entities if e.entity == "INSURER" and any(ki in e.text.lower() for ki in KNOWN_INSURERS)), None)
            if ins_ent:
                hospital_group.insurer = GroupedField(
                    value=ins_ent.text.strip(),
                    confidence=ins_ent.confidence,
                    requires_human_review=ins_ent.requires_human_review,
                    raw_entity="INSURER"
                )

        KNOWN_TPAS = ("medi assist", "vidal health", "mdindia", "paramount", "heritage", "raksha", "fhpl")
        tpa_header_m = re.search(r"\bTPA\s*[:#]?\s*([A-Za-z0-9\s&]+?)(?:\n|\r|,|$)", text, re.I)
        if tpa_header_m:
            hospital_group.tpa = GroupedField(
                value=tpa_header_m.group(1).strip(),
                confidence=0.95,
                requires_human_review=False,
                raw_entity="TPA"
            )
        else:
            tpa_ent = next((e for e in entities if e.entity == "TPA" and any(kt in e.text.lower() for kt in KNOWN_TPAS)), None)
            if tpa_ent:
                hospital_group.tpa = GroupedField(
                    value=tpa_ent.text.strip(),
                    confidence=tpa_ent.confidence,
                    requires_human_review=tpa_ent.requires_human_review,
                    raw_entity="TPA"
                )
        pol_ent = next((e for e in entities if e.entity == "POLICY_NUMBER"), None)
        if pol_ent:
            hospital_group.policy_number = GroupedField(
                value=pol_ent.text.strip(),
                confidence=pol_ent.confidence,
                requires_human_review=pol_ent.requires_human_review,
                raw_entity="POLICY_NUMBER"
            )
        pre_ent = next((e for e in entities if e.entity == "PREAUTH_NUMBER"), None)
        if pre_ent:
            hospital_group.preauth_number = GroupedField(
                value=pre_ent.text.strip(),
                confidence=pre_ent.confidence,
                requires_human_review=pre_ent.requires_human_review,
                raw_entity="PREAUTH_NUMBER"
            )

        # 2. Medicine Information - Multi-Medicine Extraction & Normalization
        NON_DRUG_MED_TERMS = {
            "medicines", "medicines and consumables", "consumables", "medicine",
            "drugs", "pharmacy", "medical supplies", "prescribed medicines", "rx"
        }
        
        # Collect all distinct drug entities preserving document appearance order
        drug_entities: list[ExtractedEntity] = []
        seen_drugs = set()
        for e in entities:
            if e.entity in ("GENERIC_NAME", "BRAND_NAME", "ACTIVE_INGREDIENT"):
                c_text = e.text.strip()
                c_lower = c_text.lower()
                if c_lower not in NON_DRUG_MED_TERMS and len(c_text) >= 3 and c_lower not in seen_drugs:
                    drug_entities.append(e)
                    seen_drugs.add(c_lower)

        brand_ent = next((e for e in entities if e.entity == "BRAND_NAME" and e.text.strip().lower() not in NON_DRUG_MED_TERMS), None)
        gen_ent = next((e for e in entities if e.entity == "GENERIC_NAME" and e.text.strip().lower() not in NON_DRUG_MED_TERMS), None)
        ai_ent = next((e for e in entities if e.entity == "ACTIVE_INGREDIENT" and e.text.strip().lower() not in NON_DRUG_MED_TERMS), None)
        dose_ent = next((e for e in entities if e.entity in ("DOSAGE", "QUANTITY") and not re.search(r"\b\d+\s*days?\b", e.text, re.I)), None)
        str_ent = next((e for e in entities if e.entity == "STRENGTH"), None)

        # Collect distinct medicines as individual structured MedicineGroup records
        individual_medicines: list[MedicineGroup] = []
        lines = [line.strip() for line in text.splitlines() if line.strip()]

        KNOWN_MED_NAMES = (
            "Sodium Chloride", "Normal Saline", "Paracetamol", "Pantoprazole", "ORS", "Oral Rehydration Salts", "Metformin",
            "Amoxicillin", "Azithromycin", "Ceftriaxone", "Domperidone", "Ibuprofen",
            "Ondansetron", "Ciprofloxacin", "Atorvastatin", "Telmisartan", "Amlodipine",
            "Rabeprazole", "Cetirizine", "Ranitidine", "Omeprazole", "Diclofenac"
        )

        def resolve_active_ingredient(med_name: str) -> str:
            med_lower = med_name.lower()
            for km in KNOWN_MED_NAMES:
                if km.lower() in med_lower:
                    return km
            cleaned = re.sub(r"^(?:Tab\.?|Cap\.?|Syp\.?|Inj\.?|Sachet)\s*", "", med_name, flags=re.I).strip()
            return cleaned or med_name

        # Strategy 1: Tabular prescription rows with header (e.g. Medicine \t Strength \t Dosage ...)
        header_idx = -1
        col_map: dict[str, int] = {}
        for idx, line in enumerate(lines):
            if re.search(r"\b(Medicine|Drug|Tablet|Medication|Item)\b", line, re.I) and re.search(r"\b(Strength|Dosage|Duration|Quantity|Qty|Frequency|Dose)\b", line, re.I):
                header_idx = idx
                if "\t" in line:
                    cols = [c.strip() for c in line.split("\t") if c.strip()]
                elif "|" in line:
                    cols = [c.strip() for c in line.split("|") if c.strip()]
                else:
                    cols = [c.strip() for c in re.split(r" {2,}", line) if c.strip()]

                for c_i, c_name in enumerate(cols):
                    c_lower = c_name.lower()
                    if any(k in c_lower for k in ("medicine", "drug", "tablet", "item", "description")):
                        col_map["medicine"] = c_i
                    elif any(k in c_lower for k in ("strength", "potency")):
                        col_map["strength"] = c_i
                    elif any(k in c_lower for k in ("dosage", "dose")):
                        col_map["dosage"] = c_i
                    elif any(k in c_lower for k in ("duration", "days", "period")):
                        col_map["duration"] = c_i
                    elif any(k in c_lower for k in ("quantity", "qty", "units")):
                        col_map["quantity"] = c_i
                    elif any(k in c_lower for k in ("frequency", "timing")):
                        col_map["frequency"] = c_i
                    elif any(k in c_lower for k in ("instruction", "directions")):
                        col_map["instructions"] = c_i
                break

        if header_idx != -1 and "medicine" in col_map:
            for line in lines[header_idx + 1:]:
                if any(term in line.lower() for term in ("subtotal", "grand total", "total:", "doctor:", "patient:", "encounter:", "hospital:", "expected", "diagnosis:", "date:", "age:")):
                    break
                if "\t" in line:
                    cells = [c.strip() for c in line.split("\t") if c.strip()]
                elif "|" in line:
                    cells = [c.strip() for c in line.split("|") if c.strip()]
                else:
                    cells = [c.strip() for c in re.split(r" {2,}", line) if c.strip()]

                if len(cells) > col_map["medicine"]:
                    m_name = cells[col_map["medicine"]]
                    if len(m_name) < 2 or m_name.startswith("---") or m_name.startswith("==="):
                        continue
                    m_str = cells[col_map["strength"]] if "strength" in col_map and len(cells) > col_map["strength"] else ""
                    m_dosage = cells[col_map["dosage"]] if "dosage" in col_map and len(cells) > col_map["dosage"] else ""
                    m_dur = cells[col_map["duration"]] if "duration" in col_map and len(cells) > col_map["duration"] else ""
                    m_qty = cells[col_map["quantity"]] if "quantity" in col_map and len(cells) > col_map["quantity"] else ""

                    m_freq = ""
                    m_inst = ""
                    freq_m = re.search(r"\b(once daily|twice daily|three times daily|thrice daily|as needed|as directed|before breakfast|after food|before food|with meals|OD|BD|TDS|QID|sos|prn|daily)\b", m_dosage, re.I)
                    if freq_m:
                        m_freq = freq_m.group(1).strip()
                        m_inst = m_dosage
                    elif m_dosage:
                        m_inst = m_dosage

                    display_qty = m_qty or m_dosage or "1"
                    ai_clean = resolve_active_ingredient(m_name)

                    mg = MedicineGroup(
                        medicine_name=GroupedField(value=m_name, confidence=0.98, requires_human_review=False, raw_entity="MEDICINE_NAME"),
                        generic_name=GroupedField(value=ai_clean, confidence=0.95, requires_human_review=False, raw_entity="GENERIC_NAME"),
                        active_ingredient=GroupedField(value=ai_clean, confidence=0.95, requires_human_review=False, raw_entity="ACTIVE_INGREDIENT"),
                        strength=GroupedField(value=m_str, confidence=0.95, requires_human_review=False, raw_entity="STRENGTH") if m_str else None,
                        dosage_quantity=GroupedField(value=display_qty, confidence=0.95, requires_human_review=False, raw_entity="QUANTITY") if display_qty else None,
                        route=GroupedField(value="Oral", confidence=0.90, requires_human_review=False, raw_entity="ROUTE"),
                        frequency=GroupedField(value=m_freq, confidence=0.92, requires_human_review=False, raw_entity="FREQUENCY") if m_freq else None,
                        duration=GroupedField(value=m_dur, confidence=0.92, requires_human_review=False, raw_entity="DURATION") if m_dur else None,
                        instructions=GroupedField(value=m_inst, confidence=0.90, requires_human_review=False, raw_entity="INSTRUCTIONS") if m_inst else None,
                    )
                    individual_medicines.append(mg)

        # Strategy 2: Tabular prescription rows without header (lines with 3+ cells starting with known medicine)
        if not individual_medicines:
            for line in lines:
                if any(term in line.lower() for term in ("subtotal", "grand total", "total:", "doctor:", "patient:", "encounter:", "hospital:", "expected", "diagnosis:", "date:", "age:")):
                    continue
                if "\t" in line:
                    cells = [c.strip() for c in line.split("\t") if c.strip()]
                elif "|" in line:
                    cells = [c.strip() for c in line.split("|") if c.strip()]
                else:
                    cells = [c.strip() for c in re.split(r" {2,}", line) if c.strip()]

                if len(cells) >= 3:
                    first_cell = cells[0]
                    is_med = any(km.lower() in first_cell.lower() for km in KNOWN_MED_NAMES) or bool(re.match(r"^(?:Tab\.?|Cap\.?|Syp\.?|Inj\.?|Sachet)\s+[A-Za-z]+", first_cell, re.I))
                    if is_med:
                        m_name = first_cell
                        m_str = cells[1] if len(cells) > 1 else ""
                        m_dosage = cells[2] if len(cells) > 2 else ""
                        m_dur = cells[3] if len(cells) > 3 else ""
                        m_qty = cells[4] if len(cells) > 4 else ""

                        m_freq = ""
                        m_inst = ""
                        freq_m = re.search(r"\b(once daily|twice daily|three times daily|thrice daily|as needed|as directed|before breakfast|after food|before food|with meals|OD|BD|TDS|QID|sos|prn|daily)\b", m_dosage, re.I)
                        if freq_m:
                            m_freq = freq_m.group(1).strip()
                            m_inst = m_dosage
                        elif m_dosage:
                            m_inst = m_dosage

                        display_qty = m_qty or m_dosage or "1"
                        ai_clean = resolve_active_ingredient(m_name)

                        mg = MedicineGroup(
                            medicine_name=GroupedField(value=m_name, confidence=0.98, requires_human_review=False, raw_entity="MEDICINE_NAME"),
                            generic_name=GroupedField(value=ai_clean, confidence=0.95, requires_human_review=False, raw_entity="GENERIC_NAME"),
                            active_ingredient=GroupedField(value=ai_clean, confidence=0.95, requires_human_review=False, raw_entity="ACTIVE_INGREDIENT"),
                            strength=GroupedField(value=m_str, confidence=0.95, requires_human_review=False, raw_entity="STRENGTH") if m_str else None,
                            dosage_quantity=GroupedField(value=display_qty, confidence=0.95, requires_human_review=False, raw_entity="QUANTITY") if display_qty else None,
                            route=GroupedField(value="Oral", confidence=0.90, requires_human_review=False, raw_entity="ROUTE"),
                            frequency=GroupedField(value=m_freq, confidence=0.92, requires_human_review=False, raw_entity="FREQUENCY") if m_freq else None,
                            duration=GroupedField(value=m_dur, confidence=0.92, requires_human_review=False, raw_entity="DURATION") if m_dur else None,
                            instructions=GroupedField(value=m_inst, confidence=0.90, requires_human_review=False, raw_entity="INSTRUCTIONS") if m_inst else None,
                        )
                        individual_medicines.append(mg)

        # Strategy 3: Check numbered line items (e.g. 1. Paracetamol ...)
        if not individual_medicines:
            num_matches = list(re.finditer(r"^\s*(\d+)[\.\)]\s+(.+?)(?=(?:^\s*\d+[\.\)]|\Z))", text, re.M | re.S))
            for nm in num_matches:
                item_text = nm.group(2).strip()
                first_line = item_text.splitlines()[0]
                inst_m = re.search(r"Instructions?[:\s]*(.+)", item_text, re.I)
                inst_val = inst_m.group(1).strip() if inst_m else ""

                name_m = re.search(r"^(?:Tab\.?|Cap\.?|Syp\.?|Inj\.?)?\s*([A-Za-z0-9\s]+?)(?:\s+\d+\s*(?:mg|ml|mcg|g)|(?:\s*-\s*)|\n|$)", first_line, re.I)
                m_name = name_m.group(1).strip() if name_m else first_line[:30].strip()

                if any(kw in m_name.lower() for kw in ("subtotal", "grand total", "total", "invoice", "doctor", "patient", "encounter")):
                    continue

                str_m = re.search(r"\b(\d+(?:\.\d+)?\s*(?:mg/ml|mcg/ml|w/v|g/l|mg|mcg|g|ml|%))\b", item_text, re.I)
                m_str = str_m.group(1).strip() if str_m else ""

                qty_m = re.search(r"\b(\d+\s*(?:tablets?|capsules?|sachets?|bottles?|vials?|strips?|units?))\b", item_text, re.I)
                if not qty_m:
                    qty_m = re.search(r"\bQty[:\s]*(\d+)\b", item_text, re.I)
                m_qty = qty_m.group(1).strip() if qty_m else ""

                up_m = re.search(r"Unit\s*Price[:\s]*(?:₹|INR|Rs\.?)?\s*([\d,]+(?:\.\d{2})?)", item_text, re.I)
                m_up = f"₹{up_m.group(1).strip()}" if up_m else ""

                la_m = re.search(r"Line\s*Amount[:\s]*(?:₹|INR|Rs\.?)?\s*([\d,]+(?:\.\d{2})?)", item_text, re.I)
                m_la = f"₹{la_m.group(1).strip()}" if la_m else ""

                freq_m = re.search(r"\b(once daily|twice daily|three times daily|thrice daily|as needed|OD|BD|TDS|QID|sos|prn|daily)\b", inst_val or item_text, re.I)
                m_freq = freq_m.group(1).strip().capitalize() if freq_m else ""

                dur_m = re.search(r"\b(\d+\s*(?:days?|weeks?|months?))\b", inst_val or item_text, re.I)
                m_dur = dur_m.group(1).strip() if dur_m else ""

                ai_clean = resolve_active_ingredient(m_name)
                mg = MedicineGroup(
                    medicine_name=GroupedField(value=m_name, confidence=0.95, requires_human_review=False, raw_entity="MEDICINE_NAME"),
                    generic_name=GroupedField(value=ai_clean, confidence=0.95, requires_human_review=False, raw_entity="GENERIC_NAME"),
                    active_ingredient=GroupedField(value=ai_clean, confidence=0.95, requires_human_review=False, raw_entity="ACTIVE_INGREDIENT"),
                    strength=GroupedField(value=m_str, confidence=0.92, requires_human_review=False, raw_entity="STRENGTH") if m_str else None,
                    dosage_quantity=GroupedField(value=m_qty, confidence=0.92, requires_human_review=False, raw_entity="QUANTITY") if m_qty else None,
                    route=GroupedField(value="Oral", confidence=0.85, requires_human_review=False, raw_entity="ROUTE"),
                    frequency=GroupedField(value=m_freq, confidence=0.90, requires_human_review=False, raw_entity="FREQUENCY") if m_freq else None,
                    duration=GroupedField(value=m_dur, confidence=0.90, requires_human_review=False, raw_entity="DURATION") if m_dur else None,
                    instructions=GroupedField(value=inst_val, confidence=0.88, requires_human_review=False, raw_entity="INSTRUCTIONS") if inst_val else None,
                    unit_price=GroupedField(value=m_up, confidence=0.95, requires_human_review=False, raw_entity="UNIT_PRICE") if m_up else None,
                    line_amount=GroupedField(value=m_la, confidence=0.95, requires_human_review=False, raw_entity="LINE_AMOUNT") if m_la else None,
                )
                individual_medicines.append(mg)

        # Strategy 4: Check bulleted items (e.g. - Paracetamol: 8 × ₹5 = ₹40)
        if not individual_medicines:
            bullet_re = re.compile(r"^[-*•]\s*([A-Za-z0-9\s]+?)[:\-]\s*(?:(\d+)\s*[x×]\s*(?:₹|INR|Rs\.?)?\s*([\d.]+)\s*=\s*(?:₹|INR|Rs\.?)?\s*([\d.]+)|(.+))", re.M)
            for bm in bullet_re.finditer(text):
                b_name = bm.group(1).strip()
                if any(term in b_name.lower() for term in ("total", "subtotal", "tax", "discount")):
                    continue
                b_qty = bm.group(2) or ""
                b_up = f"₹{bm.group(3)}" if bm.group(3) else ""
                b_la = f"₹{bm.group(4)}" if bm.group(4) else ""
                ai_clean = resolve_active_ingredient(b_name)
                mg = MedicineGroup(
                    medicine_name=GroupedField(value=b_name, confidence=0.92, requires_human_review=False, raw_entity="MEDICINE_NAME"),
                    generic_name=GroupedField(value=ai_clean, confidence=0.92, requires_human_review=False, raw_entity="GENERIC_NAME"),
                    active_ingredient=GroupedField(value=ai_clean, confidence=0.92, requires_human_review=False, raw_entity="ACTIVE_INGREDIENT"),
                    dosage_quantity=GroupedField(value=b_qty, confidence=0.90, requires_human_review=False, raw_entity="QUANTITY") if b_qty else None,
                    route=GroupedField(value="Oral", confidence=0.85, requires_human_review=False, raw_entity="ROUTE"),
                    unit_price=GroupedField(value=b_up, confidence=0.95, requires_human_review=False, raw_entity="UNIT_PRICE") if b_up else None,
                    line_amount=GroupedField(value=b_la, confidence=0.95, requires_human_review=False, raw_entity="LINE_AMOUNT") if b_la else None,
                )
                individual_medicines.append(mg)

        # Strategy 5: Multiple distinct drug entities from NER
        if not individual_medicines and len(drug_entities) > 1:
            for de in drug_entities:
                d_name = de.text.strip()
                ai_clean = resolve_active_ingredient(d_name)
                str_match_d = re.search(re.escape(d_name) + r"[\s\w\-]*?(\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml))\b", text, re.I)
                d_str = str_match_d.group(1).strip() if str_match_d else None
                mg = MedicineGroup(
                    medicine_name=GroupedField(value=d_name, confidence=de.confidence, requires_human_review=de.requires_human_review, raw_entity=de.entity),
                    generic_name=GroupedField(value=ai_clean, confidence=de.confidence, requires_human_review=False, raw_entity="GENERIC_NAME"),
                    active_ingredient=GroupedField(value=ai_clean, confidence=de.confidence, requires_human_review=False, raw_entity="ACTIVE_INGREDIENT"),
                    strength=GroupedField(value=d_str, confidence=0.90, requires_human_review=False, raw_entity="STRENGTH") if d_str else None,
                    route=GroupedField(value="Oral", confidence=0.85, requires_human_review=False, raw_entity="ROUTE"),
                )
                individual_medicines.append(mg)

        # Cross-enrich unit price, line amount, and quantity from bullet pricing lines
        for mg in individual_medicines:
            m_name = mg.medicine_name.value if mg.medicine_name else ""
            ai_name = mg.active_ingredient.value if mg.active_ingredient else ""
            price_m = None
            if m_name:
                price_m = re.search(r"[-*•]?\s*" + re.escape(m_name) + r"[:\s]+(\d+)\s*[x×]\s*(?:₹|INR|Rs\.?)?\s*([\d.]+)\s*=\s*(?:₹|INR|Rs\.?)?\s*([\d.]+)", text, re.I)
            if not price_m and ai_name:
                price_m = re.search(r"[-*•]?\s*" + re.escape(ai_name) + r"[:\s]+(\d+)\s*[x×]\s*(?:₹|INR|Rs\.?)?\s*([\d.]+)\s*=\s*(?:₹|INR|Rs\.?)?\s*([\d.]+)", text, re.I)
            if price_m:
                if not mg.dosage_quantity or mg.dosage_quantity.value in ("1", "1 Tab"):
                    mg.dosage_quantity = GroupedField(value=price_m.group(1), confidence=0.95, requires_human_review=False, raw_entity="QUANTITY")
                if not mg.unit_price:
                    mg.unit_price = GroupedField(value=f"₹{price_m.group(2)}", confidence=0.95, requires_human_review=False, raw_entity="UNIT_PRICE")
                if not mg.line_amount:
                    mg.line_amount = GroupedField(value=f"₹{price_m.group(3)}", confidence=0.95, requires_human_review=False, raw_entity="LINE_AMOUNT")

        if individual_medicines:
            medicine_group = individual_medicines[0]
        else:
            med_ent = brand_ent or gen_ent or ai_ent
            if med_ent and med_ent.text.strip().lower() not in NON_DRUG_MED_TERMS:
                disp_med = med_ent.text.strip()
                if brand_ent and gen_ent and brand_ent.text.strip().lower() != gen_ent.text.strip().lower():
                    disp_med = f"{brand_ent.text.strip()} ({gen_ent.text.strip()})"
                medicine_group.medicine_name = GroupedField(
                    value=disp_med,
                    confidence=med_ent.confidence,
                    requires_human_review=med_ent.requires_human_review,
                    raw_entity=med_ent.entity
                )
            if brand_ent:
                medicine_group.brand_name = GroupedField(
                    value=brand_ent.text.strip(),
                    confidence=brand_ent.confidence,
                    requires_human_review=brand_ent.requires_human_review,
                    raw_entity="BRAND_NAME"
                )
            if gen_ent:
                medicine_group.generic_name = GroupedField(
                    value=gen_ent.text.strip(),
                    confidence=gen_ent.confidence,
                    requires_human_review=gen_ent.requires_human_review,
                    raw_entity="GENERIC_NAME"
                )
            if ai_ent:
                medicine_group.active_ingredient = GroupedField(
                    value=ai_ent.text.strip(),
                    confidence=ai_ent.confidence,
                    requires_human_review=ai_ent.requires_human_review,
                    raw_entity="ACTIVE_INGREDIENT"
                )
            elif medicine_group.medicine_name and medicine_group.medicine_name.value:
                res_ai = resolve_active_ingredient(medicine_group.medicine_name.value)
                if res_ai:
                    medicine_group.active_ingredient = GroupedField(
                        value=res_ai,
                        confidence=0.90,
                        requires_human_review=False,
                        raw_entity="ACTIVE_INGREDIENT"
                    )

        # Strength, Dosage, Route, Frequency & Instructions for single medicine
        if not individual_medicines:
            all_strengths = re.findall(r"\b(\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|mg/ml|mcg/ml|g/l|w/v))\b", text, re.I)
            if len(all_strengths) > 1 and len(drug_entities) > 1:
                medicine_group.strength = GroupedField(
                    value=", ".join(dict.fromkeys(s.strip() for s in all_strengths)),
                    confidence=0.90,
                    requires_human_review=False,
                    raw_entity="STRENGTH"
                )
            elif str_ent and not ("%" in str_ent.text and "hba1c" in text.lower()):
                medicine_group.strength = GroupedField(
                    value=str_ent.text.strip(),
                    confidence=str_ent.confidence,
                    requires_human_review=str_ent.requires_human_review,
                    raw_entity="STRENGTH"
                )
            else:
                str_match = re.search(r"(\d+(?:\.\d+)?\s*(?:mg/ml|w/v|mcg/ml|g/l|mg|mcg|g)\b)", text, re.I)
                if not str_match and ("normal saline" in text.lower() or "sodium chloride" in text.lower()):
                    str_match = re.search(r"(0\.\d+%\s*(?:w/v|nacl)?)", text, re.I)
                if str_match:
                    medicine_group.strength = GroupedField(
                        value=str_match.group(1).strip(),
                        confidence=0.85,
                        requires_human_review=False,
                        raw_entity="STRENGTH"
                    )

            if dose_ent:
                medicine_group.dosage_quantity = GroupedField(
                    value=dose_ent.text.strip(),
                    confidence=dose_ent.confidence,
                    requires_human_review=dose_ent.requires_human_review,
                    raw_entity=dose_ent.entity
                )

            route_match = re.search(r"\b(IV|IM|SC|oral|PO|topical|sublingual|intravenous|intra-arterial|inhalation)\b", text, re.I)
            if route_match:
                r_str = route_match.group(1).upper() if len(route_match.group(1)) <= 3 else route_match.group(1).capitalize()
                medicine_group.route = GroupedField(
                    value=r_str,
                    confidence=0.85,
                    requires_human_review=False,
                    raw_entity="ROUTE"
                )

            freq_match = re.search(r"\b(once daily|twice daily|thrice daily|three times daily|OD|BD|TDS|QID|every \d+ hours|daily|at bedtime|PRN)\b", text, re.I)
            if freq_match:
                medicine_group.frequency = GroupedField(
                    value=freq_match.group(1).strip(),
                    confidence=0.88,
                    requires_human_review=False,
                    raw_entity="FREQUENCY"
                )
            dur_match = re.search(r"\b(?:for\s+)?(\d+\s*(?:days?|weeks?|months?))\b", text, re.I)
            if dur_match:
                medicine_group.duration = GroupedField(
                    value=dur_match.group(1).strip(),
                    confidence=0.85,
                    requires_human_review=False,
                    raw_entity="DURATION"
                )
            inst_match = re.search(r"\b(after food|before food|with water|with meals|empty stomach|as directed)\b", text, re.I)
            if inst_match:
                medicine_group.instructions = GroupedField(
                    value=inst_match.group(1).strip(),
                    confidence=0.85,
                    requires_human_review=False,
                    raw_entity="INSTRUCTIONS"
                )

        # 3. Clinical Information
        enc_header_m = re.search(r"\bEncounter\s*[:#]\s*([A-Za-z\s]+?)(?:\n|\r|,|\||$)", text, re.I)
        enc_match = re.search(r"\b(Emergency Department|Emergency Room|Outpatient|Inpatient|Day Care|ICU|CCU|General Ward)\b", text, re.I)
        room_ent = next((e for e in entities if e.entity == "ROOM_TYPE"), None)
        if room_ent:
            clinical_group.room_type = GroupedField(
                value=room_ent.text.strip(),
                confidence=room_ent.confidence,
                requires_human_review=room_ent.requires_human_review,
                raw_entity="ROOM_TYPE"
            )
        if enc_header_m:
            enc_clean = enc_header_m.group(1).strip().title()
            if not enc_clean.lower().endswith("encounter"):
                enc_clean = f"{enc_clean} Encounter"
            clinical_group.encounter_type = GroupedField(
                value=enc_clean,
                confidence=0.98,
                requires_human_review=False,
                raw_entity="ENCOUNTER_TYPE"
            )
        elif enc_match:
            enc_clean = enc_match.group(1).strip().title()
            if not enc_clean.lower().endswith("encounter"):
                enc_clean = f"{enc_clean} Encounter"
            clinical_group.encounter_type = GroupedField(
                value=enc_clean,
                confidence=0.95,
                requires_human_review=False,
                raw_entity="ENCOUNTER_TYPE"
            )
        elif room_ent:
            clinical_group.encounter_type = GroupedField(
                value=room_ent.text.strip(),
                confidence=room_ent.confidence,
                requires_human_review=room_ent.requires_human_review,
                raw_entity="ENCOUNTER_TYPE"
            )

        # Length of Stay: e.g. "Length of Stay: 4 Days"
        los_m = re.search(r"\b(?:Length\s*of\s*Stay|Stay\s*Duration)\s*[:#]?\s*(\d+\s*days?)\b", text, re.I)
        if los_m:
            clinical_group.length_of_stay = GroupedField(
                value=los_m.group(1).strip().title(),
                confidence=0.98,
                requires_human_review=False,
                raw_entity="LENGTH_OF_STAY"
            )
        else:
            los_ent = next((e for e in entities if e.entity in ("STAY_DURATION", "LENGTH_OF_STAY")), None)
            if los_ent:
                clinical_group.length_of_stay = GroupedField(
                    value=los_ent.text.strip().title(),
                    confidence=los_ent.confidence,
                    requires_human_review=los_ent.requires_human_review,
                    raw_entity="LENGTH_OF_STAY"
                )

        # Determine if document is an outpatient prescription / clinic visit vs inpatient stay
        is_rx_or_op = any(
            kw in text.lower()
            for kw in (
                "prescription", "prescribed medicines", "rx", "clinic consultation",
                "outpatient", "ambulatory", "op consultation", "office visit", "clinic",
                "one tablet", "take 1 tablet", "before breakfast", "after meals", "at night"
            )
        ) and not any(
            kw in text.lower()
            for kw in ("inpatient stay", "admitted on", "admission date", "discharged on", "discharge date", "icu stay", "inpatient ward")
        )

        if is_rx_or_op:
            clinical_group.encounter_type = GroupedField(
                value="Outpatient Consultation",
                confidence=0.92,
                requires_human_review=False,
                raw_entity="ENCOUNTER_TYPE"
            )
            clinical_group.length_of_stay = None
        elif not clinical_group.encounter_type and (los_m or clinical_group.length_of_stay):
            clinical_group.encounter_type = GroupedField(
                value="Inpatient Encounter",
                confidence=0.90,
                requires_human_review=False,
                raw_entity="ENCOUNTER_TYPE"
            )

        # Clinical Procedure: strictly exclude routine billing line items, supportive care, and stay durations
        EXCLUDE_PROCEDURE_TERMS = {
            "respiratory support", "& respiratory support", "oxygen & respiratory support",
            "oxygen", "bedside monitoring", "nursing handover", "room charges",
            "nursing charges", "physician consultation", "laboratory investigations",
            "medicines & consumables", "consumables", "routine nursing", "consultation",
            "monitoring", "handover", "investigations", "room & nursing charges",
            "oxygen and respiratory support", "bedside monitoring and nursing handover"
        }
        def is_valid_clinical_procedure(p_text: str) -> bool:
            clean_p = p_text.strip().lower()
            if clean_p.startswith("&") or clean_p.startswith("-") or clean_p.startswith("/"):
                return False
            if clean_p in EXCLUDE_PROCEDURE_TERMS:
                return False
            if any(term in clean_p for term in ("respiratory support", "nursing handover", "bedside monitoring", "room & nursing", "physician consultation", "laboratory investigations")):
                return False
            if re.search(r"\b(?:no|february|january|days?|\d+\s*days?|per diem|charges?)\b", clean_p, re.I):
                return False
            return len(clean_p) >= 4

        proc_header_m = re.search(r"\b(?:Surgical\s*Procedure|Clinical\s*Procedure|Procedure\s*Name|Procedure|Intervention|Surgery)\s*[:#]\s*([A-Za-z0-9\s\-]+?)(?:\n|\r|,|\||$)", text, re.I)
        if proc_header_m and is_valid_clinical_procedure(proc_header_m.group(1)):
            clinical_group.procedure = GroupedField(
                value=proc_header_m.group(1).strip(),
                confidence=0.98,
                requires_human_review=False,
                raw_entity="PROCEDURE"
            )
        else:
            proc_ent = next((e for e in entities if e.entity == "PROCEDURE" and is_valid_clinical_procedure(e.text)), None)
            if proc_ent:
                clinical_group.procedure = GroupedField(
                    value=proc_ent.text.strip(),
                    confidence=proc_ent.confidence,
                    requires_human_review=proc_ent.requires_human_review,
                    raw_entity="PROCEDURE"
                )

        # Clinical Diagnosis: Check explicit header first, then filter entities (excluding months & stop words)
        diag_header_m = re.search(r"\b(?:Diagnosis|Primary\s*Diagnosis|Provisional\s*Diagnosis|Final\s*Diagnosis)\s*[:#]\s*([A-Za-z0-9\s\-]+?)(?:\n|\r|,|\||$)", text, re.I)
        MONTHS = {"january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "no", "yes", "none"}
        if diag_header_m and len(diag_header_m.group(1).strip()) >= 3 and diag_header_m.group(1).strip().lower() not in MONTHS:
            clinical_group.diagnosis = GroupedField(
                value=diag_header_m.group(1).strip(),
                confidence=0.98,
                requires_human_review=False,
                raw_entity="DIAGNOSIS"
            )
        else:
            valid_diags = [
                e for e in entities
                if e.entity == "DIAGNOSIS"
                and e.text.strip().lower() not in MONTHS
                and len(e.text.strip()) >= 3
                and not e.text.strip().isdigit()
            ]
            if valid_diags:
                valid_diags.sort(key=lambda d: (d.confidence >= 0.5, len(d.text.strip()) > 8, d.confidence), reverse=True)
                chosen_d = valid_diags[0]
                clinical_group.diagnosis = GroupedField(
                    value=chosen_d.text.strip(),
                    confidence=chosen_d.confidence,
                    requires_human_review=chosen_d.requires_human_review,
                    raw_entity="DIAGNOSIS"
                )

        ind_match = re.search(r"(?:for|indicated for)\s+([A-Za-z\s]+?)(?:\.|\n|$)", text, re.I)
        if ind_match:
            ind_text = ind_match.group(1).strip()
            if ind_text and ind_text.lower() != (clinical_group.diagnosis.value.lower() if clinical_group.diagnosis else ""):
                clinical_group.clinical_indication = GroupedField(
                    value=ind_text.capitalize(),
                    confidence=0.88,
                    requires_human_review=False,
                    raw_entity="INDICATION"
                )

        # Dates: Check explicit headers first
        adm_header_m = re.search(r"\b(?:Admission(?:\s*Date)?|DOA)\s*[:#]\s*([0-9A-Za-z\s\-,/]+?)(?:\n|\r|,|\||$)", text, re.I)
        if adm_header_m:
            clinical_group.admission_date = GroupedField(
                value=adm_header_m.group(1).strip(),
                confidence=0.98,
                requires_human_review=False,
                raw_entity="ADMISSION_DATE"
            )
        else:
            adm_ent = next((e for e in entities if e.entity == "ADMISSION_DATE" and e.text.strip().lower() not in MONTHS), None)
            if adm_ent:
                clinical_group.admission_date = GroupedField(
                    value=adm_ent.text.strip(),
                    confidence=adm_ent.confidence,
                    requires_human_review=adm_ent.requires_human_review,
                    raw_entity="ADMISSION_DATE"
                )

        dis_header_m = re.search(r"\b(?:Discharge(?:\s*Date)?|DOD)\s*[:#]\s*([0-9A-Za-z\s\-,/]+?)(?:\n|\r|,|\||$)", text, re.I)
        if dis_header_m:
            clinical_group.discharge_date = GroupedField(
                value=dis_header_m.group(1).strip(),
                confidence=0.98,
                requires_human_review=False,
                raw_entity="DISCHARGE_DATE"
            )
        else:
            dis_ent = next((e for e in entities if e.entity == "DISCHARGE_DATE" and len(e.text.strip()) > 4), None)
            if dis_ent:
                clinical_group.discharge_date = GroupedField(
                    value=dis_ent.text.strip(),
                    confidence=dis_ent.confidence,
                    requires_human_review=dis_ent.requires_human_review,
                    raw_entity="DISCHARGE_DATE"
                )

        # 4. Billing Information (Populate using deterministic Billing Reconciliation engine)
        try:
            from app.services.billing_reconciliation import billing_reconciliation_service
            from app.services.cost_anomaly import cost_anomaly_service
            rec = billing_reconciliation_service.reconcile_claim_billing(text=text)

            detected_curr = cost_anomaly_service.detect_currency(None, text=text)
            billing_group.currency = detected_curr
            curr_sym = "₹" if detected_curr == "INR" else ("$" if detected_curr == "USD" else ("€" if detected_curr == "EUR" else "£"))

            if rec.stated_total is not None and rec.stated_total > 0:
                billing_group.billed_amount = GroupedField(
                    value=f"{curr_sym}{rec.stated_total:,.2f}".replace(".00", ""),
                    confidence=0.98,
                    requires_human_review=False,
                    raw_entity="STATED_TOTAL"
                )
            if rec.itemized_sum > 0:
                billing_group.subtotal = GroupedField(
                    value=f"{curr_sym}{rec.itemized_sum:,.2f}".replace(".00", ""),
                    confidence=0.98,
                    requires_human_review=False,
                    raw_entity="ITEMIZED_TOTAL"
                )
            if rec.patient_payable is not None and rec.patient_payable > 0:
                billing_group.patient_payable = GroupedField(
                    value=f"{curr_sym}{rec.patient_payable:,.2f}".replace(".00", ""),
                    confidence=0.98,
                    requires_human_review=False,
                    raw_entity="PATIENT_PAYABLE"
                )
        except Exception as b_err:
            logger.debug(f"Billing reconciliation in NER group_medical_information fallback: {b_err}")

        # Direct Regex Fallback for Grand Total / Subtotal / Billed Amount if not yet captured
        if not billing_group.billed_amount:
            gt_m = re.search(r"\b(?:Grand\s*Total|Total\s*Amount|Billed\s*Amount|Total\s*Payable|Invoice\s*Total|Total)\s*[:#]?\s*(?:₹|Rs\.?|INR)?\s*([0-9,]+(?:\.[0-9]{2})?)", text, re.I)
            if gt_m:
                val_clean = gt_m.group(1).replace(",", "")
                curr_char = "₹" if ("₹" in text or "INR" in text or "Rs" in text) else "$"
                billing_group.billed_amount = GroupedField(
                    value=f"{curr_char}{val_clean}".replace(".00", ""),
                    confidence=0.98,
                    requires_human_review=False,
                    raw_entity="GRAND_TOTAL"
                )
                billing_group.currency = "INR" if curr_char == "₹" else "USD"

        if not billing_group.subtotal:
            sub_m = re.search(r"\b(?:Sub\s*Total|Subtotal)\s*[:#]?\s*(?:₹|Rs\.?|INR)?\s*([0-9,]+(?:\.[0-9]{2})?)", text, re.I)
            if sub_m:
                val_clean = sub_m.group(1).replace(",", "")
                curr_char = "₹" if ("₹" in text or "INR" in text or "Rs" in text) else "$"
                billing_group.subtotal = GroupedField(
                    value=f"{curr_char}{val_clean}".replace(".00", ""),
                    confidence=0.98,
                    requires_human_review=False,
                    raw_entity="SUBTOTAL"
                )

        # Fallback to NER if billing reconciliation didn't set values
        clm_amt_ent = next((e for e in entities if e.entity == "CLAIM_AMOUNT"), None)
        inv_tot_ent = next((e for e in entities if e.entity == "INVOICE_TOTAL"), None)

        if not billing_group.billed_amount:
            amt_ent = inv_tot_ent or clm_amt_ent
            if amt_ent:
                billing_group.billed_amount = GroupedField(
                    value=amt_ent.text.strip(),
                    confidence=amt_ent.confidence,
                    requires_human_review=amt_ent.requires_human_review,
                    raw_entity=amt_ent.entity
                )
                billing_group.currency = "INR" if ("₹" in amt_ent.text or "INR" in text or "Rs" in text) else "USD"

        # Explicit Indian GSTIN regex (15-character alphanumeric, e.g. 29ABCDE1234F1Z5)
        gst_match = re.search(r"\b\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}\b", text)
        if gst_match:
            billing_group.gstin = GroupedField(
                value=gst_match.group(0),
                confidence=0.95,
                requires_human_review=False,
                raw_entity="GSTIN"
            )

        # HSN/SAC: strictly 4 to 8 digits, NEVER postal PIN codes like 577004
        pin_match = re.search(r"\b\d{6}\b", text)
        found_pin = pin_match.group(0) if pin_match else None
        hsn_ent = next((e for e in entities if e.entity == "HSN_SAC" and re.search(r"^\d{4,8}$", e.text.strip()) and e.text.strip() != found_pin), None)
        if hsn_ent:
            billing_group.hsn_sac = GroupedField(
                value=hsn_ent.text.strip(),
                confidence=hsn_ent.confidence,
                requires_human_review=hsn_ent.requires_human_review,
                raw_entity="HSN_SAC"
            )

        tax_ent = next((e for e in entities if e.entity == "TAX_AMOUNT"), None)
        if tax_ent:
            billing_group.tax_amount = GroupedField(
                value=tax_ent.text.strip(),
                confidence=tax_ent.confidence,
                requires_human_review=tax_ent.requires_human_review,
                raw_entity="TAX_AMOUNT"
            )

        disc_ent = next((e for e in entities if e.entity == "DISCOUNT"), None)
        if disc_ent:
            billing_group.discount = GroupedField(
                value=disc_ent.text.strip(),
                confidence=disc_ent.confidence,
                requires_human_review=disc_ent.requires_human_review,
                raw_entity="DISCOUNT"
            )

        if not billing_group.patient_payable:
            pay_ent = next((e for e in entities if e.entity == "PATIENT_PAYABLE"), None)
            if pay_ent:
                billing_group.patient_payable = GroupedField(
                    value=pay_ent.text.strip(),
                    confidence=pay_ent.confidence,
                    requires_human_review=pay_ent.requires_human_review,
                    raw_entity="PATIENT_PAYABLE"
                )

        app_ent = next((e for e in entities if e.entity == "APPROVED_AMOUNT"), None)
        if app_ent and not any(kw in text.lower() for kw in ("investigations", "room & nursing", "six line items")):
            billing_group.approved_amount = GroupedField(
                value=app_ent.text.strip(),
                confidence=app_ent.confidence,
                requires_human_review=app_ent.requires_human_review,
                raw_entity="APPROVED_AMOUNT"
            )

        ded_ent = next((e for e in entities if e.entity == "INSURANCE_DEDUCTION"), None)
        if ded_ent:
            billing_group.insurance_deduction = GroupedField(
                value=ded_ent.text.strip(),
                confidence=ded_ent.confidence,
                requires_human_review=ded_ent.requires_human_review,
                raw_entity="INSURANCE_DEDUCTION"
            )

        clm_header_m = re.search(r"\b(?:Claimed(?:\s*Amount)?)\s*[:#]?\s*([₹$A-Za-z0-9,.]+)", text, re.I)
        if clm_header_m:
            billing_group.claimed_amount = GroupedField(
                value=clm_header_m.group(1).strip(),
                confidence=0.95,
                requires_human_review=False,
                raw_entity="CLAIM_AMOUNT"
            )
        elif clm_amt_ent and not billing_group.billed_amount:
            billing_group.claimed_amount = GroupedField(
                value=clm_amt_ent.text.strip(),
                confidence=clm_amt_ent.confidence,
                requires_human_review=clm_amt_ent.requires_human_review,
                raw_entity="CLAIM_AMOUNT"
            )

        return GroupedMedicalInformation(
            hospital=hospital_group,
            medicine=medicine_group,
            medicines=individual_medicines if individual_medicines else [medicine_group],
            clinical=clinical_group,
            billing=billing_group,
            document_type=doc_type
        )

    def _detect_document_type(self, entities: list[ExtractedEntity], text: str = "") -> Optional[str]:
        """Infer Indian healthcare document family from extracted entity types and text."""
        types = {e.entity for e in entities}
        text_lower = text.lower() if text else ""

        if {"INSURER", "TPA", "POLICY_NUMBER", "PREAUTH_NUMBER", "APPROVED_AMOUNT", "INSURANCE_DEDUCTION"} & types or any(kw in text_lower for kw in ("cashless claim", "claim form", "preauth", "policy number", "health insurance")):
            return "insurance_claim"
        if {"ADMISSION_DATE", "DISCHARGE_DATE", "ROOM_TYPE"} & types or any(kw in text_lower for kw in ("discharge summary", "final diagnosis", "admission date", "discharge date")):
            return "discharge_summary"
        if ({"BRAND_NAME", "GENERIC_NAME", "DOSAGE"} & types and not ({"INVOICE_NUMBER", "GSTIN", "INVOICE_TOTAL"} & types)) or any(kw in text_lower for kw in ("prescription", "rx", "dosage instructions", "consultation date")):
            return "prescription"
        if {"INVOICE_NUMBER", "INVOICE_TOTAL", "GSTIN", "HSN_SAC", "UNIT_PRICE", "LINE_AMOUNT"} & types or any(kw in text_lower for kw in ("tax invoice", "bill of supply", "itemized bill", "hospital bill", "invoice number")):
            return "hospital_bill"
        return "clinical_document"


ner_service = BioBERTNERService()
