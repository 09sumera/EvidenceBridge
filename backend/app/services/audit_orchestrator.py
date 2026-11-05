"""
Unified Audit Orchestration Service for EvidenceBridge.
Coordinates all five AI models, OCR, cost benchmarking, and provenance tracking
into an explainable, auditable report according to Section 4 specifications.
"""

from datetime import datetime, timezone
import time
from typing import Any, Optional
import uuid

from app.config import get_settings
from app.models.schemas import (
    Claim,
    ExtractedEntity,
    ExtractedFields,
    NERExtractionResult,
    NLIResult,
    ProvenanceMetadata,
    ProviderAnomalyResult,
    ClaimAnomalyResult,
    MedicineSubstitutionResult,
    RetrievalResultPassage,
    SentimentType,
    UnifiedAuditReport,
    VerificationAction,
    VerificationResult,
    VerificationVerdict,
)
from app.services.cost_anomaly import cost_anomaly_service
from app.services.embedding import embedding_service
from app.services.extraction import ExtractionService
from app.services.medicine_service import medicine_service
from app.services.ner import ner_service
from app.services.nli import nli_service
from app.services.ocr_service import ocr_service
from app.services.provenance import ProvenanceService
from app.services.provider_anomaly import provider_anomaly_service
from app.services.claim_anomaly import claim_anomaly_service
from app.services.storage import storage_service
from app.services.vector_store import vector_store_service
from app.services.verification import verification_service
from app.utils.logger import logger


class AuditOrchestratorService:
    """Orchestrates document OCR, NER, BGE retrieval, NLI verification, and anomaly detection."""

    def __init__(self):
        self.settings = get_settings()
        self.provenance_service = ProvenanceService()
        self.extraction_service = ExtractionService()

    async def run_pipeline(
        self,
        text: Optional[str] = None,
        image_bytes: Optional[bytes] = None,
        source_type: str = "clinical_note",
        source_url: Optional[str] = None,
        provider_data: Optional[dict[str, Any]] = None,
        claim_data: Optional[dict[str, Any]] = None,
        target_medicine: Optional[str] = None,
        store_claim: bool = True,
        user_id: Optional[str] = None,
    ) -> UnifiedAuditReport:
        """
        Execute unified 5-model auditing pipeline.
        Gracefully skips optional models when their specific data is absent.
        """
        start_time = time.perf_counter()
        doc_text = (text or "").strip()
        ocr_confidence = None

        # 1 & 2. OCR processing and Model 6 image classification if raw image bytes are provided
        model6_prediction = None
        if image_bytes:
            # Model 6: Image-Based Medical Document AI
            try:
                from app.services.image_document_model import image_document_model_service
                model6_prediction = image_document_model_service.classify_image(image_bytes)
                logger.info(
                    f"Model 6 classified document as: {model6_prediction.document_category} "
                    f"({model6_prediction.model_score:.1%})"
                )
                if source_type in ("clinical_note", "unknown", "") and model6_prediction.is_supported:
                    source_type = model6_prediction.suggested_source_type
            except Exception as m6_err:
                logger.warning(f"Model 6 image classification failed: {m6_err}")

            # RapidOCR Text Extraction
            logger.info("Step 1-2: Running RapidOCR on input document...")
            ocr_res = ocr_service.extract_text_from_image_bytes(image_bytes)
            if ocr_res.get("text"):
                doc_text = ocr_res["text"]
                ocr_confidence = ocr_res.get("confidence")

        if not doc_text:
            raise ValueError("No input text or valid document provided for audit pipeline.")

        # 3. Model 1 (BioBERT NER): identify structured entities
        logger.info("Step 3: Running Model 1 BioBERT NER for entity extraction...")
        ner_result: Optional[NERExtractionResult] = None
        try:
            ner_result = ner_service.extract_entities(doc_text)
        except Exception as e:
            logger.warning(f"Model 1 BioBERT extraction failed: {e}")

        # 4. Structured extraction & Provenance
        logger.info("Step 4: Creating structured claim and binding immutable provenance...")
        claim_id = f"clm_{uuid.uuid4().hex[:16]}"
        provenance = self.provenance_service.create_provenance(
            original_text=doc_text,
            source_type=source_type,
            source_url=source_url,
            source_timestamp=datetime.now(timezone.utc)
        )

        # Attempt LLM structured extraction, falling back to NER entities
        extracted_fields = None
        extraction_conf = 0.85
        try:
            extracted_fields, extraction_conf = await self.extraction_service.extract_structured_claim(
                text=doc_text
            )
        except Exception as ex:
            logger.info(f"LLM extraction unavailable ({ex}); deriving fields from Model 1 NER...")
            entity_name = "Clinical Claim"
            cost_val = None
            if ner_result and ner_result.entities:
                for ent in ner_result.entities:
                    if ent.entity in ("BRAND_NAME", "GENERIC_NAME", "DIAGNOSIS", "PROCEDURE"):
                        entity_name = ent.text
                        break
                for ent in ner_result.entities:
                    if ent.entity in ("INVOICE_TOTAL", "PATIENT_PAYABLE", "AMOUNT", "TOTAL"):
                        cost_val = ent.text
                        break

            extracted_fields = ExtractedFields(
                entity=entity_name,
                effect_or_outcome=None,
                cost_range=cost_val,
                location_city=None,
                sentiment=SentimentType.NEUTRAL,
                reasoning="Derived from BioBERT NER entities."
            )

        claim = Claim(
            claim_id=claim_id,
            original_text=doc_text,
            source_type=source_type,
            source_url=source_url,
            timestamp=datetime.now(timezone.utc),
            extracted_fields=extracted_fields,
            confidence=extraction_conf,
            provenance=provenance,
            user_id=user_id,
            indexed_vector=False
        )

        # 5, 6, 7. Retrieval (Model 2 BGE) + NLI Verification (Model 3 DeBERTa) + Cost Anomaly
        logger.info("Step 5-7: Running Model 2 Retrieval, Model 3 NLI verification, and Cost Benchmarks...")
        verification = await verification_service.verify_claim(
            claim=claim,
            provider_data=provider_data,
            claim_data=claim_data,
            ner_entities=ner_result.entities if ner_result else None,
            target_medicine=target_medicine
        )

        # 8. Model 4: Provider-Level Anomaly Screening
        provider_anomaly_res: Optional[ProviderAnomalyResult] = verification.provider_anomaly
        if not provider_anomaly_res:
            try:
                provider_anomaly_res = provider_anomaly_service.evaluate_provider(provider_data)
            except Exception as e:
                logger.warning(f"Model 4 evaluation error: {e}")

        # 9. Model 5: Claim-Level Anomaly Screening
        claim_anomaly_res: Optional[ClaimAnomalyResult] = verification.claim_anomaly
        if not claim_anomaly_res:
            try:
                claim_anomaly_res = claim_anomaly_service.evaluate_claim(
                    claim_data=claim_data,
                    claim=claim,
                    cost_details=verification.anomaly_details,
                    ner_entities=ner_result.entities if ner_result else None
                )
            except Exception as e:
                logger.warning(f"Model 5 evaluation error: {e}")

        # 10. Medicine Substitution Analysis
        med_sub_res: Optional[MedicineSubstitutionResult] = verification.medicine_substitution
        if not med_sub_res and target_medicine and extracted_fields.entity:
            try:
                med_sub_res = medicine_service.match_medicines(extracted_fields.entity, target_medicine)
            except Exception as e:
                logger.warning(f"Medicine matcher error: {e}")

        # Index and Store claim if requested
        if store_claim:
            try:
                await storage_service.insert_claim(claim)
                await storage_service.save_verification(verification)
                vector_store_service.add_claim(claim)
            except Exception as e:
                logger.warning(f"Failed to persist claim to storage: {e}")

        # 11. Combine findings into explainable markdown summary
        summary_md = self._generate_markdown_summary(
            claim=claim,
            verification=verification,
            ner_result=ner_result,
            provider_anomaly=provider_anomaly_res,
            claim_anomaly=claim_anomaly_res,
            medicine_sub=med_sub_res,
            model_6_prediction=model6_prediction,
        )

        # Collect all retrieval passages formatted for report
        retrieval_passages: list[RetrievalResultPassage] = []
        for p in verification.passages_considered:
            retrieval_passages.append(RetrievalResultPassage(
                passage_id=p.passage_id,
                guideline_id=p.guideline_id,
                title=p.title,
                source=p.source,
                text=p.text,
                similarity_score=p.relevance_score,
                model_name="BGE Small en-v1.5"
            ))

        return UnifiedAuditReport(
            claim_id=claim.claim_id,
            original_text=doc_text,
            ner_result=ner_result,
            retrieval_passages=retrieval_passages,
            nli_result=verification.nli_result,
            provider_anomaly=provider_anomaly_res,
            claim_anomaly=claim_anomaly_res,
            cost_anomaly=verification.anomaly_details,
            medicine_substitution=med_sub_res,
            billing_reconciliation=verification.billing_reconciliation,
            model_6_prediction=model6_prediction,
            shared_context=verification.shared_context,
            synthesis=verification.synthesis,
            overall_verdict=verification.verdict,
            overall_action=verification.action,
            requires_human_review=verification.requires_human_review,
            human_review_reasons=verification.human_review_reasons,
            summary_markdown=summary_md,
            audit_trail_id=verification.audit_trail_id
        )

    def _generate_markdown_summary(
        self,
        claim: Claim,
        verification: VerificationResult,
        ner_result: Optional[NERExtractionResult],
        provider_anomaly: Optional[ProviderAnomalyResult],
        claim_anomaly: Optional[ClaimAnomalyResult],
        medicine_sub: Optional[MedicineSubstitutionResult],
        model_6_prediction: Optional[Any] = None,
    ) -> str:
        """Create structured audit breakdown across all five AI model outputs."""
        lines = []
        lines.append(f"### EvidenceBridge Unified Clinical Audit Report")
        lines.append(f"**Claim ID**: `{claim.claim_id}` | **Verdict**: `{verification.verdict.value.upper()}` | **Action**: `{verification.action.value.upper()}`")
        lines.append(f"**Primary Medical Entity**: {claim.extracted_fields.entity}")
        lines.append(f"**Support Score**: {verification.support_score:.2f}")

        # Human Review Banner
        if verification.requires_human_review:
            lines.append("\n> [!WARNING] **HUMAN REVIEW REQUIRED**")
            for r in verification.human_review_reasons:
                lines.append(f"> - {r}")

        # Model 1 BioBERT NER
        lines.append("\n#### Model 1 — BioBERT NER Extraction")
        if ner_result and ner_result.entities:
            lines.append(f"- Extracted **{ner_result.total_entities}** entities (Document type: *{ner_result.document_type_detected or 'generic'}*)")
            top_ents = [f"`{e.entity}`: {e.text} ({e.confidence:.0%})" for e in ner_result.entities[:6]]
            lines.append(f"- Sample entities: {', '.join(top_ents)}")
        else:
            lines.append("- No specific BioBERT entities isolated.")

        # Model 2 BGE Retrieval & Model 3 DeBERTa NLI
        lines.append("\n#### Model 2 & 3 — BGE Retrieval + DeBERTa NLI Cross-Examination")
        if verification.nli_result:
            nli = verification.nli_result
            lines.append(f"- **NLI Decision**: `{nli.decision.upper()}` (Predicted class: *{nli.predicted_class}*, Confidence: {nli.confidence:.1%})")
            lines.append(f"- Class Probabilities: `Entailment: {nli.probabilities.get('entailment', 0):.1%}`, `Contradiction: {nli.probabilities.get('contradiction', 0):.1%}`, `Neutral: {nli.probabilities.get('neutral', 0):.1%}`")
            if nli.notes:
                lines.append(f"- Note: {nli.notes}")
        else:
            lines.append("- DeBERTa NLI cross-examination not triggered (no matching guidelines found).")

        # Model 4 Provider Anomaly
        lines.append("\n#### Model 4 — Provider-Level Billing Anomaly Screening")
        if provider_anomaly and provider_anomaly.has_sufficient_data:
            p_flag = "**FLAGGED (Top 5% Anomaly)**" if provider_anomaly.is_anomaly else "Normal billing volume"
            lines.append(f"- **Status**: {p_flag} (Score: `{provider_anomaly.anomaly_score:.4f}`)")
            for exp in provider_anomaly.explanations:
                lines.append(f"  - {exp}")
            lines.append(f"- *{provider_anomaly.disclaimer}*")
        else:
            lines.append("- Provider screening: *Insufficient provider data (gracefully bypassed)*")

        # Model 5 Claim Anomaly
        lines.append("\n#### Model 5 — Claim-Level Inpatient Anomaly Screening")
        if claim_anomaly and claim_anomaly.has_sufficient_data:
            c_flag = "**FLAGGED (Top 5% Anomaly)**" if claim_anomaly.is_anomaly else "Normal inpatient profile"
            lines.append(f"- **Status**: {c_flag} (Score: `{claim_anomaly.anomaly_score:.4f}`)")
            if claim_anomaly.model_agreement:
                lines.append(f"- **Model Agreement**: {claim_anomaly.model_agreement}")
            for exp in claim_anomaly.explanations:
                lines.append(f"  - {exp}")
            lines.append(f"- *{claim_anomaly.disclaimer}*")
        else:
            lines.append("- Claim screening: *Insufficient claim features (gracefully bypassed)*")

        # Cost Anomaly
        if verification.anomaly_details:
            cd = verification.anomaly_details
            lines.append("\n#### Cost Benchmark Anomaly")
            if cd.is_anomaly:
                lines.append(f"- **ALERT**: Charged `{cd.extracted_amount}` vs Benchmark `{cd.benchmark_min} - {cd.benchmark_max}` ({cd.multiplier:.1f}x markup)")
            else:
                lines.append(f"- Pricing within benchmark bounds ({cd.extracted_amount}).")

        # Preserved Model 5: Medicine Substitution
        if medicine_sub:
            lines.append("\n#### Medicine Substitution Check")
            m_status = "Compatible Generic / Substitution" if medicine_sub.is_match else "Incompatible / Distinct Entity"
            lines.append(f"- Evaluated `{medicine_sub.query_medicine}` vs `{medicine_sub.target_medicine}`: **{m_status}** ({medicine_sub.match_probability:.1%})")

        # Model 6: Image-Based Medical Document AI
        if model_6_prediction:
            lines.append("\n#### Model 6 — Image-Based Medical Document AI")
            lines.append(
                f"- **Classification**: {model_6_prediction.category_label} "
                f"({model_6_prediction.model_score:.1%} confidence)"
            )
            if getattr(model_6_prediction, "message", None):
                lines.append(f"- *{model_6_prediction.message}*")

        return "\n".join(lines)


audit_orchestrator = AuditOrchestratorService()
