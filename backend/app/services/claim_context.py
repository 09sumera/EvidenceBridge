"""
Shared Claim Context & Issue-Aware Cross-Model Synthesis Service.

Ensures that all 5 integrated AI models operate on the EXACT SAME claim context:
- Normalizes patient, provider, clinical entity, code, and financial data.
- Enforces strict single-claim context provenance.
- Detects specific clinical and financial issue types.
- Generates transparent cross-model synthesis explaining agreement, contradictions,
  primary trigger issues, missing information, and human review requirements.
"""

from __future__ import annotations

import re
from typing import Any, Optional

from app.models.schemas import (
    Claim,
    CostAnomalyDetails,
    CrossModelSynthesis,
    ExtractedEntity,
    NLIResult,
    ProviderAnomalyResult,
    ClaimAnomalyResult,
    MedicineSubstitutionResult,
    SharedClaimContext,
    VerificationAction,
    VerificationVerdict,
)
from app.utils.logger import logger


class ClaimContextService:
    """Service to create normalized claim contexts and synthesize cross-model audit findings."""

    def build_shared_context(
        self,
        claim: Claim,
        ner_entities: Optional[list[ExtractedEntity]] = None,
        cost_details: Optional[CostAnomalyDetails] = None,
        ocr_text: Optional[str] = None,
        provider_data: Optional[dict[str, Any]] = None,
        claim_data: Optional[dict[str, Any]] = None,
    ) -> SharedClaimContext:
        """
        Build a single normalized claim context containing all extracted entities,
        hospital/provider identity, clinical items, and financial values.
        """
        text = claim.original_text or ""
        doc_id = (
            getattr(claim.provenance, "source_hash", None)
            or getattr(claim.provenance, "original_snippet", None)
            or f"doc_{claim.claim_id[-8:]}"
        )
        if isinstance(doc_id, str) and len(doc_id) > 20:
            doc_id = doc_id[:16]

        hospital_name = None
        provider_name = None
        diagnoses: list[str] = []
        medicines: list[str] = []
        procedures: list[str] = []
        patient_info: dict[str, Any] = {}

        # Check source text headers FIRST for explicit ground truth provider and hospital identity
        hosp_header = re.search(r"\b(?:HOSPITAL|FACILITY|CLINIC|INSTITUTE)\s*[:#]\s*([A-Za-z0-9&.,\s\-]+?)(?:\n|\r|,|$)", text, re.IGNORECASE)
        explicit_header_hospital = None
        if hosp_header:
            raw_h = hosp_header.group(1).strip()
            explicit_header_hospital = re.sub(
                r",\s*(?:Davangere|Bengaluru|Bangalore|Mangaluru|Ballari|Belagavi|Mysuru|Hubballi|Karnataka|India|District|State).*$",
                "", raw_h, flags=re.IGNORECASE
            ).strip()
        else:
            lines_all = [l.strip() for l in text.splitlines() if l.strip()]
            for first_l in lines_all[:3]:
                if re.search(r"\b(?:Hospital|Clinic|Medical Center|Medical Institute|Institute|Healthcare|Health System)\b", first_l, re.I):
                    explicit_header_hospital = re.sub(
                        r",\s*(?:Davangere|Bengaluru|Bangalore|Mangaluru|Ballari|Belagavi|Mysuru|Hubballi|Karnataka|India|District|State).*$",
                        "", first_l, flags=re.IGNORECASE
                    ).strip()
                    break

        provider_header = re.search(r"\b(?:PROVIDER|PHYSICIAN|DOCTOR)\s*[:#]\s*([A-Za-z0-9&.,\s\-]+?)(?:\n|\r|,|$)", text, re.IGNORECASE)
        explicit_header_provider = None
        if provider_header:
            raw_p = provider_header.group(1).strip()
            explicit_header_provider = re.sub(
                r",\s*(?:Davangere|Bengaluru|Bangalore|Mangaluru|Ballari|Belagavi|Mysuru|Hubballi|Karnataka|India|District|State).*$",
                "", raw_p, flags=re.IGNORECASE
            ).strip()

        MONTHS = {"january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "no", "yes", "none"}

        # 1. Parse from BioBERT NER entities (Model 1)
        if ner_entities:
            for ent in ner_entities:
                ename = getattr(ent, "entity", "").upper()
                etext = getattr(ent, "text", "").strip()
                if not etext:
                    continue

                if ename in ("HOSPITAL_NAME", "HOSPITAL", "CLINIC", "FACILITY", "ORGANIZATION"):
                    if not hospital_name and etext.lower() not in ("52", "no", "yes") and not etext.isdigit():
                        hospital_name = etext
                elif ename in ("DOCTOR_NAME", "DOCTOR", "PHYSICIAN", "PROVIDER"):
                    if not provider_name:
                        provider_name = etext
                if ename in ("DIAGNOSIS", "INDICATION", "PROBLEM", "CONDITION", "ICD_CODE"):
                    is_stray = bool(re.fullmatch(r"[\W\d_]+", etext) and len(etext) <= 2)
                    if not is_stray and len(etext) >= 3 and etext.lower() not in MONTHS and not etext.isdigit() and etext not in diagnoses:
                        diagnoses.append(etext)
                elif ename in ("MEDICINE_NAME", "BRAND_NAME", "GENERIC_NAME", "DRUG", "ACTIVE_INGREDIENT"):
                    is_stray = bool(re.fullmatch(r"[\W\d_]+", etext) and len(etext) <= 2)
                    NON_MEDS = {"medicines", "medicines and consumables", "consumables", "pharmacy", "drugs"}
                    is_duration = bool(re.search(r"\b\d+\s*days?\b", etext, re.I))
                    if not is_stray and len(etext) >= 3 and not is_duration and etext.lower() not in NON_MEDS and etext not in medicines:
                        medicines.append(etext)
                elif ename in ("PROCEDURE", "CPT_CODE", "TEST", "SURGERY"):
                    is_stray = bool(re.fullmatch(r"[\W\d_]+", etext) and len(etext) <= 2)
                    if not is_stray and etext.lower() not in MONTHS and etext not in procedures:
                        procedures.append(etext)
                elif ename in ("PATIENT_NAME", "PATIENT"):
                    patient_info["patient_name"] = etext
                elif ename in ("AGE", "GENDER"):
                    patient_info[ename.lower()] = etext

        # Explicit diagnosis header check (takes absolute precedence over noisy subwords)
        diag_header_m = re.search(r"\b(?:Diagnosis|Primary\s*Diagnosis|Final\s*Diagnosis)\s*[:#]\s*([A-Za-z0-9\s\-]+?)(?:\n|\r|,|\||$)", text, re.I)
        if diag_header_m:
            dh = diag_header_m.group(1).strip()
            if dh and dh.lower() not in MONTHS:
                if dh in diagnoses:
                    diagnoses.remove(dh)
                diagnoses.insert(0, dh)

        # Clean trailing district / location suffixes from hospital name if present
        if hospital_name:
            hospital_name = re.sub(r",\s*(?:Davangere|Bengaluru|Bangalore|Mangaluru|Ballari|Belagavi|Mysuru|Hubballi|Karnataka|India).*$", "", hospital_name, flags=re.IGNORECASE).strip()

        # 2. Reconcile against source text ground truth (Explicit headers take precedence over clipped NER)
        # Check if NER extracted a clipped or subword fragment (e.g. "EE MEDICAL INSTITUTE" or "Medical Institute")
        if explicit_header_hospital:
            if not hospital_name:
                hospital_name = explicit_header_hospital
            else:
                clean_h_low = explicit_header_hospital.lower()
                h_low = hospital_name.lower()
                is_subword_clipped = (
                    h_low.startswith("ee ")
                    or h_low.startswith("##")
                    or len(explicit_header_hospital) > len(hospital_name)
                    or clean_h_low.endswith(h_low)
                    or h_low in clean_h_low
                )
                if is_subword_clipped:
                    hospital_name = explicit_header_hospital

        if not hospital_name and provider_data and provider_data.get("provider_name"):
            hospital_name = str(provider_data["provider_name"]).strip()

        if not hospital_name:
            hosp_match = re.search(r"([A-Z][A-Za-z0-9&.,\s]+(?:Hospital|Clinic|Medical Center|Medical Institute|Institute|Healthcare|Health System))", text)
            if hosp_match:
                hospital_name = hosp_match.group(1).strip()
            elif getattr(claim, "location", None) and getattr(claim.location, "city", None):
                hospital_name = f"Medical Center ({claim.location.city})"

        if hospital_name:
            hospital_name = re.sub(r",\s*(?:Davangere|Bengaluru|Bangalore|Mangaluru|Ballari|Belagavi|Mysuru|Hubballi|Karnataka|India).*$", "", hospital_name, flags=re.IGNORECASE).strip()

        # Final subword recovery: Ensure clipped subwords are properly reconstructed from text
        if hospital_name and (hospital_name.lower().startswith("ee ") or hospital_name.lower().startswith("##")):
            gen_hosp_m = re.search(r"\b([A-Z][A-Za-z0-9&.,\s\-]+?(?:Institute|Hospital|Clinic|Center|Healthcare|Health System))\b", text)
            if gen_hosp_m:
                hospital_name = gen_hosp_m.group(1).strip()
            elif hospital_name.lower().startswith("ee "):
                hospital_name = hospital_name[3:].strip()
            elif hospital_name.startswith("##"):
                hospital_name = hospital_name[2:].strip()

        # Reconcile provider name: prioritize explicit provider header or hospital identity
        if explicit_header_provider:
            provider_name = explicit_header_provider
        elif not provider_name or provider_name.lower().startswith("ee ") or provider_name.lower().startswith("##"):
            if provider_data and provider_data.get("provider_name"):
                provider_name = str(provider_data["provider_name"]).strip()
            else:
                EXCLUDE_DOCTOR_WORDS = {"consultation", "charges", "charge", "fee", "fees", "services", "service", "visit", "order", "review", "handover", "monitoring"}
                doc_match = re.search(r"(?:Dr\.|Doctor)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)", text)
                if doc_match and doc_match.group(1).strip().lower() not in EXCLUDE_DOCTOR_WORDS:
                    provider_name = f"Dr. {doc_match.group(1)}"
                elif hospital_name:
                    provider_name = hospital_name

        if provider_name and (provider_name.lower().startswith("ee ") or provider_name.lower().startswith("##")):
            if hospital_name and not (hospital_name.lower().startswith("ee ") or hospital_name.startswith("##")):
                provider_name = hospital_name
            else:
                gen_hosp_m = re.search(r"\b([A-Z][A-Za-z0-9&.,\s\-]+?(?:Institute|Hospital|Clinic|Center|Healthcare|Health System))\b", text)
                if gen_hosp_m:
                    provider_name = gen_hosp_m.group(1).strip()
                elif provider_name.lower().startswith("ee "):
                    provider_name = provider_name[3:].strip()
                elif provider_name.startswith("##"):
                    provider_name = provider_name[2:].strip()

        # 3. Procedure / CPT code regex fallback
        cpt_matches = re.findall(r"\b\d{5}\b", text)
        for c in cpt_matches:
            if c not in procedures:
                procedures.append(c)

        # 4. Billed amount and currency normalization
        billed_amt = None
        currency = "USD"
        if cost_details and cost_details.extracted_amount is not None:
            billed_amt = float(cost_details.extracted_amount)
            currency = getattr(cost_details, "currency", "USD") or "USD"
        elif getattr(claim.extracted_fields, "cost_range", None):
            cost_str = str(claim.extracted_fields.cost_range)
            digits = re.findall(r"[\d,]+(?:\.\d+)?", cost_str)
            if digits:
                try:
                    billed_amt = float(digits[0].replace(",", ""))
                except ValueError:
                    pass
            if any(sym in cost_str.lower() for sym in ("inr", "₹", "rs")):
                currency = "INR"
            elif any(sym in cost_str for sym in ("$", "usd")):
                currency = "USD"

        # 5. Formulate unified clinical statement (hypothesis for M3)
        primary_entity = getattr(claim.extracted_fields, "entity", "") or ""
        outcome = getattr(claim.extracted_fields, "effect_or_outcome", None)

        # Prioritize rich, specific diagnoses and meaningful medicines (avoiding low-confidence fragments)
        clean_diags = [d for d in diagnoses if len(d) >= 3 and not d.isdigit() and any(c.isalpha() for c in d) and d.lower() not in MONTHS]
        clean_diags.sort(key=lambda d: (len(d) > 10, len(d)), reverse=True)

        clean_meds = [m for m in medicines if len(m) >= 3 and not m.isdigit() and any(c.isalpha() for c in m) and not re.search(r"\b\d+\s*days?\b", m, re.I)]
        clean_meds.sort(
            key=lambda m: (
                any(kw in m.lower() for kw in ("chloride", "saline", "sodium", "metformin", "azithromycin", "paracetamol", "lisinopril", "dolo", "amoxicillin", "pantoprazole", "ceftriaxone", "ciprofloxacin")),
                not m.lower() in ("tablet", "tablets", "capsule", "syrup", "injection", "mg", "ml", "oral", "iv"),
                len(m)
            ),
            reverse=True,
        )

        clean_procs = [p for p in procedures if len(p) >= 3 and not p.isdigit()]

        if clean_diags and (clean_meds or clean_procs):
            diag_str = clean_diags[0]
            tx_str = clean_meds[0] if clean_meds else clean_procs[0]
            clinical_stmt = f"Patient diagnosed with {diag_str} received {tx_str}."
        elif clean_diags:
            diag_str = clean_diags[0]
            clinical_stmt = f"Patient diagnosed with {diag_str} admitted for inpatient hospital care."
        elif primary_entity and outcome and outcome != "None reported":
            clinical_stmt = f"Administration of {primary_entity} reported outcome: {outcome}."
        elif primary_entity:
            clinical_stmt = f"Clinical administration and billing of {primary_entity}."
        else:
            clinical_stmt = text[:150].strip()

        # Re-sort medicines and diagnoses list so the primary coherent entity is first
        if clean_meds:
            for m in reversed(clean_meds):
                if m in medicines:
                    medicines.remove(m)
                    medicines.insert(0, m)
        if clean_diags:
            for d in reversed(clean_diags):
                if d in diagnoses:
                    diagnoses.remove(d)
                    diagnoses.insert(0, d)

        # Check data availability flags
        provider_avail = bool(
            provider_data
            and any(k in provider_data for k in ("Tot_Benes", "Tot_Srvcs", "Avg_Sbmtd_Chrg"))
        )
        claim_avail = bool(
            claim_data
            or billed_amt is not None
            or procedures
            or any(w in text.lower() for w in ("inpatient", "admission", "day", "days"))
        )

        return SharedClaimContext(
            claim_id=claim.claim_id,
            document_id=doc_id,
            source_type=getattr(claim, "source_type", "clinical_note"),
            source_url=getattr(claim, "source_url", None),
            original_text=text,
            ocr_text=ocr_text,
            hospital_name=hospital_name,
            provider_name=provider_name,
            patient_info=patient_info,
            diagnoses=diagnoses,
            medicines=medicines,
            procedures=procedures,
            billed_amount=billed_amt,
            currency=currency,
            clinical_statement=clinical_stmt,
            provider_data_available=provider_avail,
            claim_data_available=claim_avail,
            detected_issue_types=[],
        )

    def detect_issue_types(
        self,
        cost_details: Optional[CostAnomalyDetails],
        nli_result: Optional[NLIResult],
        provider_anomaly: Optional[ProviderAnomalyResult],
        claim_anomaly: Optional[ClaimAnomalyResult],
        medicine_sub: Optional[MedicineSubstitutionResult],
        usable_passages_count: int = 0,
    ) -> list[str]:
        """
        Identify the distinct clinical and financial issues detected on this claim.
        Avoids forcing every model to report an anomaly when data is absent.
        """
        issues: list[str] = []

        # 1. Pricing / Markup Issue
        if cost_details and cost_details.is_anomaly:
            issues.append("EXCESSIVE_PRICING_MARKUP")

        # 2. Clinical Indication Contradiction (M3)
        if nli_result and nli_result.predicted_class == "contradiction":
            issues.append("CLINICAL_INDICATION_MISMATCH")
        elif nli_result and (nli_result.requires_human_review or nli_result.predicted_class == "neutral"):
            issues.append("UNCERTAIN_CLINICAL_EVIDENCE")

        # 3. Medicine Substitution Mismatch
        if medicine_sub and not medicine_sub.is_match:
            issues.append("MEDICINE_SUBSTITUTION_MISMATCH")

        # 4. Inpatient Utilization Anomaly (M5)
        if claim_anomaly and claim_anomaly.is_anomaly:
            issues.append("INPATIENT_UTILIZATION_ANOMALY")
        elif claim_anomaly and not claim_anomaly.has_sufficient_data:
            issues.append("INSUFFICIENT_INPATIENT_DATA")

        # 5. Provider-Level Billing Anomaly (M4)
        if provider_anomaly and provider_anomaly.is_anomaly:
            issues.append("PROVIDER_BILLING_ANOMALY")
        elif provider_anomaly and not provider_anomaly.has_sufficient_data:
            issues.append("INSUFFICIENT_PROVIDER_HISTORY")

        # 6. Guideline Availability
        if usable_passages_count == 0:
            issues.append("MISSING_CLINICAL_GUIDELINES")

        return issues

    def synthesize_cross_model(
        self,
        shared_context: SharedClaimContext,
        ner_entities: Optional[list[ExtractedEntity]],
        retrieval_passages: list[Any],
        nli_result: Optional[NLIResult],
        provider_anomaly: Optional[ProviderAnomalyResult],
        claim_anomaly: Optional[ClaimAnomalyResult],
        cost_details: Optional[CostAnomalyDetails],
        medicine_sub: Optional[MedicineSubstitutionResult],
        final_verdict: VerificationVerdict,
        final_action: VerificationAction,
        human_review_reasons: list[str],
    ) -> CrossModelSynthesis:
        """
        Synthesize all five model outputs into a coherent cross-model explanation.
        Resolves clinical support vs pricing anomalies and identifies the decisive trigger.
        """
        primary_entity = (
            (shared_context.medicines[0] if shared_context.medicines else None)
            or (shared_context.procedures[0] if shared_context.procedures else None)
            or (shared_context.diagnoses[0] if shared_context.diagnoses else None)
            or "Clinical Encounter"
        )

        detected_issues = self.detect_issue_types(
            cost_details=cost_details,
            nli_result=nli_result,
            provider_anomaly=provider_anomaly,
            claim_anomaly=claim_anomaly,
            medicine_sub=medicine_sub,
            usable_passages_count=len(retrieval_passages),
        )
        shared_context.detected_issue_types = detected_issues

        # Determine primary trigger issue
        primary_trigger: Optional[str] = None
        if "CLINICAL_INDICATION_MISMATCH" in detected_issues:
            primary_trigger = "CLINICAL_INDICATION_MISMATCH"
        elif "EXCESSIVE_PRICING_MARKUP" in detected_issues:
            primary_trigger = "EXCESSIVE_PRICING_MARKUP"
        elif "MISSING_CLINICAL_GUIDELINES" in detected_issues:
            primary_trigger = "MISSING_CLINICAL_GUIDELINES"
        elif "MEDICINE_SUBSTITUTION_MISMATCH" in detected_issues:
            primary_trigger = "MEDICINE_SUBSTITUTION_MISMATCH"
        elif "INPATIENT_UTILIZATION_ANOMALY" in detected_issues:
            primary_trigger = "INPATIENT_UTILIZATION_ANOMALY"
        elif "PROVIDER_BILLING_ANOMALY" in detected_issues:
            primary_trigger = "PROVIDER_BILLING_ANOMALY"
        elif final_action == VerificationAction.ACCEPT:
            primary_trigger = "NONE_ACCEPTED"

        # 1. Clinical Agreement Summary
        if nli_result:
            if nli_result.predicted_class == "entailment":
                clin_summary = (
                    f"Clinically Supported: Model 3 verified that the administered treatment/procedure "
                    f"is corroborated by authoritative guidelines ({nli_result.confidence:.1%} confidence)."
                )
            elif nli_result.predicted_class == "contradiction":
                clin_summary = (
                    f"Clinical Contradiction: Model 3 detected an indication conflict between the claim "
                    f"and published medical evidence ({nli_result.confidence:.1%} confidence)."
                )
            else:
                clin_summary = (
                    "Neutral / Inconclusive Evidence: Retrieved guidelines do not directly refute or corroborate "
                    "this specific clinical statement. Human review recommended."
                )
        else:
            clin_summary = "Clinical indication cross-examination not evaluated (no matched guideline passages)."

        # 2. Financial Agreement Summary
        curr_sym = "₹" if shared_context.currency == "INR" else "$"
        if cost_details and cost_details.is_anomaly:
            mult = cost_details.multiplier or 1.0
            fin_summary = (
                f"Pricing Markup Alert: Billed amount ({curr_sym}{cost_details.extracted_amount:,.2f}) "
                f"exceeds benchmark ceiling by {mult:.1f}x. "
                f"Even when treatment is clinically appropriate, excessive pricing forces a mandatory safety FLAG."
            )
        elif cost_details and cost_details.extracted_amount is not None:
            fin_summary = (
                f"Price Compliant: Billed amount ({curr_sym}{cost_details.extracted_amount:,.2f}) "
                f"is within benchmark distribution."
            )
        else:
            fin_summary = "No itemized billing charges identified for price benchmark comparison."

        # 3. Provider & Practice Agreement Summary
        hosp_display = shared_context.hospital_name or "Provider facility"
        if provider_anomaly and provider_anomaly.has_sufficient_data:
            prov_summary = (
                f"Provider Screening ({hosp_display}): Score {provider_anomaly.anomaly_score:.3f} — "
                f"{'Atypical provider billing distribution' if provider_anomaly.is_anomaly else 'Conforms to historical practice patterns'}."
            )
        else:
            reason = (provider_anomaly.explanations[0] if provider_anomaly and provider_anomaly.explanations else None) or "Single clinical claim lacks multi-claim practice panel metrics."
            prov_summary = (
                f"Provider History ({hosp_display}): {reason} "
                f"Reported strictly as INSUFFICIENT_DATA per domain safety rules (never fabricated)."
            )

        # 4. Missing Information List
        missing_info: list[str] = []
        if not shared_context.provider_data_available:
            missing_info.append("Multi-claim historical provider volume metrics (Tot_Benes, Tot_Srvcs, Submitted_To_Allowed_Ratio).")
        if not shared_context.diagnoses:
            missing_info.append("Structured diagnostic ICD/condition codes in document.")
        if len(retrieval_passages) == 0:
            missing_info.append(f"Authoritative clinical guideline matching entity '{primary_entity}'.")
        if cost_details and cost_details.benchmark_max is None and shared_context.billed_amount:
            missing_info.append(f"Official fee schedule benchmark for procedure '{primary_entity}'.")

        # 5. Markdown narrative explaining relationship
        md_lines = [
            f"**Claim ID**: `{shared_context.claim_id}` | **Primary Entity**: `{primary_entity}`",
            f"**Hospital / Facility**: {shared_context.hospital_name or 'Unspecified'} | **Billed**: {curr_sym}{shared_context.billed_amount or 0:,.2f}",
            "",
            "#### Five-Model Context Synthesis",
            f"- **M1 BioBERT**: Identified {len(ner_entities or [])} clinical entities across diagnoses ({len(shared_context.diagnoses)}), medicines ({len(shared_context.medicines)}), and procedures ({len(shared_context.procedures)}).",
            f"- **M2 BGE**: Evaluated semantic relevance against authoritative knowledge base ({len(retrieval_passages)} usable passages).",
            f"- **M3 DeBERTa**: Evaluated clinical indication -> **{nli_result.predicted_class.upper() if nli_result else 'SKIPPED'}**.",
            f"- **M4 Provider IF**: Practice volume screening -> **{'ANOMALOUS' if (provider_anomaly and provider_anomaly.is_anomaly) else ('NORMAL' if (provider_anomaly and provider_anomaly.has_sufficient_data) else 'INSUFFICIENT_DATA')}**.",
            f"- **M5 Claim IF**: Inpatient stay & utilization -> **{'ANOMALOUS' if (claim_anomaly and claim_anomaly.is_anomaly) else ('NOT_FLAGGED' if (claim_anomaly and claim_anomaly.has_sufficient_data) else (claim_anomaly.decision if claim_anomaly else 'INSUFFICIENT_DATA'))}**.",
            "",
            f"**Decisive Action Trigger**: `{primary_trigger or 'COMPREHENSIVE_AUDIT'}`",
        ]

        if cost_details and cost_details.is_anomaly and nli_result and nli_result.predicted_class == "entailment":
            md_lines.append(
                f"\n> [!NOTE] **Cross-Model Reconciliation**: Treatment is clinically indicated and supported by guidelines (M3), "
                f"but billing charge is {cost_details.multiplier:.1f}x benchmark max. The clinical findings and pricing alert are separate, non-contradictory checks."
            )

        review_req = bool(
            final_action in (VerificationAction.FLAG, VerificationAction.ABSTAIN)
            or human_review_reasons
        )
        review_rationale = (
            "; ".join(human_review_reasons)
            if human_review_reasons
            else (f"Triggered by {primary_trigger}" if primary_trigger else None)
        )

        return CrossModelSynthesis(
            claim_id=shared_context.claim_id,
            primary_entity=primary_entity,
            detected_issues=detected_issues,
            primary_trigger_issue=primary_trigger,
            clinical_agreement_summary=clin_summary,
            financial_agreement_summary=fin_summary,
            provider_agreement_summary=prov_summary,
            missing_information=missing_info,
            human_review_required=review_req,
            human_review_rationale=review_rationale,
            synthesis_markdown="\n".join(md_lines),
        )


claim_context_service = ClaimContextService()
