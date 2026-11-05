"""
Model 5: Claim-Level Anomaly Detection Service.
Detects unusual individual healthcare claim patterns using Isolation Forest V3 Strict Temporal
and V4-A Experimental alternative.
Features: Stay duration, pass-through amounts, coinsurance, diagnosis counts, procedure counts, seasonality.
Findings are anomaly-screening signals, NOT proof of fraud or fraud probability.
"""

from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional
import joblib
import numpy as np
import pandas as pd

from app.config import get_settings
from app.models.schemas import ClaimAnomalyResult
from app.utils.logger import logger


class ClaimAnomalyService:
    """Service wrapping Model 5 Claim-Level Anomaly Detection."""

    RAW_COLUMNS = [
        "CLM_ID", "DESYNPUF_ID", "PRVDR_NUM",
        "CLM_ADMSN_DT", "CLM_FROM_DT", "CLM_THRU_DT",
        "NCH_BENE_DSCHRG_DT", "CLM_PASS_THRU_PER_DIEM_AMT",
        "NCH_BENE_PTA_COINSRNC_LBLTY_AM",
        "NCH_BENE_BLOOD_DDCTBL_LBLTY_AM",
        "CLM_UTLZTN_DAY_CNT", "CLM_DRG_CD"
    ]

    def __init__(
        self,
        v3_path: Optional[str] = None,
        v4a_path: Optional[str] = None
    ):
        self.settings = get_settings()
        self.raw_v3_path = v3_path or self.settings.MODEL_5_CLAIM_ANOMALY_PATH
        self.raw_v4a_path = v4a_path or self.settings.MODEL_5_CLAIM_ANOMALY_V4A_PATH
        self._v3_artifact = None
        self._v4a_model = None

    def _resolve_path(self, path_str: str) -> Path:
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
        """Check if Model 5 V3 artifact exists."""
        return self._resolve_path(self.raw_v3_path).exists()

    def _load_models(self) -> None:
        """Lazy load V3 Strict artifact and optional V4-A experimental model."""
        if self._v3_artifact is not None:
            return

        v3_path = self._resolve_path(self.raw_v3_path)
        if not v3_path.exists():
            raise FileNotFoundError(f"Model 5 V3 Strict artifact not found at: {v3_path}")

        logger.info(f"Loading Model 5 V3 Strict artifact from '{v3_path}'...")
        self._v3_artifact = joblib.load(str(v3_path))
        # Ensure scikit-learn 1.9 compatibility for unpickled SimpleImputer
        imputer = self._v3_artifact.get("imputer")
        if imputer is not None and not hasattr(imputer, "_fill_dtype"):
            imputer._fill_dtype = imputer.statistics_.dtype

        logger.info("Model 5 V3 Strict artifact loaded successfully.")

        # Load V4-A if available
        v4a_path = self._resolve_path(self.raw_v4a_path)
        if v4a_path.exists():
            try:
                self._v4a_model = joblib.load(str(v4a_path))
                logger.info("Model 5 V4-A Experimental model loaded successfully.")
            except Exception as e:
                logger.warning(f"Could not load Model 5 V4-A experimental model: {e}")
                self._v4a_model = None

    def adapt_claim_data(self, claim_data: dict[str, Any]) -> tuple[Optional[pd.DataFrame], list[str]]:
        """
        Adapt claim dictionary into DE-SynPUF raw claim format for Model 5 feature extraction.
        Requires at least admission date, claim dates, and monetary/stay indicators.
        Returns (raw_claims_df, missing_fields).
        """
        if not claim_data:
            return None, ["claim_data"]

        # Check for minimum required fields
        clm_id = str(claim_data.get("CLM_ID") or claim_data.get("claim_id") or "CLM_AUTO_001")
        desynpuf_id = str(claim_data.get("DESYNPUF_ID") or claim_data.get("patient_id") or "BENEFICIARY_001")
        prvdr_num = str(claim_data.get("PRVDR_NUM") or claim_data.get("provider_id") or "000000")

        # Dates (expected in YYYYMMDD or parseable format)
        def clean_date_str(val: Any, default: str = "20260101") -> str:
            if not val:
                return default
            s = str(val).replace("-", "").replace("/", "")[:8]
            return s if len(s) == 8 and s.isdigit() else default

        admsn_dt = clean_date_str(claim_data.get("CLM_ADMSN_DT") or claim_data.get("admission_date"))
        from_dt = clean_date_str(claim_data.get("CLM_FROM_DT") or claim_data.get("claim_from_date"), default=admsn_dt)
        thru_dt = clean_date_str(claim_data.get("CLM_THRU_DT") or claim_data.get("claim_thru_date") or claim_data.get("discharge_date"), default=from_dt)
        dschrg_dt = clean_date_str(claim_data.get("NCH_BENE_DSCHRG_DT") or claim_data.get("discharge_date"), default=thru_dt)

        util_days = claim_data.get("CLM_UTLZTN_DAY_CNT") or claim_data.get("utilization_days")
        util_val = float(util_days) if util_days is not None else np.nan

        # Synchronize discharge and through dates with utilization days if dates are collapsed
        if util_val is not None and util_val > 0 and dschrg_dt == admsn_dt:
            try:
                d_adm = datetime.strptime(admsn_dt, "%Y%m%d")
                d_dis = d_adm + timedelta(days=int(util_val))
                dschrg_dt = d_dis.strftime("%Y%m%d")
                thru_dt = dschrg_dt
            except Exception:
                pass

        pass_thru = float(claim_data.get("CLM_PASS_THRU_PER_DIEM_AMT") or claim_data.get("pass_through_amount") or 0.0)
        # Pass-through per-diem is capital/PPS carve-out, NOT total billed charge
        if pass_thru > 1000.0:
            logger.warning(
                f"Pass-through per-diem value {pass_thru} exceeds standard Medicare per-diem scales (normative mean ~$1.90/day); "
                "treating as total billed charge and defaulting pass-through per diem to 0.0."
            )
            pass_thru = 0.0

        coinsurance = float(claim_data.get("NCH_BENE_PTA_COINSRNC_LBLTY_AM") or claim_data.get("coinsurance_amount") or 0.0)
        blood_deduct = float(claim_data.get("NCH_BENE_BLOOD_DDCTBL_LBLTY_AM") or claim_data.get("blood_deductible") or 0.0)
        drg_cd = str(claim_data.get("CLM_DRG_CD") or claim_data.get("drg_code") or "000")

        # Diagnosis and Procedure lists
        dx_codes = claim_data.get("diagnosis_codes") or []
        px_codes = claim_data.get("procedure_codes") or []

        row: dict[str, Any] = {
            "CLM_ID": clm_id,
            "DESYNPUF_ID": desynpuf_id,
            "PRVDR_NUM": prvdr_num,
            "CLM_ADMSN_DT": admsn_dt,
            "CLM_FROM_DT": from_dt,
            "CLM_THRU_DT": thru_dt,
            "NCH_BENE_DSCHRG_DT": dschrg_dt,
            "CLM_PASS_THRU_PER_DIEM_AMT": pass_thru,
            "NCH_BENE_PTA_COINSRNC_LBLTY_AM": coinsurance,
            "NCH_BENE_BLOOD_DDCTBL_LBLTY_AM": blood_deduct,
            "CLM_UTLZTN_DAY_CNT": util_val,
            "CLM_DRG_CD": drg_cd,
        }

        # Up to 10 diagnoses and 6 procedures
        for i in range(1, 11):
            key = f"ICD9_DGNS_CD_{i}"
            row[key] = claim_data.get(key) or (dx_codes[i - 1] if i <= len(dx_codes) else "")
        for i in range(1, 7):
            key = f"ICD9_PRCDR_CD_{i}"
            row[key] = claim_data.get(key) or (px_codes[i - 1] if i <= len(px_codes) else "")

        df = pd.DataFrame([row])
        return df, []

    def _prepare_features(self, raw_claims: pd.DataFrame, artifact: dict[str, Any]) -> tuple[pd.DataFrame, pd.DataFrame]:
        """Convert raw claim DataFrame into the 13 features following Model 5 specification."""
        df = raw_claims.copy().reset_index(drop=True)

        def parse_date(series):
            values = pd.to_numeric(series, errors="coerce")
            return pd.to_datetime(
                values.round().astype("Int64").astype("string"),
                format="%Y%m%d",
                errors="coerce"
            )

        admission = parse_date(df["CLM_ADMSN_DT"])
        claim_from = parse_date(df["CLM_FROM_DT"])
        claim_thru = parse_date(df["CLM_THRU_DT"])
        discharge = parse_date(df["NCH_BENE_DSCHRG_DT"])

        X = pd.DataFrame(index=df.index)
        X["Pass_Through_Amount"] = pd.to_numeric(df["CLM_PASS_THRU_PER_DIEM_AMT"], errors="coerce")
        X["Coinsurance_Amount"] = pd.to_numeric(df["NCH_BENE_PTA_COINSRNC_LBLTY_AM"], errors="coerce")
        X["Blood_Deductible"] = pd.to_numeric(df["NCH_BENE_BLOOD_DDCTBL_LBLTY_AM"], errors="coerce")
        X["Utilization_Days"] = pd.to_numeric(df["CLM_UTLZTN_DAY_CNT"], errors="coerce")

        stay_claim = (claim_thru - claim_from).dt.days
        stay_admsn = (discharge - admission).dt.days
        X["Stay_Days_From_Claim_Dates"] = stay_claim.fillna(1).clip(lower=0)
        X["Stay_Days_From_Admission"] = stay_admsn.fillna(1).clip(lower=0)

        def count_codes(columns):
            return pd.DataFrame({
                col: (df[col].notna() & df[col].astype(str).str.strip().ne(""))
                for col in columns
            }).sum(axis=1)

        X["Diagnosis_Count"] = count_codes([f"ICD9_DGNS_CD_{i}" for i in range(1, 11)])
        X["Procedure_Count"] = count_codes([f"ICD9_PRCDR_CD_{i}" for i in range(1, 7)])
        X["Utilization_Missing"] = X["Utilization_Days"].isna().astype(int)

        month = admission.dt.month.fillna(1)
        X["Admission_Month_Sin"] = np.sin(2 * np.pi * month / 12)
        X["Admission_Month_Cos"] = np.cos(2 * np.pi * month / 12)

        X["Provider_Claim_Frequency"] = (
            df["PRVDR_NUM"].astype(str)
            .map(artifact.get("provider_training_counts", {}))
            .fillna(0)
        )
        X["DRG_Claim_Frequency"] = (
            df["CLM_DRG_CD"].astype(str)
            .map(artifact.get("drg_training_counts", {}))
            .fillna(0)
        )

        log_columns = [
            "Pass_Through_Amount", "Coinsurance_Amount",
            "Blood_Deductible", "Utilization_Days",
            "Stay_Days_From_Claim_Dates",
            "Stay_Days_From_Admission", "Diagnosis_Count",
            "Procedure_Count", "Provider_Claim_Frequency",
            "DRG_Claim_Frequency"
        ]
        for col in log_columns:
            X[col] = np.log1p(X[col].clip(lower=0))

        X = X[artifact["feature_names"]]
        identifiers = df[["CLM_ID", "DESYNPUF_ID", "PRVDR_NUM"]].copy()
        return identifiers, X

    def derive_claim_data_from_claim(
        self,
        claim: Any,
        cost_details: Optional[Any] = None,
        ner_entities: Optional[list[Any]] = None
    ) -> Optional[dict[str, Any]]:
        """
        Derive Model 5 claim-level input dictionary from a Claim object and extraction metadata.
        Constructs standard DE-SynPUF fields using available clinical and billing data.
        """
        if not claim:
            return None

        import re
        text = getattr(claim, "original_text", "") or ""
        extracted = getattr(claim, "extracted_fields", None)

        # Parse monetary charge
        amount = 0.0
        if cost_details and getattr(cost_details, "extracted_amount", None) is not None:
            amount = float(cost_details.extracted_amount)
        elif extracted and getattr(extracted, "cost_range", None):
            digits = re.findall(r"[\d,]+(?:\.\d+)?", str(extracted.cost_range))
            if digits:
                try:
                    amount = float(digits[0].replace(",", ""))
                except ValueError:
                    amount = 0.0

        # Detect encounter type: Outpatient / Emergency vs genuine Inpatient admission
        text_lower = text.lower()
        is_emergency_or_outpatient = any(
            kw in text_lower
            for kw in (
                "emergency department", "emergency room", "casualty", "er visit",
                "outpatient", "ambulatory", "day care", "clinic consultation",
                "charge summary", "prescription", "office visit", "op consultation",
                "clinic", "apollo clinic", "prescribed medicines", "rx", "one tablet",
                "before breakfast", "after meals", "at night"
            )
        ) and not any(
            kw in text_lower
            for kw in ("inpatient stay", "admitted on", "admission date", "discharged on", "discharge date", "icu stay", "inpatient ward", "ip no", "ipd no")
        )

        if is_emergency_or_outpatient:
            return {
                "encounter_type": "OUTPATIENT_OR_EMERGENCY",
                "is_inpatient": False,
                "reason": "Encounter is an Outpatient / Clinic encounter without inpatient admission or length-of-stay metrics. Inpatient anomaly screening is not applicable."
            }

        # Parse utilization days / length of stay from actual text (never fabricate)
        # CRITICAL: Medication course duration (e.g. '30 days') must NEVER be parsed as hospital stay
        stay_days = None
        days_match = re.search(r"(?:length\s*of\s*stay|hospital\s*stay|admission\s*duration)\s*[:=]?\s*(\d+)\s*(?:days?|nights?)?", text, re.IGNORECASE)
        if not days_match and not is_emergency_or_outpatient:
            days_match = re.search(r"\b(\d+)\s*(?:day|days|night|nights)\b\s*(?:hospitalization|admission|inpatient|stay)", text, re.IGNORECASE)
        if days_match:
            try:
                stay_days = float(days_match.group(1))
            except ValueError:
                stay_days = None
        elif any(w in text_lower for w in ("inpatient stay", "hospital stay", "length of stay")):
            stay_days = 1.0

        # Helper to parse dates in clinical formats (e.g. 10 February 2026, 2026-02-10, 10/02/2026)
        def _parse_clinical_date(val: Optional[str]) -> Optional[datetime]:
            if not val or not str(val).strip():
                return None
            s = str(val).strip()
            month_map = {
                'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6,
                'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12,
                'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'jun': 6, 'jul': 7, 'aug': 8,
                'sep': 9, 'sept': 9, 'oct': 10, 'nov': 11, 'dec': 12
            }
            # 1. '10 February 2026' or '10 Feb 2026'
            m1 = re.search(r"\b(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})\b", s)
            if m1 and m1.group(2).lower() in month_map:
                try:
                    return datetime(int(m1.group(3)), month_map[m1.group(2).lower()], int(m1.group(1)))
                except ValueError:
                    pass
            # 2. 'February 10, 2026'
            m2 = re.search(r"\b([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})\b", s)
            if m2 and m2.group(1).lower() in month_map:
                try:
                    return datetime(int(m2.group(3)), month_map[m2.group(1).lower()], int(m2.group(2)))
                except ValueError:
                    pass
            # 3. '2026-02-10' or '2026/02/10'
            m3 = re.search(r"\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b", s)
            if m3:
                try:
                    return datetime(int(m3.group(1)), int(m3.group(2)), int(m3.group(3)))
                except ValueError:
                    pass
            # 4. '10-02-2026' or '10/02/2026'
            m4 = re.search(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b", s)
            if m4:
                try:
                    return datetime(int(m4.group(3)), int(m4.group(2)), int(m4.group(1)))
                except ValueError:
                    pass
            return None

        # Look for admission and discharge dates in BioBERT entities or text
        adm_date_obj: Optional[datetime] = None
        dis_date_obj: Optional[datetime] = None

        if ner_entities:
            for ent in ner_entities:
                ename = getattr(ent, "entity", "")
                etext = getattr(ent, "text", "")
                if ename in ("ADMISSION_DATE", "DOA") and not adm_date_obj:
                    adm_date_obj = _parse_clinical_date(etext)
                elif ename in ("DISCHARGE_DATE", "DOD") and not dis_date_obj:
                    dis_date_obj = _parse_clinical_date(etext)

        if not adm_date_obj:
            adm_m = re.search(r"(?:admission(?:\s*date)?|admitted(?:\s*on)?|doa)\s*[:=]?\s*([0-9A-Za-z\s,/.-]+?)(?:\n|,|;|$)", text, re.IGNORECASE)
            if adm_m:
                adm_date_obj = _parse_clinical_date(adm_m.group(1))

        if not dis_date_obj:
            dis_m = re.search(r"(?:discharge(?:\s*date)?|discharged(?:\s*on)?|dod)\s*[:=]?\s*([0-9A-Za-z\s,/.-]+?)(?:\n|,|;|$)", text, re.IGNORECASE)
            if dis_m:
                dis_date_obj = _parse_clinical_date(dis_m.group(1))

        if adm_date_obj:
            admsn_str = adm_date_obj.strftime("%Y%m%d")
            if dis_date_obj:
                dschrg_str = dis_date_obj.strftime("%Y%m%d")
                calc_days = max((dis_date_obj - adm_date_obj).days, 0)
                if stay_days is None:
                    stay_days = float(calc_days)
            elif stay_days is not None:
                dschrg_str = (adm_date_obj + timedelta(days=int(stay_days))).strftime("%Y%m%d")
            else:
                dschrg_str = admsn_str
        else:
            # Fallback to date_pattern YYYY-MM-DD
            date_pattern = re.compile(r"\b(20\d{2}[-/.]\d{2}[-/.]\d{2})\b")
            dates_found = date_pattern.findall(text)
            if dates_found:
                admsn_clean = dates_found[0].replace("-", "").replace("/", "").replace(".", "")
                if len(dates_found) > 1:
                    dschrg_clean = dates_found[1].replace("-", "").replace("/", "").replace(".", "")
                    try:
                        d_adm = datetime.strptime(admsn_clean, "%Y%m%d")
                        d_dis = datetime.strptime(dschrg_clean, "%Y%m%d")
                        calc_days = max((d_dis - d_adm).days, 0)
                        if stay_days is None:
                            stay_days = float(calc_days)
                    except Exception:
                        pass
                elif stay_days is not None:
                    try:
                        d_adm = datetime.strptime(admsn_clean, "%Y%m%d")
                        d_dis = d_adm + timedelta(days=int(stay_days))
                        dschrg_clean = d_dis.strftime("%Y%m%d")
                    except Exception:
                        dschrg_clean = admsn_clean
                else:
                    dschrg_clean = admsn_clean
                admsn_str = admsn_clean
                dschrg_str = dschrg_clean
            else:
                # If no inpatient admission date exists in an unstructured claim, do not fabricate an inpatient stay
                if stay_days is None and not any(w in text_lower for w in ("inpatient", "admission", "admitted")):
                    return {
                        "encounter_type": "OUTPATIENT_OR_EMERGENCY",
                        "is_inpatient": False,
                        "reason": "Single claim note lacks inpatient admission date or length-of-stay metrics. Inpatient anomaly screening deferred."
                    }
                ts = getattr(claim, "timestamp", None)
                base_date = ts if (ts and hasattr(ts, "strftime")) else datetime(2026, 1, 1)
                admsn_str = base_date.strftime("%Y%m%d")
                eff_days = int(stay_days) if stay_days is not None else 1
                dschrg_str = (base_date + timedelta(days=eff_days)).strftime("%Y%m%d")
                if stay_days is None:
                    stay_days = 1.0

        # Diagnosis and Procedure lists
        dx_list: list[str] = []
        px_list: list[str] = []
        if ner_entities:
            for ent in ner_entities:
                ename = getattr(ent, "entity", "")
                etext = getattr(ent, "text", "")
                if ename in ("DIAGNOSIS", "CONDITION", "INDICATION", "PROBLEM"):
                    dx_list.append(etext)
                elif ename in ("PROCEDURE", "CPT_CODE", "TEST", "SURGERY"):
                    px_list.append(etext)

        # Also search for 5-digit CPT codes
        cpt_codes = re.findall(r"\b\d{5}\b", text)
        for c in cpt_codes:
            if c not in px_list:
                px_list.append(c)

        # DRG code extraction if present
        drg_cd = "000"
        drg_match = re.search(r"\b(?:MS-)?DRG\s*[:#]?\s*(\d{1,3})\b", text, re.IGNORECASE)
        if drg_match:
            drg_cd = drg_match.group(1).zfill(3)

        # Pass-through per diem amount is a Medicare capital/PPS carve-out, NOT total billed amount
        pass_thru_amt = 0.0
        pass_thru_match = re.search(r"(?:pass[- ]through|per[- ]diem)\s*[:=]?\s*[₹$]?\s*([0-9,]+(?:\.[0-9]+)?)", text, re.IGNORECASE)
        if pass_thru_match:
            try:
                pass_thru_amt = float(pass_thru_match.group(1).replace(",", ""))
            except ValueError:
                pass_thru_amt = 0.0

        # Check if we have at least minimal claim signal
        has_signal = bool(amount > 0 or px_list or dx_list or stay_days is not None)
        if not has_signal:
            return None

        return {
            "CLM_ID": getattr(claim, "claim_id", "CLM_DERIVED"),
            "DESYNPUF_ID": f"BENE_{getattr(claim, 'claim_id', '000')[-6:]}",
            "PRVDR_NUM": getattr(claim.location, "normalized_key", "000000") if getattr(claim, "location", None) else "000000",
            "CLM_ADMSN_DT": admsn_str,
            "CLM_FROM_DT": admsn_str,
            "CLM_THRU_DT": dschrg_str,
            "NCH_BENE_DSCHRG_DT": dschrg_str,
            "CLM_PASS_THRU_PER_DIEM_AMT": pass_thru_amt,
            "NCH_BENE_PTA_COINSRNC_LBLTY_AM": 0.0,
            "NCH_BENE_BLOOD_DDCTBL_LBLTY_AM": 0.0,
            "CLM_UTLZTN_DAY_CNT": stay_days,
            "CLM_DRG_CD": drg_cd,
            "diagnosis_codes": dx_list,
            "procedure_codes": px_list,
        }

    def evaluate_claim(
        self,
        claim_data: Optional[dict[str, Any]] = None,
        claim: Optional[Any] = None,
        cost_details: Optional[Any] = None,
        ner_entities: Optional[list[Any]] = None
    ) -> ClaimAnomalyResult:
        """
        Evaluate individual claim data against Model 5 Isolation Forest V3 and V4-A.
        Constructs features from claim_data dict or derives them from a Claim object.
        Returns anomaly scores, decision, review flags, model agreement, and feature breakdown.
        """
        if not claim_data and claim:
            claim_data = self.derive_claim_data_from_claim(claim, cost_details, ner_entities)

        if not claim_data:
            return ClaimAnomalyResult(
                model_version="V3 Strict Temporal" + (" + V4-A Experimental" if self._v4a_model else ""),
                decision="INSUFFICIENT_DATA",
                has_sufficient_data=False,
                is_anomaly=False,
                anomaly_score=0.0,
                screening_flag="Insufficient claim features",
                explanations=["No claim-level inpatient or financial features supplied for screening."],
                disclaimer="Claim-level anomaly-screening signal; not proof of fraud."
            )

        if claim_data.get("encounter_type") in ("OUTPATIENT_OR_EMERGENCY", "OUTPATIENT", "PRESCRIPTION") or claim_data.get("is_inpatient") is False:
            return ClaimAnomalyResult(
                model_version="V3 Strict Temporal" + (" + V4-A Experimental" if self._v4a_model else ""),
                decision="NOT_APPLICABLE",
                has_sufficient_data=False,
                is_anomaly=False,
                anomaly_score=0.0,
                screening_flag="Not applicable to outpatient / clinic encounter",
                explanations=[
                    claim_data.get("reason")
                    or "Claim is an Outpatient / Clinic encounter without inpatient admission or length-of-stay features. Inpatient anomaly screening is not applicable."
                ],
                disclaimer="Claim-level anomaly-screening signal; not proof of fraud."
            )

        raw_df, missing = self.adapt_claim_data(claim_data)
        if raw_df is None:
            return ClaimAnomalyResult(
                model_version="V3 Strict Temporal",
                decision="INSUFFICIENT_DATA",
                has_sufficient_data=False,
                is_anomaly=False,
                anomaly_score=0.0,
                screening_flag="Insufficient claim features",
                explanations=[f"Missing claim fields: {', '.join(missing)}"]
            )

        try:
            self._load_models()
        except Exception as e:
            logger.error(f"Failed to load Model 5 Claim Anomaly: {e}")
            return ClaimAnomalyResult(
                model_version="V3 Strict Temporal",
                decision="INSUFFICIENT_DATA",
                has_sufficient_data=False,
                is_anomaly=False,
                anomaly_score=0.0,
                screening_flag="Model unavailable",
                explanations=[f"Model loading error: {e}"]
            )

        try:
            identifiers, X = self._prepare_features(raw_df, self._v3_artifact)

            # Impute and Scale using V3 artifact transformers
            X_imputed = self._v3_artifact["imputer"].transform(X)
            X_scaled = self._v3_artifact["scaler"].transform(X_imputed)

            # Primary V3 inference
            v3_pred = int(self._v3_artifact["model"].predict(X_scaled)[0])
            v3_score = float(self._v3_artifact["model"].decision_function(X_scaled)[0])
            is_anomaly = (v3_pred == -1)

            # Optional V4-A experimental inference
            v4a_score = None
            v4a_flag = False
            agreement = None

            if self._v4a_model is not None:
                try:
                    v4a_pred = int(self._v4a_model.predict(X_scaled)[0])
                    v4a_score = float(self._v4a_model.decision_function(X_scaled)[0])
                    v4a_flag = (v4a_pred == -1)

                    if is_anomaly and v4a_flag:
                        agreement = "Both Models Flagged"
                    elif is_anomaly and not v4a_flag:
                        agreement = "V3 Only"
                    elif not is_anomaly and v4a_flag:
                        agreement = "V4-A Only (Experimental)"
                    else:
                        agreement = "Neither Model Flagged"
                except Exception as ex:
                    logger.debug(f"V4-A evaluation error: {ex}")

            explanations = []
            if is_anomaly:
                decision = "REVIEW_RECOMMENDED"
                flag = "Review recommended"
                explanations.append("Claim features fall in the top 5% most anomalous utilization/financial patterns.")
                stay_days = float(X["Stay_Days_From_Admission"].iloc[0])
                if stay_days > 2.0:  # log1p(stay_days) > 2 -> ~7+ days
                    explanations.append("Extended length of stay compared to baseline DRG distribution.")
                dx_cnt = float(X["Diagnosis_Count"].iloc[0])
                if dx_cnt > 2.0:
                    explanations.append("High comorbid diagnosis count on single admission.")
            else:
                decision = "NOT_FLAGGED"
                flag = "Not flagged"
                explanations.append("Claim features conform to standard inpatient billing and length-of-stay profiles.")

            features_used = {col: round(float(X[col].iloc[0]), 3) for col in X.columns}

            return ClaimAnomalyResult(
                model_version="V3 Strict Temporal" + (" + V4-A Experimental" if self._v4a_model else ""),
                decision=decision,
                is_anomaly=is_anomaly,
                anomaly_score=round(v3_score, 4),
                screening_flag=flag,
                model_agreement=agreement,
                v3_score=round(v3_score, 4),
                v4a_score=round(v4a_score, 4) if v4a_score is not None else None,
                features_used=features_used,
                explanations=explanations,
                has_sufficient_data=True,
                disclaimer="Claim-level anomaly-screening signal; not proof of fraud."
            )
        except Exception as e:
            logger.error(f"Error during Model 5 inference: {e}")
            return ClaimAnomalyResult(
                model_version="V3 Strict Temporal",
                decision="INSUFFICIENT_DATA",
                has_sufficient_data=False,
                is_anomaly=False,
                anomaly_score=0.0,
                screening_flag="Inference error",
                explanations=[f"Error evaluating claim features: {e}"]
            )


claim_anomaly_service = ClaimAnomalyService()
