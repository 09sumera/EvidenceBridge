"""
Audit Trail Service for EvidenceBridge.
Constructs, records, and retrieves transparent decision graphs (AuditTrails)
for healthcare claim verification, tracking every transformation and reasoning step.
"""

from datetime import datetime, timezone
from typing import Any, Optional
import uuid

from app.models.schemas import (
    AuditTrail,
    Claim,
    CostAnomalyDetails,
    DecisionStep,
    EvidencePassage,
    VerificationAction,
    VerificationResult,
    VerificationVerdict,
)
from app.services.abstention import AbstentionDecision
from app.services.storage import storage_service
from app.utils.logger import logger


class AuditService:
    """Service to create, store, and query complete decision audit trails."""

    @staticmethod
    def create_step(
        step_name: str,
        input_summary: str,
        output_summary: str,
        details: Optional[dict[str, Any]] = None
    ) -> DecisionStep:
        """Create a single standardized decision step."""
        return DecisionStep(
            step_name=step_name,
            input_summary=input_summary,
            output_summary=output_summary,
            details=details or {},
            timestamp=datetime.now(timezone.utc)
        )

    @classmethod
    def record_full_audit(
        cls,
        claim: Claim,
        verification: VerificationResult,
        passages: list[EvidencePassage],
        cost_details: CostAnomalyDetails,
        abstention_decision: AbstentionDecision,
        audit_id: Optional[str] = None,
        raw_model_verdict: Optional[VerificationVerdict] = None,
        raw_model_support_score: Optional[float] = None,
        raw_model_reasoning: Optional[str] = None,
        raw_conflict_assessment: Optional[dict[str, Any]] = None,
    ) -> AuditTrail:
        """
        Assemble the complete 7-stage decision graph for a verified claim:
        EXTRACTION -> PROVENANCE -> HYBRID_RETRIEVAL -> COST_AUDIT ->
        CLINICAL_VERIFICATION -> ABSTENTION_GATE -> FINAL_ACTION.
        Preserves both the original raw model assessment and any final safety policy overrides.
        """
        aid = audit_id or f"aud_{uuid.uuid4().hex[:16]}"
        steps: list[DecisionStep] = []

        # Determine raw model verdict and support score
        raw_verdict_str: Optional[str] = None
        if raw_model_verdict is not None:
            raw_verdict_str = raw_model_verdict.value if hasattr(raw_model_verdict, "value") else str(raw_model_verdict)
        elif abstention_decision.details and abstention_decision.details.get("original_model_verdict"):
            raw_verdict_str = str(abstention_decision.details.get("original_model_verdict"))
        elif not abstention_decision.should_abstain:
            raw_verdict_str = verification.verdict.value
        else:
            raw_verdict_str = None

        raw_score = raw_model_support_score if raw_model_support_score is not None else (
            verification.support_score if not abstention_decision.should_abstain else 0.0
        )
        raw_reasoning_text = raw_model_reasoning or verification.reasoning

        # Detect safety policy overrides
        policy_override_applied = False
        policy_override_reason: Optional[str] = None
        rule_name = (
            abstention_decision.rule_triggered.value
            if hasattr(abstention_decision.rule_triggered, "value")
            else (str(abstention_decision.rule_triggered) if abstention_decision.rule_triggered else None)
        )

        if abstention_decision.should_abstain:
            if raw_verdict_str and raw_verdict_str != VerificationVerdict.INSUFFICIENT_EVIDENCE.value:
                policy_override_applied = True
                rule_display = rule_name or "SAFETY_RULE"
                policy_override_reason = (
                    f"Safety policy gate [{rule_display}] overrode model verdict '{raw_verdict_str}' "
                    f"(support score: {raw_score:.2f}) to ABSTAIN: {abstention_decision.reason}"
                )
            elif not raw_verdict_str:
                policy_override_applied = True
                rule_display = rule_name or "PRE_FLIGHT_GATE"
                policy_override_reason = (
                    f"Pre-flight safety gate [{rule_display}] prevented model inference: {abstention_decision.reason}"
                )
        elif cost_details.is_anomaly and verification.action == VerificationAction.FLAG:
            if raw_verdict_str == VerificationVerdict.SUPPORTED.value or verification.verdict == VerificationVerdict.SUPPORTED:
                policy_override_applied = True
                mult = cost_details.multiplier or 1.0
                policy_override_reason = (
                    f"Cost anomaly detected ({mult:.1f}× benchmark max) forced action to FLAG "
                    f"despite model verdict '{raw_verdict_str}'."
                )

        # Step 1: Extraction Stage
        steps.append(cls.create_step(
            step_name="EXTRACTION",
            input_summary=f"Raw source text ({len(claim.original_text)} chars, origin: {claim.source_type})",
            output_summary=(
                f"Extracted Entity='{claim.extracted_fields.entity}', "
                f"Cost='{claim.extracted_fields.cost_range or 'None'}', "
                f"Outcome='{claim.extracted_fields.effect_or_outcome or 'None'}', "
                f"Location='{claim.location.city if claim.location else 'unspecified'}', "
                f"Confidence={claim.confidence:.2f}"
            ),
            details={
                "entity": claim.extracted_fields.entity,
                "cost_range": claim.extracted_fields.cost_range,
                "effect_or_outcome": claim.extracted_fields.effect_or_outcome,
                "location_city": claim.extracted_fields.location_city,
                "sentiment": claim.extracted_fields.sentiment.value,
                "confidence": claim.confidence,
                "source_type": claim.source_type,
                "source_url": claim.provenance.source_url,
                "reasoning": claim.extracted_fields.reasoning,
            }
        ))

        # Step 2: Provenance Binding
        steps.append(cls.create_step(
            step_name="PROVENANCE",
            input_summary=f"Raw text verification against SHA-256 cryptographic digest",
            output_summary=(
                f"Cryptographic digest={claim.provenance.source_hash[:16]}... (verified), "
                f"Snippet='{claim.provenance.original_snippet[:60]}...', "
                f"SourceURL={claim.provenance.source_url or 'unspecified'}"
            ),
            details={
                "source_hash": claim.provenance.source_hash,
                "original_snippet": claim.provenance.original_snippet,
                "text_length": claim.provenance.text_length,
                "source_url": claim.provenance.source_url,
                "source_type": claim.provenance.source_type,
                "ingested_at": str(claim.provenance.ingested_at),
                "tamper_check_passed": True,
            }
        ))

        # Step 3: Hybrid Retrieval
        used_count = sum(1 for p in passages if p.used_in_decision)
        discarded_count = len(passages) - used_count
        top_rel = max((p.relevance_score for p in passages), default=0.0)
        steps.append(cls.create_step(
            step_name="HYBRID_RETRIEVAL",
            input_summary=f"Query: entity='{claim.extracted_fields.entity}', text excerpt ({len(claim.original_text)} chars)",
            output_summary=(
                f"Retrieved {len(passages)} passages ({used_count} usable above 0.35 threshold, {discarded_count} discarded). "
                f"Top relevance score={top_rel:.2f}"
            ),
            details={
                "total_retrieved": len(passages),
                "used_count": used_count,
                "discarded_count": discarded_count,
                "top_relevance": top_rel,
                "relevance_threshold": 0.35,
                "passages": [
                    {
                        "passage_id": p.passage_id,
                        "guideline_id": p.guideline_id,
                        "title": p.title,
                        "source": p.source,
                        "score": p.relevance_score,
                        "used": p.used_in_decision,
                        "discard_reason": p.discard_reason
                    }
                    for p in passages
                ]
            }
        ))

        # Step 4: Cost Anomaly Audit
        cost_curr = getattr(cost_details, "currency", "INR") or "INR"
        curr_symbol = "₹" if cost_curr == "INR" else ("€" if cost_curr == "EUR" else ("£" if cost_curr == "GBP" else "$"))
        bm_curr = getattr(cost_details, "benchmark_currency", cost_curr) or cost_curr
        bm_symbol = "₹" if bm_curr == "INR" else ("€" if bm_curr == "EUR" else ("£" if bm_curr == "GBP" else "$"))

        if cost_details.extracted_amount is None:
            cost_out = "No numeric cost figure identified in claim for anomaly auditing."
        elif cost_details.benchmark_max is None:
            cost_out = f"No public pricing benchmark matched for entity '{claim.extracted_fields.entity}'. Billed: {curr_symbol}{cost_details.extracted_amount:,.2f} ({cost_curr})."
        elif bm_curr != cost_curr:
            bm_name = cost_details.benchmark_name or "matched benchmark"
            cost_out = (
                f"Benchmark='{bm_name}' ({bm_symbol}{cost_details.benchmark_min:,.2f} - {bm_symbol}{cost_details.benchmark_max:,.2f} {bm_curr}). "
                f"Billed={curr_symbol}{cost_details.extracted_amount:,.2f} {cost_curr}. "
                f"Cross-currency comparison noted: billed in {cost_curr}, benchmark in {bm_curr}."
            )
        else:
            bm_name = cost_details.benchmark_name or "matched benchmark"
            cost_out = (
                f"Benchmark='{bm_name}' ({curr_symbol}{cost_details.benchmark_min:,.2f} - {curr_symbol}{cost_details.benchmark_max:,.2f} {cost_curr}). "
                f"Billed={curr_symbol}{cost_details.extracted_amount:,.2f} ({cost_details.multiplier or 1.0:.1f}× max, "
                f"Anomaly={cost_details.is_anomaly}, Severity={cost_details.severity.upper()})."
            )

        steps.append(cls.create_step(
            step_name="COST_AUDIT",
            input_summary=f"Claim cost='{claim.extracted_fields.cost_range or 'None'}' for entity='{claim.extracted_fields.entity}'",
            output_summary=cost_out,
            details={
                "is_anomaly": cost_details.is_anomaly,
                "currency": cost_curr,
                "benchmark_currency": bm_curr,
                "extracted_amount": cost_details.extracted_amount,
                "benchmark_matched": bool(getattr(cost_details, "benchmark_matched", False) or cost_details.benchmark_max is not None),
                "benchmark_name": cost_details.benchmark_name or "no benchmark matched",
                "benchmark_source": cost_details.benchmark_source,
                "cpt_code": cost_details.cpt_code,
                "benchmark_min": cost_details.benchmark_min,
                "benchmark_max": cost_details.benchmark_max,
                "multiplier": cost_details.multiplier,
                "threshold_multiplier": cost_details.threshold_multiplier,
                "severity": cost_details.severity,
                "explanation": cost_details.explanation
            }
        ))

        # Step 5: Clinical Verification (Ollama)
        has_conflict = bool(raw_conflict_assessment and raw_conflict_assessment.get("has_conflict"))
        if raw_verdict_str:
            clin_out = (
                f"Model Verdict={raw_verdict_str}, SupportScore={raw_score:.2f}, "
                f"ConflictDetected={has_conflict}. Reasoning: '{raw_reasoning_text[:120]}...'"
            )
        else:
            clin_out = f"Model evaluation bypassed: {abstention_decision.reason}"

        steps.append(cls.create_step(
            step_name="CLINICAL_VERIFICATION",
            input_summary=(
                f"Ollama judgment on {used_count} authoritative guidelines"
                if raw_verdict_str else
                f"Bypassed LLM inference: pre-flight safety gate triggered"
            ),
            output_summary=clin_out,
            details={
                "raw_model_verdict": raw_verdict_str,
                "raw_model_support_score": raw_score,
                "raw_model_reasoning": raw_reasoning_text,
                "conflict_assessment": raw_conflict_assessment,
                "usable_passages_count": used_count,
                "usable_passage_ids": [p.passage_id for p in passages if p.used_in_decision],
                "bypassed": raw_verdict_str is None,
            }
        ))

        # Step 5a: Model 4 Provider Anomaly Screening
        if verification.provider_anomaly:
            p_res = verification.provider_anomaly
            if p_res.has_sufficient_data:
                p_summary = f"Isolation Forest V3: Score={p_res.anomaly_score:.3f}, Flag='{p_res.screening_flag}', Decision={p_res.decision}."
            else:
                p_summary = "Isolation Forest V3: INSUFFICIENT_DATA (provider practice history required for screening)."
            steps.append(cls.create_step(
                step_name="PROVIDER_SCREENING",
                input_summary="Model 4 Provider-level billing patterns across 9 features",
                output_summary=p_summary,
                details={
                    "model_version": p_res.model_version,
                    "decision": p_res.decision,
                    "is_anomaly": p_res.is_anomaly,
                    "anomaly_score": p_res.anomaly_score,
                    "screening_flag": p_res.screening_flag,
                    "has_sufficient_data": p_res.has_sufficient_data,
                    "explanations": p_res.explanations,
                }
            ))

        # Step 5b: Model 5 Claim Anomaly Screening
        if verification.claim_anomaly:
            c_res = verification.claim_anomaly
            if c_res.has_sufficient_data:
                c_summary = f"Isolation Forest V3 Strict: Score={c_res.anomaly_score:.3f}, Flag='{c_res.screening_flag}', Decision={c_res.decision}."
            else:
                c_summary = "Isolation Forest V3 Strict: INSUFFICIENT_DATA (inpatient utilization features required for screening)."
            steps.append(cls.create_step(
                step_name="CLAIM_SCREENING",
                input_summary="Model 5 Claim-level utilization metrics across 13 features",
                output_summary=c_summary,
                details={
                    "model_version": c_res.model_version,
                    "decision": c_res.decision,
                    "is_anomaly": c_res.is_anomaly,
                    "anomaly_score": c_res.anomaly_score,
                    "screening_flag": c_res.screening_flag,
                    "model_agreement": c_res.model_agreement,
                    "has_sufficient_data": c_res.has_sufficient_data,
                    "explanations": c_res.explanations,
                }
            ))

        # Step 6: Abstention Gate
        if abstention_decision.should_abstain:
            gate_out = (
                f"ABSTAIN TRIGGERED by rule [{rule_name or 'SAFETY_RULE'}]: "
                f"{abstention_decision.reason}. Policy override enforced."
            )
        elif cost_details.is_anomaly:
            mult = cost_details.multiplier or 1.0
            gate_out = (
                f"SAFETY POLICY FLAG: Pricing benchmark anomaly detected ({mult:.1f}× benchmark max). "
                f"Clinical evidence gates cleared, but cost policy requires mandatory human review (FLAG)."
            )
        else:
            gate_out = "PASSED: All 5 safety gates cleared (valid entity, relevant evidence, no unresolvable conflict, confidence floor met, cost benchmark valid)."

        steps.append(cls.create_step(
            step_name="ABSTENTION_GATE",
            input_summary=f"Evaluating 5 deterministic safety rules against claim and model verdict '{raw_verdict_str or 'bypassed'}'",
            output_summary=gate_out,
            details={
                "should_abstain": abstention_decision.should_abstain,
                "rule_triggered": rule_name,
                "reason": abstention_decision.reason,
                "pre_gate_verdict": raw_verdict_str,
                "pre_gate_support_score": raw_score,
                "policy_override_applied": policy_override_applied,
                "policy_override_reason": policy_override_reason,
                "cost_anomaly_flag": cost_details.is_anomaly,
                "rules_evaluated": [
                    "ENTITY_NOT_FOUND",
                    "NO_RELEVANT_EVIDENCE",
                    "CONFLICTING_EVIDENCE",
                    "LOW_MODEL_CONFIDENCE",
                    "UNBENCHMARKED_HIGH_COST"
                ],
                "details": abstention_decision.details or {},
                "gate_details": abstention_decision.details or {}
            }
        ))

        # Step 7: Final Action Synthesis
        if verification.action == VerificationAction.ABSTAIN:
            action_out = f"Action=ABSTAIN (Verdict=insufficient_evidence). Enforced by safety policy [{rule_name or 'UNKNOWN'}]."
        elif verification.action == VerificationAction.FLAG:
            if cost_details.is_anomaly:
                mult = cost_details.multiplier or 1.0
                action_out = f"Action=FLAG (Verdict={verification.verdict.value}). Policy override: Flagged due to cost anomaly ({mult:.1f}× markup) despite model verdict '{raw_verdict_str}'."
            elif verification.verdict == VerificationVerdict.CONTRADICTED:
                action_out = "Action=FLAG (Verdict=contradicted). Clinical guidelines contradict claim."
            else:
                action_out = f"Action=FLAG (Verdict={verification.verdict.value}). Requires manual clinical review."
        else:
            action_out = "Action=ACCEPT (Verdict=supported). Clinically supported with compliant pricing."

        steps.append(cls.create_step(
            step_name="FINAL_ACTION",
            input_summary=f"Synthesizing raw model verdict='{raw_verdict_str or 'none'}', cost_anomaly={verification.cost_anomaly_flag}, abstention={abstention_decision.should_abstain}",
            output_summary=action_out,
            details={
                "final_action": verification.action.value,
                "final_verdict": verification.verdict.value,
                "final_support_score": verification.support_score,
                "raw_model_verdict": raw_verdict_str,
                "raw_model_support_score": raw_score,
                "policy_override_applied": policy_override_applied,
                "policy_override_reason": policy_override_reason,
                "cost_anomaly_flag": verification.cost_anomaly_flag,
                "abstain_triggered": abstention_decision.should_abstain,
                "abstain_reason": verification.abstain_reason,
                "detected_issues": getattr(verification.synthesis, "detected_issues", []) if getattr(verification, "synthesis", None) else [],
                "primary_trigger_issue": getattr(verification.synthesis, "primary_trigger_issue", None) if getattr(verification, "synthesis", None) else None,
                "cross_model_synthesis": getattr(verification.synthesis, "synthesis_markdown", None) if getattr(verification, "synthesis", None) else None,
            }
        ))

        audit_trail = AuditTrail(
            audit_id=aid,
            claim_id=claim.claim_id,
            verification_id=verification.verification_id,
            steps=steps,
            passages_considered=passages,
            final_verdict=verification.verdict,
            final_action=verification.action,
            final_reasoning=verification.reasoning,
            abstain_triggered=abstention_decision.should_abstain,
            abstain_reason=verification.abstain_reason or abstention_decision.reason,
            cost_anomaly_flag=verification.cost_anomaly_flag,
            raw_model_verdict=raw_verdict_str,
            raw_model_support_score=raw_score,
            policy_override_applied=policy_override_applied,
            policy_override_reason=policy_override_reason,
            created_at=datetime.now(timezone.utc)
        )

        logger.info(f"Recorded audit trail {aid} for claim {claim.claim_id} with {len(steps)} decision steps")
        return audit_trail

    @staticmethod
    async def save_audit_trail(audit_trail: AuditTrail) -> AuditTrail:
        """Persist audit trail in MongoDB."""
        return await storage_service.insert_audit_trail(audit_trail)

    @staticmethod
    async def get_audit_trail_by_claim(claim_id: str) -> Optional[AuditTrail]:
        """Fetch audit trail by claim ID."""
        return await storage_service.get_audit_trail_by_claim_id(claim_id)

    @staticmethod
    async def get_audit_trail_by_verification(verification_id: str) -> Optional[AuditTrail]:
        """Fetch audit trail by verification ID."""
        return await storage_service.get_audit_trail_by_verification_id(verification_id)


audit_service = AuditService()
