"""
Claim Verification, Support Scoring & Hybrid Retrieval Service for EvidenceBridge.
Combines ChromaDB vector search + BM25 term weighting for evidence ranking,
enforces strict deterministic abstention safety gates, and records complete decision audit trails.
"""

from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re
from typing import Any, Optional
import uuid
import httpx

from app.config import get_settings
from app.models.schemas import (
    AuditTrail,
    Claim,
    CostAnomalyDetails,
    EvidencePassage,
    EvidenceSnippet,
    VerificationAction,
    VerificationResult,
    VerificationVerdict,
)
from app.services.abstention import abstention_service
from app.services.audit import audit_service
from app.services.cost_anomaly import cost_anomaly_service
from app.services.extraction import (
    ExtractionError,
    GeminiConnectionError,
    LLMConnectionError,
    OllamaConnectionError,
)
from app.services.vector_store import vector_store_service
from app.utils.logger import logger


VERIFICATION_SYSTEM_PROMPT = """You are an expert clinical auditor evaluating the veracity of a healthcare claim against authoritative medical guidelines.

Your task is to determine whether the provided authoritative evidence passages SUPPORT, PARTIALLY SUPPORT, CONTRADICT, or provide INSUFFICIENT EVIDENCE for the medical claim.

VERDICT DEFINITIONS:
1. "supported" (support_score: 0.70 to 1.00):
   The guideline explicitly validates the drug, procedure, indication, or reported outcome/adverse effect as clinically sound.
2. "partially_supported" (support_score: 0.40 to 0.69):
   The guideline confirms the entity exists and has relevant medical use, but reported outcomes or specific details are only partially corroborated or partially atypical.
3. "contradicted" (support_score: 0.00 to 0.39):
   The guideline explicitly discourages, refutes, or contradicts the claim (e.g. antibiotic prescribed for viral bronchitis, contraindicated therapy, or clinically false outcome claims).
4. "insufficient_evidence" (support_score: 0.00 to 0.30):
   The passages do not provide enough medical facts to judge the claim.

OUTPUT STRICTLY A VALID JSON OBJECT WITH THIS FORMAT:
{
  "verdict": "supported" | "partially_supported" | "contradicted" | "insufficient_evidence",
  "support_score": float between 0.0 and 1.0,
  "reasoning": "Clear 1-3 sentence factual explanation directly referencing the evidence passages",
  "conflict_assessment": {
    "has_conflict": boolean,
    "supporting_passage_ids": ["passage ID", ...],
    "opposing_passage_ids": ["passage ID", ...],
    "explanation": "Brief explanation of the opposing positions"
  }
}

Set has_conflict to true only when usable passages explicitly support opposing positions
on the claim. Cite the exact passage IDs shown with each passage. Do not treat insufficient
evidence, uncertainty, or wording alone as a conflict. If conflict is not established,
set has_conflict to false and use empty passage ID lists. A contradicted verdict must
remain contradicted; do not use conflict wording alone to change it.
STRICT RULE: Do not output markdown or text outside the JSON object.
"""

ANATOMICAL_REGIONS: dict[str, set[str]] = {
    "brain": {"brain", "head", "cranial", "cerebral", "neuro", "neuroimaging", "intracranial", "encephalopathy"},
    "knee": {"knee", "patella", "meniscus", "meniscal"},
    "chest": {"chest", "thorax", "thoracic", "lung", "pulmonary"},
    "abdomen": {"abdomen", "abdominal", "pelvis", "pelvic"},
    "spine": {"spine", "spinal", "lumbar", "cervical", "vertebra"},
}

STOP_WORDS: set[str] = {
    "mg", "ml", "oral", "tablet", "tablets", "solution", "daily", "the", "and", "for",
    "with", "cpt", "dose", "unit", "iv", "intravenous", "infusion", "injection",
    "capsule", "vial", "per", "take", "twice", "once", "thrice", "after", "before",
    "meals", "breakfast", "night", "morning", "one", "two", "three", "days"
}

CLINICAL_SYNONYMS: dict[str, set[str]] = {
    "paracetamol": {"acetaminophen", "dolo", "crocin", "calpol", "tylenol", "antipyretic", "fever", "febrile", "pyrexia"},
    "acetaminophen": {"paracetamol", "dolo", "crocin", "antipyretic", "fever", "febrile", "pyrexia"},
    "dolo": {"paracetamol", "acetaminophen", "dolo 650", "fever", "febrile"},
    "saline": {"sodium", "chloride", "nacl", "crystalloid", "hydration", "fluid"},
    "sodium": {"saline", "sodium chloride", "nacl"},
    "chloride": {"saline", "sodium chloride", "nacl"},
    "metformin": {"glucophage", "biguanide", "glycomet", "diabetes", "glycemic"},
    "glimepiride": {"amaryl", "sulfonylurea", "diabetes", "glycemic", "antidiabetic"},
    "atorvastatin": {"statin", "lipitor", "cholesterol", "dyslipidemia", "lipid", "cardiovascular"},
    "ors": {"oral rehydration solution", "oral rehydration salts", "rehydration", "diarrhea"},
    "rehydration": {"ors", "oral rehydration solution", "dehydration", "gastroenteritis", "saline"},
    "gastroenteritis": {"dehydration", "diarrhea", "vomiting", "rehydration", "saline"},
    "fever": {"paracetamol", "acetaminophen", "antipyretic", "febrile", "pyrexia"},
    "febrile": {"paracetamol", "acetaminophen", "fever", "pyrexia", "antipyretic"},
    "hypertension": {"blood pressure", "amlodipine", "telmisartan", "antihypertensive"},
    "pantoprazole": {"pan", "pantocid", "ppi", "proton pump", "gastritis", "gerd", "acid reflux"},
}



class VerificationService:
    """Service to verify claims against evidence guidelines using Gemini or Ollama."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        provider: Optional[str] = None,
    ):
        self.settings = get_settings()
        self.provider = (provider or self.settings.LLM_PROVIDER).lower()

        # Gemini configuration
        self.gemini_model = model or self.settings.GEMINI_MODEL
        self.gemini_base_url = (base_url or self.settings.GEMINI_BASE_URL).rstrip("/")
        self.gemini_api_key = self.settings.GEMINI_API_KEY
        self.gemini_timeout = self.settings.GEMINI_TIMEOUT_SECONDS

        # Ollama configuration
        self.base_url = (base_url or self.settings.OLLAMA_BASE_URL).rstrip("/")
        self.model = model or self.settings.OLLAMA_MODEL
        self.timeout = self.settings.OLLAMA_TIMEOUT_SECONDS

        self.relevance_threshold = self.settings.RETRIEVAL_RELEVANCE_THRESHOLD
        self.guidelines_file = self._resolve_guidelines_path()
        self.guidelines: list[dict[str, Any]] = []
        self._guidelines_indexed = False
        self.load_guidelines()

    def _resolve_guidelines_path(self) -> Path:
        """Locate clinical_guidelines_samples.json across known paths."""
        candidates = [
            Path(self.settings.KNOWLEDGE_BASE_DIR) / "clinical_guidelines_samples.json",
            Path(__file__).parent.parent.parent.parent / "data" / "knowledge" / "clinical_guidelines_samples.json",
            Path("./data/knowledge/clinical_guidelines_samples.json"),
            Path("../data/knowledge/clinical_guidelines_samples.json"),
        ]
        for path in candidates:
            if path.exists():
                return path.resolve()
        return Path("./data/knowledge/clinical_guidelines_samples.json")

    def load_guidelines(self) -> None:
        """Load guideline documents from disk."""
        if not self.guidelines_file.exists():
            logger.warning(f"Guidelines file not found at: {self.guidelines_file}")
            return

        try:
            with open(self.guidelines_file, "r", encoding="utf-8") as f:
                self.guidelines = json.load(f)
            logger.info(f"Loaded {len(self.guidelines)} clinical guidelines from {self.guidelines_file.name}")
        except Exception as e:
            logger.error(f"Failed to load clinical guidelines: {e}")

    def index_guidelines_in_vector_store(self) -> None:
        """Index guideline passages into ChromaDB for semantic retrieval."""
        if self._guidelines_indexed or not self.guidelines:
            return

        try:
            if not vector_store_service._client:
                vector_store_service.initialize()

            if vector_store_service._client:
                ef = None
                try:
                    from app.services.embedding import embedding_service
                    ef = embedding_service.get_chroma_embedding_function()
                except Exception as ef_err:
                    logger.debug(f"Could not load BGE embedding function: {ef_err}")

                try:
                    collection = vector_store_service._client.get_or_create_collection(
                        name=self.settings.CHROMA_GUIDELINES_COLLECTION,
                        embedding_function=ef
                    )
                except Exception as coll_err:
                    logger.debug(f"Opening existing guidelines collection without overriding embedding function: {coll_err}")
                    collection = vector_store_service._client.get_collection(name=self.settings.CHROMA_GUIDELINES_COLLECTION)
                ids = [g["guideline_id"] for g in self.guidelines]
                docs = [f"Title: {g['title']}\nSource: {g['source']}\nText: {g['text']}" for g in self.guidelines]
                metas = [
                    {
                        "guideline_id": g["guideline_id"],
                        "title": g["title"],
                        "source": g["source"],
                        "topics": " ".join(g.get("topics", []))
                    }
                    for g in self.guidelines
                ]
                collection.upsert(ids=ids, documents=docs, metadatas=metas)
                logger.info(f"Indexed {len(ids)} clinical guidelines into ChromaDB collection '{self.settings.CHROMA_GUIDELINES_COLLECTION}'")
                self._guidelines_indexed = True
        except Exception as e:
            logger.warning(f"Could not index guidelines into ChromaDB (will use keyword search fallback): {e}")

    def _compute_bm25_scores(self, query_tokens: list[str], entity_tokens: set[str]) -> dict[str, float]:
        """
        Compute BM25-style scores for all guidelines based on query and entity tokens.
        Includes TF saturation (k1=1.5), length normalization (b=0.75), IDF term weighting,
        and anchor boosts for exact CPT codes and clinical entity matches.
        """
        scores: dict[str, float] = {}
        if not self.guidelines or not query_tokens:
            return scores

        N = len(self.guidelines)
        k1 = 1.5
        b = 0.75

        # Check for 5-digit CPT codes in query and entity tokens
        cpt_pattern = re.compile(r"\b\d{5}\b")
        query_cpts = set(cpt_pattern.findall(" ".join(query_tokens))) | set(cpt_pattern.findall(" ".join(entity_tokens)))

        # Document lengths (in tokens)
        doc_lens = {
            g["guideline_id"]: len(re.findall(r"\w+", f"{g['title']} {' '.join(g.get('topics', []))} {g['text']}".lower()))
            for g in self.guidelines
        }
        avg_len = sum(doc_lens.values()) / max(N, 1)

        # Document frequency (DF) per token
        df: dict[str, int] = {}
        for token in query_tokens:
            df[token] = sum(
                1 for g in self.guidelines
                if token in g["title"].lower() or token in g["text"].lower() or any(token in t.lower() for t in g.get("topics", []))
            )

        for g in self.guidelines:
            gid = g["guideline_id"]
            d_len = doc_lens.get(gid, avg_len)
            title_text = g["title"].lower()
            body_text = g["text"].lower()
            topics_text = " ".join(g.get("topics", [])).lower()
            combined_text = f"{title_text} {topics_text} {body_text}"

            score = 0.0
            for token in query_tokens:
                # Term frequency with extra weight for titles and topics
                tf = (
                    combined_text.count(token)
                    + title_text.count(token) * 2.0
                    + topics_text.count(token) * 3.0
                )
                if tf == 0:
                    continue

                # IDF
                token_df = df.get(token, 0)
                idf = math.log((N - token_df + 0.5) / (token_df + 0.5) + 1.0)

                # TF saturation with length normalization
                tf_norm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (d_len / avg_len)))
                score += idf * tf_norm

            # Significant entity anchor boost (including 3-letter clinical acronyms like MRI, CMP, CBC)
            entity_matches = sum(1 for t in entity_tokens if len(t) >= 3 and (t in topics_text or t in title_text or t in body_text))
            title_topic_matches = sum(1 for t in entity_tokens if len(t) >= 3 and (t in topics_text or t in title_text))
            score += entity_matches * 3.0 + title_topic_matches * 4.0

            # Exact CPT code anchor boost
            if query_cpts:
                guide_cpts = set(cpt_pattern.findall(combined_text))
                if query_cpts & guide_cpts:
                    score += 15.0

            scores[gid] = score

        # Normalize BM25 scores with minimum ceiling to prevent noise inflation
        max_score = max(scores.values(), default=1.0)
        normalizer = max(max_score, 8.0)
        return {gid: round(min(1.0, s / normalizer), 4) for gid, s in scores.items()}

    def retrieve_hybrid_passages(self, entity: str, claim_text: str, k: int = 5) -> list[EvidencePassage]:
        """
        Ranked hybrid retrieval combining BM25 keyword matching and ChromaDB vector search.
        Evaluates relevance threshold, anatomical region compatibility, and procedure codes,
        marking passages used_in_decision vs discarded.
        """
        # Clean entity-targeted retrieval query to avoid full-document contamination
        entity_clean = entity.strip()
        query_text = f"{entity_clean} clinical guideline indication dosage".strip()
        all_tokens = [t.lower() for t in re.findall(r"\w+", f"{entity_clean} {claim_text[:120]}") if len(t) >= 3 and t.lower() not in STOP_WORDS]
        entity_tokens = set(re.findall(r"\w+", entity_clean.lower())) - STOP_WORDS

        expanded_entity_tokens = set(entity_tokens)
        for t in entity_tokens:
            if t in CLINICAL_SYNONYMS:
                expanded_entity_tokens.update(CLINICAL_SYNONYMS[t])

        # Check for 5-digit CPT codes and anatomical regions in query
        cpt_pattern = re.compile(r"\b\d{5}\b")
        query_cpts = set(cpt_pattern.findall(query_text))

        query_combined = f"{entity} {claim_text}".lower()
        query_regions = {
            region for region, keywords in ANATOMICAL_REGIONS.items()
            if any(re.search(r"\b" + re.escape(kw) + r"\b", query_combined) for kw in keywords)
        }

        # 1. Compute BM25 scores
        bm25_scores = self._compute_bm25_scores(all_tokens, entity_tokens)

        # 2. Compute ChromaDB vector distances
        vector_scores: dict[str, float] = {}
        try:
            if not self._guidelines_indexed:
                self.index_guidelines_in_vector_store()

            if vector_store_service._client:
                ef = None
                try:
                    from app.services.embedding import embedding_service
                    ef = embedding_service.get_chroma_embedding_function()
                except Exception as ef_err:
                    logger.debug(f"Could not load BGE embedding function: {ef_err}")

                try:
                    collection = vector_store_service._client.get_collection(
                        name=self.settings.CHROMA_GUIDELINES_COLLECTION,
                        embedding_function=ef
                    )
                except Exception:
                    collection = vector_store_service._client.get_or_create_collection(
                        name=self.settings.CHROMA_GUIDELINES_COLLECTION,
                        embedding_function=ef
                    )
                results = collection.query(
                    query_texts=[query_text],
                    n_results=min(k, len(self.guidelines))
                )
                if results and results.get("ids") and results["ids"][0]:
                    ids = results["ids"][0]
                    dists = results.get("distances", [[]])[0] if results.get("distances") else [0.5] * len(ids)
                    for gid, dist in zip(ids, dists):
                        sim = max(0.0, min(1.0, 1.0 - (dist if dist is not None else 0.5)))
                        vector_scores[gid] = sim
        except Exception as e:
            logger.debug(f"ChromaDB query fallback: {e}")

        # 3. Assemble hybrid passages
        passages: list[EvidencePassage] = []
        for g in self.guidelines:
            gid = g["guideline_id"]
            bm25 = bm25_scores.get(gid, 0.0)
            vec = vector_scores.get(gid, 0.0)

            # Check if vector search was active for this doc
            if gid in vector_scores:
                composite = round(0.55 * bm25 + 0.45 * vec, 3)
            else:
                composite = round(bm25, 3)

            guide_combined = f"{g['title']} {' '.join(g.get('topics', []))} {g['text']}".lower()
            topics_text = " ".join(g.get("topics", [])).lower()
            title_text = g["title"].lower()
            body_text = g["text"].lower()

            # Check anatomical region compatibility
            guide_regions = {
                region for region, keywords in ANATOMICAL_REGIONS.items()
                if any(re.search(r"\b" + re.escape(kw) + r"\b", guide_combined) for kw in keywords)
            }
            has_anatomical_conflict = bool(
                query_regions and guide_regions and not (query_regions & guide_regions)
            )

            # Check CPT code compatibility
            guide_cpts = set(cpt_pattern.findall(guide_combined))
            has_cpt_conflict = bool(
                query_cpts and guide_cpts and not (query_cpts & guide_cpts)
            )

            # Entity anchor check (supports 3+ letter tokens and clinical synonyms)
            has_topic_match = any(t in topics_text or t in title_text for t in expanded_entity_tokens if len(t) >= 3)
            has_body_match = any(t in body_text for t in expanded_entity_tokens if len(t) >= 3)
            has_entity_match = has_topic_match or has_body_match

            # Threshold and discard logic
            if has_cpt_conflict:
                used = False
                composite = round(min(composite, 0.20), 3)
                discard_reason = f"CPT mismatch: guideline covers CPT {', '.join(sorted(guide_cpts))} instead of claim CPT {', '.join(sorted(query_cpts))}"
            elif has_anatomical_conflict:
                used = False
                composite = round(min(composite, 0.20), 3)
                discard_reason = f"Anatomical mismatch: guideline targets {', '.join(sorted(guide_regions))} while claim targets {', '.join(sorted(query_regions))}"
            elif entity_tokens and not has_entity_match:
                used = False
                composite = round(min(composite, 0.20), 3)
                discard_reason = f"Entity mismatch: guideline does not mention clinical entity '{entity}'"
            elif composite < self.relevance_threshold:
                used = False
                discard_reason = f"Below relevance threshold {self.relevance_threshold:.2f} (score: {composite:.2f})"
            elif entity_tokens and not has_topic_match and composite < 0.60:
                used = False
                discard_reason = "Entity mismatch: clinical entity only weakly mentioned in body text"
            else:
                used = True
                discard_reason = None

            passages.append(EvidencePassage(
                passage_id=f"pas_{uuid.uuid4().hex[:10]}",
                guideline_id=gid,
                title=g["title"],
                source=g["source"],
                text=g["text"],
                relevance_score=composite,
                used_in_decision=used,
                discard_reason=discard_reason
            ))

        # Rank by relevance score descending, strictly prioritizing usable grounded evidence
        passages.sort(key=lambda p: (1 if p.used_in_decision else 0, p.relevance_score), reverse=True)
        top_passages = passages[:k]

        used_cnt = sum(1 for p in top_passages if p.used_in_decision)
        disc_cnt = len(top_passages) - used_cnt
        logger.info(f"Hybrid retrieval for '{entity}': {used_cnt} passages usable, {disc_cnt} discarded (threshold: {self.relevance_threshold:.2f})")

        return top_passages

    def retrieve_evidence_passages(self, entity: str, claim_text: str, k: int = 3) -> list[EvidenceSnippet]:
        """Backward-compatible method returning EvidenceSnippet list."""
        passages = self.retrieve_hybrid_passages(entity, claim_text, k=k)
        return [
            EvidenceSnippet(
                guideline_id=p.guideline_id or "UNKNOWN",
                title=p.title,
                source=p.source,
                text=p.text,
                relevance_score=p.relevance_score
            )
            for p in passages if p.used_in_decision
        ]

    async def verify_claim(
        self,
        claim: Claim,
        provider_data: Optional[dict[str, Any]] = None,
        claim_data: Optional[dict[str, Any]] = None,
        ner_entities: Optional[list[Any]] = None,
        target_medicine: Optional[str] = None
    ) -> VerificationResult:
        """
        Verify an extracted Claim against local guidelines, price benchmarks, and all 5 AI models.
        Executes hybrid retrieval (BGE + BM25), DeBERTa NLI cross-examination,
        Provider Anomaly screening (V3), Claim Anomaly screening (V3 Strict/V4-A),
        evaluates deterministic abstention gates, and records complete decision audit trail.
        """
        # 0. Build normalized shared claim context binding all models to the same document
        from app.services.claim_context import claim_context_service
        anomaly_details = cost_anomaly_service.evaluate_claim_cost(claim)
        has_cost_anomaly = anomaly_details.is_anomaly

        shared_context = claim_context_service.build_shared_context(
            claim=claim,
            ner_entities=ner_entities,
            cost_details=anomaly_details,
            provider_data=provider_data,
            claim_data=claim_data,
        )

        # Derive clean grouped medical information for auditor view (always execute deterministic grouping)
        ner_grouped_info = None
        try:
            from app.services.ner import ner_service
            ner_grouped_info = ner_service.group_medical_information(claim.original_text, ner_entities or [])
        except Exception as e:
            logger.debug(f"Failed to generate grouped medical information: {e}")

        NON_CLINICAL_WORDS = {
            "hospital", "clinic", "multispeciality", "institute", "center", "centre",
            "healthcare", "health", "system", "nursing", "department", "ward",
            "invoice", "bill", "prescription", "patient", "dr.", "doctor"
        }

        entity = claim.extracted_fields.entity
        valid_diags = [d for d in shared_context.diagnoses if len(d.strip()) >= 3 and not d.strip().isdigit() and d.lower() not in ("february", "january", "march", "no", "yes")]
        valid_meds = [m for m in shared_context.medicines if len(m.strip()) >= 3 and not m.strip().isdigit() and not re.search(r"\b\d+\s*days?\b", m, re.I)]
        valid_procs = [p for p in shared_context.procedures if len(p.strip()) >= 3 and not p.strip().isdigit()]

        is_generic_or_facility = bool(
            not entity
            or len(entity.strip()) <= 3
            or entity.strip().isdigit()
            or re.fullmatch(r"[\W\d_]+", entity.strip())
            or entity in ("Clinical Claim", "Patient", "Treatment", "Medical Record")
            or any(w in entity.lower() for w in NON_CLINICAL_WORDS)
            or (shared_context.hospital_name and entity.strip().lower() == shared_context.hospital_name.strip().lower())
            or (shared_context.patient_info and entity.strip().lower() == str(shared_context.patient_info.get("name", "")).strip().lower())
        )

        if target_medicine:
            entity = target_medicine
        elif is_generic_or_facility:
            if valid_meds:
                entity = valid_meds[0]
            elif valid_diags:
                entity = valid_diags[0]
            elif valid_procs:
                entity = valid_procs[0]

        outcome = claim.extracted_fields.effect_or_outcome or "None reported"

        # 1. Retrieve hybrid evidence passages (with scores and discard reasons)
        passages = self.retrieve_hybrid_passages(entity, claim.original_text, k=5)
        usable_passages = [p for p in passages if p.used_in_decision]

        # Clinical fallback: if primary entity retrieval yielded no usable passages, try top medicine or diagnosis
        if not usable_passages:
            fallback_candidates = [m for m in valid_meds if m.lower() != entity.lower()] + [d for d in valid_diags if d.lower() != entity.lower()]
            for alt in fallback_candidates:
                alt_passages = self.retrieve_hybrid_passages(alt, claim.original_text, k=3)
                alt_usable = [p for p in alt_passages if p.used_in_decision]
                if alt_usable:
                    usable_passages = alt_usable
                    existing_ids = {p.guideline_id for p in passages}
                    for ap in alt_passages:
                        if ap.guideline_id not in existing_ids:
                            passages.append(ap)
                    entity = alt
                    break

        shared_context.retrieved_passages_count = len(usable_passages)

        # 3. Model 3: DeBERTa NLI Cross-Examination with Strict Entity-Identity Validation Guard
        nli_result = None
        human_review_reasons: list[str] = []
        try:
            from app.services.nli import nli_service

            # STRICT ENTITY-IDENTITY VALIDATION GUARD
            # Ensure top guideline actually addresses the target claim entity
            verified_usable_passages: list[EvidencePassage] = []
            entity_words = [w for w in re.findall(r"[a-z]{3,}", entity.lower()) if w not in STOP_WORDS]
            clinical_claim_words = set(entity_words)
            for m in valid_meds:
                clinical_claim_words.update(re.findall(r"[a-z]{3,}", m.lower()))
            for d in valid_diags:
                clinical_claim_words.update(re.findall(r"[a-z]{3,}", d.lower()))
            clinical_claim_words = {w for w in clinical_claim_words if w not in STOP_WORDS}

            syns = set(clinical_claim_words)
            for w in clinical_claim_words:
                if w in CLINICAL_SYNONYMS:
                    syns.update(CLINICAL_SYNONYMS[w])

            for p in usable_passages:
                g_text = f"{p.title} {p.text}".lower()
                matches_entity = any(w in g_text for w in syns) if syns else True
                if matches_entity:
                    verified_usable_passages.append(p)
                else:
                    logger.warning(f"Entity-Identity Guard: Guideline '{p.title}' rejected for clinical entity '{entity}'.")
                    p.used_in_decision = False
                    p.discard_reason = f"Entity-Identity mismatch: Guideline does not cover target entity '{entity}'."

            # If guard rejected all, but we have valid_meds, try direct lookup with medicines
            if not verified_usable_passages and valid_meds:
                for med_alt in valid_meds:
                    alt_passages = self.retrieve_hybrid_passages(med_alt, claim.original_text, k=3)
                    for ap in alt_passages:
                        if ap.used_in_decision:
                            ag_text = f"{ap.title} {ap.text}".lower()
                            if any(w in ag_text for w in syns) or any(w in ag_text for w in re.findall(r"[a-z]{3,}", med_alt.lower())):
                                verified_usable_passages.append(ap)
                                if ap.guideline_id not in {p.guideline_id for p in passages}:
                                    passages.append(ap)
                    if verified_usable_passages:
                        break

            usable_passages = verified_usable_passages
            shared_context.retrieved_passages_count = len(usable_passages)

            # Map to backwards-compatible snippets from verified usable passages
            snippets = [
                EvidenceSnippet(
                    guideline_id=p.guideline_id or "UNKNOWN",
                    title=p.title,
                    source=p.source,
                    text=p.text,
                    relevance_score=p.relevance_score
                )
                for p in usable_passages
            ]

            if usable_passages:
                top_p = usable_passages[0]
                premise = top_p.text
                hypothesis = shared_context.clinical_statement or f"{entity}: {outcome if outcome != 'None reported' else claim.original_text}"
                nli_result = nli_service.predict(premise=premise, hypothesis=hypothesis)
                if nli_result.predicted_class == "contradiction":
                    human_review_reasons.append("Model 3 DeBERTa NLI detected clinical contradiction with guideline.")
                elif nli_result.requires_human_review:
                    human_review_reasons.append(f"Model 3 DeBERTa NLI confidence ({nli_result.confidence:.2f}) requires human review.")
        except Exception as nli_err:
            logger.error(f"Model 3 DeBERTa NLI evaluation error: {nli_err}", exc_info=True)

        if "snippets" not in locals():
            snippets = [
                EvidenceSnippet(
                    guideline_id=p.guideline_id or "UNKNOWN",
                    title=p.title,
                    source=p.source,
                    text=p.text,
                    relevance_score=p.relevance_score
                )
                for p in usable_passages
            ]

        # 4. Model 4: Provider-Level Anomaly Screening (Isolation Forest V3)
        provider_anomaly_res = None
        try:
            from app.services.provider_anomaly import provider_anomaly_service
            from app.services.storage import storage_service

            active_pdata = provider_data
            provider_id = (
                shared_context.provider_name
                or shared_context.hospital_name
                or (claim.location.normalized_key if getattr(claim, "location", None) else None)
            )
            # Reconstruct clipped provider identity or reject service terms
            if provider_id:
                if provider_id.lower().startswith("ee ") or provider_id.startswith("##"):
                    match_fac = re.search(
                        r"\b([A-Z][A-Za-z0-9&.,\s\-]+?(?:Institute|Hospital|Clinic|Center|Healthcare|Health System))\b",
                        claim.original_text or "",
                    )
                    if match_fac:
                        provider_id = match_fac.group(1).strip()
                    else:
                        provider_id = re.sub(r"^(?:ee|##)\s*", "", provider_id, flags=re.IGNORECASE).strip()
                elif "consultation" in provider_id.lower() and shared_context.hospital_name:
                    provider_id = shared_context.hospital_name
            claims_count = None
            insufficient_reason = None

            # Priority 2: Extract provider billing dossier from claim original text if not supplied explicitly
            if not active_pdata:
                extracted_pdata = provider_anomaly_service.extract_provider_history_from_text(claim.original_text)
                if extracted_pdata:
                    active_pdata = extracted_pdata
                    shared_context.provider_data_available = True
                    logger.info("Extracted structured provider billing history directly from claim audit text.")

            # Priority 3: Retrieve and aggregate genuine historical claims from storage
            # CRITICAL: Bypassed for outpatient prescriptions with no billed charges
            is_prescription_doc = any(
                w in (claim.original_text or "").lower()
                for w in ("prescription", "prescribed medicines", "rx", "apollo clinic", "one tablet", "take 1 tablet")
            ) and not getattr(claim.extracted_fields, "cost_range", None)

            if is_prescription_doc:
                insufficient_reason = "Outpatient prescription does not contain billed charges or fee claims. Provider anomaly screening is not applicable."
            elif not active_pdata and provider_id:
                try:
                    hist_claims = await storage_service.get_claims_by_provider(provider_id)
                    claims_count = len(hist_claims)
                    agg_data, agg_msg = provider_anomaly_service.aggregate_provider_claims(hist_claims, provider_id)
                    if agg_data:
                        active_pdata = agg_data
                        shared_context.provider_data_available = True
                        logger.info(f"Aggregated {claims_count} historical claims for provider '{provider_id}'")
                    else:
                        insufficient_reason = agg_msg
                except Exception as agg_err:
                    logger.debug(f"Historical provider claim aggregation skipped: {agg_err}")
                    logger.debug(f"Historical provider claim aggregation skipped: {agg_err}")

            provider_anomaly_res = provider_anomaly_service.evaluate_provider(
                provider_data=active_pdata,
                provider_name=provider_id,
                claims_count=claims_count,
                insufficient_reason=insufficient_reason,
            )
            if provider_anomaly_res and provider_anomaly_res.is_anomaly:
                human_review_reasons.append("Model 4 Provider Anomaly screening detected unusual provider billing pattern.")
        except Exception as p_err:
            logger.debug(f"Model 4 Provider Anomaly skipped or failed: {p_err}")

        # 5. Model 5: Claim-Level Anomaly Screening (Isolation Forest V3 Strict + V4-A)
        claim_anomaly_res = None
        try:
            from app.services.claim_anomaly import claim_anomaly_service
            claim_anomaly_res = claim_anomaly_service.evaluate_claim(
                claim_data=claim_data,
                claim=claim,
                cost_details=anomaly_details,
                ner_entities=ner_entities,
            )
            if claim_anomaly_res and claim_anomaly_res.is_anomaly:
                human_review_reasons.append("Model 5 Claim Anomaly screening detected unusual utilization/stay pattern.")
        except Exception as c_err:
            logger.debug(f"Model 5 Claim Anomaly skipped or failed: {c_err}")

        # 6. Preserved Model 5: Medicine Substitution (if medicine entity present)
        medicine_res = None
        try:
            from app.services.medicine_service import medicine_service
            if target_medicine and entity:
                medicine_res = medicine_service.match_medicines(entity, target_medicine)
        except Exception as m_err:
            logger.debug(f"Medicine Matcher skipped or failed: {m_err}")

        # 7. Dedicated Claim-Level Billing Reconciliation (Invoice Arithmetic & Line Item Audit)
        billing_rec_res = None
        try:
            from app.services.billing_reconciliation import billing_reconciliation_service
            from app.models.schemas import BillingClassification
            billing_rec_res = billing_reconciliation_service.reconcile_claim_billing(
                claim=claim,
                text=claim.original_text
            )
            if billing_rec_res:
                if billing_rec_res.classification == BillingClassification.POSSIBLE_DUPLICATE:
                    human_review_reasons.append(
                        f"Billing integrity check identified {len(billing_rec_res.duplicates)} potential duplicate line item(s)."
                    )
                elif billing_rec_res.classification == BillingClassification.POTENTIAL_OVERLAP_REQUIRES_REVIEW:
                    human_review_reasons.append(
                        f"Billing integrity check flagged {len(billing_rec_res.overlaps)} potentially overlapping charge(s) (policy-dependent bundling)."
                    )
                elif billing_rec_res.classification == BillingClassification.TOTAL_MISMATCH:
                    diff_val = abs(billing_rec_res.difference or 0.0)
                    if diff_val >= 1.0:
                        human_review_reasons.append(
                            f"Invoice arithmetic discrepancy: unexplained difference of ₹{diff_val:,.2f} between itemized sum and stated total."
                        )
        except Exception as b_err:
            logger.debug(f"Billing Reconciliation skipped or failed: {b_err}")

        # 8. Pre-evaluation Abstention Check (before querying LLM)
        pre_abstention = abstention_service.evaluate(
            claim=claim,
            passages=passages,
            cost_details=anomaly_details
        )

        if pre_abstention.should_abstain:
            logger.info(f"Claim {claim.claim_id}: Abstention triggered before LLM execution [{pre_abstention.rule_triggered.value}]: {pre_abstention.reason}")
            human_review_reasons.append(f"Abstention triggered: {pre_abstention.reason}")
            synthesis = claim_context_service.synthesize_cross_model(
                shared_context=shared_context,
                ner_entities=ner_entities,
                retrieval_passages=usable_passages,
                nli_result=nli_result,
                provider_anomaly=provider_anomaly_res,
                claim_anomaly=claim_anomaly_res,
                cost_details=anomaly_details,
                medicine_sub=medicine_res,
                final_verdict=VerificationVerdict.INSUFFICIENT_EVIDENCE,
                final_action=VerificationAction.ABSTAIN,
                human_review_reasons=human_review_reasons,
            )
            verification = VerificationResult(
                claim_id=claim.claim_id,
                support_score=0.0,
                verdict=VerificationVerdict.INSUFFICIENT_EVIDENCE,
                action=VerificationAction.ABSTAIN,
                reasoning=f"System abstained from judgment: {pre_abstention.reason}",
                evidence_snippets=snippets,
                passages_considered=passages,
                cost_anomaly_flag=has_cost_anomaly,
                anomaly_details=anomaly_details,
                location=claim.location,
                abstain_reason=pre_abstention.reason,
                verified_at=datetime.now(timezone.utc),
                ner_entities=ner_entities,
                ner_grouped_info=ner_grouped_info,
                nli_result=nli_result,
                provider_anomaly=provider_anomaly_res,
                claim_anomaly=claim_anomaly_res,
                medicine_substitution=medicine_res,
                billing_reconciliation=billing_rec_res,
                shared_context=shared_context,
                synthesis=synthesis,
                requires_human_review=True,
                human_review_reasons=human_review_reasons,
            )

            # Record full audit trail
            audit_trail = audit_service.record_full_audit(
                claim=claim,
                verification=verification,
                passages=passages,
                cost_details=anomaly_details,
                abstention_decision=pre_abstention,
                raw_model_verdict=None,
                raw_model_support_score=0.0,
                raw_model_reasoning=None,
                raw_conflict_assessment=None,
            )
            verification.audit_trail_id = audit_trail.audit_id

            try:
                await audit_service.save_audit_trail(audit_trail)
            except Exception as e:
                logger.warning(f"Failed to persist audit trail: {e}")

            return verification

        # 8. Formulate prompt for LLM or evaluate via Model 3 DeBERTa NLI
        passages_text = "\n\n".join(
            f"[Passage ID: {passage.passage_id}] Guideline: {passage.title} "
            f"({passage.source})\nText: {passage.text}"
            for passage in usable_passages
        )

        user_prompt = (
            f"{VERIFICATION_SYSTEM_PROMPT}\n\n"
            f"CLAIM TO EVALUATE:\n"
            f"- Entity: {entity}\n"
            f"- Reported Outcome: {outcome}\n"
            f"- Source Type: {claim.source_type}\n"
            f"- Verbatim Text: \"\"\"{claim.original_text.strip()}\"\"\"\n\n"
            f"AUTHORITATIVE EVIDENCE PASSAGES:\n{passages_text}\n\n"
            f"AUDIT JSON OUTPUT:"
        )

        raw_verdict = None
        raw_support_score = 0.50
        raw_reasoning = ""
        conflict_assessment = None

        # 9. Call configured LLM (Gemini or Ollama), with safe DeBERTa NLI fallback
        try:
            if self.provider == "gemini":
                raw_response = await self._call_gemini_verification(user_prompt)
            else:
                raw_response = await self._call_ollama_verification(user_prompt)
            raw_verdict, raw_support_score, raw_reasoning, conflict_assessment = (
                self._parse_verification_response(raw_response)
            )
        except Exception as llm_err:
            logger.info(f"LLM verification unavailable ({llm_err}); evaluating verdict via Model 3 DeBERTa NLI.")
            if not usable_passages:
                raw_verdict = VerificationVerdict.INSUFFICIENT_EVIDENCE
                raw_support_score = 0.30
                raw_reasoning = f"No authoritative clinical guideline found in knowledge base directly addressing '{entity}'. Inpatient or outpatient verification deferred due to insufficient grounded evidence."
            elif nli_result:
                if nli_result.predicted_class == "entailment":
                    raw_verdict = VerificationVerdict.SUPPORTED
                    raw_support_score = max(0.70, nli_result.confidence)
                    raw_reasoning = f"Corroborated by guideline '{usable_passages[0].title}' via DeBERTa NLI ({nli_result.confidence:.1%} confidence)."
                elif nli_result.predicted_class == "contradiction":
                    raw_verdict = VerificationVerdict.CONTRADICTED
                    raw_support_score = 0.15
                    raw_reasoning = f"Contradicted by guideline '{usable_passages[0].title}' via DeBERTa NLI ({nli_result.confidence:.1%} confidence)."
                else:
                    raw_verdict = VerificationVerdict.PARTIALLY_SUPPORTED
                    raw_support_score = 0.50
                    raw_reasoning = f"Neutral evidence correlation with guideline '{usable_passages[0].title}' via DeBERTa NLI."
            else:
                raw_verdict = VerificationVerdict.PARTIALLY_SUPPORTED
                raw_support_score = 0.50
                raw_reasoning = f"Retrieved {len(usable_passages)} relevant passages for '{entity}'; LLM evaluation skipped."

        # 10. If Model 3 NLI found contradiction, ensure contradiction is flagged
        if nli_result and nli_result.predicted_class == "contradiction" and raw_verdict != VerificationVerdict.CONTRADICTED:
            logger.info(f"Model 3 DeBERTa NLI flagged contradiction; updating verdict for claim {claim.claim_id}")
            raw_verdict = VerificationVerdict.CONTRADICTED
            raw_support_score = min(raw_support_score, 0.25)
            raw_reasoning += " [DeBERTa NLI: Clinical Contradiction detected]"

        # 11. Post-evaluation Abstention Check
        post_abstention = abstention_service.evaluate(
            claim=claim,
            passages=passages,
            cost_details=anomaly_details,
            model_verdict=raw_verdict,
            model_support_score=raw_support_score,
            model_reasoning=raw_reasoning,
            model_conflict_assessment=conflict_assessment
        )

        if post_abstention.should_abstain:
            final_verdict = VerificationVerdict.INSUFFICIENT_EVIDENCE
            final_action = VerificationAction.ABSTAIN
            final_support_score = 0.0
            final_abstain_reason = post_abstention.reason
            human_review_reasons.append(f"Post-evaluation abstention: {post_abstention.reason}")
        else:
            final_action, final_abstain_reason = self._determine_action(
                raw_verdict,
                raw_support_score,
                has_cost_anomaly,
                billing_rec=billing_rec_res,
                provider_anomaly=provider_anomaly_res,
                claim_anomaly=claim_anomaly_res,
                has_review_reasons=bool(human_review_reasons),
            )
            final_verdict = raw_verdict
            final_support_score = raw_support_score

        if has_cost_anomaly:
            human_review_reasons.append(f"Price anomaly detected: {anomaly_details.severity or 'elevated'} cost markup ({anomaly_details.multiplier:.1f}x benchmark).")

        requires_review = bool(
            human_review_reasons
            or final_action in (VerificationAction.FLAG, VerificationAction.ABSTAIN)
            or (nli_result and nli_result.requires_human_review)
            or (provider_anomaly_res and provider_anomaly_res.is_anomaly)
            or (claim_anomaly_res and claim_anomaly_res.is_anomaly)
        )

        synthesis = claim_context_service.synthesize_cross_model(
            shared_context=shared_context,
            ner_entities=ner_entities,
            retrieval_passages=usable_passages,
            nli_result=nli_result,
            provider_anomaly=provider_anomaly_res,
            claim_anomaly=claim_anomaly_res,
            cost_details=anomaly_details,
            medicine_sub=medicine_res,
            final_verdict=final_verdict,
            final_action=final_action,
            human_review_reasons=human_review_reasons,
        )

        verification = VerificationResult(
            claim_id=claim.claim_id,
            support_score=final_support_score,
            verdict=final_verdict,
            action=final_action,
            reasoning=raw_reasoning,
            evidence_snippets=snippets,
            passages_considered=passages,
            cost_anomaly_flag=has_cost_anomaly,
            anomaly_details=anomaly_details,
            location=claim.location,
            abstain_reason=final_abstain_reason,
            verified_at=datetime.now(timezone.utc),
            ner_entities=ner_entities,
            ner_grouped_info=ner_grouped_info,
            nli_result=nli_result,
            provider_anomaly=provider_anomaly_res,
            claim_anomaly=claim_anomaly_res,
            medicine_substitution=medicine_res,
            billing_reconciliation=billing_rec_res,
            shared_context=shared_context,
            synthesis=synthesis,
            requires_human_review=requires_review,
            human_review_reasons=human_review_reasons,
        )

        # 12. Record and persist complete AuditTrail
        audit_trail = audit_service.record_full_audit(
            claim=claim,
            verification=verification,
            passages=passages,
            cost_details=anomaly_details,
            abstention_decision=post_abstention,
            raw_model_verdict=raw_verdict,
            raw_model_support_score=raw_support_score,
            raw_model_reasoning=raw_reasoning,
            raw_conflict_assessment=conflict_assessment,
        )
        verification.audit_trail_id = audit_trail.audit_id

        try:
            await audit_service.save_audit_trail(audit_trail)
        except Exception as e:
            logger.warning(f"Failed to persist audit trail: {e}")

        return verification

    async def _call_gemini_verification(self, prompt: str) -> str:
        """Call Google Gemini API for clinical verification judgment."""
        import os
        if os.getenv("TESTING") or os.getenv("PYTEST_CURRENT_TEST"):
            raise GeminiConnectionError("Test environment active: skipping external Gemini network call.")

        if not self.gemini_api_key or not self.gemini_api_key.strip():
            msg = "GEMINI_API_KEY is not configured or missing."
            logger.error(msg)
            raise GeminiConnectionError(msg)

        logger.info(f"Calling Gemini model '{self.gemini_model}' for clinical verification")
        url = f"{self.gemini_base_url}/models/{self.gemini_model}:generateContent"
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": self.gemini_api_key,
        }
        payload = {
            "contents": [
                {
                    "parts": [{"text": prompt}]
                }
            ],
            "generationConfig": {
                "temperature": 0.0,
                "responseMimeType": "application/json",
            },
        }

        try:
            timeout_cfg = httpx.Timeout(self.gemini_timeout, connect=5.0)
            async with httpx.AsyncClient(timeout=timeout_cfg) as client:
                resp = await client.post(url, headers=headers, json=payload)
                if resp.status_code != 200:
                    if resp.status_code in (401, 403):
                        raise GeminiConnectionError(f"Gemini API authentication failed (HTTP {resp.status_code}). Check GEMINI_API_KEY.")
                    raise ExtractionError(f"Gemini API returned HTTP {resp.status_code}: {resp.text}")

                data = resp.json()
                candidates = data.get("candidates", [])
                if not candidates:
                    raise ExtractionError("Gemini API returned 0 candidate completions for verification.")

                parts = candidates[0].get("content", {}).get("parts", [])
                if not parts or "text" not in parts[0]:
                    raise ExtractionError("Gemini API candidate missing text content.")

                return parts[0]["text"]
        except (GeminiConnectionError, ExtractionError):
            raise
        except httpx.ConnectError as e:
            logger.error(f"Cannot reach Gemini API for verification: {e}")
            raise GeminiConnectionError(f"Gemini API unreachable at {self.gemini_base_url}: {e}") from e
        except httpx.TimeoutException as e:
            logger.error(f"Gemini verification request timed out: {e}")
            raise ExtractionError(f"Gemini verification request timed out after {self.gemini_timeout}s.") from e
        except Exception as e:
            logger.error(f"Verification request failed: {e}")
            raise ExtractionError(f"Verification service error: {e}")

    async def _call_ollama_verification(self, prompt: str) -> str:
        """Call Ollama /api/generate for clinical verification judgment."""
        logger.info(f"Calling Ollama model '{self.model}' for clinical verification")
        payload = {
            "model": self.model,
            "prompt": prompt,
            "format": "json",
            "stream": False,
            "options": {
                "temperature": 0.0,
                "top_p": 0.9,
            },
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(f"{self.base_url}/api/generate", json=payload)
                if resp.status_code != 200:
                    raise ExtractionError(f"Ollama returned HTTP {resp.status_code}: {resp.text}")
                data = resp.json()
                return data.get("response", "")
        except httpx.ConnectError as e:
            logger.error(f"Cannot reach Ollama for verification: {e}")
            raise OllamaConnectionError(f"Ollama LLM unreachable at {self.base_url}: {e}") from e
        except httpx.TimeoutException as e:
            logger.error(f"Ollama verification request timed out: {e}")
            raise ExtractionError(f"Ollama request timed out after {self.timeout}s.") from e
        except Exception as e:
            logger.error(f"Verification request failed: {e}")
            raise ExtractionError(f"Verification service error: {e}")

    def _parse_verification_response(
        self,
        raw_text: str
    ) -> tuple[VerificationVerdict, float, str, Optional[dict[str, Any]]]:
        """Parse the verdict, support score, reasoning, and optional conflict assessment."""
        cleaned = raw_text.strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
            cleaned = re.sub(r"\s*```$", "", cleaned)

        parsed: Optional[dict[str, Any]] = None
        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", cleaned, re.DOTALL)
            if match:
                try:
                    parsed = json.loads(match.group(0))
                except json.JSONDecodeError:
                    pass

        if not parsed or not isinstance(parsed, dict):
            logger.warning(f"Failed to parse JSON from verification output: {raw_text[:200]}")
            return (
                VerificationVerdict.PARTIALLY_SUPPORTED,
                0.50,
                "Verification output was non-standard; assigned default partially supported verdict.",
                None
            )

        verdict_str = str(parsed.get("verdict") or "partially_supported").lower().strip()
        if verdict_str in [v.value for v in VerificationVerdict]:
            verdict = VerificationVerdict(verdict_str)
        else:
            verdict = VerificationVerdict.PARTIALLY_SUPPORTED

        score_val = parsed.get("support_score")
        try:
            score = float(score_val)
            score = max(0.0, min(1.0, round(score, 3)))
        except (TypeError, ValueError):
            defaults = {
                VerificationVerdict.SUPPORTED: 0.85,
                VerificationVerdict.PARTIALLY_SUPPORTED: 0.55,
                VerificationVerdict.CONTRADICTED: 0.15,
                VerificationVerdict.INSUFFICIENT_EVIDENCE: 0.10,
            }
            score = defaults.get(verdict, 0.50)

        reasoning = str(parsed.get("reasoning") or "Evidence evaluated against clinical guidelines.").strip()
        conflict_assessment = parsed.get("conflict_assessment")
        if not isinstance(conflict_assessment, dict):
            conflict_assessment = None
        return verdict, score, reasoning, conflict_assessment

    def _parse_verification_output(
        self,
        raw_text: str
    ) -> tuple[VerificationVerdict, float, str]:
        """Backward-compatible parser for the public verdict fields."""
        verdict, score, reasoning, _ = self._parse_verification_response(raw_text)
        return verdict, score, reasoning

    def _determine_action(
        self,
        verdict: VerificationVerdict,
        support_score: float,
        has_cost_anomaly: bool,
        billing_rec: Optional[Any] = None,
        provider_anomaly: Optional[Any] = None,
        claim_anomaly: Optional[Any] = None,
        has_review_reasons: bool = False,
    ) -> tuple[VerificationAction, Optional[str]]:
        """
        Synthesize verdict, support score, cost anomaly flag, billing reconciliation,
        provider anomaly, and claim anomaly into an actionable decision.
        """
        # 1. Contradiction is a decisive finding -> FLAG
        if verdict == VerificationVerdict.CONTRADICTED:
            return (
                VerificationAction.FLAG,
                None
            )

        # 2. If evidence is insufficient or support is below floor -> Abstain
        if verdict == VerificationVerdict.INSUFFICIENT_EVIDENCE or support_score < 0.25:
            return (
                VerificationAction.ABSTAIN,
                "Support score or guideline relevance is below required threshold to formulate a decisive judgment."
            )

        # 3. Cost Anomaly -> Flag for human review
        if has_cost_anomaly:
            return (
                VerificationAction.FLAG,
                None
            )

        # 4. Billing Reconciliation Issues (Arithmetic mismatch, duplicates, overlaps) -> Flag for human review
        if billing_rec:
            status = getattr(billing_rec, "classification", None) or getattr(billing_rec, "reconciliation_status", None)
            from app.models.schemas import BillingClassification
            if status in (
                BillingClassification.TOTAL_MISMATCH,
                BillingClassification.POSSIBLE_DUPLICATE,
                BillingClassification.POTENTIAL_OVERLAP_REQUIRES_REVIEW,
            ):
                diff = abs(getattr(billing_rec, "difference", 0.0) or 0.0)
                if status == BillingClassification.TOTAL_MISMATCH and diff >= 1.0:
                    return (
                        VerificationAction.FLAG,
                        f"Invoice arithmetic discrepancy: unexplained difference of ₹{diff:,.2f} between itemized sum and stated total."
                    )
                elif status in (BillingClassification.POSSIBLE_DUPLICATE, BillingClassification.POTENTIAL_OVERLAP_REQUIRES_REVIEW):
                    return (
                        VerificationAction.FLAG,
                        f"Billing integrity review required: {status.value if hasattr(status, 'value') else status}."
                    )

        # 5. Claim Anomaly or Provider Anomaly -> Flag
        if (claim_anomaly and getattr(claim_anomaly, "is_anomaly", False)) or (provider_anomaly and getattr(provider_anomaly, "is_anomaly", False)):
            return (
                VerificationAction.FLAG,
                None
            )

        # 6. Explicit human review triggers -> Flag
        if verdict == VerificationVerdict.PARTIALLY_SUPPORTED or has_review_reasons:
            return (
                VerificationAction.FLAG,
                None
            )

        # 7. Cleanly supported with fair pricing, verified billing, and no anomalies -> Accept
        if verdict == VerificationVerdict.SUPPORTED and support_score >= 0.70 and not has_cost_anomaly:
            return (
                VerificationAction.ACCEPT,
                None
            )

        return (
            VerificationAction.FLAG,
            None
        )


verification_service = VerificationService()
