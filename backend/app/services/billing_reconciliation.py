"""
Claim-Level Billing Reconciliation & Accounting Integrity Service.
Evaluates claim-level invoice arithmetic, line-item itemization, duplicate charges,
potential unbundling overlaps, and grounded price benchmark comparisons.
Independent of historical provider ML (Model 4).
"""

import json
import re
import uuid
from pathlib import Path
from typing import Any, Optional

from app.models.schemas import (
    BenchmarkComparison,
    BillingClassification,
    BillingLineItem,
    BillingReconciliationResult,
    DuplicateLineItem,
    OverlappingCharge,
)
from app.utils.logger import logger


class BillingReconciliationService:
    """Service providing claim-level invoice arithmetic and billing integrity auditing."""

    def __init__(self, benchmarks_path: Optional[str] = None):
        self.benchmarks_path = benchmarks_path
        self._benchmarks: Optional[list[dict[str, Any]]] = None

    def _resolve_benchmarks_path(self) -> Path:
        """Resolve path to price_benchmarks.json."""
        if self.benchmarks_path:
            p = Path(self.benchmarks_path)
            if p.exists():
                return p
        # Default locations
        root = Path(__file__).resolve().parent.parent.parent.parent
        candidates = [
            root / "data" / "knowledge" / "price_benchmarks.json",
            Path.cwd() / "data" / "knowledge" / "price_benchmarks.json",
            Path("data/knowledge/price_benchmarks.json"),
        ]
        for c in candidates:
            if c.exists():
                return c
        return candidates[0]

    def _load_benchmarks(self) -> list[dict[str, Any]]:
        """Load pricing benchmarks from JSON knowledge base."""
        if self._benchmarks is not None:
            return self._benchmarks

        p = self._resolve_benchmarks_path()
        if not p.exists():
            logger.warning(f"Price benchmarks file not found at {p}")
            self._benchmarks = []
            return self._benchmarks

        try:
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
                self._benchmarks = data if isinstance(data, list) else []
                logger.info(f"Loaded {len(self._benchmarks)} price benchmarks for billing reconciliation.")
        except Exception as e:
            logger.error(f"Failed to load price benchmarks: {e}")
            self._benchmarks = []

        return self._benchmarks

    def parse_line_items(self, text: str) -> list[BillingLineItem]:
        """
        Extract itemized line items from invoice or claim text.
        Recognizes numbered lines, bullets, tables, description-to-amount pairs,
        and multi-line (adjacent line) OCR item descriptions and amounts.
        Filters out document headers, patient metadata, and summary totals.
        """
        if not text:
            return []

        line_items: list[BillingLineItem] = []
        lines = [line.strip() for line in text.split("\n") if line.strip()]

        # Headers and metadata to exclude from being treated as bill line items
        EXCLUDE_PATTERNS = [
            r"^\s*(?:hospital|facility|clinic|institute|provider|doctor|physician|dr\.)\s*[:#]",
            r"^\s*(?:patient|name|age|gender|sex|dob|mrn|uhid|ip\s*no|op\s*no|patient\s*id)\s*[:#]",
            r"^\s*(?:admission|discharge|doa|dod|date\s*of|encounter|length\s*of\s*stay|stay)\s*[:#]",
            r"^\s*(?:diagnosis|indication|clinical|chief\s*complaint|treatment|procedure\s*name)\s*[:#]",
            r"^\s*(?:policy|claim\s*id|claim\s*number|tpa|insurer|preauth)\s*[:#]",
            r"^\s*(?:(?:six|\d+|all)?\s*line\s*items?|billing\s*breakdown|bill\s*breakdown|charges|particulars|itemized\s*charges)\s*[:#]?\s*$",
            r"^\s*(?:itemized\s*(?:total|sum|charges?)|total\b[^\n:=]*|stated\s*(?:total|billed|bill)?\b[^\n:=]*|invoice\s*total|net\s*(?:total|payable|amount)|final\s*(?:bill|amount)|grand\s*total|subtotal|balance|amount\s*paid|patient\s*payable|amount\s*payable)\s*[:=]?",
            r"^\s*(?:[A-Za-z\s,.-]+\b)?(?:davangere|bengaluru|bangalore|mumbai|delhi|chennai|hyderabad|kolkata|ballari|mangaluru|mysuru|karnataka|maharashtra|tamil\s*nadu|india)\b.*(?:\b\d{6}\b)?",
            r"^\s*(?:pin|pincode|postal\s*code|zip|zipcode)\s*[:#–\-]?\s*\d{5,6}\b",
            r"^\s*(?:sl\s*no|s\.no|item\s*no|description|particulars|rate|qty|quantity|amount)\s*\|",
            r"^[-=_\s]+$",
        ]

        # Document-Type Gate: Prescriptions contain medical dosing instructions, not billing line items
        text_lower = text.lower()
        has_rx_markers = any(w in text_lower for w in ("prescription", "prescribed medicines", "rx", "one tablet", "take 1 tablet", "after meals", "before breakfast", "at night"))
        has_bill_markers = any(w in text_lower for w in ("invoice", "bill no", "total bill", "tax invoice", "final bill", "receipt no", "billed amount", "stated total", "charges summary", "tariff", "cghs code", "hospital bill"))
        if has_rx_markers and not has_bill_markers:
            logger.info("Prescription document detected without billing headers; bypassing billing line item extraction.")
            return []

        # Pass 1: Parse single-line items
        item_idx = 1
        for raw_line in lines:
            line_lower = raw_line.lower()

            # Skip excluded summary / metadata lines
            if any(re.search(pat, line_lower) for pat in EXCLUDE_PATTERNS):
                continue

            # Must contain at least one digit to be a potential single-line billing item
            if not re.search(r"\d", raw_line):
                continue

            parsed_item = self._parse_single_line_item(raw_line, item_idx)
            if parsed_item:
                line_items.append(parsed_item)
                item_idx += 1

        # Pass 2: If Pass 1 found fewer than 2 items, attempt multi-line (adjacent-line) pairing
        # OCR frequently emits the clinical description on line i and the monetary amount on line i+1
        if len(line_items) < 2:
            multi_line_items = self._parse_adjacent_line_items(lines, EXCLUDE_PATTERNS)
            if len(multi_line_items) > len(line_items):
                line_items = multi_line_items

        return line_items

    def _parse_adjacent_line_items(self, lines: list[str], exclude_patterns: list[str]) -> list[BillingLineItem]:
        """Pair adjacent description and monetary amount lines from OCR text."""
        paired_items: list[BillingLineItem] = []
        i = 0
        item_idx = 1

        def is_pure_amount(s: str) -> bool:
            clean = re.sub(r"[\s/=\-onlycrdr]+$", "", s.strip(), flags=re.I)
            clean = re.sub(r"^[₹$€£RsINR\s.]+", "", clean, flags=re.I).replace(",", "").strip()
            if clean and clean.replace(".", "", 1).isdigit():
                try:
                    val = float(clean)
                    return 0 < val < 10000000 and not (100000 <= val <= 999999 and not re.search(r"[₹$€£]|Rs\.?|INR", s, re.I))
                except ValueError:
                    return False
            return False

        def get_amount_val(s: str) -> float:
            clean = re.sub(r"[\s/=\-onlycrdr]+$", "", s.strip(), flags=re.I)
            clean = re.sub(r"^[₹$€£RsINR\s.]+", "", clean, flags=re.I).replace(",", "").strip()
            return float(clean)

        while i < len(lines) - 1:
            curr_l = lines[i]
            next_l = lines[i + 1]
            curr_low = curr_l.lower()

            if any(re.search(pat, curr_low) for pat in exclude_patterns):
                i += 1
                continue

            # Check if next_l is a standalone monetary amount and curr_l is a textual description
            if is_pure_amount(next_l) and not is_pure_amount(curr_l):
                clean_desc = re.sub(r"^\s*(?:\d+[\.\)]|[-*•])\s*", "", curr_l).strip()
                # Skip if header or summary total
                if len(clean_desc) >= 3 and not re.search(r"\b(?:total|payable|billed|subtotal|balance|due)\b", clean_desc, re.I):
                    amt = get_amount_val(next_l)
                    combined_raw = f"{curr_l}: {next_l}"
                    if self._is_valid_bill_item(clean_desc, amt, combined_raw):
                        paired_items.append(
                            BillingLineItem(
                                item_id=f"item_{item_idx:03d}",
                                description=clean_desc,
                                amount=amt,
                                currency="INR",
                                raw_text=combined_raw
                            )
                        )
                        item_idx += 1
                        i += 2
                        continue
            i += 1

        return paired_items

    def _is_valid_bill_item(self, desc: str, amt: float, raw_line: str) -> bool:
        """Filter out non-monetary items like postal PIN codes, locations, phone numbers, and dates."""
        if len(desc) < 3 or desc.replace(".", "").isdigit() or amt <= 0:
            return False
        desc_low = desc.lower()
        geo_terms = {"davangere", "karnataka", "bengaluru", "bangalore", "mumbai", "delhi", "chennai", "hyderabad", "kolkata", "ballari", "mangaluru", "mysuru", "india", "pincode", "postal"}
        if any(geo in desc_low for geo in geo_terms) and bool(re.search(r"\b\d{5,6}\b", raw_line)):
            return False
        if not re.search(r"[₹$€£]|Rs\.?|INR|USD|EUR", raw_line, re.I):
            if 100000 <= amt <= 999999:  # 6-digit postal PIN code
                return False
        months = ("january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december")
        if any(m in desc_low for m in months):
            return False

        # Filter out clinical dosing instructions from being parsed as billing line items
        CLINICAL_INSTRUCTION_WORDS = {
            "tablet", "tablets", "tab", "tabs", "capsule", "capsules", "cap", "caps",
            "twice daily", "once daily", "thrice daily", "daily", "after meals",
            "before breakfast", "at night", "morning and night", "od", "bd", "tds", "qid", "qhs",
            "for 30 days", "30 days", "days", "weeks", "months", "oral", "po"
        }
        has_currency_sym = bool(re.search(r"[₹$€£]|Rs\.?|INR|USD|EUR", raw_line, re.I))
        if any(re.search(r"\b" + re.escape(w) + r"\b", desc_low) for w in CLINICAL_INSTRUCTION_WORDS) and not has_currency_sym:
            return False
        # Do not accept small bare single digits (1, 2, 3, 5, 10, 30) without currency symbol as monetary amounts
        if not has_currency_sym and amt in (1.0, 2.0, 3.0, 4.0, 5.0, 10.0, 15.0, 20.0, 30.0, 50.0):
            return False

        return True

    def _parse_single_line_item(self, line: str, index: int) -> Optional[BillingLineItem]:
        """Parse description and monetary amount from a single line."""
        # 1. Table row format: | Description | Qty | Amount | or | Description | Amount |
        if "|" in line:
            parts = [p.strip() for p in line.split("|") if p.strip()]
            if len(parts) >= 2:
                # Find amount part (typically last column or second column with digits)
                for part in reversed(parts):
                    clean_amt_str = re.sub(r"[\s/=\-onlycrdr]+$", "", part, flags=re.I)
                    clean_amt_str = re.sub(r"[₹$€£Rs.INR,\s]", "", clean_amt_str)
                    if clean_amt_str and clean_amt_str.replace(".", "", 1).isdigit():
                        try:
                            amt = float(clean_amt_str)
                            desc = parts[0]
                            if self._is_valid_bill_item(desc, amt, line):
                                return BillingLineItem(
                                    item_id=f"item_{index:03d}",
                                    description=desc,
                                    amount=amt,
                                    currency="INR",
                                    raw_text=line
                                )
                        except ValueError:
                            pass

        # 2. Key-value or colon-separated line: "1. Room & Nursing Charges (4 Days): ₹10,000/-"
        m_colon = re.search(
            r"^\s*(?:(?:\d+[\.\)]?|[-*•])\s+)?(.+?)\s*[:=]\s*(?:[₹$€£]|Rs\.?|INR)?\s*([0-9,]+(?:\.[0-9]{1,2})?)(?:\s*(?:/[-=]|only|\.00/[-=]))?\s*$",
            line,
            re.I
        )
        if m_colon:
            desc = m_colon.group(1).strip()
            amt_str = m_colon.group(2).replace(",", "").strip()
            try:
                amt = float(amt_str)
                if self._is_valid_bill_item(desc, amt, line):
                    return BillingLineItem(
                        item_id=f"item_{index:03d}",
                        description=desc,
                        amount=amt,
                        currency="INR",
                        raw_text=line
                    )
            except ValueError:
                pass

        # 3. Trailing currency format: "Complete Blood Count Rs. 350/-" or "IV Saline 1000ml ₹250"
        m_curr = re.search(
            r"^\s*(?:(?:\d+[\.\)]?|[-*•])\s+)?(.+?)\s+(?:[₹$€£]|Rs\.?|INR)\s*([0-9,]+(?:\.[0-9]{1,2})?)(?:\s*(?:/[-=]|only|\.00/[-=]))?\s*$",
            line,
            re.I
        )
        if m_curr:
            desc = m_curr.group(1).strip()
            amt_str = m_curr.group(2).replace(",", "").strip()
            try:
                amt = float(amt_str)
                if self._is_valid_bill_item(desc, amt, line):
                    return BillingLineItem(
                        item_id=f"item_{index:03d}",
                        description=desc,
                        amount=amt,
                        currency="INR",
                        raw_text=line
                    )
            except ValueError:
                pass

        # 4. Standard dash or arrow format: "Paracetamol 500mg - 50/-"
        m_dash = re.search(
            r"^\s*(?:(?:\d+[\.\)]?|[-*•])\s+)?(.+?)\s+[-–—]\s*(?:[₹$€£]|Rs\.?|INR)?\s*([0-9,]+(?:\.[0-9]{1,2})?)(?:\s*(?:/[-=]|only|\.00/[-=]))?\s*$",
            line,
            re.I
        )
        if m_dash:
            desc = m_dash.group(1).strip()
            amt_str = m_dash.group(2).replace(",", "").strip()
            try:
                amt = float(amt_str)
                if self._is_valid_bill_item(desc, amt, line):
                    return BillingLineItem(
                        item_id=f"item_{index:03d}",
                        description=desc,
                        amount=amt,
                        currency="INR",
                        raw_text=line
                    )
            except ValueError:
                pass

        # 5. Multi-space or tab separated format: "Physician Consultation    5000"
        m_space = re.search(
            r"^\s*(?:(?:\d+[\.\)]?|[-*•])\s+)?(.+?)(?:\s{2,}|\t)\s*(?:[₹$€£]|Rs\.?|INR)?\s*([0-9,]+(?:\.[0-9]{1,2})?)(?:\s*(?:/[-=]|only|\.00/[-=]))?\s*$",
            line,
            re.I
        )
        if m_space:
            desc = m_space.group(1).strip()
            amt_str = m_space.group(2).replace(",", "").strip()
            try:
                amt = float(amt_str)
                if self._is_valid_bill_item(desc, amt, line):
                    return BillingLineItem(
                        item_id=f"item_{index:03d}",
                        description=desc,
                        amount=amt,
                        currency="INR",
                        raw_text=line
                    )
            except ValueError:
                pass

        # 6. Generic trailing number: "1 Room & Nursing Charges (4 Days) 10000"
        m_generic = re.search(
            r"^\s*(?:(?:\d+[\.\)]?|[-*•])\s+)?(.+?)\s+([0-9,]+(?:\.[0-9]{1,2})?)(?:\s*(?:/[-=]|only|\.00/[-=]))?\s*$",
            line,
            re.I
        )
        if m_generic:
            desc = m_generic.group(1).strip()
            amt_str = m_generic.group(2).replace(",", "").strip()
            try:
                amt = float(amt_str)
                if self._is_valid_bill_item(desc, amt, line):
                    return BillingLineItem(
                        item_id=f"item_{index:03d}",
                        description=desc,
                        amount=amt,
                        currency="INR",
                        raw_text=line
                    )
            except ValueError:
                pass

        return None

    def extract_stated_total(self, text: str, claim: Optional[Any] = None) -> Optional[float]:
        """Extract stated total bill from document text or claim metadata."""
        if not text:
            return None

        # 1. Regex pattern for stated total in text with strict precedence order (supporting trailing /- or only):
        patterns = [
            r"(?:stated\s*(?:total|billed|bill)?\s*(?:amount|charges?)?|total\s*billed\s*amount|grand\s*total|patient\s*payable|final\s*bill\s*amount)\s*[:=]?\s*(?:Rs\.?|INR|[₹$])?\s*([0-9,]+(?:\.[0-9]+)?)(?:\s*(?:/[-=]|only))?",
            r"(?:invoice\s*total|net\s*(?:total|payable|amount)|total\s*(?:bill|amount|charge|billed|payable))\s*[:=]?\s*(?:Rs\.?|INR|[₹$])?\s*([0-9,]+(?:\.[0-9]+)?)(?:\s*(?:/[-=]|only))?",
            r"^\s*(?:total|billed\s*amount)\s*[:=]\s*(?:Rs\.?|INR|[₹$])?\s*([0-9,]+(?:\.[0-9]+)?)(?:\s*(?:/[-=]|only))?",
            r"\b(?:total|billed\s*amount)\s*[:=]?\s*(?:Rs\.?|INR|[₹$])?\s*([0-9,]+(?:\.[0-9]+)?)(?:\s*(?:/[-=]|only))?",
        ]
        for pat in patterns:
            m = re.search(pat, text, re.IGNORECASE)
            if m:
                try:
                    val = float(m.group(1).replace(",", "").strip())
                    if val > 0:
                        return val
                except ValueError:
                    pass

        # 2. Multi-line total match: Header on line i, amount on line i+1
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        for i in range(len(lines) - 1):
            if re.search(r"^(?:stated\s*(?:total|billed|bill)?\s*(?:amount|charges?)?|total\s*billed\s*amount|grand\s*total|final\s*bill|patient\s*payable)\s*[:=]?$", lines[i], re.I):
                amt_m = re.search(r"^(?:Rs\.?|INR|[₹$])?\s*([0-9,]+(?:\.[0-9]+)?)(?:\s*(?:/[-=]|only))?$", lines[i + 1], re.I)
                if amt_m:
                    try:
                        val = float(amt_m.group(1).replace(",", "").strip())
                        if val > 0:
                            return val
                    except ValueError:
                        pass

        # 3. Fallback to claim extracted fields
        if claim is not None:
            extracted = getattr(claim, "extracted_fields", None)
            if extracted and getattr(extracted, "cost_range", None):
                digits = re.findall(r"[\d,]+(?:\.\d+)?", str(extracted.cost_range))
                if digits:
                    try:
                        return float(digits[0].replace(",", ""))
                    except ValueError:
                        pass

        return None

    def detect_duplicate_line_items(self, line_items: list[BillingLineItem]) -> list[DuplicateLineItem]:
        """
        Identify line items appearing more than once with identical or near-identical descriptions/amounts.
        Provides clinical context (medication dosing vs procedural duplication).
        """
        duplicates: list[DuplicateLineItem] = []
        if len(line_items) < 2:
            return duplicates

        # Group items by normalized description
        groups: dict[str, list[BillingLineItem]] = {}
        for item in line_items:
            # Clean description: strip leading bullets, numbers, trailing punctuation
            norm = re.sub(r"^\s*(?:\d+[\.\)]|[-*•])\s*", "", item.description.lower()).strip()
            # Normalize internal whitespace
            norm = re.sub(r"\s+", " ", norm)
            # Remove parenthetical abbreviations (e.g. (CBC) -> cbc)
            core_key = re.sub(r"\s*\([^)]*\)", "", norm).strip() or norm
            groups.setdefault(core_key, []).append(item)

        MEDICATION_KEYWORDS = {
            "tablet", "tab", "capsule", "cap", "mg", "ml", "injection", "inj",
            "iv", "saline", "syrup", "infusion", "dose", "paracetamol", "antibiotic",
            "metformin", "ceftriaxone", "pantoprazole", "ondansetron"
        }

        for core_key, items in groups.items():
            if len(items) > 1:
                first_item = items[0]
                count = len(items)
                amt_per = first_item.amount
                total_dup = round(amt_per * count, 2)

                # Check if item description indicates medication / consumable
                is_med = any(kw in core_key for kw in MEDICATION_KEYWORDS)
                if is_med:
                    clinical_note = (
                        "Multiple administrations or repeat doses of medication/consumables may be clinically legitimate. "
                        "Verify administration chart and prescription schedule."
                    )
                else:
                    clinical_note = (
                        f"Line item '{first_item.description}' is billed {count} times at ₹{amt_per:,.2f} each. "
                        "Duplicate billing of procedural, diagnostic, or room charges requires verification against clinical chart."
                    )

                duplicates.append(
                    DuplicateLineItem(
                        description=first_item.description,
                        occurrences=count,
                        amount_per_occurrence=amt_per,
                        total_duplicate_billed=total_dup,
                        currency="INR",
                        clinical_note=clinical_note
                    )
                )

        return duplicates

    def detect_overlapping_charges(self, line_items: list[BillingLineItem]) -> list[OverlappingCharge]:
        """
        Detect potentially overlapping charges or known unbundling patterns.
        Flags policy-dependent bundling questions without claiming illegality.
        """
        overlaps: list[OverlappingCharge] = []
        if len(line_items) < 2:
            return overlaps

        def find_items(pattern: str) -> list[BillingLineItem]:
            rx = re.compile(pattern, re.IGNORECASE)
            return [it for it in line_items if rx.search(it.description)]

        # 1. Routine nursing care / nursing handover billed separately when room/bed charges are present
        room_items = find_items(r"\b(?:room|bed|ward|inpatient\s*stay|per\s*diem)\b")
        nursing_items = find_items(r"\b(?:routine\s*nursing|nursing\s*care|general\s*nursing|nursing\s*handover)\b")
        if room_items and nursing_items:
            for n_it in nursing_items:
                if n_it.item_id != room_items[0].item_id:
                    overlaps.append(
                        OverlappingCharge(
                            item_a=n_it.description,
                            item_b=room_items[0].description,
                            overlap_type="BUNDLED_NURSING",
                            potential_overlap_amount=n_it.amount,
                            currency="INR",
                            policy_reference="NABH & General Hospital Inpatient Tariff Guidelines",
                            explanation=(
                                f"'{n_it.description}' (₹{n_it.amount:,.2f}) may be included in '{room_items[0].description}' "
                                "under standard hospital billing guidelines. Policy-dependent — verify with hospital billing policy."
                            )
                        )
                    )

        # 2. Bedside monitoring fee billed separately when ICU charges are present
        icu_items = find_items(r"\b(?:icu|intensive\s*care|ccu|nicu|picu)\b")
        mon_items = find_items(r"\b(?:monitoring|bedside\s*monitor|vitals\s*monitoring)\b")
        if icu_items and mon_items:
            for m_it in mon_items:
                overlaps.append(
                    OverlappingCharge(
                        item_a=m_it.description,
                        item_b=icu_items[0].description,
                        overlap_type="BUNDLED_MONITORING",
                        potential_overlap_amount=m_it.amount,
                        currency="INR",
                        policy_reference="ICU Package Tariff Guidelines",
                        explanation=(
                            f"'{m_it.description}' (₹{m_it.amount:,.2f}) is typically bundled within ICU per diem tariffs "
                            f"('{icu_items[0].description}'). Policy-dependent — verify with hospital billing policy."
                        )
                    )
                )

        # 3. Basic surgical consumables billed separately when surgical procedure package is present
        surgery_items = find_items(r"\b(?:surgery|procedure|operation|arthroscopy|laparoscopy|appendectomy|hernia)\b")
        consumable_items = find_items(r"\b(?:basic\s*consumables|surgical\s*drape|gloves|sterile\s*disposables)\b")
        if surgery_items and consumable_items:
            for c_it in consumable_items:
                overlaps.append(
                    OverlappingCharge(
                        item_a=c_it.description,
                        item_b=surgery_items[0].description,
                        overlap_type="BUNDLED_SURGICAL_CONSUMABLES",
                        potential_overlap_amount=c_it.amount,
                        currency="INR",
                        policy_reference="CGHS / PMJAY Surgical Package Inclusions",
                        explanation=(
                            f"'{c_it.description}' (₹{c_it.amount:,.2f}) is generally included in comprehensive surgical package tariffs "
                            f"('{surgery_items[0].description}'). Policy-dependent — verify with hospital billing policy."
                        )
                    )
                )

        # 4. IV fluid administration fee billed separately alongside IV fluids
        iv_line_items = find_items(r"\b(?:iv\s*(?:administration|line\s*charge|infusion\s*charge|cannula\s*insertion)|infusion\s*fee)\b")
        iv_fluid_items = find_items(r"\b(?:iv\s*saline|normal\s*saline|0\.9%|iv\s*fluids|dextrose|ringer)\b")
        if iv_line_items and iv_fluid_items:
            for iv_it in iv_line_items:
                overlaps.append(
                    OverlappingCharge(
                        item_a=iv_it.description,
                        item_b=iv_fluid_items[0].description,
                        overlap_type="BUNDLED_IV_ADMINISTRATION",
                        potential_overlap_amount=iv_it.amount,
                        currency="INR",
                        policy_reference="Standard Inpatient Nursing Protocols",
                        explanation=(
                            f"'{iv_it.description}' (₹{iv_it.amount:,.2f}) may be bundled into general inpatient nursing or room tariffs "
                            "rather than itemized as an unbundled surcharge. Policy-dependent — verify with hospital billing policy."
                        )
                    )
                )

        return overlaps

    def match_benchmarks(self, line_items: list[BillingLineItem]) -> list[BenchmarkComparison]:
        """
        Compare line items against verified benchmarks in price_benchmarks.json.
        Records source, ceiling, and conditions.
        Explicitly reports 'Comparison cannot be established' when unlisted without inventing tariffs.
        """
        benchmarks = self._load_benchmarks()
        comparisons: list[BenchmarkComparison] = []

        for item in line_items:
            item_desc_lower = item.description.lower()
            matched_b: Optional[dict[str, Any]] = None
            best_match_score = 0

            # Match against knowledge base keywords
            for b in benchmarks:
                b_curr = b.get("currency", "INR")
                keywords = b.get("keywords", [])
                score = sum(1 for kw in keywords if kw.lower() in item_desc_lower)
                # Prioritize INR benchmarks for Indian bills
                if b_curr == "INR" and score > 0:
                    score += 1
                if score > best_match_score and score >= 1:
                    best_match_score = score
                    matched_b = b

            if matched_b is not None:
                b_max = float(matched_b.get("typical_max", 0.0))
                b_min = float(matched_b.get("typical_min", 0.0))
                source = str(matched_b.get("source", "Official Price Benchmark"))
                unit = matched_b.get("unit")
                cat = matched_b.get("category")

                if item.amount > b_max:
                    diff = round(item.amount - b_max, 2)
                    pct = round((diff / b_max) * 100, 1) if b_max > 0 else 0.0
                    note = f"Billed charge of ₹{item.amount:,.2f} exceeds {source} benchmark ceiling of ₹{b_max:,.2f} by ₹{diff:,.2f} ({pct}%)."
                    status = "EXCEEDS_BENCHMARK"
                elif item.amount < b_min:
                    diff = round(b_min - item.amount, 2)
                    pct = round((diff / b_min) * 100, 1) if b_min > 0 else 0.0
                    note = f"Billed charge of ₹{item.amount:,.2f} is below typical benchmark minimum of ₹{b_min:,.2f} ({source})."
                    status = "BELOW_BENCHMARK"
                else:
                    diff = 0.0
                    pct = 0.0
                    note = f"Billed charge of ₹{item.amount:,.2f} is within published benchmark range (₹{b_min:,.2f} - ₹{b_max:,.2f}) from {source}."
                    status = "WITHIN_BENCHMARK"

                comparisons.append(
                    BenchmarkComparison(
                        service_or_item=item.description,
                        billed_amount=item.amount,
                        benchmark_min=b_min,
                        benchmark_max=b_max,
                        currency="INR",
                        status=status,
                        difference_amount=diff,
                        percentage_difference=pct,
                        source_attribution=source,
                        service_category=cat,
                        ceiling_conditions=unit,
                        note=note
                    )
                )
            else:
                # Comparison cannot be established — never invent tariffs
                comparisons.append(
                    BenchmarkComparison(
                        service_or_item=item.description,
                        billed_amount=item.amount,
                        benchmark_min=None,
                        benchmark_max=None,
                        currency="INR",
                        status="CANNOT_ESTABLISH",
                        difference_amount=None,
                        percentage_difference=None,
                        source_attribution=None,
                        note=f"Comparison cannot be established — no published benchmark available for '{item.description}' in this region."
                    )
                )

        return comparisons

    def reconcile_claim_billing(
        self,
        claim: Optional[Any] = None,
        text: Optional[str] = None
    ) -> BillingReconciliationResult:
        """
        Complete claim-level billing reconciliation:
        1. Extract line items & calculate itemized sum.
        2. Extract stated total bill & calculate exact difference.
        3. Detect duplicate line items.
        4. Detect potential unbundling overlaps.
        5. Match against grounded price benchmarks.
        6. Determine classification and non-accusatory auditor findings.
        """
        doc_text = text or (getattr(claim, "original_text", "") if claim else "") or ""

        # 1. Line items & Stated total
        line_items = self.parse_line_items(doc_text)
        stated_total = self.extract_stated_total(doc_text, claim)
        itemized_sum = round(sum(it.amount for it in line_items), 2)

        # Extract Patient Payable if present (single-line or two-line)
        pat_pay_match = re.search(
            r"\b(?:Patient\s*Payable|Amount\s*Payable|Payable\s*Amount)\s*[:#]?\s*(?:₹|Rs\.?|INR|\$)?\s*([\d,]+(?:\.[0-9]{1,2})?)(?:\s*(?:/[-=]|only))?",
            doc_text,
            re.I
        )
        patient_payable = None
        if pat_pay_match:
            try:
                patient_payable = float(pat_pay_match.group(1).replace(",", ""))
            except ValueError:
                pass
        if patient_payable is None:
            doc_lines = [l.strip() for l in doc_text.splitlines() if l.strip()]
            for i in range(len(doc_lines) - 1):
                if re.search(r"^\s*(?:Patient\s*Payable|Amount\s*Payable|Payable\s*Amount)\s*[:#]?$", doc_lines[i], re.I):
                    amt_m = re.search(r"^(?:₹|Rs\.?|INR|\$)?\s*([0-9,]+(?:\.[0-9]{1,2})?)(?:\s*(?:/[-=]|only))?$", doc_lines[i + 1], re.I)
                    if amt_m:
                        try:
                            patient_payable = float(amt_m.group(1).replace(",", ""))
                            break
                        except ValueError:
                            pass

        # 2. Arithmetic difference
        difference = None
        if stated_total is not None:
            difference = round(itemized_sum - stated_total, 2)

        # 3. Duplicates & Overlaps
        duplicates = self.detect_duplicate_line_items(line_items)
        overlaps = self.detect_overlapping_charges(line_items)

        # 4. Benchmark Comparisons
        benchmark_comparisons = self.match_benchmarks(line_items)

        # 5. Determine Classification
        explanations: list[str] = []
        auditor_notes: list[str] = []

        if not line_items:
            classification = BillingClassification.INSUFFICIENT_ITEMIZATION
            is_prescription = any(w in doc_text.lower() for w in ("prescription", "prescribed medicines", "rx", "apollo clinic", "one tablet", "take 1 tablet"))
            if is_prescription:
                summary = "Prescription document contains clinical dosing instructions without billed charges or invoice totals. Billing reconciliation deferred to pharmacy invoice."
                explanations.append("Document is an outpatient clinical prescription. No hospital tariff or medication prices are billed on this document.")
            else:
                summary = (
                    f"Single stated total bill of ₹{stated_total:,.2f} without individual line-item itemization."
                    if stated_total is not None
                    else "No individual line items or stated total bill identified in document text."
                )
                explanations.append(
                    "Document lacks individual line items to reconcile against the stated total. "
                    "Line-item itemization required for accounting verification."
                )
        elif duplicates and (stated_total is None or abs(difference or 0.0) < 0.01):
            classification = BillingClassification.POSSIBLE_DUPLICATE
            summary = f"Detected {len(duplicates)} line item(s) billed multiple times ('mentioned 2 times'). Verify dosing schedule and chart entries."
            for dup in duplicates:
                explanations.append(f"POSSIBLE_DUPLICATE: '{dup.description}' billed {dup.occurrences} times at ₹{dup.amount_per_occurrence:,.2f} each.")
        elif overlaps and (stated_total is None or abs(difference or 0.0) < 0.01):
            classification = BillingClassification.POTENTIAL_OVERLAP_REQUIRES_REVIEW
            summary = f"Detected {len(overlaps)} potentially overlapping charge(s). Bundling is policy-dependent — verify with hospital billing policy."
            for ov in overlaps:
                explanations.append(f"POTENTIAL_OVERLAP_REQUIRES_REVIEW: {ov.explanation}")
        elif stated_total is not None and abs(difference or 0.0) >= 0.01:
            classification = BillingClassification.TOTAL_MISMATCH
            diff_abs = abs(difference or 0.0)
            diff_direction = "exceeds" if (difference or 0.0) > 0 else "is lower than"
            summary = (
                f"Unexplained difference of ₹{diff_abs:,.2f} between itemized charges (₹{itemized_sum:,.2f}) "
                f"and stated total bill (₹{stated_total:,.2f})."
            )
            explanations.append(
                f"Arithmetic discrepancy: Itemized line items sum to ₹{itemized_sum:,.2f}, which {diff_direction} "
                f"the stated total bill of ₹{stated_total:,.2f} by ₹{diff_abs:,.2f}. "
                "Possible reasons include unlisted services, administrative charges, arithmetic error, or unbundled fees."
            )
            if duplicates:
                for dup in duplicates:
                    explanations.append(f"POSSIBLE_DUPLICATE: '{dup.description}' billed {dup.occurrences} times at ₹{dup.amount_per_occurrence:,.2f} each.")
            if overlaps:
                for ov in overlaps:
                    explanations.append(f"POTENTIAL_OVERLAP_REQUIRES_REVIEW: {ov.explanation}")
        elif stated_total is not None and abs(difference or 0.0) < 0.01:
            classification = BillingClassification.TOTAL_MATCH
            summary = f"Itemized charges (₹{itemized_sum:,.2f}) exactly match the stated total bill (₹{stated_total:,.2f})."
            explanations.append("Arithmetic integrity confirmed: Sum of line items exactly equals the stated invoice total.")
        else:
            classification = BillingClassification.INSUFFICIENT_ITEMIZATION
            summary = f"Extracted {len(line_items)} line item(s) totalling ₹{itemized_sum:,.2f}; stated total bill not specified."
            explanations.append("Invoice provides itemized charges but lacks an explicit stated total bill header for reconciliation.")

        # Auditor notes
        auditor_notes.append(
            "Claim-level billing reconciliation evaluates accounting facts and line-item integrity. "
            "Discrepancies are reported as arithmetic observations, not accusations of fraud."
        )
        if overlaps:
            auditor_notes.append(
                "Potential unbundling flags are policy-dependent. Bundling of routine nursing, monitoring, or sterile supplies "
                "depends on the hospital's specific tariff schedule and contractual agreements."
            )

        return BillingReconciliationResult(
            classification=classification,
            stated_total=stated_total,
            itemized_sum=itemized_sum,
            difference=difference,
            patient_payable=patient_payable,
            currency="INR",
            line_items=line_items,
            duplicates=duplicates,
            overlaps=overlaps,
            benchmark_comparisons=benchmark_comparisons,
            summary_message=summary,
            explanations=explanations,
            auditor_notes=auditor_notes,
            disclaimer=(
                "Arithmetic and line-item discrepancies reflect invoice reconciliation facts, "
                "not automatic fraud accusations. Bundling and package inclusions are policy-dependent "
                "and require verification against the hospital's published tariff schedule."
            )
        )


billing_reconciliation_service = BillingReconciliationService()
