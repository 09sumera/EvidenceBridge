"""
Pydantic Schemas for EvidenceBridge Foundational Layer.
Defines core data models for Claims, Provenance, Extraction, and API contracts.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Literal, Optional
import uuid
from pydantic import BaseModel, ConfigDict, Field, model_validator


class SourceType(str, Enum):
    CLINICAL_NOTE = "clinical_note"
    PATIENT_REPORT = "patient_report"
    HOSPITAL_BILL = "hospital_bill"
    FORUM_POST = "forum_post"
    OTHER = "other"


class SentimentType(str, Enum):
    POSITIVE = "positive"
    NEGATIVE = "negative"
    NEUTRAL = "neutral"
    MIXED = "mixed"


class ExtractedFields(BaseModel):
    """Structured clinical and billing fields extracted by the model."""
    model_config = ConfigDict(extra="ignore")

    entity: str = Field(
        ...,
        description="Medical entity: drug name, procedure, diagnostic test, or billed line item"
    )
    effect_or_outcome: Optional[str] = Field(
        None,
        description="Observed clinical outcome, patient effect, side effect, or procedure finding"
    )
    cost_range: Optional[str] = Field(
        None,
        description="Billed charge, copay, price range, or financial figure if mentioned (e.g. '$1,200', '$4,500 - $6,000')"
    )
    cost_currency: Optional[str] = Field(
        None,
        description="Explicit ISO-4217 currency code (e.g. 'INR', 'USD', 'EUR', 'GBP') if cost is mentioned"
    )
    location_city: Optional[str] = Field(
        None,
        description="City, state, or hospital/facility name if present in text"
    )
    sentiment: SentimentType = Field(
        default=SentimentType.NEUTRAL,
        description="Sentiment towards medical outcome or hospital billing experience"
    )
    reasoning: Optional[str] = Field(
        None,
        description="Brief justification or explanation of extraction"
    )
    raw_model_output: Optional[dict[str, Any]] = Field(
        None,
        description="Full raw JSON response from local Ollama model for provenance and debugging"
    )


class ProvenanceMetadata(BaseModel):
    """
    Immutable provenance metadata linking structured claims back to raw ground-truth source.
    """
    model_config = ConfigDict(extra="ignore")

    source_hash: str = Field(
        ...,
        description="Cryptographic SHA-256 hash of the exact original raw text"
    )
    original_snippet: str = Field(
        ...,
        description="Verbatim initial snippet/anchor from the raw text"
    )
    text_length: int = Field(
        ...,
        description="Character count of original raw text"
    )
    source_type: str = Field(
        ...,
        description="Document origin classification (clinical_note, patient_report, hospital_bill, etc.)"
    )
    source_url: Optional[str] = Field(
        None,
        description="Source URL, document URI, or EHR record identifier"
    )
    source_timestamp: Optional[datetime] = Field(
        None,
        description="Timestamp recorded at origin if available"
    )
    ingested_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="UTC timestamp when EvidenceBridge ingested the record"
    )


class LocationInfo(BaseModel):
    """Normalized geographic location associated with a healthcare claim."""
    model_config = ConfigDict(extra="ignore")

    city: str = Field(..., description="City or municipality (e.g. 'Chicago', 'Atlanta')")
    state_or_region: Optional[str] = Field(None, description="State, province, or region code (e.g. 'IL', 'GA', 'TX')")
    country: str = Field(default="US", description="ISO country code")
    normalized_key: str = Field(..., description="Normalized canonical identifier (e.g. 'chicago_il', 'atlanta_ga')")
    raw_mention: Optional[str] = Field(None, description="Original verbatim location mention in text")
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class Claim(BaseModel):
    """
    Core Claim entity in EvidenceBridge.
    Combines extracted medical/cost data with strict provenance tracking.
    """
    model_config = ConfigDict(extra="ignore", populate_by_name=True)

    claim_id: str = Field(
        ...,
        description="Unique identifier for the claim (prefixed UUID, e.g. clm_a1b2c3d4...)"
    )
    original_text: str = Field(
        ...,
        description="Full original text from which the claim was extracted"
    )
    source_type: str = Field(
        ...,
        description="Source classification type"
    )
    source_url: Optional[str] = Field(
        None,
        description="Original source link or identifier"
    )
    timestamp: datetime = Field(
        ...,
        description="Timestamp of claim (source timestamp if known, otherwise ingestion time)"
    )
    extracted_fields: ExtractedFields = Field(
        ...,
        description="Structured extracted entities and outcomes"
    )
    confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Confidence score of the extraction between 0.0 and 1.0"
    )
    provenance: ProvenanceMetadata = Field(
        ...,
        description="Strict source provenance metadata"
    )
    location: Optional[LocationInfo] = Field(
        default=None,
        description="Geographic location resolved from text or source metadata"
    )
    indexed_vector: bool = Field(
        default=False,
        description="Whether this claim has been indexed into the local vector store"
    )
    user_id: Optional[str] = Field(
        default=None,
        description="ID of the user who owns or submitted this claim for personal memory and data isolation"
    )


class ExtractionRequest(BaseModel):
    """Input payload to trigger extraction and provenance tracking."""
    text: str = Field(
        ...,
        min_length=3,
        description="Verbatim clinical note, patient report, or hospital bill line text"
    )
    source_type: Optional[str] = Field(
        default="clinical_note",
        description="Origin classification: clinical_note, patient_report, hospital_bill, forum_post, other"
    )
    source_url: Optional[str] = Field(
        default=None,
        description="Optional origin URL, EMR/EHR ID, or public forum link"
    )
    source_timestamp: Optional[datetime] = Field(
        default=None,
        description="Optional original creation date/time (ISO 8601)"
    )
    store_claim: bool = Field(
        default=True,
        description="Whether to persist the extracted claim into MongoDB"
    )
    user_id: Optional[str] = Field(
        default=None,
        description="Optional ID of the authenticated user to attribute the claim to"
    )
    provider_data: Optional[dict[str, Any]] = Field(
        default=None,
        description="Optional provider-level billing metrics for Model 4 screening"
    )
    claim_data: Optional[dict[str, Any]] = Field(
        default=None,
        description="Optional claim-level inpatient/financial metrics for Model 5 screening"
    )
    target_medicine: Optional[str] = Field(
        default=None,
        description="Optional reference drug name to evaluate substitution against"
    )
    image_base64: Optional[str] = Field(
        default=None,
        description="Optional base64-encoded document image for RapidOCR processing"
    )


class ExtractionResponse(BaseModel):
    """API response containing extracted claim, provenance, and storage status."""
    success: bool = True
    claim: Claim
    stored: bool
    message: str = "Claim successfully extracted and linked with provenance"


class ClaimListResponse(BaseModel):
    """Paginated list response for claims."""
    total: int
    count: int
    claims: list[Claim]


class HealthResponse(BaseModel):
    """System health status."""
    status: str
    app_name: str
    version: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    services: dict[str, Any]


# ==============================================================================
# Layer 2: Verification, Support Scoring & Cost Anomaly Schemas
# ==============================================================================

class VerificationVerdict(str, Enum):
    """Verdict representing whether medical evidence supports or refutes a claim."""
    SUPPORTED = "supported"
    PARTIALLY_SUPPORTED = "partially_supported"
    CONTRADICTED = "contradicted"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"


class VerificationAction(str, Enum):
    """Decision action based on verification verdict and cost anomaly flag."""
    ACCEPT = "accept"    # Supported claim, fair or expected pricing
    FLAG = "flag"        # Contradicted, partially supported, or cost anomaly detected
    ABSTAIN = "abstain"  # Insufficient or inconclusive evidence in knowledge base


class CostBenchmark(BaseModel):
    """Public pricing benchmark for a procedure, test, drug, or hospital service."""
    model_config = ConfigDict(extra="ignore")

    entity: str
    keywords: list[str] = Field(default_factory=list)
    category: Optional[str] = None
    typical_min: float
    typical_max: float
    currency: str = "USD"
    unit: Optional[str] = None
    source: str
    cpt_code: Optional[str] = None


class CostAnomalyDetails(BaseModel):
    """Details of cost anomaly evaluation against public benchmarks."""
    model_config = ConfigDict(extra="ignore")

    is_anomaly: bool = False
    benchmark_matched: bool = False
    currency: str = "USD"
    benchmark_currency: Optional[str] = None
    extracted_amount: Optional[float] = None
    benchmark_min: Optional[float] = None
    benchmark_max: Optional[float] = None
    multiplier: Optional[float] = None
    threshold_multiplier: float = 3.0
    severity: str = "none"  # "none", "moderate", "severe", "extreme"
    explanation: str
    benchmark_name: Optional[str] = None
    benchmark_source: Optional[str] = None
    cpt_code: Optional[str] = None

    @model_validator(mode="after")
    def sync_benchmark_matched(self) -> "CostAnomalyDetails":
        if self.benchmark_max is not None and not self.benchmark_matched:
            self.benchmark_matched = True
        return self


class EvidenceSnippet(BaseModel):
    """Clinical guideline passage retrieved from local knowledge base."""
    model_config = ConfigDict(extra="ignore")

    guideline_id: str
    title: str
    source: str
    text: str
    relevance_score: Optional[float] = None


class EvidencePassage(BaseModel):
    """
    Detailed evidence passage evaluated during hybrid retrieval,
    tracking relevance score, whether it was utilized, or why it was discarded.
    """
    model_config = ConfigDict(extra="ignore")

    passage_id: str = Field(
        default_factory=lambda: f"pas_{uuid.uuid4().hex[:12]}",
        description="Unique passage identifier"
    )
    guideline_id: Optional[str] = None
    title: str
    source: str
    text: str
    relevance_score: float = Field(
        ...,
        description="Composite relevance score (0.0 to 1.0) combining vector similarity & BM25 keyword match"
    )
    used_in_decision: bool = Field(
        default=True,
        description="Whether this passage exceeded the relevance threshold and was fed to the verification model"
    )
    discard_reason: Optional[str] = Field(
        default=None,
        description="Reason for discarding (e.g. 'Below relevance threshold 0.35', 'Entity mismatch')"
    )


class DecisionStep(BaseModel):
    """Single auditable execution step in the claim processing and verification pipeline."""
    model_config = ConfigDict(extra="ignore")

    step_name: str = Field(..., description="Stage name (e.g. EXTRACTION, RETRIEVAL, COST_CHECK, ABSTENTION_GATE, FINAL_ACTION)")
    input_summary: str
    output_summary: str
    details: Optional[dict[str, Any]] = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class VerificationResult(BaseModel):
    """
    Complete audit result for an extracted claim:
    evidence-based support score, verdict, action decision, and cost anomaly flags.
    """
    model_config = ConfigDict(extra="ignore")

    verification_id: str = Field(
        default_factory=lambda: f"ver_{uuid.uuid4().hex[:16]}",
        description="Unique verification audit identifier"
    )
    claim_id: str
    audit_trail_id: Optional[str] = Field(
        default=None,
        description="Reference to full decision audit trail"
    )
    support_score: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Numeric score (0.0 to 1.0) indicating strength of evidence support"
    )
    verdict: VerificationVerdict
    action: VerificationAction
    reasoning: str
    evidence_snippets: list[EvidenceSnippet] = Field(default_factory=list)
    passages_considered: list[EvidencePassage] = Field(default_factory=list)
    cost_anomaly_flag: bool = False
    anomaly_details: Optional[CostAnomalyDetails] = None
    location: Optional[LocationInfo] = Field(
        default=None,
        description="Geographic location of the audited claim"
    )
    abstain_reason: Optional[str] = None
    verified_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Five-model integrated results
    ner_entities: Optional[list["ExtractedEntity"]] = Field(default=None, description="Model 1 BioBERT extracted structured entities")
    ner_grouped_info: Optional["GroupedMedicalInformation"] = Field(default=None, description="Model 1 clean grouped medical information for auditor view")
    nli_result: Optional["NLIResult"] = Field(default=None, description="Model 3 DeBERTa NLI cross-examination")
    provider_anomaly: Optional["ProviderAnomalyResult"] = Field(default=None, description="Model 4 Provider-level anomaly screening")
    claim_anomaly: Optional["ClaimAnomalyResult"] = Field(default=None, description="Model 5 Claim-level anomaly screening")
    medicine_substitution: Optional["MedicineSubstitutionResult"] = Field(default=None, description="Medicine matching / substitution analysis")
    requires_human_review: bool = Field(default=False, description="Whether any model or safety gate flagged this finding for human auditor review")
    human_review_reasons: list[str] = Field(default_factory=list, description="Specific triggers requiring human auditor review")
    shared_context: Optional["SharedClaimContext"] = Field(
        default=None,
        description="Unified shared claim context binding all models to the same document and encounter"
    )
    synthesis: Optional["CrossModelSynthesis"] = Field(
        default=None,
        description="Cross-model issue-aware synthesis explaining how the 5 models relate to each other"
    )
    billing_reconciliation: Optional["BillingReconciliationResult"] = Field(
        default=None,
        description="Claim-level billing reconciliation: itemized arithmetic, duplicates, overlaps, and grounded benchmarks"
    )
    model_6_prediction: Optional["Model6PredictionResult"] = Field(
        default=None,
        description="Model 6 Document AI image classification result if document photo was provided"
    )


class AuditTrail(BaseModel):
    """
    Full transparent decision graph and lineage for a claim:
    tracks all intermediate pipeline steps, considered evidence, and exact rationale.
    """
    model_config = ConfigDict(extra="ignore")

    audit_id: str = Field(
        default_factory=lambda: f"aud_{uuid.uuid4().hex[:16]}",
        description="Unique audit identifier"
    )
    claim_id: str
    verification_id: str
    steps: list[DecisionStep] = Field(default_factory=list)
    passages_considered: list[EvidencePassage] = Field(default_factory=list)
    final_verdict: Optional[VerificationVerdict] = None
    final_action: VerificationAction
    final_reasoning: str
    abstain_triggered: bool = False
    abstain_reason: Optional[str] = None
    cost_anomaly_flag: bool = False
    raw_model_verdict: Optional[str] = Field(default=None, description="Raw model verdict before safety gate policy overrides")
    raw_model_support_score: Optional[float] = Field(default=None, description="Raw model support score before safety gate policy overrides")
    policy_override_applied: bool = Field(default=False, description="Whether safety gates or cost rules overrode the raw model verdict")
    policy_override_reason: Optional[str] = Field(default=None, description="Explicit rationale for policy override")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class VerificationResponse(BaseModel):
    """Response returned by verification endpoint."""
    success: bool = True
    verification: VerificationResult
    audit_trail_id: Optional[str] = None
    message: str = "Claim verification completed successfully"


class ExtractAndVerifyResponse(BaseModel):
    """Combined response for extraction and verification pipeline."""
    success: bool = True
    claim: Claim
    verification: VerificationResult
    audit_trail_id: Optional[str] = None
    stored: bool
    message: str = "Claim extracted, verified, and linked with provenance"


class AuditResponse(BaseModel):
    """Response returned by audit trail endpoint."""
    success: bool = True
    audit_trail: AuditTrail
    message: str = "Audit trail retrieved successfully"


# ==============================================================================
# Layer 4: Hyperlocal Trust Density Schemas
# ==============================================================================

class TrustTier(str, Enum):
    """Categorical trust tier assigned to a geographic location."""
    HIGH = "high"                      # Clean guidelines, very few anomalies, high support
    MODERATE = "moderate"              # Mixed reports, minor or occasional anomalies
    LOW = "low"                        # Elevated cost anomaly density or frequent contradictions
    CRITICAL_ALERT = "critical_alert"  # Extreme cost markups (>5x) or systematic contradictions
    INSUFFICIENT_DATA = "insufficient_data"  # Fewer than minimum required claims to formulate score


class TrustDensityMetrics(BaseModel):
    """
    Aggregated location-level trust and anomaly density metrics.
    """
    model_config = ConfigDict(extra="ignore")

    location_key: str = Field(..., description="Canonical key, e.g. 'chicago_il'")
    city: str
    state_or_region: Optional[str] = None
    total_claims: int = Field(default=0, description="Total ingested claims in this locality")
    verified_claims: int = Field(
        default=0,
        description="Total claims that have undergone verification audit (including accepted, flagged, and abstained). Labeled in UI as 'Audited (Verified)'",
    )
    supported_count: int = Field(default=0, description="Claims verified as SUPPORTED by clinical guidelines")
    partially_supported_count: int = Field(default=0, description="Claims verified as PARTIALLY_SUPPORTED")
    contradicted_count: int = Field(default=0, description="Claims verified as CONTRADICTED by clinical guidelines")
    flagged_count: int = Field(default=0, description="Claims flagged for manual review")
    abstained_count: int = Field(default=0, description="Claims where verification abstained due to insufficient evidence")
    cost_anomaly_count: int = Field(default=0, description="Claims flagged with pricing markup anomalies")
    cost_anomaly_rate: float = Field(default=0.0, ge=0.0, le=1.0, description="Ratio of cost anomalies to audited claims: cost_anomaly_count / verified_claims")
    support_ratio: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Ratio of clinical support among conclusive audits: (supported + 0.5 * partially_supported) / (supported + partially_supported + contradicted). Evaluates to 0.0 when 0 conclusive audits exist.",
    )
    recency_weighted_volume: float = 0.0
    density_score: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Composite trust density score (0.0 to 1.0) where 1.0 is peak clinical & billing reliability"
    )
    trust_tier: TrustTier = Field(default=TrustTier.INSUFFICIENT_DATA)
    last_updated: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class LocationInsight(BaseModel):
    """
    Synthesized audit insight and risk summary for a geographic locality.
    """
    model_config = ConfigDict(extra="ignore")

    location_key: str
    city: str
    state_or_region: Optional[str] = None
    density_score: float
    trust_tier: TrustTier
    top_anomalous_entities: list[str] = Field(default_factory=list)
    top_procedures_audited: list[str] = Field(default_factory=list)
    summary_text: str
    sample_claim_ids: list[str] = Field(default_factory=list)
    recommendation: Optional[str] = None


class TrustDensityResponse(BaseModel):
    """Response payload for a single location trust density query."""
    success: bool = True
    metrics: TrustDensityMetrics
    insight: Optional[LocationInsight] = None
    message: str = "Trust density metrics retrieved successfully"


class TrustDensityListResponse(BaseModel):
    """Paginated list of location trust density records."""
    total: int
    count: int
    locations: list[TrustDensityMetrics]


# ==============================================================================
# Layer 6: Evaluation Harness & Calibration Schemas
# ==============================================================================

class EvaluationLabel(BaseModel):
    """Ground truth gold label for an evaluation benchmark case."""
    model_config = ConfigDict(extra="ignore")

    case_id: str
    category: Optional[str] = None
    raw_text: str
    source_type: str = "clinical_note"
    expected_entity: Optional[str] = None
    gold_verdict: str  # "supported", "partially_supported", "contradicted", "insufficient_evidence"
    gold_action: str   # "ACCEPT", "FLAG", "ABSTAIN"
    cost_anomaly_flag: bool = False
    expected_rule_triggered: Optional[str] = None
    note: Optional[str] = None


class MetricResult(BaseModel):
    """Statistical evaluation metrics for a specific class or binary task."""
    model_config = ConfigDict(extra="ignore")

    precision: float = 0.0
    recall: float = 0.0
    f1_score: float = 0.0
    accuracy: Optional[float] = None
    support_count: int = 0
    predicted_count: int = 0
    true_positives: int = 0
    false_positives: int = 0
    false_negatives: int = 0


class CalibrationBin(BaseModel):
    """Reliability calibration bin for expected calibration error (ECE)."""
    model_config = ConfigDict(extra="ignore")

    bin_index: int
    bin_lower: float
    bin_upper: float
    sample_count: int = 0
    avg_confidence: float = 0.0
    empirical_accuracy: float = 0.0
    calibration_error: float = 0.0


class AbstentionMetrics(BaseModel):
    """Metrics assessing the precision, recall, and safety calibration of the abstention gate."""
    model_config = ConfigDict(extra="ignore")

    total_samples: int = 0
    total_abstained: int = 0
    abstention_rate: float = 0.0
    correct_abstentions: int = 0  # True positive abstentions (gold was insufficient_evidence / ABSTAIN)
    over_abstentions: int = 0     # False positive abstentions (system abstained when gold was conclusive)
    under_abstentions: int = 0    # False negative abstentions (system was conclusive when gold was abstain)
    abstention_precision: float = 0.0
    abstention_recall: float = 0.0
    abstention_f1: float = 0.0


class SampleEvaluationDetail(BaseModel):
    """Detailed side-by-side comparison for a single evaluation sample."""
    model_config = ConfigDict(extra="ignore")

    case_id: str
    predicted_verdict: str
    gold_verdict: str
    verdict_correct: bool
    predicted_action: str
    gold_action: str
    action_correct: bool
    predicted_cost_anomaly: bool
    gold_cost_anomaly: bool
    cost_anomaly_correct: bool
    support_score: float
    rule_triggered: Optional[str] = None
    claim_id: Optional[str] = None
    explanation: Optional[str] = None


class EvaluationReport(BaseModel):
    """Comprehensive evaluation report stored in MongoDB and returned via API."""
    model_config = ConfigDict(extra="ignore")

    run_id: str = Field(default_factory=lambda: f"eval_{uuid.uuid4().hex[:12]}")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    dataset_name: str = "controlled_cases.json"
    total_samples: int = 0

    # Verdict performance
    overall_verdict_accuracy: float = 0.0
    macro_verdict_f1: float = 0.0
    verdict_metrics: dict[str, MetricResult] = Field(default_factory=dict)

    # Action performance
    overall_action_accuracy: float = 0.0
    macro_action_f1: float = 0.0
    action_metrics: dict[str, MetricResult] = Field(default_factory=dict)

    # Cost anomaly performance
    cost_anomaly_metrics: MetricResult = Field(default_factory=MetricResult)

    # Abstention gate calibration
    abstention_metrics: AbstentionMetrics = Field(default_factory=AbstentionMetrics)

    # Confidence calibration
    calibration_bins: list[CalibrationBin] = Field(default_factory=list)
    expected_calibration_error: float = 0.0

    # Human-readable report & guidance
    markdown_report: str = ""
    recommendations: list[str] = Field(default_factory=list)
    sample_evaluations: list[SampleEvaluationDetail] = Field(default_factory=list)
    user_id: Optional[str] = Field(default=None, description="User ID who executed this evaluation run")


class EvaluationRunRequest(BaseModel):
    """Payload to trigger an evaluation run."""
    model_config = ConfigDict(extra="ignore")

    dataset_path: Optional[str] = None
    case_ids: Optional[list[str]] = None
    force_reverify: bool = False
    offline_mode: bool = False
    custom_labels: Optional[list[EvaluationLabel]] = None
    user_id: Optional[str] = Field(default=None, description="Optional user ID attributing the evaluation run")


class EvaluationRunResponse(BaseModel):
    """Response payload returning evaluation execution results."""
    success: bool = True
    run_id: str
    report: EvaluationReport
    message: str = "Evaluation run completed successfully"


class EvaluationListResponse(BaseModel):
    """List of recent evaluation reports."""
    total: int
    count: int
    runs: list[EvaluationReport]


# ---------------------------------------------------------------------------
# Community Stories (Recovery Stories)
# ---------------------------------------------------------------------------

class CommunityStoryCreate(BaseModel):
    """Payload to post a voluntary personal recovery or coping story."""
    model_config = ConfigDict(extra="ignore")

    title: Optional[str] = Field(None, max_length=150, description="Optional brief title for the story")
    story_text: str = Field(..., min_length=10, max_length=5000, description="Personal story and what helped cope or recover")
    author_name: Optional[str] = Field("Community Member", max_length=80, description="Name or alias")
    condition_or_topic: Optional[str] = Field(None, max_length=100, description="Optional topic or condition tag")
    location: Optional[str] = Field(None, max_length=100, description="Optional city, region, or hospital location")
    category: Optional[str] = Field(None, max_length=50, description="Optional category tag, e.g. Billing, Prescription, Recovery")
    contact_email: Optional[str] = Field(None, max_length=120, description="Optional voluntary public email")
    contact_instagram: Optional[str] = Field(None, max_length=80, description="Optional voluntary public Instagram handle")
    consent_acknowledged: bool = Field(True, description="Confirmation that story and contact will be public")
    user_id: Optional[str] = Field(None, description="Optional user ID of author if authenticated")


class CommunityStory(BaseModel):
    """Stored community recovery story."""
    model_config = ConfigDict(extra="ignore")

    story_id: str
    title: Optional[str] = None
    story_text: str
    author_name: str = "Community Member"
    condition_or_topic: Optional[str] = None
    location: Optional[str] = None
    category: Optional[str] = None
    contact_email: Optional[str] = None
    contact_instagram: Optional[str] = None
    consent_acknowledged: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    user_id: Optional[str] = Field(None, description="User ID of author if authenticated")
    is_demo: Optional[bool] = Field(False, description="Whether this is a system-curated demo story")


class CommunityStoryListResponse(BaseModel):
    """Response containing list of community recovery stories."""
    total: int
    count: int
    stories: list[CommunityStory]


# ---------------------------------------------------------------------------
# Visual Insights & Statistics
# ---------------------------------------------------------------------------

class DecisionOverview(BaseModel):
    """Decision breakdown: Approved, Flagged, Held."""
    approved: int = Field(default=0, description="Claims approved (ACCEPT)")
    flagged: int = Field(default=0, description="Claims flagged for review (FLAG)")
    held: int = Field(default=0, description="Claims held for information (ABSTAIN)")
    total: int = Field(default=0, description="Total verified claims")


class PriceAlertsOverview(BaseModel):
    """Price markup breakdown: Normal vs Anomaly tiers."""
    normal_charges: int = Field(default=0, description="Charges within normal benchmark (<3x)")
    price_alerts: int = Field(default=0, description="Charges triggering price markup alerts (>=3x)")
    moderate: int = Field(default=0, description="Moderate markups (3x - 5x)")
    severe: int = Field(default=0, description="Severe markups (5x - 10x)")
    extreme: int = Field(default=0, description="Extreme markups (>=10x)")
    total: int = Field(default=0, description="Total cost-audited claims")


class GuidelineSupportOverview(BaseModel):
    """Clinical guideline match verdict breakdown."""
    supported: int = Field(default=0, description="Conclusive evidence supporting claim")
    partially_supported: int = Field(default=0, description="Partial evidence supporting claim")
    contradicted: int = Field(default=0, description="Evidence contradicting or contraindicating claim")
    insufficient_evidence: int = Field(default=0, description="No or inadequate guideline evidence found")
    total: int = Field(default=0, description="Total verified claims")


class GapsAndRisks(BaseModel):
    """High-priority systemic gaps and clinical risks."""
    insufficient_evidence_claims: int = Field(default=0, description="Claims lacking guideline evidence")
    extreme_price_markups: int = Field(default=0, description="Claims with >=10x hospital markups")
    held_by_safety_rules: int = Field(default=0, description="Claims where safety rules halted automated decision")
    unbenchmarked_high_cost: int = Field(default=0, description="High-cost items without standard benchmarks")


class ProcedureFrequency(BaseModel):
    """Procedure occurrence count in audited corpus."""
    procedure_name: str
    count: int


class LocationFrequency(BaseModel):
    """Metropolitan occurrence count and pricing anomaly rate."""
    location_name: str
    claims_count: int
    anomalies_count: int = 0


class ClaimHighlight(BaseModel):
    """Summary of a notable risk or flagged claim."""
    claim_id: str
    entity: str
    action: str
    verdict: Optional[str] = None
    cost_range: Optional[str] = None
    cost_currency: Optional[str] = None
    reason: Optional[str] = None
    timestamp: Optional[datetime] = None


class InsightsSummaryResponse(BaseModel):
    """Aggregated statistics and visual metrics across claims and verifications."""
    model_config = ConfigDict(extra="ignore")

    total_claims: int = 0
    total_verified: int = 0
    decision_overview: DecisionOverview = Field(default_factory=DecisionOverview)
    price_alerts_overview: PriceAlertsOverview = Field(default_factory=PriceAlertsOverview)
    guideline_support_overview: GuidelineSupportOverview = Field(default_factory=GuidelineSupportOverview)
    gaps_and_risks: GapsAndRisks = Field(default_factory=GapsAndRisks)
    top_procedures: list[ProcedureFrequency] = Field(default_factory=list)
    top_locations: list[LocationFrequency] = Field(default_factory=list)
    recent_risk_claims: list[ClaimHighlight] = Field(default_factory=list)
    is_baseline_fallback: bool = False


# ---------------------------------------------------------------------------
# User Authentication & Profiles (Part 2)
# ---------------------------------------------------------------------------

class UserCreateRequest(BaseModel):
    """Payload for user sign up."""
    model_config = ConfigDict(extra="ignore")

    name: str = Field(..., min_length=1, max_length=100, description="Full name")
    email: str = Field(..., min_length=3, max_length=150, description="Email address or username")
    password: str = Field(..., min_length=4, max_length=100, description="Raw password")
    organization: Optional[str] = Field(None, max_length=150, description="Hospital or organization")


class UserLoginRequest(BaseModel):
    """Payload for user login."""
    model_config = ConfigDict(extra="ignore")

    email: str = Field(..., min_length=1, description="Email address or username")
    password: str = Field(..., min_length=1, description="Password")


class UserResponse(BaseModel):
    """Safe user profile response without password hash."""
    model_config = ConfigDict(extra="ignore")

    user_id: str
    name: str
    email: str
    role: str = "PATIENT"
    organization: Optional[str] = "Personal Health Vault"
    created_at: datetime
    hospital_id: Optional[str] = None


class AuthResponse(BaseModel):
    """Response returned upon successful login or sign up."""
    model_config = ConfigDict(extra="ignore")

    access_token: str
    token_type: str = "bearer"
    user: UserResponse


# ---------------------------------------------------------------------------
# Hospital Finder & Price Comparison Schemas
# ---------------------------------------------------------------------------

class HospitalProcedurePrice(BaseModel):
    """Verified or benchmark price for a procedure or consultation."""
    model_config = ConfigDict(extra="ignore")

    service_name: str
    cpt_code: Optional[str] = None
    min_price: float
    max_price: float
    typical_price: Optional[float] = None
    currency: str = "USD"
    price_type: str = "Official Published Benchmark"
    source: str
    last_updated: str


class HospitalDetail(BaseModel):
    """Comprehensive hospital/facility detail with attributable trust and real prices."""
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    address: str
    neighborhood: Optional[str] = None
    city: str
    state_or_region: Optional[str] = None
    country: str = "US"
    lat: float
    lon: float
    distance_km: Optional[float] = None
    distance_miles: Optional[float] = None
    distance_label: str = "Straight-line distance"
    facility_type: str = "General Hospital"
    verified_services: list[str] = Field(default_factory=list)
    phone: Optional[str] = None
    website: Optional[str] = None
    directions_url: Optional[str] = None

    # Real prices & cost comparison
    price_available: bool = False
    consultation_fee: Optional[float] = None
    consultation_fee_currency: str = "USD"
    consultation_fee_source: Optional[str] = None
    consultation_fee_date: Optional[str] = None
    price_type: str = "Unavailable"
    procedure_prices: list[HospitalProcedurePrice] = Field(default_factory=list)

    # Local trust & accreditation
    public_rating: Optional[float] = None
    review_count: Optional[int] = None
    review_source: Optional[str] = None
    review_date: Optional[str] = None
    accreditations: list[str] = Field(default_factory=list)
    trust_score: Optional[float] = None
    trust_score_explanation: Optional[str] = None

    why_appears: str = "Located in your requested area."
    data_source: str = "OpenStreetMap & Published Healthcare Benchmarks"
    last_updated: str = Field(default_factory=lambda: datetime.now(timezone.utc).strftime("%Y-%m-%d"))


class EmergencyAlert(BaseModel):
    """Immediate high-priority guidance for urgent clinical symptoms."""
    model_config = ConfigDict(extra="ignore")

    is_emergency: bool = False
    warning_title: Optional[str] = None
    warning_message: Optional[str] = None
    emergency_phone: Optional[str] = None
    action_advice: Optional[str] = None


class HospitalSearchResponse(BaseModel):
    """Payload returned by Hospital Finder search."""
    model_config = ConfigDict(extra="ignore")

    query_city: str
    search_coordinates: Optional[dict[str, float]] = None
    total_results: int
    symptom_filter: Optional[str] = None
    symptom_guidance: Optional[str] = None
    emergency_alert: Optional[EmergencyAlert] = None
    hospitals: list[HospitalDetail] = Field(default_factory=list)
    data_sources_used: list[str] = Field(default_factory=list)
    disclaimer: str = (
        "EvidenceBridge Hospital Finder provides facility location, published price benchmarks, and "
        "accreditation data for informational comparison only. This is not a medical diagnosis or treatment recommendation. "
        "Distances are calculated as straight-line distance from specified coordinates."
    )


# ==============================================================================
# Five AI Models Integrated Schemas
# ==============================================================================

class ExtractedEntity(BaseModel):
    """Structured healthcare entity extracted by Model 1 BioBERT."""
    model_config = ConfigDict(extra="ignore")

    entity: str = Field(..., description="Entity class name, e.g. HOSPITAL, BRAND_NAME, GENERIC_NAME, INVOICE_TOTAL")
    text: str = Field(..., description="Extracted textual substring")
    start: Optional[int] = Field(default=None, description="Character start offset in source text")
    end: Optional[int] = Field(default=None, description="Character end offset in source text")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence probability for this entity")
    requires_human_review: bool = Field(default=False, description="Flagged for human review if confidence is low")


class GroupedField(BaseModel):
    """Clean, validated clinical field in the structured auditor presentation."""
    model_config = ConfigDict(extra="ignore")

    value: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    requires_human_review: bool = False
    raw_entity: Optional[str] = None
    source_snippet: Optional[str] = None


class HospitalGroup(BaseModel):
    """Hospital and patient identity information."""
    model_config = ConfigDict(extra="ignore")

    hospital_name: Optional[GroupedField] = None
    location: Optional[GroupedField] = None
    phone: Optional[GroupedField] = None
    patient_name: Optional[GroupedField] = None
    age_gender: Optional[GroupedField] = None
    patient_id: Optional[GroupedField] = None
    claim_reference: Optional[GroupedField] = None
    insurer: Optional[GroupedField] = None
    tpa: Optional[GroupedField] = None
    policy_number: Optional[GroupedField] = None
    preauth_number: Optional[GroupedField] = None


class MedicineGroup(BaseModel):
    """Structured medication information."""
    model_config = ConfigDict(extra="ignore")

    medicine_name: Optional[GroupedField] = None
    brand_name: Optional[GroupedField] = None
    generic_name: Optional[GroupedField] = None
    active_ingredient: Optional[GroupedField] = None
    strength: Optional[GroupedField] = None
    dosage_quantity: Optional[GroupedField] = None
    route: Optional[GroupedField] = None
    frequency: Optional[GroupedField] = None
    duration: Optional[GroupedField] = None
    instructions: Optional[GroupedField] = None


class ClinicalGroup(BaseModel):
    """Encounter and clinical context information."""
    model_config = ConfigDict(extra="ignore")

    encounter_type: Optional[GroupedField] = None
    length_of_stay: Optional[GroupedField] = None
    procedure: Optional[GroupedField] = None
    diagnosis: Optional[GroupedField] = None
    clinical_indication: Optional[GroupedField] = None
    admission_date: Optional[GroupedField] = None
    discharge_date: Optional[GroupedField] = None
    room_type: Optional[GroupedField] = None
    findings: Optional[GroupedField] = None


class BillingGroup(BaseModel):
    """Billing and financial parameters actually present in document."""
    model_config = ConfigDict(extra="ignore")

    billed_amount: Optional[GroupedField] = None
    currency: Optional[str] = None
    invoice_number: Optional[GroupedField] = None
    gstin: Optional[GroupedField] = None
    hsn_sac: Optional[GroupedField] = None
    tax_amount: Optional[GroupedField] = None
    discount: Optional[GroupedField] = None
    patient_payable: Optional[GroupedField] = None
    unit_price: Optional[GroupedField] = None
    line_amount: Optional[GroupedField] = None
    subtotal: Optional[GroupedField] = None
    claimed_amount: Optional[GroupedField] = None
    approved_amount: Optional[GroupedField] = None
    insurance_deduction: Optional[GroupedField] = None


class GroupedMedicalInformation(BaseModel):
    """Complete auditor-facing grouped medical information."""
    model_config = ConfigDict(extra="ignore")

    hospital: HospitalGroup = Field(default_factory=HospitalGroup)
    medicine: MedicineGroup = Field(default_factory=MedicineGroup)
    clinical: ClinicalGroup = Field(default_factory=ClinicalGroup)
    billing: BillingGroup = Field(default_factory=BillingGroup)
    document_type: Optional[str] = None


class NERExtractionResult(BaseModel):
    """Overall output from Model 1 BioBERT Token Classification."""
    model_config = ConfigDict(extra="ignore")

    model_name: str = "EvidenceBridge BioBERT v4"
    entities: list[ExtractedEntity] = Field(default_factory=list)
    total_entities: int = 0
    document_type_detected: Optional[str] = None
    execution_time_ms: Optional[float] = None
    grouped_info: Optional[GroupedMedicalInformation] = None


class RetrievalResultPassage(BaseModel):
    """Evidence passage retrieved via Model 2 BGE embeddings."""
    model_config = ConfigDict(extra="ignore")

    passage_id: str
    guideline_id: Optional[str] = None
    title: str
    source: str
    text: str
    similarity_score: float = Field(..., ge=0.0, le=1.0)
    model_name: str = "BGE Small en-v1.5"


class NLIResult(BaseModel):
    """Output from Model 3 DeBERTa NLI comparing claim against evidence."""
    model_config = ConfigDict(extra="ignore")

    model_name: str = "EvidenceBridge DeBERTa-v3-small NLI"
    decision: str = Field(..., description="'entailment', 'contradiction', 'neutral', or 'review_required'")
    predicted_class: str = Field(..., description="Primary prediction: contradiction, entailment, or neutral")
    confidence: float = Field(..., ge=0.0, le=1.0)
    requires_human_review: bool = Field(default=False)
    probabilities: dict[str, float] = Field(default_factory=dict)
    threshold_applied: float = 0.80
    notes: Optional[str] = None


class ProviderAnomalyResult(BaseModel):
    """Output from Model 4 Provider-level Isolation Forest screening."""
    model_config = ConfigDict(extra="ignore")

    model_version: str = "V3"
    decision: str = Field(default="NORMAL", description="'NORMAL', 'ANOMALOUS', or 'INSUFFICIENT_DATA'")
    is_anomaly: bool = False
    anomaly_score: float = 0.0
    screening_flag: str = "Normal billing pattern"
    features_used: dict[str, Any] = Field(default_factory=dict)
    explanations: list[str] = Field(default_factory=list)
    has_sufficient_data: bool = True
    disclaimer: str = "Provider-level anomaly-screening signal based on CMS Medicare billing data; not proof of fraud."


class ClaimAnomalyResult(BaseModel):
    """Output from Model 5 Claim-level Isolation Forest screening."""
    model_config = ConfigDict(extra="ignore")

    model_version: str = "V3 Strict Temporal"
    decision: str = Field(default="NOT_FLAGGED", description="'NOT_FLAGGED', 'REVIEW_RECOMMENDED', or 'INSUFFICIENT_DATA'")
    is_anomaly: bool = False
    anomaly_score: float = 0.0
    screening_flag: str = "Not flagged"
    model_agreement: Optional[str] = None
    v3_score: Optional[float] = None
    v4a_score: Optional[float] = None
    features_used: dict[str, Any] = Field(default_factory=dict)
    explanations: list[str] = Field(default_factory=list)
    has_sufficient_data: bool = True
    disclaimer: str = "Claim-level anomaly-screening signal; not proof of fraud."


class MedicineSubstitutionResult(BaseModel):
    """Output from preserved Model 5 medicine matcher."""
    model_config = ConfigDict(extra="ignore")

    query_medicine: str
    target_medicine: str
    match_probability: float = Field(..., ge=0.0, le=1.0)
    is_match: bool
    explanation: str


class SharedClaimContext(BaseModel):
    """
    Normalized shared context binding all five AI models to the exact same claim encounter.
    """
    model_config = ConfigDict(extra="ignore")

    claim_id: str
    document_id: str
    source_type: str = "clinical_note"
    source_url: Optional[str] = None
    original_text: str
    ocr_text: Optional[str] = None
    hospital_name: Optional[str] = None
    provider_name: Optional[str] = None
    patient_info: Optional[dict[str, Any]] = None
    diagnoses: list[str] = Field(default_factory=list)
    medicines: list[str] = Field(default_factory=list)
    procedures: list[str] = Field(default_factory=list)
    billed_amount: Optional[float] = None
    currency: str = "USD"
    clinical_statement: str = ""
    retrieved_passages_count: int = 0
    provider_data_available: bool = False
    claim_data_available: bool = False
    detected_issue_types: list[str] = Field(default_factory=list)


class CrossModelSynthesis(BaseModel):
    """
    Unified synthesis explaining how all five model outputs relate to the same claim.
    """
    model_config = ConfigDict(extra="ignore")

    claim_id: str
    primary_entity: str
    detected_issues: list[str] = Field(default_factory=list)
    primary_trigger_issue: Optional[str] = None
    clinical_agreement_summary: str
    financial_agreement_summary: str
    provider_agreement_summary: str
    missing_information: list[str] = Field(default_factory=list)
    human_review_required: bool = False
    human_review_rationale: Optional[str] = None
    synthesis_markdown: str = ""


# ---------------------------------------------------------------------------
# Claim-Level Billing Reconciliation & Accounting Integrity
# ---------------------------------------------------------------------------

class BillingClassification(str, Enum):
    """Integrity classification for claim-level invoice arithmetic."""
    TOTAL_MATCH = "TOTAL_MATCH"
    TOTAL_MISMATCH = "TOTAL_MISMATCH"
    POSSIBLE_DUPLICATE = "POSSIBLE_DUPLICATE"
    POTENTIAL_OVERLAP_REQUIRES_REVIEW = "POTENTIAL_OVERLAP_REQUIRES_REVIEW"
    INSUFFICIENT_ITEMIZATION = "INSUFFICIENT_ITEMIZATION"


class BillingLineItem(BaseModel):
    """Extracted itemized bill line item."""
    model_config = ConfigDict(extra="ignore")

    item_id: str
    description: str
    amount: float
    currency: str = "INR"
    category: Optional[str] = None
    raw_text: Optional[str] = None


class DuplicateLineItem(BaseModel):
    """Line item billed multiple times with identical or near-identical descriptions/amounts."""
    model_config = ConfigDict(extra="ignore")

    description: str
    occurrences: int
    amount_per_occurrence: float
    total_duplicate_billed: float
    currency: str = "INR"
    clinical_note: str


class OverlappingCharge(BaseModel):
    """Line items potentially covering overlapping services (unbundling screening)."""
    model_config = ConfigDict(extra="ignore")

    item_a: str
    item_b: str
    overlap_type: str
    potential_overlap_amount: float
    currency: str = "INR"
    policy_reference: str
    explanation: str


class BenchmarkComparison(BaseModel):
    """Line item charge benchmark comparison grounded in verified sources."""
    model_config = ConfigDict(extra="ignore")

    service_or_item: str
    billed_amount: float
    benchmark_min: Optional[float] = None
    benchmark_max: Optional[float] = None
    currency: str = "INR"
    status: str = Field(
        ...,
        description="'WITHIN_BENCHMARK', 'EXCEEDS_BENCHMARK', 'BELOW_BENCHMARK', or 'CANNOT_ESTABLISH'"
    )
    difference_amount: Optional[float] = None
    percentage_difference: Optional[float] = None
    source_attribution: Optional[str] = None
    location_tier: Optional[str] = None
    service_category: Optional[str] = None
    ceiling_conditions: Optional[str] = None
    note: str


class BillingReconciliationResult(BaseModel):
    """
    Claim-level accounting integrity result:
    Independent of ML models; evaluates arithmetic consistency, duplicate charges,
    overlapping services, and grounded price benchmark comparisons.
    """
    model_config = ConfigDict(extra="ignore")

    classification: BillingClassification
    stated_total: Optional[float] = None
    itemized_sum: float = 0.0
    difference: Optional[float] = None
    patient_payable: Optional[float] = None
    currency: str = "INR"
    line_items: list[BillingLineItem] = Field(default_factory=list)
    duplicates: list[DuplicateLineItem] = Field(default_factory=list)
    overlaps: list[OverlappingCharge] = Field(default_factory=list)
    benchmark_comparisons: list[BenchmarkComparison] = Field(default_factory=list)
    summary_message: str
    explanations: list[str] = Field(default_factory=list)
    auditor_notes: list[str] = Field(default_factory=list)
    disclaimer: str = (
        "Arithmetic and line-item discrepancies reflect invoice reconciliation facts, "
        "not automatic fraud accusations. Bundling and package inclusions are policy-dependent "
        "and require verification against the hospital's published tariff schedule."
    )


class UnifiedAuditReport(BaseModel):
    """Complete 5-model unified audit report for a claim."""
    model_config = ConfigDict(extra="ignore")

    claim_id: str
    original_text: str
    ner_result: Optional[NERExtractionResult] = None
    retrieval_passages: list[RetrievalResultPassage] = Field(default_factory=list)
    nli_result: Optional[NLIResult] = None
    provider_anomaly: Optional[ProviderAnomalyResult] = None
    claim_anomaly: Optional[ClaimAnomalyResult] = None
    cost_anomaly: Optional[CostAnomalyDetails] = None
    medicine_substitution: Optional[MedicineSubstitutionResult] = None
    billing_reconciliation: Optional[BillingReconciliationResult] = None
    model_6_prediction: Optional["Model6PredictionResult"] = None
    shared_context: Optional[SharedClaimContext] = None
    synthesis: Optional[CrossModelSynthesis] = None
    overall_verdict: VerificationVerdict
    overall_action: VerificationAction
    requires_human_review: bool = False
    human_review_reasons: list[str] = Field(default_factory=list)
    summary_markdown: str = ""
    audit_trail_id: Optional[str] = None


# ============================================================================
# Model 6: Image-Based Medical Document AI Schemas (ResNet18)
# ============================================================================

class Model6DocumentCategory(str, Enum):
    PRESCRIPTION = "prescription"
    LABORATORY_REPORT = "laboratory_report"
    INVOICE_OR_RECEIPT = "invoice_or_receipt"
    UNCERTAIN = "uncertain_or_unsupported"


class Model6PredictionResult(BaseModel):
    """
    Inference result from Model 6 (Image-Based Medical Document AI - ResNet18).
    Classifies raw uploaded or camera-captured document images into prescription,
    laboratory report, or invoice/receipt.
    """
    model_config = ConfigDict(extra="ignore")

    document_category: str = Field(
        ...,
        description="'prescription', 'laboratory_report', 'invoice_or_receipt', or 'uncertain_or_unsupported'"
    )
    category_label: str = Field(
        ...,
        description="Human-friendly label: 'Medical Invoice / Receipt', 'Prescription', 'Laboratory Report', or 'Uncertain Document Type'"
    )
    model_score: float = Field(
        ...,
        description="Softmax probability score of the predicted class (0.0 to 1.0)"
    )
    all_probabilities: dict[str, float] = Field(
        default_factory=dict,
        description="Softmax probability distribution across all 3 trained classes"
    )
    is_supported: bool = Field(
        default=True,
        description="True if model confidence satisfies operational threshold and category is recognized"
    )
    suggested_source_type: str = Field(
        default="clinical_note",
        description="Mapped EvidenceBridge source_type ('hospital_bill', 'prescription', or 'clinical_note')"
    )
    model_name: str = "EvidenceBridge Model 6 (ResNet18 Document AI)"
    message: Optional[str] = None
    processed_at: Optional[datetime] = Field(default_factory=lambda: datetime.now(timezone.utc))


class DocumentImageProcessResponse(BaseModel):
    """
    Unified image processing response containing Model 6 Document AI classification
    and verbatim text extracted from the document via OCR.
    """
    model_config = ConfigDict(extra="ignore")

    model6_prediction: Model6PredictionResult
    ocr_text: str = ""
    ocr_confidence: float = 0.0
    ocr_lines_count: int = 0
    suggested_source_type: str = "clinical_note"
    is_clear: bool = True
    notice: Optional[str] = None


# ============================================================================
# Stage 1: Karnataka ML External Service Integration Schemas
# ============================================================================

class KarnatakaCostPredictRequest(BaseModel):
    """Request model for Treatment Package Cost Prediction."""
    model_config = ConfigDict(extra="ignore")

    package_name: str = Field(..., description="Procedure or treatment package name (e.g. 'Normal Delivery', 'Appendectomy')")
    room_category: str = Field(..., description="Room accommodation tier (e.g. 'General', 'Semi-Private', 'Deluxe')")


class KarnatakaAnomalyPredictRequest(BaseModel):
    """Request model for Hospital Directory Anomaly Detection (11 numerical features)."""
    model_config = ConfigDict(extra="ignore")

    name_length: float = Field(..., description="Character length of hospital name")
    name_word_count: float = Field(..., description="Word count in hospital name")
    name_digit_count: float = Field(..., description="Digit count in hospital name")
    normalized_name_duplicate_count: float = Field(..., description="Duplicate frequency of normalized name across directory")
    Hospital_Category_frequency: float = Field(..., description="Dataset frequency of Hospital Category")
    Hospital_Care_Type_frequency: float = Field(..., description="Dataset frequency of Hospital Care Type")
    Discipline_Systems_of_Medicine_frequency: float = Field(..., description="Dataset frequency of Systems of Medicine")
    district_record_count: float = Field(..., description="Number of hospital records in district")
    pincode_valid_format: float = Field(..., description="1.0 if valid 6-digit pincode, else 0.0")
    coordinates_valid_format: float = Field(..., description="1.0 if valid lat/lon coordinates format, else 0.0")
    valid_contact_count: float = Field(..., description="Number of non-empty contact channels (telephone, mobile, email, website)")


class KarnatakaEvidenceAssessRequest(BaseModel):
    """Request model for Hospital Directory Evidence Completeness Assessment (15 fields)."""
    model_config = ConfigDict(extra="ignore")

    Hospital_Name: str = Field(..., description="Name of the hospital")
    District: str = Field(..., description="District name")
    Pincode: Optional[Any] = Field(default="", description="Pincode or postal code")
    Location_Coordinates: Optional[Any] = Field(default="", description="Location coordinates string e.g. '12.97, 77.59'")
    Telephone: Optional[Any] = Field(default="", description="Landline telephone number")
    Mobile_Number: Optional[Any] = Field(default="", description="Mobile contact number")
    Hospital_Primary_Email_Id: Optional[Any] = Field(default="", description="Primary hospital email address")
    Website: Optional[Any] = Field(default="", description="Hospital official website URL")
    Specialties: Optional[Any] = Field(default="", description="Clinical specialties offered")
    Facilities: Optional[Any] = Field(default="", description="Medical facilities available")
    Hospital_Care_Type: Optional[Any] = Field(default="", description="Hospital care type (Primary, Secondary, Tertiary)")
    Hospital_Category: Optional[Any] = Field(default="", description="Hospital category (Govt, Private, Trust)")
    Emergency_Services: Optional[Any] = Field(default="", description="Emergency services availability description")
    Establised_Year: Optional[Any] = Field(default="", description="Year hospital was established")
    Empanelment_or_Collaboration_with: Optional[Any] = Field(default="", description="Insurance or scheme empanelments")


class KarnatakaHospitalRecommendRequest(BaseModel):
    """Request model for Hospital Directory Recommendations."""
    model_config = ConfigDict(extra="ignore")

    district: Optional[str] = Field(None, description="District filter (e.g. 'Bengaluru Urban', 'Ballari')")
    specialty: Optional[str] = Field(None, description="Specialty filter substring (e.g. 'Cardiology')")
    limit: Optional[int] = Field(default=10, ge=1, le=50, description="Maximum number of candidate hospitals (1-50)")
    require_coordinates: Optional[bool] = Field(default=False, description="Whether to only return hospitals with valid coordinates")


class KarnatakaMLResponseEnvelope(BaseModel):
    """Standard response envelope for external Karnataka ML API calls."""
    model_config = ConfigDict(extra="ignore")

    status: str = Field(..., description="Response status: 'success', 'external_service_unavailable', 'validation_error', 'invalid_external_response'")
    data: Optional[Any] = Field(None, description="Payload returned from upstream service or None")
    error: Optional[str] = Field(None, description="Descriptive error explanation if unsuccessful")
    warning: Optional[str] = Field(None, description="Model scope or limitation warning")
    upstream_status_code: Optional[int] = Field(None, description="HTTP status code received from upstream service")
    service_name: Optional[str] = Field(None, description="Name of the invoked Karnataka ML service")


# ============================================================================
# Stage 2: GPS-Based Nearby Hospital Recommendations Schemas
# ============================================================================

class KarnatakaNearbyHospitalsRequest(BaseModel):
    """Request model for GPS-based nearby hospital recommendations."""
    model_config = ConfigDict(extra="ignore")

    latitude: float = Field(..., ge=-90.0, le=90.0, description="User GPS latitude")
    longitude: float = Field(..., ge=-180.0, le=180.0, description="User GPS longitude")
    radius_km: float = Field(default=35.0, ge=1.0, le=150.0, description="Search radius in kilometers (1 - 150 km)")
    specialty: Optional[str] = Field(default=None, description="Optional specialty filter (e.g. 'Cardiology')")
    district: Optional[str] = Field(default=None, description="Optional manual district override (e.g. 'Bengaluru Urban')")
    limit: int = Field(default=10, ge=1, le=50, description="Maximum number of nearby hospitals to return (1 - 50)")


class KarnatakaNearbyHospitalRecord(BaseModel):
    """Normalized nearby hospital record with calculated distance and verified source metadata."""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(..., description="Unique hospital identifier")
    name: str = Field(..., description="Hospital Name")
    district: str = Field(..., description="District Name")
    lat: float = Field(..., description="Hospital Latitude")
    lon: float = Field(..., description="Hospital Longitude")
    distance_km: float = Field(..., description="Straight-line distance from user in kilometers (Haversine)")
    distance_miles: float = Field(..., description="Straight-line distance in miles")
    distance_status: str = Field(default="CALCULATED_HAVERSINE", description="Calculation status: CALCULATED_HAVERSINE or NOT_CALCULATED")
    data_source: str = Field(..., description="Source dataset (e.g. 'Karnataka Hospital Directory (Validated ML Dataset)' or 'OpenStreetMap / Overpass API')")
    address: Optional[str] = Field(None, description="Street address or location details if available")
    pincode: Optional[str] = Field(None, description="Postal pincode if available")
    category: Optional[str] = Field(None, description="Hospital Category (e.g. Government, Private, Trust)")
    care_type: Optional[str] = Field(None, description="Care Type (e.g. Tertiary, Secondary, Primary, General Hospital)")
    specialties: list[str] = Field(default_factory=list, description="List of medical specialties")
    facilities: list[str] = Field(default_factory=list, description="Available clinical facilities")
    phone: Optional[str] = Field(None, description="Landline contact telephone")
    mobile: Optional[str] = Field(None, description="Mobile contact number")
    email: Optional[str] = Field(None, description="Hospital email address")
    website: Optional[str] = Field(None, description="Official website URL")
    emergency_services: Optional[str] = Field(None, description="Emergency services description")
    established_year: Optional[str] = Field(None, description="Year established")
    evidence_completeness_percentage: Optional[float] = Field(None, description="Directory information completeness score (0-100%)")
    completeness_category: Optional[str] = Field(None, description="Completeness category: HIGH, MODERATE, LOW, VERY_LOW")
    directions_url: Optional[str] = Field(None, description="Map directions URL based on exact hospital coordinates")
    source_warning: Optional[str] = Field(None, description="Limitations notice for the data source")


class KarnatakaNearbyHospitalsResponse(BaseModel):
    """Response model for GPS-based nearby hospital recommendations."""
    model_config = ConfigDict(extra="ignore")

    status: str = Field(default="success", description="Status code: 'success', 'external_service_unavailable', 'validation_error', etc.")
    resolved_district: Optional[str] = Field(None, description="Karnataka district resolved from coordinates or override")
    is_in_karnataka: bool = Field(default=True, description="Whether coordinates resolve within Karnataka territory")
    user_coordinates: dict[str, float] = Field(..., description="User search coordinates: {'lat': float, 'lon': float}")
    radius_km: float = Field(..., description="Applied search radius in kilometers")
    count: int = Field(..., description="Total hospitals returned within radius")
    hospitals: list[KarnatakaNearbyHospitalRecord] = Field(default_factory=list, description="Hospitals sorted by distance ascending")
    karnataka_dataset_count: int = Field(default=0, description="Count of hospitals sourced from Karnataka ML dataset")
    osm_fallback_count: int = Field(default=0, description="Count of hospitals sourced from OpenStreetMap fallback")
    warning: Optional[str] = Field(None, description="Data scope, radius, or service warnings")
    disclaimer: str = Field(
        default="Directory information completeness reflects data availability only; it is not a clinical quality or accreditation rating. Distances are straight-line Haversine calculations.",
        description="Auditor transparency and safety disclaimer"
    )


# ============================================================================
# Stage 3: Treatment Cost Prediction & Benchmark Comparison Schemas
# ============================================================================

class KarnatakaTreatmentPackageInfo(BaseModel):
    """Supported treatment package for cost prediction with verified published tariffs."""
    model_config = ConfigDict(extra="ignore")

    package_name: str = Field(..., description="Procedure or treatment package name")
    category: str = Field(..., description="Clinical package category (e.g. 'Obstetrics & Maternity', 'Gynecological Surgery')")
    available_rooms: list[str] = Field(default_factory=list, description="Verified available room tiers: 'Private', 'Deluxe', 'Suite'")
    hospital_name: str = Field(default="Sakhii Hospital", description="Exact hospital where tariff was published (strictly Sakhii Hospital)")
    district: str = Field(default="Bengaluru", description="District location of the hospital")
    published_prices_inr: dict[str, float] = Field(default_factory=dict, description="Published reference tariff by room category")
    price_type: str = Field(default="Published hospital package tariff", description="Price classification type")
    model_status: str = Field(default="Experimental", description="ML model training readiness tier")
    karnataka_wide_prediction: bool = Field(default=False, description="Whether the model generalizes statewide (strictly False)")
    package_scope_verified: bool = Field(default=False, description="Whether package inclusions/exclusions are officially verified")
    scope_note: str = Field(
        default="Experimental model trained on Sakhii Hospital (Bengaluru) data only. Not generalizable to other hospitals.",
        description="Auditor safety and scope limitation note"
    )


class KarnatakaComparableBenchmark(BaseModel):
    """Comparable EvidenceBridge pricing benchmark across hospitals and government schedules."""
    model_config = ConfigDict(extra="ignore")

    id: str = Field(..., description="Unique benchmark identifier")
    service_or_procedure: str = Field(..., description="Name of clinical service, diagnostic test, or treatment package")
    category: str = Field(..., description="Category: e.g. 'Maternity & Obstetrics', 'Diagnostic Imaging', 'Emergency Visit', 'Subsidized OPD'")
    hospital_or_source: str = Field(..., description="Publishing hospital or regulatory benchmark authority")
    price_display: str = Field(..., description="Formatted pricing display (e.g. '₹66,400', '₹20 (OPD)', '₹3,500 – ₹8,500')")
    min_price_inr: float = Field(..., description="Minimum price or fixed quoted tariff in INR")
    max_price_inr: float = Field(..., description="Maximum price in INR")
    typical_price_inr: Optional[float] = Field(None, description="Typical or reference price in INR")
    currency: str = Field(default="INR", description="Currency code")
    price_type: str = Field(
        ...,
        description="Tariff tier: 'Published hospital package tariff', 'Official Published Benchmark', 'National Statutory Ceiling (NPPA)', 'Government Subsidized OPD Tariff', or 'Standard Diagnostic Benchmark'"
    )
    data_source: str = Field(..., description="Official regulatory, transparency, or chargemaster source")
    last_updated: Optional[str] = Field(None, description="Data publication or retrieval date")
    relevance_tag: Optional[str] = Field(None, description="Comparable procedure tag (e.g. 'Delivery', 'Surgery', 'Diagnostic', 'OPD')")


class KarnatakaCostComparisonCatalog(BaseModel):
    """Comprehensive catalog of supported packages, room categories, and comparable price benchmarks."""
    model_config = ConfigDict(extra="ignore")

    status: str = Field(default="success", description="Response status")
    hospital_name: str = Field(default="Sakhii Hospital", description="Attributed hospital for experimental ML predictions")
    district: str = Field(default="Bengaluru", description="Hospital district")
    model_algorithm: str = Field(default="RandomForestRegressor", description="Machine learning regression model")
    supported_packages: list[KarnatakaTreatmentPackageInfo] = Field(default_factory=list, description="Supported procedures")
    available_room_categories: list[str] = Field(default_factory=list, description="Available room categories: 'Private', 'Deluxe', 'Suite'")
    comparable_benchmarks: list[KarnatakaComparableBenchmark] = Field(default_factory=list, description="Comparable pricing across Indian providers and NPPA/CGHS")
    disclaimer: str = Field(
        default="Cost predictions are generated by an experimental RandomForestRegressor trained solely on Sakhii Hospital (Bengaluru) tariff data. They must NOT be attributed to or extrapolated to other medical facilities. Published benchmarks reflect official public filings and statutory price ceilings.",
        description="Auditor integrity notice"
    )


# ==============================================================================
# STAGE 4B: GOVERNMENT HEALTHCARE SCHEMES & FINANCIAL AID SCHEMAS
# ==============================================================================

class GovernmentSchemeHelpline(BaseModel):
    """Verified official helpline number and contact channel."""
    model_config = ConfigDict(extra="ignore")

    name: str = Field(..., description="Agency or department name")
    number: str = Field(..., description="Formatted phone or toll-free number")
    description: str = Field(..., description="Operational purpose and availability (e.g. 24x7, Toll-Free)")
    tel_uri: str = Field(..., description="Clickable URI (e.g. 'tel:14555')")


class GovernmentSchemeOfficialLink(BaseModel):
    """Verified official government portal link."""
    model_config = ConfigDict(extra="ignore")

    title: str = Field(..., description="Portal name or title")
    url: str = Field(..., description="Official government URL")
    purpose: str = Field(..., description="Brief description of portal functions")


class GovernmentSchemeDetail(BaseModel):
    """Comprehensive verified profile of a government healthcare scheme."""
    model_config = ConfigDict(extra="ignore")

    scheme_id: str = Field(..., description="Unique scheme identifier ('pmjay', 'ab_ark', 'cmrf')")
    name: str = Field(..., description="Full official name of the scheme")
    short_name: str = Field(..., description="Common acronym or short title")
    administering_body: str = Field(..., description="Government department, trust, or authority managing the scheme")
    official_portal_url: str = Field(..., description="Primary official website URL")
    beneficiary_portal_url: Optional[str] = Field(None, description="Citizen eligibility and card generation URL")
    hospital_search_portal_url: Optional[str] = Field(None, description="Official empanelled hospital directory search URL")
    helplines: list[GovernmentSchemeHelpline] = Field(default_factory=list, description="Verified helplines")
    coverage_ceiling_inr: float = Field(..., description="Annual or one-time coverage limit in INR")
    coverage_display: str = Field(..., description="Human-readable financial coverage ceiling")
    coverage_description: str = Field(..., description="Scope of covered treatments (inpatient, tertiary, etc.)")
    nature_of_scheme: str = Field(..., description="Legal nature (Entitlement, Co-Payment, Discretionary Ex-Gratia)")
    bpl_benefit: str = Field(..., description="Entitlements for BPL / PHH / AAY cardholders")
    apl_benefit: str = Field(..., description="Entitlements for APL / general non-BPL citizens")
    referral_required_for_private: bool = Field(..., description="Whether a public hospital referral is required for private treatment")
    emergency_referral_exempt: bool = Field(..., description="Whether emergencies are exempt from public hospital referral")
    mandatory_documents: list[str] = Field(default_factory=list, description="Documents strictly required for processing")
    conditional_documents: list[str] = Field(default_factory=list, description="Documents required under specific conditions")
    exclusions: list[str] = Field(default_factory=list, description="Excluded procedures and scenarios")
    limitations_and_disclaimers: list[str] = Field(default_factory=list, description="Key operational caveats and waiting periods")
    official_links: list[GovernmentSchemeOfficialLink] = Field(default_factory=list, description="Official portal links")
    is_discretionary: bool = Field(default=False, description="True if financial assistance is discretionary (e.g. CMRF) and not guaranteed")
    status: str = Field(default="active", description="Operational status: 'active'")


class GovernmentSchemesCatalog(BaseModel):
    """Complete catalog of verified government healthcare schemes in Karnataka."""
    model_config = ConfigDict(extra="ignore")

    status: str = Field(default="success", description="Response status")
    schemes: list[GovernmentSchemeDetail] = Field(default_factory=list, description="Profiles of verified schemes")
    emergency_helplines: list[GovernmentSchemeHelpline] = Field(default_factory=list, description="Critical helplines")
    disclaimer: str = Field(
        default="Official scheme policies, coverage schedules, and empanelment rosters are determined solely by government authorities. EvidenceBridge provides informational guidance and does not authorize or determine scheme approvals.",
        description="Auditor and citizen integrity disclaimer"
    )
    last_verified: str = Field(default="2026-11-04", description="Date of official source verification")


class SchemeEligibilityEvaluationRequest(BaseModel):
    """Anonymous eligibility guidance request without personal data."""
    model_config = ConfigDict(extra="ignore")

    is_karnataka_resident: bool = Field(..., description="Whether patient is a permanent resident of Karnataka")
    ration_card_type: Literal["BPL_PHH_AAY", "APL_NPHH", "NONE"] = Field(
        ...,
        description="Ration card classification: 'BPL_PHH_AAY', 'APL_NPHH', or 'NONE'"
    )
    patient_age: Optional[int] = Field(None, ge=0, le=125, description="Patient age in years (optional)")
    care_type: Literal["EMERGENCY", "PLANNED"] = Field(
        ...,
        description="Care urgency: 'EMERGENCY' (acute life-threatening) or 'PLANNED' (elective/scheduled)"
    )
    estimated_cost_inr: Optional[float] = Field(None, ge=0, description="Estimated treatment cost in INR (optional)")


class SchemeEligibilityEvaluationResponse(BaseModel):
    """Deterministic, transparent guidance result based on verified government rules."""
    model_config = ConfigDict(extra="ignore")

    status: str = Field(default="success", description="Evaluation status")
    pathway_headline: str = Field(
        default="Potential scheme pathway — confirm with the official authority.",
        description="Core guidance verdict"
    )
    primary_scheme_id: Optional[str] = Field(None, description="Most directly applicable scheme identifier")
    primary_scheme_name: Optional[str] = Field(None, description="Primary scheme name")
    eligible_schemes: list[str] = Field(default_factory=list, description="List of potentially applicable schemes")
    coverage_summary: str = Field(..., description="High-level coverage description")
    copay_status: str = Field(..., description="Co-payment and cashless status summary")
    referral_required: bool = Field(..., description="Whether a public hospital referral is needed for private care")
    referral_guidance: str = Field(..., description="Detailed instructions on referral requirements")
    emergency_exemption: bool = Field(..., description="Whether emergency rules apply to waive referral")
    senior_citizen_expansion: bool = Field(default=False, description="Whether 70+ Ayushman Vay Vandana expansion applies")
    cmrf_applicable: bool = Field(default=False, description="Whether Karnataka Chief Minister's Relief Fund is relevant")
    cmrf_status_note: Optional[str] = Field(None, description="Explanation of CMRF discretionary relief")
    actionable_steps: list[str] = Field(default_factory=list, description="Step-by-step guidance for the citizen")
    mandatory_documents: list[str] = Field(default_factory=list, description="Documents required")
    conditional_documents: list[str] = Field(default_factory=list, description="Conditional documents")
    official_verification_links: list[GovernmentSchemeOfficialLink] = Field(default_factory=list, description="Official portal links")
    helpline_numbers: list[GovernmentSchemeHelpline] = Field(default_factory=list, description="Verified helplines")
    disclaimer: str = Field(
        default="Potential scheme pathway — confirm with the official authority. EvidenceBridge does not determine eligibility or approve medical treatments. All official eligibility, pre-authorizations, and coverage decisions are made solely by the National Health Authority (NHA), Suvarna Arogya Suraksha Trust (SAST), or the Chief Minister's Relief Fund committee.",
        description="Mandatory integrity disclaimer"
    )


# ============================================================================
# Live Hospital Doctor Availability & Emergency SOS Models
# ============================================================================

class HospitalAvailabilityUpdate(BaseModel):
    """Payload submitted by hospital staff to update real-time clinical staffing and duty status."""
    model_config = ConfigDict(extra="ignore")

    hospital_id: str = Field(..., description="Hospital unique identifier")
    hospital_name: Optional[str] = Field(None, description="Hospital display name")
    doctors_available: int = Field(..., ge=0, description="Total doctors currently available on duty")
    emergency_doctors: int = Field(..., ge=0, description="Emergency medicine doctors currently on duty")
    nurses_available: int = Field(..., ge=0, description="Nurses currently available on duty")
    emergency_nurses: int = Field(default=0, ge=0, description="Emergency nurses currently on duty")
    department_specialists: Optional[dict[str, int]] = Field(
        default_factory=dict,
        description="Specialist doctors available by department (e.g. Cardiology, Neurology, Orthopaedics)"
    )
    available_beds: Optional[int] = Field(default=None, ge=0, description="Total inpatient beds currently available")
    icu_beds_available: Optional[int] = Field(default=None, ge=0, description="Available ICU beds")
    emergency_dept_status: str = Field(
        default="Operational",
        description="Emergency department status: Operational, Limited, Critical, or Closed"
    )
    duty_status: str = Field(
        default="Accepting Patients",
        description="Hospital duty status: Accepting Patients, Limited, or Unavailable"
    )
    notes: Optional[str] = Field(None, description="Optional triage or capacity notes")

    @model_validator(mode="after")
    def validate_staff_counts(self):
        if self.emergency_doctors > self.doctors_available:
            raise ValueError(
                f"Emergency doctors on duty ({self.emergency_doctors}) cannot exceed total available doctors ({self.doctors_available})."
            )
        if self.emergency_nurses > self.nurses_available:
            raise ValueError(
                f"Emergency nurses on duty ({self.emergency_nurses}) cannot exceed total available nurses ({self.nurses_available})."
            )
        return self


class HospitalAvailabilityResponse(BaseModel):
    """Real-time clinical staffing and hospital duty status returned to citizens and staff."""
    model_config = ConfigDict(extra="ignore")

    hospital_id: str
    hospital_name: str
    doctors_available: int
    emergency_doctors: int
    nurses_available: int
    emergency_nurses: int = 0
    department_specialists: dict[str, int] = Field(default_factory=dict)
    available_beds: Optional[int] = None
    icu_beds_available: Optional[int] = None
    emergency_dept_status: str = "Operational"
    duty_status: str = "Accepting Patients"  # "Accepting Patients" | "Limited" | "Unavailable"
    last_updated: datetime
    updated_by: Optional[str] = None
    notes: Optional[str] = None


class EmergencySOSCreate(BaseModel):
    """Emergency SOS distress request created by a patient or bystander."""
    model_config = ConfigDict(extra="ignore")

    emergency_type: str = Field(
        ...,
        description="Emergency classification: 'Accident / Trauma', 'Breathing Difficulty', 'Chest Pain', 'Other Emergency'"
    )
    hospital_id: str = Field(..., description="Target hospital ID receiving the alert")
    hospital_name: Optional[str] = Field(None, description="Target hospital name")
    patient_name: str = Field(..., description="Patient or bystander name")
    patient_phone: str = Field(..., description="Callback phone number for emergency desk")
    description: Optional[str] = Field(None, description="Brief description of patient condition or situation")
    latitude: Optional[float] = Field(None, ge=-90.0, le=90.0, description="GPS latitude if permitted")
    longitude: Optional[float] = Field(None, ge=-180.0, le=180.0, description="GPS longitude if permitted")
    address: Optional[str] = Field(None, description="Approximate address or landmark")


class EmergencySOSStatusUpdate(BaseModel):
    """Payload to transition an SOS state."""
    model_config = ConfigDict(extra="ignore")

    status: str = Field(..., description="New status: ACKNOWLEDGED, RESPONDING, RESOLVED")
    response_notes: Optional[str] = Field(None, description="Notes from the emergency triage desk")


class EmergencySOSRecord(BaseModel):
    """Complete SOS emergency dispatch record with clinical protocol guidance."""
    model_config = ConfigDict(extra="ignore")

    sos_id: str
    emergency_type: str
    hospital_id: str
    hospital_name: str
    patient_name: str
    patient_phone: str
    description: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    address: Optional[str] = None
    status: str = "PENDING"  # PENDING | ACKNOWLEDGED | RESPONDING | RESOLVED
    created_at: datetime
    updated_at: datetime
    acknowledged_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    response_notes: Optional[str] = None
    clinical_protocol: Optional[dict[str, Any]] = None





