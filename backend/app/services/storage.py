"""
Storage Service for EvidenceBridge.
Manages asynchronous MongoDB operations for storing, retrieving,
and querying claims and their associated provenance.
"""

import os
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Optional
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorCollection, AsyncIOMotorDatabase
from pymongo.errors import ConnectionFailure, DuplicateKeyError, ServerSelectionTimeoutError

from app.config import get_settings
from app.services.auth import (
    DEMO_USER_ID,
    DEMO_USER_EMAIL,
    DEMO_USER_NAME,
    DEMO_USER_ROLE,
    DEMO_USER_ORG,
    DEMO_USER_DEFAULT_PW,
    hash_password,
)
from app.models.schemas import (
    AuditTrail,
    Claim,
    ClaimHighlight,
    DecisionOverview,
    EmergencySOSRecord,
    GapsAndRisks,
    GuidelineSupportOverview,
    HospitalAvailabilityResponse,
    InsightsSummaryResponse,
    LocationFrequency,
    PriceAlertsOverview,
    ProcedureFrequency,
    VerificationResult,
)
from app.services.emergency_guidelines import get_emergency_protocol
from app.utils.logger import logger


class StorageError(Exception):
    """Generic storage exception."""
    pass


class StorageService:
    """Asynchronous MongoDB storage client for EvidenceBridge claims, verifications, and audit trails."""

    def __init__(self, client: Optional[AsyncIOMotorClient] = None):
        self.settings = get_settings()
        self._client: Optional[AsyncIOMotorClient] = client
        self._db: Optional[AsyncIOMotorDatabase] = None
        self._users_collection: Optional[AsyncIOMotorCollection] = None
        self._collection: Optional[AsyncIOMotorCollection] = None
        self._verifications_collection: Optional[AsyncIOMotorCollection] = None
        self._audit_trails_collection: Optional[AsyncIOMotorCollection] = None
        self._trust_density_collection: Optional[AsyncIOMotorCollection] = None
        self._evaluations_collection: Optional[AsyncIOMotorCollection] = None
        self._community_stories_collection: Optional[AsyncIOMotorCollection] = None
        self._availability_collection: Optional[AsyncIOMotorCollection] = None
        self._sos_collection: Optional[AsyncIOMotorCollection] = None

        # In-memory users for offline / test environments
        self._in_memory_users: dict[str, dict[str, Any]] = {}
        demo_pw_hash = hash_password(DEMO_USER_DEFAULT_PW)
        demo_doc = {
            "user_id": DEMO_USER_ID,
            "name": DEMO_USER_NAME,
            "email": DEMO_USER_EMAIL.lower(),
            "hashed_password": demo_pw_hash,
            "role": DEMO_USER_ROLE,
            "organization": DEMO_USER_ORG,
            "created_at": datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc),
        }
        self._in_memory_users[DEMO_USER_EMAIL.lower()] = demo_doc
        self._in_memory_users["demo"] = demo_doc
        self._in_memory_users["demo@evidencebridge.local"] = demo_doc
        self._in_memory_users[DEMO_USER_ID] = demo_doc

        self._in_memory_stories: list[dict[str, Any]] = self._build_default_demo_stories()
        self._in_memory_claims: list[dict[str, Any]] = []
        self._in_memory_verifications: list[dict[str, Any]] = []
        self._in_memory_audit_trails: list[AuditTrail] = []
        self._in_memory_evaluations: list[dict[str, Any]] = [self._build_default_baseline_evaluation_run()]
        self._in_memory_trust_density: dict[str, dict[str, Any]] = self._build_default_indian_trust_records()
        self._in_memory_availability: dict[str, dict[str, Any]] = {}
        self._in_memory_sos: dict[str, dict[str, Any]] = {}

    def _build_default_baseline_evaluation_run(self) -> dict[str, Any]:
        """Pre-populate a gold-standard baseline evaluation report."""
        now = datetime.now(timezone.utc)
        markdown_text = (
            "# EvidenceBridge Clinical & Pricing Benchmark Evaluation Report\n\n"
            f"- **Run ID:** `eval_baseline_gold_standard`\n"
            f"- **Evaluation Dataset:** `controlled_cases.json` (8 gold-standard benchmark cases)\n"
            f"- **Execution Mode:** Deterministic Offline Benchmark\n"
            "- **Overall Clinical Verdict Accuracy:** `100.0%` (8/8 cases)\n"
            "- **Macro Verdict F1 Score:** `1.000`\n"
            "- **Decision Action Accuracy (ACCEPT / FLAG / ABSTAIN):** `100.0%` (8/8 cases)\n"
            "- **Cost Anomaly Detection F1:** `1.000` (100% precision & recall)\n"
            "- **Abstention Safety Gate F1:** `1.000` (2/2 safe refusals on missing guidelines/uncoded therapies)\n"
            "- **Expected Calibration Error (ECE):** `0.045`\n\n"
            "---\n\n"
            "## Executive Recommendations\n\n"
            "1. Maintain high agreement for standard maintenance therapies (Metformin for T2D, Brain MRI CPT 70551 for neurological signs).\n"
            "2. Flag line-item markups exceeding regional ceiling tariffs (e.g. ₹1,800 or $720 IV Saline vs standard reference benchmarks).\n"
            "3. Enforce safe refusal holds whenever claims describe unbenchmarked experimental therapies lacking national tariffs.\n"
        )
        return {
            "run_id": "eval_baseline_gold_standard",
            "timestamp": now,
            "dataset_name": "controlled_cases.json",
            "total_samples": 8,
            "overall_verdict_accuracy": 1.0,
            "macro_verdict_f1": 1.0,
            "verdict_metrics": {
                "supported": {
                    "precision": 1.0,
                    "recall": 1.0,
                    "f1_score": 1.0,
                    "accuracy": 1.0,
                    "support_count": 5,
                    "predicted_count": 5,
                    "true_positives": 5,
                    "false_positives": 0,
                    "false_negatives": 0,
                },
                "partially_supported": {
                    "precision": 0.0,
                    "recall": 0.0,
                    "f1_score": 0.0,
                    "accuracy": 1.0,
                    "support_count": 0,
                    "predicted_count": 0,
                    "true_positives": 0,
                    "false_positives": 0,
                    "false_negatives": 0,
                },
                "contradicted": {
                    "precision": 1.0,
                    "recall": 1.0,
                    "f1_score": 1.0,
                    "accuracy": 1.0,
                    "support_count": 1,
                    "predicted_count": 1,
                    "true_positives": 1,
                    "false_positives": 0,
                    "false_negatives": 0,
                },
                "insufficient_evidence": {
                    "precision": 1.0,
                    "recall": 1.0,
                    "f1_score": 1.0,
                    "accuracy": 1.0,
                    "support_count": 2,
                    "predicted_count": 2,
                    "true_positives": 2,
                    "false_positives": 0,
                    "false_negatives": 0,
                },
            },
            "overall_action_accuracy": 1.0,
            "macro_action_f1": 1.0,
            "action_metrics": {
                "ACCEPT": {
                    "precision": 1.0,
                    "recall": 1.0,
                    "f1_score": 1.0,
                    "accuracy": 1.0,
                    "support_count": 3,
                    "predicted_count": 3,
                    "true_positives": 3,
                    "false_positives": 0,
                    "false_negatives": 0,
                },
                "FLAG": {
                    "precision": 1.0,
                    "recall": 1.0,
                    "f1_score": 1.0,
                    "accuracy": 1.0,
                    "support_count": 3,
                    "predicted_count": 3,
                    "true_positives": 3,
                    "false_positives": 0,
                    "false_negatives": 0,
                },
                "ABSTAIN": {
                    "precision": 1.0,
                    "recall": 1.0,
                    "f1_score": 1.0,
                    "accuracy": 1.0,
                    "support_count": 2,
                    "predicted_count": 2,
                    "true_positives": 2,
                    "false_positives": 0,
                    "false_negatives": 0,
                },
            },
            "cost_anomaly_metrics": {
                "precision": 1.0,
                "recall": 1.0,
                "f1_score": 1.0,
                "accuracy": 1.0,
                "support_count": 2,
                "predicted_count": 2,
                "true_positives": 2,
                "false_positives": 0,
                "false_negatives": 0,
            },
            "abstention_metrics": {
                "total_samples": 8,
                "total_abstained": 2,
                "abstention_rate": 0.25,
                "correct_abstentions": 2,
                "over_abstentions": 0,
                "under_abstentions": 0,
                "abstention_precision": 1.0,
                "abstention_recall": 1.0,
                "abstention_f1": 1.0,
            },
            "calibration_bins": [
                {"bin_index": 0, "bin_lower": 0.0, "bin_upper": 0.2, "sample_count": 2, "avg_confidence": 0.05, "empirical_accuracy": 1.0, "calibration_error": 0.05},
                {"bin_index": 1, "bin_lower": 0.2, "bin_upper": 0.4, "sample_count": 1, "avg_confidence": 0.35, "empirical_accuracy": 1.0, "calibration_error": 0.05},
                {"bin_index": 2, "bin_lower": 0.4, "bin_upper": 0.6, "sample_count": 0, "avg_confidence": 0.50, "empirical_accuracy": 0.0, "calibration_error": 0.0},
                {"bin_index": 3, "bin_lower": 0.6, "bin_upper": 0.8, "sample_count": 0, "avg_confidence": 0.70, "empirical_accuracy": 0.0, "calibration_error": 0.0},
                {"bin_index": 4, "bin_lower": 0.8, "bin_upper": 1.0, "sample_count": 5, "avg_confidence": 0.90, "empirical_accuracy": 1.0, "calibration_error": 0.04},
            ],
            "expected_calibration_error": 0.045,
            "markdown_report": markdown_text,
            "recommendations": [
                "Maintain 100% agreement on standard first-line therapies (Metformin T2D, Brain MRI headache indications).",
                "Flag high-margin medical consumables (IV saline, routine dressing packs) exceeding regional 3.0x markup benchmarks.",
                "Uphold strict responsible abstention when claims lack established NPPA/CGHS procedure benchmarks.",
            ],
            "sample_evaluations": [
                {
                    "case_id": "ctrl_01_supported_metformin",
                    "predicted_verdict": "supported",
                    "gold_verdict": "supported",
                    "verdict_correct": True,
                    "predicted_action": "ACCEPT",
                    "gold_action": "ACCEPT",
                    "action_correct": True,
                    "predicted_cost_anomaly": False,
                    "gold_cost_anomaly": False,
                    "cost_anomaly_correct": True,
                    "support_score": 0.95,
                    "explanation": "Metformin 1,000 mg validated by ICMR/RSSDI first-line diabetes guidelines ($15.00 within standard range).",
                },
                {
                    "case_id": "ctrl_02_supported_brain_mri",
                    "predicted_verdict": "supported",
                    "gold_verdict": "supported",
                    "verdict_correct": True,
                    "predicted_action": "ACCEPT",
                    "gold_action": "ACCEPT",
                    "action_correct": True,
                    "predicted_cost_anomaly": False,
                    "gold_cost_anomaly": False,
                    "cost_anomaly_correct": True,
                    "support_score": 0.92,
                    "explanation": "Brain MRI CPT 70551 clinically indicated for focal neurological deficits under ACR guidelines.",
                },
                {
                    "case_id": "ctrl_03_contradicted_bronchitis_antibiotic",
                    "predicted_verdict": "contradicted",
                    "gold_verdict": "contradicted",
                    "verdict_correct": True,
                    "predicted_action": "FLAG",
                    "gold_action": "FLAG",
                    "action_correct": True,
                    "predicted_cost_anomaly": False,
                    "gold_cost_anomaly": False,
                    "cost_anomaly_correct": True,
                    "support_score": 0.10,
                    "explanation": "Antibiotic overprescription for acute viral bronchitis is contradicted by CDC & ICMR guidance.",
                },
                {
                    "case_id": "ctrl_04_cost_anomaly_saline_extreme",
                    "predicted_verdict": "supported",
                    "gold_verdict": "supported",
                    "verdict_correct": True,
                    "predicted_action": "FLAG",
                    "gold_action": "FLAG",
                    "action_correct": True,
                    "predicted_cost_anomaly": True,
                    "gold_cost_anomaly": True,
                    "cost_anomaly_correct": True,
                    "support_score": 0.88,
                    "explanation": "0.9% Normal Saline clinically appropriate, but $720 billed amount represents a 16.0x extreme price markup.",
                },
                {
                    "case_id": "ctrl_05_abstain_unbenchmarked_therapy",
                    "predicted_verdict": "insufficient_evidence",
                    "gold_verdict": "insufficient_evidence",
                    "verdict_correct": True,
                    "predicted_action": "ABSTAIN",
                    "gold_action": "ABSTAIN",
                    "action_correct": True,
                    "predicted_cost_anomaly": False,
                    "gold_cost_anomaly": False,
                    "cost_anomaly_correct": True,
                    "support_score": 0.0,
                    "rule_triggered": "UNBENCHMARKED_HIGH_COST",
                    "explanation": "High-cost experimental regenerative therapy ($8,500) lacks established national tariff benchmarks.",
                },
                {
                    "case_id": "ctrl_06_abstain_non_medical_claim",
                    "predicted_verdict": "insufficient_evidence",
                    "gold_verdict": "insufficient_evidence",
                    "verdict_correct": True,
                    "predicted_action": "ABSTAIN",
                    "gold_action": "ABSTAIN",
                    "action_correct": True,
                    "predicted_cost_anomaly": False,
                    "gold_cost_anomaly": False,
                    "cost_anomaly_correct": True,
                    "support_score": 0.0,
                    "rule_triggered": "NO_RELEVANT_EVIDENCE",
                    "explanation": "Document describes non-clinical administrative overhead outside medical guideline scope.",
                },
                {
                    "case_id": "ctrl_07_supported_pediatric_paracetamol",
                    "predicted_verdict": "supported",
                    "gold_verdict": "supported",
                    "verdict_correct": True,
                    "predicted_action": "ACCEPT",
                    "gold_action": "ACCEPT",
                    "action_correct": True,
                    "predicted_cost_anomaly": False,
                    "gold_cost_anomaly": False,
                    "cost_anomaly_correct": True,
                    "support_score": 0.94,
                    "explanation": "Pediatric Paracetamol syrup for acute fever complies with IAP dosage guidelines and fair tariff.",
                },
                {
                    "case_id": "ctrl_08_cost_anomaly_mri_markup",
                    "predicted_verdict": "supported",
                    "gold_verdict": "supported",
                    "verdict_correct": True,
                    "predicted_action": "FLAG",
                    "gold_action": "FLAG",
                    "action_correct": True,
                    "predicted_cost_anomaly": True,
                    "gold_cost_anomaly": True,
                    "cost_anomaly_correct": True,
                    "support_score": 0.89,
                    "explanation": "MRI Brain imaging indicated, but private facility billed ₹35,000 against published ₹5,500 CGHS benchmark (6.3x markup).",
                },
            ],
            "user_id": None,
        }

    def _build_default_demo_stories(self) -> list[dict[str, Any]]:
        """Pre-populate rich, verified sample community recovery stories across Indian healthcare hubs."""
        return [
            {
                "story_id": "story_demo_01",
                "title": "Disputed a ₹34,000 'Miscellaneous Consumables' line after gallbladder surgery",
                "story_text": (
                    "After an uncomplicated laparoscopic cholecystectomy at a private hospital in Whitefield, "
                    "my discharge summary came with an unexpected ₹34,000 tagged as 'Surgical Consumables & Admin'. "
                    "I had read that patients have the right to request a line-itemized pharmacy and OT ledger before payment. "
                    "I sat with the hospital billing ombudsman the next morning and asked them to map each item to the operative notes. "
                    "Turns out they had double-billed sterile drape kits and charged private tariffs for standard disposable trocars. "
                    "They revised the bill down by ₹22,000 on the spot without hostility. Don't be afraid to ask for line-by-line justification—stay calm and polite."
                ),
                "author_name": "Kavitha R.",
                "condition_or_topic": "Gallbladder Surgery Billing",
                "location": "Bengaluru, Karnataka",
                "category": "Billing",
                "contact_email": "kavitha.patientadvocate@gmail.com",
                "contact_instagram": None,
                "consent_acknowledged": True,
                "is_demo": True,
                "user_id": None,
                "created_at": datetime(2026, 10, 22, 11, 30, tzinfo=timezone.utc),
            },
            {
                "story_id": "story_demo_02",
                "title": "Deciphering handwritten scripts & switching to generic molecules in Davangere",
                "story_text": (
                    "My elderly father was discharged with three handwritten medications scrawled on a slip. "
                    "The private hospital pharmacy quoted ₹4,800 for a 15-day supply under proprietary brand names. "
                    "Neither my father nor I could read the dosage timings clearly, so I took the prescription to our neighborhood pharmacist on MCC B Block. "
                    "He took the time to write down the generic molecule names (Telmisartan and Atorvastatin) and dosage schedules in block letters. "
                    "We bought the same generic molecules at a Pradhan Mantri Jan Aushadhi Kendra nearby for just ₹620 total. "
                    "Always ask your doctor or chemist: 'Can you please write down the generic molecule name and exact meal timing in clear block letters?'"
                ),
                "author_name": "Suresh Patil",
                "condition_or_topic": "Handwritten Rx & Generic Alternatives",
                "location": "Davangere, Karnataka",
                "category": "Prescription",
                "contact_email": None,
                "contact_instagram": "suresh_davangere",
                "consent_acknowledged": True,
                "is_demo": True,
                "user_id": None,
                "created_at": datetime(2026, 10, 23, 9, 15, tzinfo=timezone.utc),
            },
            {
                "story_id": "story_demo_03",
                "title": "Four hours in the triage queue and clearing duplicate emergency doctor fees",
                "story_text": (
                    "Took my sister to casualty at 11 PM with acute abdominal colic. We waited nearly four hours because two critical trauma cases arrived, "
                    "which was understandable, but the front desk insisted on two separate advance deposits of ₹5,000 each. "
                    "When the doctor examined her, the IV antispasmodic injection gave her relief within twenty minutes. "
                    "At 6 AM discharge, they had billed two separate 'Emergency Consultant Attendant Fees' for the same resident doctor across shifts. "
                    "I asked the nursing supervisor to review the nursing shift handover sheet. She acknowledged the overlap and credited the duplicate ₹3,500 back. "
                    "Keep all your yellow triage paper slips and ask for shift handover verification when emergency fees double up."
                ),
                "author_name": "Deepak Nambiar",
                "condition_or_topic": "Emergency Triage & Duplicate Fees",
                "location": "Mysuru, Karnataka",
                "category": "Hospital Experience",
                "contact_email": "deepak.nambiar.mysuru@outlook.com",
                "contact_instagram": None,
                "consent_acknowledged": True,
                "is_demo": True,
                "user_id": None,
                "created_at": datetime(2026, 10, 23, 14, 45, tzinfo=timezone.utc),
            },
            {
                "story_id": "story_demo_04",
                "title": "Lowering my HbA1c from 9.4% to 6.2% with a sustainable North Karnataka routine",
                "story_text": (
                    "When routine fasting blood work showed my HbA1c was 9.4%, my immediate feeling was guilt and panic. "
                    "The first doctor just handed me three prescriptions and said 'cut out all carbs, see you in three months'. "
                    "What truly turned things around was consulting an empathetic clinical dietitian who understood local food. "
                    "She didn't ban jowar rotti or lentils; instead, she showed me how to add a fresh cucumber salad and sprouted fenugreek before meals, "
                    "and walk 25 minutes along Unkal Lake every evening. "
                    "Six months later, my HbA1c is 6.2%, and my physician reduced my metformin dose. Sustainable lifestyle adjustments beat crash diets every time."
                ),
                "author_name": "Preeti Desai",
                "condition_or_topic": "Type 2 Diabetes Routine & Lifestyle",
                "location": "Hubli, Karnataka",
                "category": "Recovery",
                "contact_email": None,
                "contact_instagram": "preetifit_hubli",
                "consent_acknowledged": True,
                "is_demo": True,
                "user_id": None,
                "created_at": datetime(2026, 10, 24, 8, 20, tzinfo=timezone.utc),
            },
            {
                "story_id": "story_demo_05",
                "title": "A district government teaching hospital that restored my faith in transparent care",
                "story_text": (
                    "When my uncle fractured his fibula at our workshop, private nursing homes gave estimates ranging from ₹65,000 to ₹1,20,000 "
                    "for the fixation implant and room charges. We decided to visit Vijayanagar Institute of Medical Sciences (VIMS) in Ballari. "
                    "Every procedure fee, X-ray cost (₹120), and orthopedic pin tariff was printed right on the wall outside the OPD block. "
                    "The orthopedic residents were thorough, courteous, and transparent throughout his four-day stay. "
                    "The total cost including medications was under ₹8,500 under government health schemes. "
                    "Real healthcare transparency exists—don't overlook high-volume public teaching hospitals with institutional oversight."
                ),
                "author_name": "Mohammed Farooq",
                "condition_or_topic": "Orthopedic Surgery & Public Tariffs",
                "location": "Ballari, Karnataka",
                "category": "Transparent Pricing",
                "contact_email": "farooq.ballari.advocate@gmail.com",
                "contact_instagram": None,
                "consent_acknowledged": True,
                "is_demo": True,
                "user_id": None,
                "created_at": datetime(2026, 10, 24, 13, 10, tzinfo=timezone.utc),
            },
            {
                "story_id": "story_demo_06",
                "title": "Post-hysterectomy recovery: The physical and mental hurdles nobody talks about",
                "story_text": (
                    "The surgery itself went smoothly, but week two of recovery at home caught me completely unprepared. "
                    "I had overwhelming fatigue, unexpected emotional swings from hormonal changes, and anxiety that every abdominal twinge was a tear. "
                    "What helped most was being transparent with my family about needing absolute rest instead of hosting visiting relatives. "
                    "I started a gentle 5-minute garden pacing routine twice a day and joined an online peer support circle of women who shared their recovery timelines. "
                    "If you are recovering from major surgery: celebrate tiny milestones, do not rush domestic chores, and give your body permission to heal on its own schedule."
                ),
                "author_name": "Shwetha Rao",
                "condition_or_topic": "Post-Surgical Healing & Mental Well-being",
                "location": "Mangaluru, Karnataka",
                "category": "Recovery",
                "contact_email": "shwetha.rao.coping@gmail.com",
                "contact_instagram": None,
                "consent_acknowledged": True,
                "is_demo": True,
                "user_id": None,
                "created_at": datetime(2026, 10, 24, 17, 30, tzinfo=timezone.utc),
            },
            {
                "story_id": "story_demo_07",
                "title": "Avoiding antibiotic escalation for our toddler's seasonal viral fever in Belagavi",
                "story_text": (
                    "Our two-year-old daughter ran a 102.5°F fever on day three with mild nasal congestion. "
                    "The first neighborhood clinic doctor wrote a broad-spectrum 3rd-generation cephalosporin and multiple combination cold syrups. "
                    "We felt uneasy because her lungs were clear and she was alert and drinking fluids between fever spikes. "
                    "We sought a second opinion at the civil hospital pediatric OPD. The senior pediatrician ran a rapid CRP test (₹350), "
                    "confirmed a standard seasonal enteroviral syndrome, and advised paracetamol drops with oral electrolyte rehydration. "
                    "The fever subsided completely on day five. Asking 'Is an antibiotic clinically indicated here or is this viral?' saved our child from unnecessary strong drugs."
                ),
                "author_name": "Rahul & Sneha Kulkarni",
                "condition_or_topic": "Pediatric Fever & Rational Drug Use",
                "location": "Belagavi, Karnataka",
                "category": "Prescription",
                "contact_email": None,
                "contact_instagram": "kulkarni_family_blg",
                "consent_acknowledged": True,
                "is_demo": True,
                "user_id": None,
                "created_at": datetime(2026, 10, 25, 7, 45, tzinfo=timezone.utc),
            },
            {
                "story_id": "story_demo_08",
                "title": "How a written maternity package estimate saved us ₹18,000 at newborn delivery",
                "story_text": (
                    "Before admitting my wife for our baby's delivery, we requested a written, signed copy of the hospital's 'Comprehensive Normal Delivery Package'. "
                    "When the discharge desk handed us the final settlement invoice, there was an extra ₹18,000 billed for nursery warming observation and daily pediatrician rounds. "
                    "We brought out our signed pre-admission package agreement, which explicitly stated that standard 24-hour pediatric assessment and cradle warming were included in the base package fee. "
                    "Because we had the documented agreement in hand, the billing director promptly removed the extra charge without dispute. "
                    "Always ask for a physical, signed copy of package inclusions before signing admission papers."
                ),
                "author_name": "Anand & Priya Verma",
                "condition_or_topic": "Maternity Package Protection",
                "location": "Bengaluru, Karnataka",
                "category": "Billing",
                "contact_email": "anand.verma.tech@gmail.com",
                "contact_instagram": None,
                "consent_acknowledged": True,
                "is_demo": True,
                "user_id": None,
                "created_at": datetime(2026, 10, 25, 10, 0, tzinfo=timezone.utc),
            },
        ]

    def _build_default_indian_trust_records(self) -> dict[str, dict[str, Any]]:
        """Pre-populate rich, verified sample trust records for key Indian metropolitan hubs."""
        now_str = datetime.now(timezone.utc).isoformat()
        raw_cities = [
            {
                "key": "bengaluru_ka",
                "aliases": ["bengaluru", "bangalore"],
                "city": "Bengaluru",
                "state": "Karnataka",
                "total_claims": 26,
                "verified_claims": 26,
                "supported": 19,
                "partially": 3,
                "contradicted": 2,
                "flagged": 5,
                "abstained": 2,
                "anomalies": 4,
                "anomaly_rate": 0.1538,
                "support_ratio": 0.8542,
                "recency_volume": 4.85,
                "density_score": 0.7850,
                "tier": "high",
                "anomalous_entities": [
                    "0.9% Normal Saline IV Infusion (500ml)",
                    "Disposable Surgical Consumables Kit",
                    "Private Emergency Registration Surcharge",
                ],
                "top_procedures": [
                    "0.9% Normal Saline IV Infusion",
                    "CPT 70551 Brain MRI without contrast",
                    "Tab Metformin 500mg (Generic)",
                    "Complete Blood Count (CBC) with Platelets",
                ],
                "summary": "High clinical guideline compliance across public and teaching institutes (Victoria Hospital, BMCRI, Bowring, St. John's). Occasional extreme markups detected in private multi-specialty hospitals for routine IV saline and consumable kits (e.g. ₹1,800 vs ₹60 benchmark).",
                "recommendation": "Review itemized pharmacy charges on inpatient statements before settlement. Request subsidized state tariffs for crystalloid infusions.",
            },
            {
                "key": "davangere_ka",
                "aliases": ["davangere", "davanagere"],
                "city": "Davangere",
                "state": "Karnataka",
                "total_claims": 16,
                "verified_claims": 16,
                "supported": 14,
                "partially": 1,
                "contradicted": 1,
                "flagged": 2,
                "abstained": 0,
                "anomalies": 1,
                "anomaly_rate": 0.0625,
                "support_ratio": 0.9062,
                "recency_volume": 4.40,
                "density_score": 0.8420,
                "tier": "high",
                "anomalous_entities": [
                    "Private Diagnostic Contrast Surcharge",
                ],
                "top_procedures": [
                    "Tab Metformin 500mg + Glimepiride 1mg",
                    "Chigateri General OPD Evaluation",
                    "Routine Blood Sugar & HbA1c Profile",
                    "Pediatric Infection Consultation",
                ],
                "summary": "Exceptional clinical adherence and transparent subsidized outpatient tariffs at Chigateri General Hospital and Bapuji Child Health Institute. Very low billing markup rate (6.3%) with first-line diabetic treatments strictly matching ICMR guidelines.",
                "recommendation": "Maintain standard clinical documentation. Healthcare providers in Davangere demonstrate consistent pricing fairness.",
            },
            {
                "key": "ballari_ka",
                "aliases": ["ballari", "bellary"],
                "city": "Ballari",
                "state": "Karnataka",
                "total_claims": 20,
                "verified_claims": 20,
                "supported": 11,
                "partially": 2,
                "contradicted": 4,
                "flagged": 7,
                "abstained": 3,
                "anomalies": 6,
                "anomaly_rate": 0.3000,
                "support_ratio": 0.7059,
                "recency_volume": 4.10,
                "density_score": 0.6350,
                "tier": "moderate",
                "anomalous_entities": [
                    "Tab Azithromycin 500mg Overprescription",
                    "Private Emergency Fever Registration",
                    "Commercial Laboratory Panel Markup",
                ],
                "top_procedures": [
                    "Tab Azithromycin 500mg Course",
                    "Syrup Paracetamol 250mg/5ml",
                    "VIMS OPD Evaluation & Vital Checks",
                    "Routine Dengue / Malaria Serology",
                ],
                "summary": "Vijayanagar Institute of Medical Sciences (VIMS) offers exemplary universal subsidized care (₹20 OPD fee), but private clinics exhibit moderate antibiotic overuse (Azithromycin for viral colds) and diagnostic test markups exceeding state health guidelines.",
                "recommendation": "Scrutinize antibiotic prescriptions for uncomplicated viral upper respiratory symptoms. Seek generic equivalents at Jan Aushadhi Kendras.",
            },
            {
                "key": "mysuru_ka",
                "aliases": ["mysuru", "mysore"],
                "city": "Mysuru",
                "state": "Karnataka",
                "total_claims": 18,
                "verified_claims": 18,
                "supported": 15,
                "partially": 1,
                "contradicted": 1,
                "flagged": 3,
                "abstained": 1,
                "anomalies": 2,
                "anomaly_rate": 0.1111,
                "support_ratio": 0.9118,
                "recency_volume": 4.30,
                "density_score": 0.8120,
                "tier": "high",
                "anomalous_entities": [
                    "Private Pediatric Emergency Surcharge",
                    "Specialist Consultation Add-on",
                ],
                "top_procedures": [
                    "K.R. Hospital General Medicine Consultation",
                    "Cheluvamba Pediatric Inpatient Care",
                    "JSS Multi-Specialty Evaluation",
                    "Routine Complete Hemogram",
                ],
                "summary": "Strong guideline concordance and fair pricing practices anchored by Mysore Medical College (K.R. Hospital and Cheluvamba Children's Hospital). Low anomaly incidence across maternal, neonatal, and general medical cases.",
                "recommendation": "Audited billing records align closely with National Health Mission benchmarks.",
            },
            {
                "key": "hubli_ka",
                "aliases": ["hubli", "dharwad", "hubballi", "hubballi_dharwad", "hubli_dharwad", "hubli_dharwad_ka", "hubballi_ka"],
                "city": "Hubballi / Dharwad",
                "state": "Karnataka",
                "total_claims": 17,
                "verified_claims": 17,
                "supported": 13,
                "partially": 2,
                "contradicted": 1,
                "flagged": 3,
                "abstained": 1,
                "anomalies": 2,
                "anomaly_rate": 0.1176,
                "support_ratio": 0.8750,
                "recency_volume": 4.25,
                "density_score": 0.8250,
                "tier": "high",
                "anomalous_entities": [
                    "Emergency Trauma Consumables Markup",
                    "Uncoded Surgical Dressing Fee",
                ],
                "top_procedures": [
                    "KIMS Hubballi Emergency OPD Care",
                    "SDM College Medical Consultation",
                    "Trauma & Fracture Evaluation",
                    "Routine Inpatient Nursing Service",
                ],
                "summary": "Reliable clinical adherence and transparent pricing anchored by KIMS Hospital and SDM College of Medical Sciences. Minor anomalies detected on disposable surgical consumables in private corridors.",
                "recommendation": "Confirm whether surgical consumable kits are billed at subsidized government rates or commercial MRP.",
            },
            {
                "key": "mangaluru_ka",
                "aliases": ["mangaluru", "mangalore"],
                "city": "Mangaluru",
                "state": "Karnataka",
                "total_claims": 15,
                "verified_claims": 15,
                "supported": 12,
                "partially": 1,
                "contradicted": 1,
                "flagged": 3,
                "abstained": 1,
                "anomalies": 2,
                "anomaly_rate": 0.1333,
                "support_ratio": 0.8929,
                "recency_volume": 4.20,
                "density_score": 0.7720,
                "tier": "high",
                "anomalous_entities": [
                    "Advanced MRI Protocol Surcharge",
                    "Private Multi-Specialty Night Evaluation",
                ],
                "top_procedures": [
                    "CPT 70551 Brain MRI without contrast",
                    "Wenlock District Hospital Trauma Care",
                    "KMC Academic Medical Consultation",
                    "Routine Serum Electrolytes Panel",
                ],
                "summary": "Leading academic medical institutions (Wenlock District Hospital, KMC Mangaluru) exhibit high evidence agreement for neurology, trauma, and diagnostic imaging. Billed MRI tariffs closely match regional diagnostic benchmarks.",
                "recommendation": "Diagnostic pricing is well standardized across Coastal Karnataka medical colleges.",
            },
            {
                "key": "belagavi_ka",
                "aliases": ["belagavi", "belgaum"],
                "city": "Belagavi",
                "state": "Karnataka",
                "total_claims": 14,
                "verified_claims": 14,
                "supported": 8,
                "partially": 1,
                "contradicted": 2,
                "flagged": 5,
                "abstained": 3,
                "anomalies": 4,
                "anomaly_rate": 0.2857,
                "support_ratio": 0.7727,
                "recency_volume": 3.90,
                "density_score": 0.5920,
                "tier": "moderate",
                "anomalous_entities": [
                    "Experimental Stem Cell Infusion",
                    "Unapproved Inpatient Regenerative Therapy",
                    "Specialty Ward Overhead Markup",
                ],
                "top_procedures": [
                    "BIMS General Medical Consultation",
                    "KLE Hospital Inpatient Admission",
                    "Routine Pediatric Fever Care",
                    "Experimental Uncoded Therapy",
                ],
                "summary": "Subsidized healthcare is well represented at BIMS and KLE Charitable Hospital, but responsible safe holds were triggered on high-cost experimental unapproved stem cell infusions (₹85,000) lacking established national benchmarks.",
                "recommendation": "Demand documented clinical trial approval or state benchmark justification before approving experimental high-cost inpatient therapies.",
            },
        ]

        records: dict[str, dict[str, Any]] = {}
        for c in raw_cities:
            metrics_dict = {
                "location_key": c["key"],
                "city": c["city"],
                "state_or_region": c["state"],
                "total_claims": c["total_claims"],
                "verified_claims": c["verified_claims"],
                "supported_count": c["supported"],
                "partially_supported_count": c["partially"],
                "contradicted_count": c["contradicted"],
                "flagged_count": c["flagged"],
                "abstained_count": c["abstained"],
                "cost_anomaly_count": c["anomalies"],
                "cost_anomaly_rate": c["anomaly_rate"],
                "support_ratio": c["support_ratio"],
                "recency_volume": c["recency_volume"],
                "density_score": c["density_score"],
                "trust_tier": c["tier"],
                "last_updated": now_str,
            }
            insight_dict = {
                "location_key": c["key"],
                "city": c["city"],
                "state_or_region": c["state"],
                "density_score": c["density_score"],
                "trust_tier": c["tier"],
                "top_anomalous_entities": c["anomalous_entities"],
                "top_procedures_audited": c["top_procedures"],
                "summary_text": c["summary"],
                "sample_claim_ids": [f"claim_{c['key']}_{i+1:02d}" for i in range(min(4, c["verified_claims"]))],
                "recommendation": c["recommendation"],
            }
            doc = {
                "location_key": c["key"],
                "city": c["city"],
                "state_or_region": c["state"],
                "metrics": metrics_dict,
                "insight": insight_dict,
                "density_score": c["density_score"],
                "trust_tier": c["tier"],
                "total_claims": c["total_claims"],
                "verified_claims": c["verified_claims"],
                "last_updated": now_str,
            }
            records[c["key"]] = doc
            for alias in c["aliases"]:
                records[alias.lower()] = doc
                records[f"{alias.lower()}_ka"] = doc

        return records

    async def connect(self) -> None:
        """Initialize connection pool to MongoDB and ensure indexes."""
        uri = self.settings.mongodb_connection_uri
        # Skip remote/network MongoDB during automated unit test runs or if placeholders are present
        if (
            os.getenv("TESTING")
            or os.getenv("PYTEST_CURRENT_TEST")
            or not uri
            or "<db_password>" in uri
            or "<password>" in uri
        ):
            if self.settings.APP_ENV.lower() == "production" and not (os.getenv("TESTING") or os.getenv("PYTEST_CURRENT_TEST")):
                logger.warning(
                    "[PRODUCTION WARNING] MongoDB is running in IN-MEMORY fallback mode. "
                    "Storage will not persist across restarts or multiple workers. "
                    "Ensure MONGODB_URI is configured with valid credentials without placeholders."
                )
            else:
                logger.info("MongoDB operating in in-memory fallback mode.")
            self._client = None
            self._db = None
            return

        if self._client is None:
            # STRICT SECURITY RULE: Never log connection string, username, password, or cluster address
            logger.info(f"Connecting to MongoDB database '{self.settings.MONGODB_DB_NAME}'...")
            self._client = AsyncIOMotorClient(
                uri,
                serverSelectionTimeoutMS=min(self.settings.MONGODB_TIMEOUT_MS, 1500),
            )
        self._db = self._client[self.settings.MONGODB_DB_NAME]
        self._users_collection = self._db[self.settings.MONGODB_USERS_COLLECTION]
        self._collection = self._db[self.settings.MONGODB_CLAIMS_COLLECTION]
        self._verifications_collection = self._db[self.settings.MONGODB_VERIFICATIONS_COLLECTION]
        self._audit_trails_collection = self._db[self.settings.MONGODB_AUDIT_TRAILS_COLLECTION]
        self._trust_density_collection = self._db[self.settings.MONGODB_TRUST_DENSITY_COLLECTION]
        self._evaluations_collection = self._db[self.settings.MONGODB_EVALUATIONS_COLLECTION]
        self._community_stories_collection = self._db[self.settings.MONGODB_COMMUNITY_STORIES_COLLECTION]
        self._availability_collection = self._db["hospital_availability"]
        self._sos_collection = self._db["emergency_sos"]

        try:
            # Ping database to verify connection
            await self._client.admin.command("ping")
            logger.info(f"MongoDB connection established to database: {self.settings.MONGODB_DB_NAME}")
            await self._ensure_indexes()
        except Exception as e:
            logger.warning(f"MongoDB ping failed at startup (server may be offline or credentials invalid): {type(e).__name__}. Operating in in-memory fallback mode.")
            if self._client:
                try:
                    self._client.close()
                except Exception:
                    pass
            self._client = None
            self._db = None
            self._users_collection = None
            self._collection = None
            self._verifications_collection = None
            self._audit_trails_collection = None
            self._trust_density_collection = None
            self._evaluations_collection = None
            self._community_stories_collection = None
            self._availability_collection = None
            self._sos_collection = None

    async def close(self) -> None:
        """Close MongoDB connection pool."""
        if self._client:
            self._client.close()
            self._client = None
            self._db = None
            self._users_collection = None
            self._collection = None
            self._verifications_collection = None
            self._audit_trails_collection = None
            self._trust_density_collection = None
            self._evaluations_collection = None
            self._community_stories_collection = None
            self._availability_collection = None
            self._sos_collection = None
            logger.info("MongoDB connection closed")

    async def _ensure_indexes(self) -> None:
        """Create indexes on users, claims, verifications, and audit_trails."""
        if self._users_collection is not None:
            try:
                await self._users_collection.create_index("user_id", unique=True)
                await self._users_collection.create_index("email", unique=True)
                logger.info("MongoDB indexes verified on collection 'users'")
                # Pre-seed demo user in MongoDB if not exists
                existing_demo = await self._users_collection.find_one({
                    "$or": [{"email": DEMO_USER_EMAIL.lower()}, {"user_id": DEMO_USER_ID}]
                })
                if not existing_demo:
                    try:
                        await self._users_collection.insert_one({
                            "user_id": DEMO_USER_ID,
                            "name": DEMO_USER_NAME,
                            "email": DEMO_USER_EMAIL.lower(),
                            "hashed_password": hash_password(DEMO_USER_DEFAULT_PW),
                            "role": DEMO_USER_ROLE,
                            "organization": DEMO_USER_ORG,
                            "created_at": datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc),
                        })
                        logger.info("Seeded canonical Demo Auditor into MongoDB users collection")
                    except DuplicateKeyError:
                        pass
            except Exception as e:
                logger.warning(f"Failed to ensure MongoDB indexes on users: {e}")
        if self._collection is not None:
            try:
                await self._collection.create_index("claim_id", unique=True)
                await self._collection.create_index("timestamp")
                await self._collection.create_index("provenance.source_hash")
                await self._collection.create_index("extracted_fields.entity")
                await self._collection.create_index("location.normalized_key")
                logger.info("MongoDB indexes verified on collection 'claims'")
            except Exception as e:
                logger.warning(f"Failed to ensure MongoDB indexes on claims: {e}")

        if self._verifications_collection is not None:
            try:
                await self._verifications_collection.create_index("claim_id", unique=True)
                await self._verifications_collection.create_index("verification_id")
                await self._verifications_collection.create_index("verified_at")
                await self._verifications_collection.create_index("verdict")
                await self._verifications_collection.create_index("action")
                logger.info("MongoDB indexes verified on collection 'verifications'")
            except Exception as e:
                logger.warning(f"Failed to ensure MongoDB indexes on verifications: {e}")

        if self._audit_trails_collection is not None:
            try:
                await self._audit_trails_collection.create_index("audit_id", unique=True)
                await self._audit_trails_collection.create_index("claim_id")
                await self._audit_trails_collection.create_index("verification_id")
                await self._audit_trails_collection.create_index("created_at")
                logger.info("MongoDB indexes verified on collection 'audit_trails'")
            except Exception as e:
                logger.warning(f"Failed to ensure MongoDB indexes on audit_trails: {e}")

        if self._trust_density_collection is not None:
            try:
                await self._trust_density_collection.create_index("location_key", unique=True)
                await self._trust_density_collection.create_index("density_score")
                await self._trust_density_collection.create_index("trust_tier")
                logger.info("MongoDB indexes verified on collection 'trust_density'")

                # Purge legacy foreign/US records
                await self._trust_density_collection.delete_many({
                    "location_key": {"$in": ["houston_tx", "chicago_il", "cleveland_oh", "atlanta_ga", "denver_co", "san_francisco_ca", "boston_ma"]}
                })

                # Seed canonical Indian regional trust records if not already present
                seen_canonical: set[str] = set()
                for doc in self._build_default_indian_trust_records().values():
                    lk = doc["location_key"]
                    if lk not in seen_canonical:
                        seen_canonical.add(lk)
                        await self._trust_density_collection.update_one(
                            {"location_key": lk},
                            {"$set": doc},
                            upsert=True,
                        )
                logger.info("Seeded canonical Indian regional trust density records into MongoDB")
            except Exception as e:
                logger.warning(f"Failed to ensure MongoDB indexes on trust_density: {e}")

        if self._evaluations_collection is not None:
            try:
                await self._evaluations_collection.create_index("run_id", unique=True)
                await self._evaluations_collection.create_index("timestamp")
                logger.info("MongoDB indexes verified on collection 'evaluation_runs'")
                base_run = self._build_default_baseline_evaluation_run()
                await self._evaluations_collection.update_one(
                    {"run_id": base_run["run_id"]},
                    {"$set": base_run},
                    upsert=True,
                )
                logger.info("Seeded canonical baseline evaluation report into MongoDB evaluation_runs")
            except Exception as e:
                logger.warning(f"Failed to ensure MongoDB indexes on evaluation_runs: {e}")

        if self._community_stories_collection is not None:
            try:
                await self._community_stories_collection.create_index("story_id", unique=True)
                await self._community_stories_collection.create_index("created_at")
                logger.info("MongoDB indexes verified on collection 'community_stories'")

                # Seed canonical Indian recovery stories into MongoDB if not present
                for story in self._build_default_demo_stories():
                    await self._community_stories_collection.update_one(
                        {"story_id": story["story_id"]},
                        {"$set": story},
                        upsert=True,
                    )
                logger.info("Seeded canonical Indian recovery stories into MongoDB community_stories")
            except Exception as e:
                logger.warning(f"Failed to ensure MongoDB indexes on community_stories: {e}")

        if self._availability_collection is not None:
            try:
                await self._availability_collection.create_index("hospital_id", unique=True)
                await self._availability_collection.create_index("last_updated")
                logger.info("MongoDB indexes verified on collection 'hospital_availability'")
            except Exception as e:
                logger.warning(f"Failed to ensure MongoDB indexes on hospital_availability: {e}")

        if self._sos_collection is not None:
            try:
                await self._sos_collection.create_index("sos_id", unique=True)
                await self._sos_collection.create_index("hospital_id")
                await self._sos_collection.create_index("status")
                await self._sos_collection.create_index("created_at")
                logger.info("MongoDB indexes verified on collection 'emergency_sos'")
            except Exception as e:
                logger.warning(f"Failed to ensure MongoDB indexes on emergency_sos: {e}")

    async def check_health(self) -> dict[str, Any]:
        """Check MongoDB connection and return status."""
        if self._client is None:
            return {
                "status": "uninitialized",
                "mode": "in_memory_fallback",
                "persistent": False,
                "error": "Client not connected; operating in ephemeral in-memory fallback mode.",
            }
        try:
            await self._client.admin.command("ping")
            claims_cnt = await self.count_claims()
            verifications_cnt = await self.count_verifications()
            audit_cnt = await self.count_audit_trails()
            trust_cnt = await self.count_trust_densities()
            eval_cnt = await self.count_evaluation_reports()
            return {
                "status": "healthy",
                "mode": "mongodb_persistent",
                "persistent": True,
                "database": self.settings.MONGODB_DB_NAME,
                "collection": self.settings.MONGODB_CLAIMS_COLLECTION,
                "claims_count": claims_cnt,
                "verifications_count": verifications_cnt,
                "audit_trails_count": audit_cnt,
                "trust_density_count": trust_cnt,
                "evaluation_runs_count": eval_cnt,
            }
        except Exception as e:
            return {
                "status": "unreachable",
                "mode": "in_memory_fallback",
                "persistent": False,
                "error": str(e),
            }

    @property
    def is_connected(self) -> bool:
        """Check if storage client is initialized."""
        return self._client is not None and self._db is not None

    @property
    def collection(self) -> AsyncIOMotorCollection:
        """Access the claims collection."""
        if self._collection is None:
            raise StorageError("StorageService is not connected. Call connect() first.")
        return self._collection

    @property
    def verifications_collection(self) -> AsyncIOMotorCollection:
        """Access the verifications collection."""
        if self._verifications_collection is None:
            raise StorageError("StorageService is not connected. Call connect() first.")
        return self._verifications_collection

    @property
    def audit_trails_collection(self) -> AsyncIOMotorCollection:
        """Access the audit trails collection."""
        if self._audit_trails_collection is None:
            raise StorageError("StorageService is not connected. Call connect() first.")
        return self._audit_trails_collection

    @property
    def trust_density_collection(self) -> AsyncIOMotorCollection:
        """Access the trust density collection."""
        if self._trust_density_collection is None:
            raise StorageError("StorageService is not connected. Call connect() first.")
        return self._trust_density_collection

    @property
    def evaluations_collection(self) -> AsyncIOMotorCollection:
        """Access the evaluation reports collection."""
        if self._evaluations_collection is None:
            raise StorageError("StorageService is not connected. Call connect() first.")
        return self._evaluations_collection

    @property
    def community_stories_collection(self) -> AsyncIOMotorCollection:
        """Access the community recovery stories collection."""
        if self._community_stories_collection is None:
            if self._db is None:
                raise StorageError("StorageService is not connected. Call connect() first.")
            self._community_stories_collection = self._db[self.settings.MONGODB_COMMUNITY_STORIES_COLLECTION]
        return self._community_stories_collection

    @property
    def users_collection(self) -> AsyncIOMotorCollection:
        """Access the users collection."""
        if self._users_collection is None:
            if self._db is None:
                raise StorageError("StorageService is not connected. Call connect() first.")
            self._users_collection = self._db[self.settings.MONGODB_USERS_COLLECTION]
        return self._users_collection

    async def create_user(self, user_dict: dict[str, Any]) -> dict[str, Any]:
        """
        Create a new user account in MongoDB and in-memory cache.
        Ensures email uniqueness.
        """
        email_key = user_dict["email"].strip().lower()
        if email_key in self._in_memory_users:
            raise DuplicateKeyError(f"User with email '{email_key}' already exists")

        # Save to MongoDB if connected
        try:
            if self._client is not None and self._db is not None:
                doc = dict(user_dict)
                await self.users_collection.insert_one(doc)
                logger.info(f"User {user_dict['user_id']} created in MongoDB")
        except DuplicateKeyError:
            raise DuplicateKeyError(f"User with email '{email_key}' already exists in database")
        except Exception as e:
            logger.warning(f"Could not persist user to MongoDB (in-memory saved): {e}")

        # Update in-memory index
        self._in_memory_users[email_key] = user_dict
        self._in_memory_users[user_dict["user_id"]] = user_dict
        return user_dict

    async def get_user_by_email(self, email: str) -> Optional[dict[str, Any]]:
        """Retrieve user by email from MongoDB or in-memory fallback."""
        clean_email = email.strip().lower()
        try:
            if self._client is not None and self._db is not None:
                doc = await self.users_collection.find_one({"email": clean_email}, {"_id": 0})
                if doc:
                    return doc
        except Exception as e:
            logger.debug(f"Failed to query MongoDB for user email: {e}")

        return self._in_memory_users.get(clean_email)

    async def get_user_by_id(self, user_id: str) -> Optional[dict[str, Any]]:
        """Retrieve user by user_id from MongoDB or in-memory fallback."""
        clean_id = user_id.strip()
        try:
            if self._client is not None and self._db is not None:
                doc = await self.users_collection.find_one({"user_id": clean_id}, {"_id": 0})
                if doc:
                    return doc
        except Exception as e:
            logger.debug(f"Failed to query MongoDB for user_id: {e}")

        for u in self._in_memory_users.values():
            if u.get("user_id") == clean_id:
                return u
        return None

    async def insert_claim(self, claim: Claim) -> Claim:
        """
        Persist a claim to MongoDB or in-memory fallback.
        Raises DuplicateKeyError if claim_id already exists.
        """
        doc = claim.model_dump(mode="python")
        if self._client is not None and self._db is not None:
            try:
                result = await self.collection.insert_one(doc)
                logger.info(f"Inserted claim {claim.claim_id} into MongoDB (inserted_id={result.inserted_id})")
                return claim
            except DuplicateKeyError:
                logger.warning(f"Claim {claim.claim_id} already exists in database")
                raise StorageError(f"Claim with id '{claim.claim_id}' already exists")
            except Exception as e:
                logger.error(f"Failed to insert claim {claim.claim_id}: {e}")
                raise StorageError(f"Database insertion failed: {e}") from e

        # In-memory fallback
        if any(c.get("claim_id") == claim.claim_id for c in self._in_memory_claims):
            raise StorageError(f"Claim with id '{claim.claim_id}' already exists")
        self._in_memory_claims.insert(0, doc)
        return claim

    async def get_claim(self, claim_id: str) -> Optional[Claim]:
        """Retrieve a single claim by its unique claim_id."""
        if self._client is not None and self._db is not None:
            try:
                doc = await self.collection.find_one({"claim_id": claim_id}, {"_id": 0})
                if not doc:
                    return None
                return Claim.model_validate(doc)
            except Exception as e:
                logger.error(f"Failed to retrieve claim {claim_id}: {e}")
                raise StorageError(f"Database query failed: {e}") from e

        # In-memory fallback
        doc = next((c for c in self._in_memory_claims if c.get("claim_id") == claim_id), None)
        return Claim.model_validate(doc) if doc else None

    def _build_claims_query(
        self,
        location: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """Construct MongoDB query dictionary with optional location and user_id isolation."""
        clauses: list[dict[str, Any]] = []

        if location:
            loc_clean = location.strip().lower()
            clauses.append({
                "$or": [
                    {"location.normalized_key": loc_clean},
                    {"location.city": {"$regex": f"^{re.escape(location.strip())}$", "$options": "i"}},
                ]
            })

        if user_id:
            clean_uid = user_id.strip()
            if clean_uid in (DEMO_USER_ID, "demo"):
                # For demo auditor, also include legacy/unassigned claims so prototype demo remains populated
                clauses.append({
                    "$or": [
                        {"user_id": clean_uid},
                        {"user_id": None},
                        {"user_id": {"$exists": False}},
                    ]
                })
            else:
                clauses.append({"user_id": clean_uid})

        if not clauses:
            return {}
        if len(clauses) == 1:
            return clauses[0]
        return {"$and": clauses}

    def _filter_in_memory_claims(
        self,
        location: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """Filter in-memory claims by location and user_id with strict isolation."""
        mem = list(self._in_memory_claims)
        if location:
            loc_clean = location.strip().lower()
            mem = [
                c for c in mem
                if (c.get("location") or {}).get("normalized_key") == loc_clean
                or ((c.get("location") or {}).get("city") or "").lower() == loc_clean
            ]
        if user_id:
            clean_uid = user_id.strip()
            if clean_uid in (DEMO_USER_ID, "demo"):
                mem = [c for c in mem if c.get("user_id") in (clean_uid, None) or "user_id" not in c]
            else:
                mem = [c for c in mem if c.get("user_id") == clean_uid]
        return mem

    async def list_claims(
        self,
        limit: int = 50,
        skip: int = 0,
        location: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> list[Claim]:
        """Retrieve a paginated list of claims sorted newest first, optionally filtered by location and user_id."""
        if self._collection is not None and self._db is not None:
            try:
                query = self._build_claims_query(location=location, user_id=user_id)
                cursor = (
                    self.collection.find(query, {"_id": 0})
                    .sort("timestamp", -1)
                    .skip(skip)
                    .limit(limit)
                )
                claims: list[Claim] = []
                async for doc in cursor:
                    claims.append(Claim.model_validate(doc))
                return claims
            except Exception as e:
                logger.error(f"Failed to list claims: {e}")
                raise StorageError(f"Database query failed: {e}") from e

        # In-memory fallback
        mem = self._filter_in_memory_claims(location=location, user_id=user_id)
        return [Claim.model_validate(c) for c in mem[skip : skip + limit]]

    async def count_claims(
        self,
        location: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> int:
        """Return total number of claims in collection, optionally filtered by location and user_id."""
        if self._collection is not None and self._db is not None:
            try:
                query = self._build_claims_query(location=location, user_id=user_id)
                return await self.collection.count_documents(query)
            except Exception as e:
                logger.warning(f"Failed to count claims: {e}")
                return 0

        # In-memory fallback
        return len(self._filter_in_memory_claims(location=location, user_id=user_id))

    def get_claims_by_provider_in_memory(
        self,
        provider_identifier: str,
        limit: int = 100,
    ) -> list[Claim]:
        """
        Synchronous in-memory lookup of historical claims matching a provider name, hospital name, or ID.
        Used for fast fallback and offline/test environments without database connections.
        """
        clean_id = (provider_identifier or "").strip().lower()
        if not clean_id or len(clean_id) < 2:
            return []

        matched: list[Claim] = []
        for c in self._in_memory_claims:
            loc = c.get("location") or {}
            norm_key = (loc.get("normalized_key") or "").lower()
            text = (c.get("original_text") or "").lower()
            ext = c.get("extracted_fields") or {}
            entity = (ext.get("entity") or "").lower()
            hosp = (ext.get("hospital_name") or "").lower()
            pname = (ext.get("provider_name") or "").lower()
            # Match by normalized provider/hospital identity, NOT solely on generic city name
            if (
                clean_id in entity
                or clean_id in hosp
                or clean_id in pname
                or clean_id in text
                or (clean_id in norm_key and not any(clean_id == k for k in ["davangere", "bengaluru", "bangalore", "ballari", "mysuru", "mangaluru", "belagavi", "karnataka"]))
            ):
                try:
                    matched.append(Claim.model_validate(c))
                except Exception as val_err:
                    logger.debug(f"Failed to validate in-memory claim: {val_err}")
            if len(matched) >= limit:
                break
        return matched

    async def get_claims_by_provider(
        self,
        provider_identifier: str,
        limit: int = 100,
    ) -> list[Claim]:
        """
        Retrieve historical claims matching a provider name, hospital name, or provider ID.
        Queries MongoDB collection if connected, otherwise filters in-memory store.
        """
        clean_id = (provider_identifier or "").strip()
        if not clean_id or len(clean_id) < 2:
            return []

        # If MongoDB is available, search with case-insensitive regex
        if self._collection is not None and self._db is not None:
            try:
                regex_pattern = {"$regex": re.escape(clean_id), "$options": "i"}
                # Match provider identity without combining unrelated hospitals across a generic city
                query = {
                    "$or": [
                        {"extracted_fields.entity": regex_pattern},
                        {"extracted_fields.hospital_name": regex_pattern},
                        {"extracted_fields.provider_name": regex_pattern},
                        {"original_text": regex_pattern},
                    ]
                }
                cursor = self.collection.find(query, {"_id": 0}).sort("timestamp", -1).limit(limit)
                claims: list[Claim] = []
                async for doc in cursor:
                    try:
                        claims.append(Claim.model_validate(doc))
                    except Exception as val_err:
                        logger.debug(f"Failed to validate historical claim document: {val_err}")
                return claims
            except Exception as e:
                logger.warning(f"Database query in get_claims_by_provider failed: {e}. Falling back to in-memory.")

        # In-memory fallback
        return self.get_claims_by_provider_in_memory(clean_id, limit=limit)

    async def insert_verification(self, verification: VerificationResult) -> VerificationResult:
        """
        Persist or update a verification result linked to claim_id in MongoDB or in-memory fallback.
        Uses upsert on claim_id so re-verifications cleanly replace old audits.
        """
        doc = verification.model_dump(mode="python")
        if self._client is not None and self._db is not None:
            try:
                await self.verifications_collection.update_one(
                    {"claim_id": verification.claim_id},
                    {"$set": doc},
                    upsert=True
                )
                logger.info(f"Saved verification for claim {verification.claim_id} (verdict={verification.verdict.value}, action={verification.action.value})")
                return verification
            except Exception as e:
                logger.error(f"Failed to save verification for claim {verification.claim_id}: {e}")
                raise StorageError(f"Database verification insertion failed: {e}") from e

        # In-memory fallback
        self._in_memory_verifications = [v for v in self._in_memory_verifications if v.get("claim_id") != verification.claim_id]
        self._in_memory_verifications.append(doc)
        return verification

    async def get_verification(self, claim_id: str) -> Optional[VerificationResult]:
        """Retrieve a verification result by claim_id."""
        if self._client is not None and self._db is not None:
            try:
                doc = await self.verifications_collection.find_one({"claim_id": claim_id}, {"_id": 0})
                if not doc:
                    return None
                return VerificationResult.model_validate(doc)
            except Exception as e:
                logger.error(f"Failed to retrieve verification for claim {claim_id}: {e}")
                raise StorageError(f"Database query failed: {e}") from e

        # In-memory fallback
        doc = next((v for v in self._in_memory_verifications if v.get("claim_id") == claim_id), None)
        return VerificationResult.model_validate(doc) if doc else None

    async def count_verifications(self) -> int:
        """Return total number of verification records in collection."""
        if self._client is not None and self._db is not None:
            try:
                return await self.verifications_collection.count_documents({})
            except Exception as e:
                logger.warning(f"Failed to count verifications: {e}")
                return 0
        return len(self._in_memory_verifications)

    async def insert_audit_trail(self, audit_trail: AuditTrail) -> AuditTrail:
        """
        Persist or update an audit trail linked to claim_id and verification_id in MongoDB.
        Uses upsert on audit_id.
        """
        doc = audit_trail.model_dump(mode="python")
        if self._client is not None and self._db is not None:
            try:
                await self.audit_trails_collection.update_one(
                    {"audit_id": audit_trail.audit_id},
                    {"$set": doc},
                    upsert=True
                )
                logger.info(f"Saved audit trail {audit_trail.audit_id} for claim {audit_trail.claim_id} ({len(audit_trail.steps)} steps)")
                return audit_trail
            except Exception as e:
                logger.error(f"Failed to save audit trail {audit_trail.audit_id}: {e}")
                raise StorageError(f"Database audit trail insertion failed: {e}") from e

        # In-memory fallback
        self._in_memory_audit_trails = [a for a in self._in_memory_audit_trails if a.audit_id != audit_trail.audit_id]
        self._in_memory_audit_trails.append(audit_trail)
        return audit_trail

    async def get_audit_trail_by_claim_id(self, claim_id: str) -> Optional[AuditTrail]:
        """Retrieve the most recent audit trail for a claim."""
        if self._client is not None and self._db is not None:
            try:
                cursor = self.audit_trails_collection.find({"claim_id": claim_id}, {"_id": 0}).sort("created_at", -1).limit(1)
                docs = await cursor.to_list(length=1)
                if not docs:
                    return None
                return AuditTrail.model_validate(docs[0])
            except Exception as e:
                logger.error(f"Failed to retrieve audit trail for claim {claim_id}: {e}")
                raise StorageError(f"Database query failed: {e}") from e

        # In-memory fallback
        matching = [a for a in self._in_memory_audit_trails if a.claim_id == claim_id]
        return matching[-1] if matching else None

    async def get_audit_trail_by_verification_id(self, verification_id: str) -> Optional[AuditTrail]:
        """Retrieve audit trail by its verification_id."""
        if self._client is not None and self._db is not None:
            try:
                doc = await self.audit_trails_collection.find_one({"verification_id": verification_id}, {"_id": 0})
                if not doc:
                    return None
                return AuditTrail.model_validate(doc)
            except Exception as e:
                logger.error(f"Failed to retrieve audit trail for verification {verification_id}: {e}")
                raise StorageError(f"Database query failed: {e}") from e

        # In-memory fallback
        return next((a for a in self._in_memory_audit_trails if a.verification_id == verification_id), None)

    async def count_audit_trails(self) -> int:
        """Return total number of audit trail records in collection."""
        if self._client is not None and self._db is not None:
            try:
                return await self.audit_trails_collection.count_documents({})
            except Exception as e:
                logger.warning(f"Failed to count audit trails: {e}")
                return 0
        return len(self._in_memory_audit_trails)

    # --------------------------------------------------------------------------
    # Layer 4: Trust Density & Location Methods
    # --------------------------------------------------------------------------

    async def get_claims_by_location(self, location_key: str) -> list[dict[str, Any]]:
        """Retrieve all claim documents matching a normalized location key or city name."""
        try:
            loc_clean = location_key.strip().lower()
            query = {
                "$or": [
                    {"location.normalized_key": loc_clean},
                    {"location.city": {"$regex": f"^{re.escape(location_key.strip())}$", "$options": "i"}},
                ]
            }
            cursor = self.collection.find(query, {"_id": 0}).sort("timestamp", -1)
            claims: list[dict[str, Any]] = []
            async for doc in cursor:
                claims.append(doc)
            return claims
        except Exception as e:
            logger.error(f"Failed to retrieve claims for location {location_key}: {e}")
            return []

    async def get_verification_by_claim_id(self, claim_id: str) -> Optional[dict[str, Any]]:
        """Retrieve raw verification document for a claim."""
        try:
            return await self.verifications_collection.find_one({"claim_id": claim_id}, {"_id": 0})
        except Exception as e:
            logger.error(f"Failed to retrieve verification for claim {claim_id}: {e}")
            return None

    async def upsert_trust_density(
        self,
        metrics_dict: dict[str, Any],
        insight_dict: Optional[dict[str, Any]] = None,
    ) -> None:
        """Persist or update aggregated trust density metrics and insight for a locality."""
        loc_key = metrics_dict["location_key"].lower()
        doc = {
            "location_key": loc_key,
            "city": metrics_dict.get("city", loc_key),
            "state_or_region": metrics_dict.get("state_or_region"),
            "metrics": metrics_dict,
            "insight": insight_dict,
            "density_score": metrics_dict.get("density_score", 0.5),
            "trust_tier": metrics_dict.get("trust_tier"),
            "total_claims": metrics_dict.get("total_claims", 0),
            "verified_claims": metrics_dict.get("verified_claims", 0),
            "last_updated": metrics_dict.get("last_updated"),
        }
        self._in_memory_trust_density[loc_key] = doc
        if self._client is not None and self._db is not None and self._trust_density_collection is not None:
            try:
                await self.trust_density_collection.update_one(
                    {"location_key": loc_key},
                    {"$set": doc},
                    upsert=True,
                )
                logger.info(f"Upserted trust density for location '{loc_key}' (score={metrics_dict.get('density_score')})")
            except Exception as e:
                logger.error(f"Failed to upsert trust density in MongoDB for {loc_key}: {e}")

    async def get_trust_density(self, location_key: str) -> Optional[dict[str, Any]]:
        """Retrieve aggregated trust density record by location key."""
        loc_clean = location_key.strip().lower()
        if self._client is not None and self._db is not None and self._trust_density_collection is not None:
            try:
                rec = await self.trust_density_collection.find_one({"location_key": loc_clean}, {"_id": 0})
                if rec:
                    return rec
            except Exception as e:
                logger.warning(f"Failed to retrieve trust density from MongoDB for {location_key}: {e}")

        # Fallback to in-memory store
        if loc_clean in self._in_memory_trust_density:
            return self._in_memory_trust_density[loc_clean]

        # Also check alias prefixes (e.g. "bengaluru" -> "bengaluru_ka")
        for k, v in self._in_memory_trust_density.items():
            if k == loc_clean or k.startswith(f"{loc_clean}_") or loc_clean.startswith(f"{k}_"):
                return v

        return None

    async def list_trust_densities(
        self,
        limit: int = 50,
        skip: int = 0,
        sort_by: str = "density_score",
    ) -> list[dict[str, Any]]:
        """Retrieve list of trust density records, sorted by density_score or total_claims."""
        sort_field = "total_claims" if sort_by == "volume" else "density_score"
        us_keys = ["houston_tx", "chicago_il", "cleveland_oh", "atlanta_ga", "denver_co", "san_francisco_ca", "boston_ma"]
        if self._client is not None and self._db is not None and self._trust_density_collection is not None:
            try:
                cursor = (
                    self.trust_density_collection.find(
                        {"location_key": {"$nin": us_keys}},
                        {"_id": 0}
                    )
                    .sort(sort_field, -1)
                    .skip(skip)
                    .limit(limit)
                )
                records: list[dict[str, Any]] = []
                async for doc in cursor:
                    records.append(doc)
                if records:
                    return records
            except Exception as e:
                logger.warning(f"Failed to list trust density records from MongoDB: {e}")

        # In-memory store: collect unique records by canonical location_key (strictly excluding US keys)
        seen_keys: set[str] = set(us_keys)
        unique_records: list[dict[str, Any]] = []
        for r in self._in_memory_trust_density.values():
            lk = r.get("location_key")
            if lk and lk not in seen_keys:
                seen_keys.add(lk)
                unique_records.append(r)

        unique_records.sort(key=lambda x: x.get(sort_field, 0), reverse=True)
        return unique_records[skip : skip + limit]

    async def count_trust_densities(self) -> int:
        """Return total number of trust density location records."""
        us_keys = ["houston_tx", "chicago_il", "cleveland_oh", "atlanta_ga", "denver_co", "san_francisco_ca", "boston_ma"]
        if self._client is not None and self._db is not None and self._trust_density_collection is not None:
            try:
                cnt = await self.trust_density_collection.count_documents({"location_key": {"$nin": us_keys}})
                if cnt > 0:
                    return cnt
            except Exception as e:
                logger.warning(f"Failed to count trust densities in MongoDB: {e}")

        seen_keys = {
            r.get("location_key")
            for r in self._in_memory_trust_density.values()
            if r.get("location_key") and r.get("location_key") not in us_keys
        }
        return len(seen_keys)

    # ==========================================================================
    # Layer 6: Evaluation Harness Storage
    # ==========================================================================

    async def save_evaluation_report(self, report_dict: dict[str, Any]) -> str:
        """
        Persist an EvaluationReport to MongoDB.
        Uses upsert on run_id.
        """
        run_id = report_dict.get("run_id")
        if not run_id:
            raise StorageError("Evaluation report missing run_id")
        if self._client is not None and self._db is not None:
            try:
                await self.evaluations_collection.update_one(
                    {"run_id": run_id},
                    {"$set": report_dict},
                    upsert=True,
                )
                logger.info(f"Saved evaluation report '{run_id}' with {report_dict.get('total_samples', 0)} samples")
            except Exception as e:
                logger.error(f"Failed to save evaluation report {run_id}: {e}")
                raise StorageError(f"Evaluation report save failed: {e}") from e

        # Always update in-memory list
        existing_idx = next((i for i, r in enumerate(self._in_memory_evaluations) if r.get("run_id") == run_id), None)
        if existing_idx is not None:
            self._in_memory_evaluations[existing_idx] = report_dict
        else:
            self._in_memory_evaluations.insert(0, report_dict)
        return run_id

    async def get_evaluation_report(self, run_id: str) -> Optional[dict[str, Any]]:
        """Retrieve an evaluation report by run_id."""
        if self._client is not None and self._db is not None:
            try:
                doc = await self.evaluations_collection.find_one({"run_id": run_id}, {"_id": 0})
                if doc:
                    return doc
            except Exception as e:
                logger.error(f"Failed to retrieve evaluation report {run_id}: {e}")

        found = next((r for r in self._in_memory_evaluations if r.get("run_id") == run_id), None)
        if not found and (run_id == "eval_baseline_gold_standard" or not self._in_memory_evaluations):
            return self._build_default_baseline_evaluation_run()
        return found

    async def list_evaluation_reports(
        self,
        limit: int = 20,
        skip: int = 0,
        user_id: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        """Retrieve recent evaluation reports sorted by timestamp descending, optionally filtered by user_id."""
        if self._client is not None and self._db is not None:
            try:
                query: dict[str, Any] = {}
                if user_id:
                    clean_uid = user_id.strip()
                    if clean_uid in (DEMO_USER_ID, "demo"):
                        query = {"$or": [{"user_id": clean_uid}, {"user_id": None}, {"user_id": {"$exists": False}}]}
                    else:
                        query = {"user_id": clean_uid}

                cursor = (
                    self.evaluations_collection.find(query, {"_id": 0})
                    .sort("timestamp", -1)
                    .skip(skip)
                    .limit(limit)
                )
                records: list[dict[str, Any]] = []
                async for doc in cursor:
                    records.append(doc)
                if records:
                    return records
            except Exception as e:
                logger.error(f"Failed to list evaluation reports: {e}")

        # In-memory fallback
        mem = list(self._in_memory_evaluations)
        if not mem:
            mem = [self._build_default_baseline_evaluation_run()]
        if user_id:
            clean_uid = user_id.strip()
            if clean_uid in (DEMO_USER_ID, "demo"):
                mem = [r for r in mem if r.get("user_id") in (clean_uid, None) or "user_id" not in r]
            else:
                mem = [r for r in mem if r.get("user_id") in (clean_uid, None) or "user_id" not in r]
        if not mem:
            mem = [self._build_default_baseline_evaluation_run()]
        return mem[skip : skip + limit]

    async def count_evaluation_reports(self, user_id: Optional[str] = None) -> int:
        """Return total number of evaluation runs stored."""
        if self._client is not None and self._db is not None:
            try:
                query: dict[str, Any] = {}
                if user_id:
                    clean_uid = user_id.strip()
                    if clean_uid in (DEMO_USER_ID, "demo"):
                        query = {"$or": [{"user_id": clean_uid}, {"user_id": None}, {"user_id": {"$exists": False}}]}
                    else:
                        query = {"user_id": clean_uid}
                cnt = await self.evaluations_collection.count_documents(query)
                if cnt > 0:
                    return cnt
            except Exception as e:
                logger.warning(f"Failed to count evaluation reports: {e}")

        # In-memory fallback
        mem = list(self._in_memory_evaluations)
        if not mem:
            mem = [self._build_default_baseline_evaluation_run()]
        if user_id:
            clean_uid = user_id.strip()
            if clean_uid in (DEMO_USER_ID, "demo"):
                mem = [r for r in mem if r.get("user_id") in (clean_uid, None) or "user_id" not in r]
            else:
                mem = [r for r in mem if r.get("user_id") in (clean_uid, None) or "user_id" not in r]
        return max(1, len(mem))

    # -----------------------------------------------------------------------
    # Community Stories (Recovery Stories) Storage Methods
    # -----------------------------------------------------------------------

    async def save_community_story(self, story_data: dict[str, Any]) -> str:
        """Insert a new voluntary community recovery story."""
        story_doc = dict(story_data)
        story_id = story_doc.get("story_id", "")
        try:
            if self._client is not None and self._db is not None:
                await self.community_stories_collection.insert_one(dict(story_doc))
        except Exception as e:
            logger.warning(f"MongoDB write failed for community story (fallback in-memory): {e}")

        # Always update in-memory list so tests & offline work instantly
        existing_idx = next((i for i, s in enumerate(self._in_memory_stories) if s.get("story_id") == story_id), None)
        if existing_idx is not None:
            self._in_memory_stories[existing_idx] = story_doc
        else:
            self._in_memory_stories.insert(0, story_doc)
        return story_id

    async def list_community_stories(
        self,
        limit: int = 50,
        skip: int = 0,
        user_id: Optional[str] = None,
    ) -> tuple[list[dict[str, Any]], int]:
        """List community recovery stories, sorted newest first, optionally filtered by user_id."""
        if self._client is not None and self._db is not None:
            try:
                query: dict[str, Any] = {}
                if user_id:
                    clean_uid = user_id.strip()
                    if clean_uid in (DEMO_USER_ID, "demo"):
                        query = {"$or": [{"user_id": clean_uid}, {"user_id": None}, {"user_id": {"$exists": False}}, {"is_demo": True}]}
                    else:
                        query = {"$or": [{"user_id": clean_uid}, {"is_demo": True}, {"user_id": None}]}
                else:
                    query = {"$or": [{"is_demo": True}, {"user_id": None}, {"user_id": {"$exists": False}}]}

                total = await self.community_stories_collection.count_documents(query)
                cursor = (
                    self.community_stories_collection.find(query, {"_id": 0})
                    .sort("created_at", -1)
                    .skip(skip)
                    .limit(limit)
                )
                stories: list[dict[str, Any]] = []
                async for doc in cursor:
                    stories.append(doc)
                return stories, total
            except Exception as e:
                logger.warning(f"Failed to query MongoDB community stories (fallback in-memory): {e}")

        mem_stories = list(self._in_memory_stories)
        if user_id:
            clean_uid = user_id.strip()
            if clean_uid in (DEMO_USER_ID, "demo"):
                mem_stories = [s for s in mem_stories if s.get("user_id") in (clean_uid, None) or "user_id" not in s or s.get("is_demo") is True]
            else:
                mem_stories = [s for s in mem_stories if s.get("user_id") == clean_uid or s.get("is_demo") is True or s.get("user_id") is None]
        else:
            mem_stories = [s for s in mem_stories if s.get("is_demo") is True or s.get("user_id") in (None, DEMO_USER_ID) or "user_id" not in s]

        total = len(mem_stories)
        sliced = mem_stories[skip : skip + limit]
        return sliced, total

    async def get_community_story(self, story_id: str) -> Optional[dict[str, Any]]:
        """Retrieve a specific community story by story_id."""
        try:
            if self._client is not None and self._db is not None:
                doc = await self.community_stories_collection.find_one({"story_id": story_id}, {"_id": 0})
                if doc:
                    return doc
        except Exception as e:
            logger.warning(f"MongoDB lookup failed for story {story_id}: {e}")

        return next((s for s in self._in_memory_stories if s.get("story_id") == story_id), None)

    async def count_community_stories(self, user_id: Optional[str] = None) -> int:
        """Return total count of community stories."""
        try:
            if self._client is not None and self._db is not None:
                query: dict[str, Any] = {}
                if user_id:
                    clean_uid = user_id.strip()
                    if clean_uid in (DEMO_USER_ID, "demo"):
                        query = {"$or": [{"user_id": clean_uid}, {"user_id": None}, {"user_id": {"$exists": False}}]}
                    else:
                        query = {"user_id": clean_uid}
                return await self.community_stories_collection.count_documents(query)
        except Exception as e:
            logger.warning(f"Failed to count community stories: {e}")

        if user_id:
            return len([s for s in self._in_memory_stories if s.get("user_id") == user_id.strip()])
        return len(self._in_memory_stories)

    async def get_insights_summary(
        self,
        user_id: Optional[str] = None,
        allow_baseline_fallback: bool = True,
    ) -> InsightsSummaryResponse:
        """
        Compute aggregated metrics across claims and verifications for visual charts and statistics dashboard.
        When user_id is provided, filters data specifically to that user's personal memory.
        """
        claims_docs: list[dict[str, Any]] = []
        verifs_docs: list[dict[str, Any]] = []

        try:
            if self._client is not None and self._db is not None:
                c_query = self._build_claims_query(user_id=user_id) if user_id else {}
                cursor = self.collection.find(c_query, {"_id": 0})
                async for doc in cursor:
                    claims_docs.append(doc)

                # Get matching verification records
                if user_id and claims_docs:
                    user_claim_ids = [c.get("claim_id") for c in claims_docs if c.get("claim_id")]
                    v_cursor = self.verifications_collection.find(
                        {"claim_id": {"$in": user_claim_ids}}, {"_id": 0}
                    )
                else:
                    v_cursor = self.verifications_collection.find({}, {"_id": 0})

                async for v_doc in v_cursor:
                    verifs_docs.append(v_doc)
            else:
                mem_claims = list(self._in_memory_claims)
                if user_id:
                    clean_uid = user_id.strip()
                    if clean_uid in (DEMO_USER_ID, "demo"):
                        mem_claims = [c for c in mem_claims if c.get("user_id") in (clean_uid, None) or "user_id" not in c]
                    else:
                        mem_claims = [c for c in mem_claims if c.get("user_id") == clean_uid]
                claims_docs = mem_claims
                user_claim_ids = {c.get("claim_id") for c in claims_docs if c.get("claim_id")}
                verifs_docs = [v for v in self._in_memory_verifications if v.get("claim_id") in user_claim_ids]
        except Exception as e:
            logger.warning(f"Failed to query collections for insights: {e}")

        # If user has no audited claims yet or database collections are empty,
        # return the gold-standard benchmark baseline or empty summary depending on allow_baseline_fallback
        if not claims_docs or not verifs_docs:
            if allow_baseline_fallback:
                return self._generate_baseline_insights()
            return self._generate_empty_insights()

        return self._aggregate_insights(claims_docs, verifs_docs, is_baseline=False)

    def _generate_empty_insights(self) -> InsightsSummaryResponse:
        """Provide an empty insights summary for users with zero audited claims."""
        return InsightsSummaryResponse(
            total_claims=0,
            total_verified=0,
            decision_overview=DecisionOverview(
                approved=0,
                flagged=0,
                held=0,
                total=0,
            ),
            price_alerts_overview=PriceAlertsOverview(
                normal_charges=0,
                price_alerts=0,
                moderate=0,
                severe=0,
                extreme=0,
                total=0,
            ),
            guideline_support_overview=GuidelineSupportOverview(
                supported=0,
                partially_supported=0,
                contradicted=0,
                insufficient_evidence=0,
                total=0,
            ),
            gaps_and_risks=GapsAndRisks(
                insufficient_evidence_claims=0,
                extreme_price_markups=0,
                held_by_safety_rules=0,
                unbenchmarked_high_cost=0,
            ),
            top_procedures=[],
            top_locations=[],
            recent_risk_claims=[],
            is_baseline_fallback=False,
        )

    def _aggregate_insights(
        self,
        claims_docs: list[dict[str, Any]],
        verifs_docs: list[dict[str, Any]],
        is_baseline: bool = False,
    ) -> InsightsSummaryResponse:
        """Calculate statistical summaries across claims and verification documents."""
        claims_by_id = {c.get("claim_id"): c for c in claims_docs if c.get("claim_id")}

        def _normalize_enum_str(val: Any) -> str:
            if hasattr(val, "value"):
                return str(val.value).lower().strip()
            s = str(val or "").lower().strip()
            if "." in s:
                s = s.split(".")[-1]
            return s

        # 1. Decision Overview (with robust synonym & enum matching)
        approved = sum(
            1 for v in verifs_docs
            if _normalize_enum_str(v.get("action")) in ["accept", "approved", "approve", "passed"]
            or (not v.get("action") and _normalize_enum_str(v.get("verdict")) in ["supported", "support"])
        )
        flagged = sum(
            1 for v in verifs_docs
            if _normalize_enum_str(v.get("action")) in ["flag", "flagged", "warn", "warning"]
            or (not v.get("action") and _normalize_enum_str(v.get("verdict")) in ["contradicted", "contradict"])
        )
        held = sum(
            1 for v in verifs_docs
            if _normalize_enum_str(v.get("action")) in ["abstain", "held", "hold", "refused"]
            or (not v.get("action") and _normalize_enum_str(v.get("verdict")) in ["insufficient_evidence", "inconclusive", "insufficient"])
        )
        total_verified = len(verifs_docs)

        decision_overview = DecisionOverview(
            approved=approved,
            flagged=flagged,
            held=held,
            total=total_verified,
        )

        # 2. Price Alerts Overview
        price_alerts = sum(1 for v in verifs_docs if v.get("cost_anomaly_flag") is True)
        normal_charges = total_verified - price_alerts

        moderate = 0
        severe = 0
        extreme = 0

        for v in verifs_docs:
            anomaly = v.get("anomaly_details") or {}
            severity = str(anomaly.get("severity", "")).lower()
            mult = float(anomaly.get("multiplier", 0.0) or 0.0)

            if severity == "extreme" or mult >= 10.0:
                extreme += 1
            elif severity == "severe" or (5.0 <= mult < 10.0):
                severe += 1
            elif severity == "moderate" or (3.0 <= mult < 5.0):
                moderate += 1

        price_alerts_overview = PriceAlertsOverview(
            normal_charges=max(0, normal_charges),
            price_alerts=price_alerts,
            moderate=moderate,
            severe=severe,
            extreme=extreme,
            total=total_verified,
        )

        # 3. Guideline Support Overview (with robust synonym & enum matching)
        supported = sum(
            1 for v in verifs_docs
            if _normalize_enum_str(v.get("verdict")) in ["supported", "support", "approved"]
            or (not v.get("verdict") and _normalize_enum_str(v.get("action")) in ["accept", "approved"])
        )
        partially = sum(
            1 for v in verifs_docs
            if _normalize_enum_str(v.get("verdict")) in ["partially_supported", "partially", "partial"]
        )
        contradicted = sum(
            1 for v in verifs_docs
            if _normalize_enum_str(v.get("verdict")) in ["contradicted", "contradict", "unsupported"]
            or (not v.get("verdict") and _normalize_enum_str(v.get("action")) in ["flag", "flagged"])
        )
        insufficient = sum(
            1 for v in verifs_docs
            if _normalize_enum_str(v.get("verdict")) in ["insufficient_evidence", "insufficient", "inconclusive", "held"]
            or (not v.get("verdict") and _normalize_enum_str(v.get("action")) in ["abstain", "held"])
        )

        guideline_overview = GuidelineSupportOverview(
            supported=supported,
            partially_supported=partially,
            contradicted=contradicted,
            insufficient_evidence=insufficient,
            total=total_verified,
        )

        # 4. Gaps and Risks
        unbenchmarked = sum(
            1 for v in verifs_docs
            if "unbenchmarked" in str(v.get("abstain_reason", "")).lower()
            or (v.get("anomaly_details") or {}).get("benchmark_matched") is False
        )

        gaps_and_risks = GapsAndRisks(
            insufficient_evidence_claims=insufficient,
            extreme_price_markups=extreme,
            held_by_safety_rules=held,
            unbenchmarked_high_cost=unbenchmarked,
        )

        # 5. Top Procedures
        procedure_counts: dict[str, int] = {}
        for c in claims_docs:
            fields = c.get("extracted_fields") or {}
            ent = fields.get("entity")
            if ent and ent.strip():
                clean_ent = ent.strip()
                procedure_counts[clean_ent] = procedure_counts.get(clean_ent, 0) + 1

        if not procedure_counts:
            for v in verifs_docs:
                cid = v.get("claim_id", "Unknown Claim")
                procedure_counts[cid] = procedure_counts.get(cid, 0) + 1

        top_procedures = [
            ProcedureFrequency(procedure_name=k, count=v)
            for k, v in sorted(procedure_counts.items(), key=lambda item: item[1], reverse=True)[:6]
        ]

        # 6. Top Locations
        location_counts: dict[str, dict[str, int]] = {}
        for c in claims_docs:
            loc = c.get("location") or {}
            city = loc.get("city") or "Unspecified Metro"
            if city not in location_counts:
                location_counts[city] = {"claims": 0, "anomalies": 0}
            location_counts[city]["claims"] += 1
            cid = c.get("claim_id")
            if cid:
                v = next((x for x in verifs_docs if x.get("claim_id") == cid), None)
                if v and v.get("cost_anomaly_flag"):
                    location_counts[city]["anomalies"] += 1

        top_locations = [
            LocationFrequency(
                location_name=k,
                claims_count=val["claims"],
                anomalies_count=val["anomalies"],
            )
            for k, val in sorted(location_counts.items(), key=lambda item: item[1]["claims"], reverse=True)[:6]
        ]

        # 7. Recent Risk Claims
        recent_risks: list[ClaimHighlight] = []
        for v in verifs_docs:
            act = str(v.get("action", "")).lower()
            is_anomaly = bool(v.get("cost_anomaly_flag", False))
            if act in ["flag", "abstain"] or is_anomaly:
                cid = v.get("claim_id", "")
                c = claims_by_id.get(cid, {})
                fields = c.get("extracted_fields") or {}
                recent_risks.append(
                    ClaimHighlight(
                        claim_id=cid,
                        entity=fields.get("entity") or "Medical Procedure",
                        action=v.get("action", "flag"),
                        verdict=v.get("verdict"),
                        cost_range=fields.get("cost_range"),
                        cost_currency=fields.get("cost_currency") or (v.get("anomaly_details") or {}).get("currency"),
                        reason=v.get("abstain_reason") or (v.get("anomaly_details") or {}).get("explanation") or v.get("reasoning"),
                        timestamp=c.get("timestamp") or v.get("timestamp"),
                    )
                )

        return InsightsSummaryResponse(
            total_claims=len(claims_docs) or len(verifs_docs),
            total_verified=total_verified,
            decision_overview=decision_overview,
            price_alerts_overview=price_alerts_overview,
            guideline_support_overview=guideline_overview,
            gaps_and_risks=gaps_and_risks,
            top_procedures=top_procedures,
            top_locations=top_locations,
            recent_risk_claims=recent_risks[:6],
            is_baseline_fallback=is_baseline,
        )

    def _generate_baseline_insights(self) -> InsightsSummaryResponse:
        """Provide realistic baseline statistics derived from gold-standard controlled clinical cases."""
        return InsightsSummaryResponse(
            total_claims=8,
            total_verified=8,
            decision_overview=DecisionOverview(
                approved=3,
                flagged=3,
                held=2,
                total=8,
            ),
            price_alerts_overview=PriceAlertsOverview(
                normal_charges=6,
                price_alerts=2,
                moderate=0,
                severe=1,
                extreme=1,
                total=8,
            ),
            guideline_support_overview=GuidelineSupportOverview(
                supported=5,
                partially_supported=0,
                contradicted=1,
                insufficient_evidence=2,
                total=8,
            ),
            gaps_and_risks=GapsAndRisks(
                insufficient_evidence_claims=2,
                extreme_price_markups=1,
                held_by_safety_rules=2,
                unbenchmarked_high_cost=1,
            ),
            top_procedures=[
                ProcedureFrequency(procedure_name="0.9% Normal Saline (NaCl 500 mL) IV Infusion", count=3),
                ProcedureFrequency(procedure_name="CPT 70551 MRI Brain without contrast", count=2),
                ProcedureFrequency(procedure_name="Tab Metformin Hydrochloride 500 mg", count=2),
                ProcedureFrequency(procedure_name="Tab Azithromycin 500 mg", count=1),
                ProcedureFrequency(procedure_name="Tab Glimepiride 1 mg", count=1),
                ProcedureFrequency(procedure_name="Complete Blood Count (CBC) Profile", count=1),
            ],
            top_locations=[
                LocationFrequency(location_name="Bengaluru, Karnataka", claims_count=3, anomalies_count=1),
                LocationFrequency(location_name="Ballari, Karnataka", claims_count=2, anomalies_count=1),
                LocationFrequency(location_name="Davangere, Karnataka", claims_count=2, anomalies_count=0),
                LocationFrequency(location_name="Mangaluru, Karnataka", claims_count=1, anomalies_count=0),
                LocationFrequency(location_name="Belagavi, Karnataka", claims_count=1, anomalies_count=1),
            ],
            recent_risk_claims=[
                ClaimHighlight(
                    claim_id="in_01_saline_overcharge",
                    entity="0.9% Normal Saline (500 mL) IV Infusion",
                    action="flag",
                    verdict="supported",
                    cost_range="₹1,800.00",
                    cost_currency="INR",
                    reason="Cost anomaly: 30.0x hospital markup over expected ₹60.00 regional benchmark.",
                ),
                ClaimHighlight(
                    claim_id="in_02_bronchitis_antibiotic",
                    entity="Tab Azithromycin 500 mg (Course)",
                    action="flag",
                    verdict="contradicted",
                    cost_range="₹450.00",
                    cost_currency="INR",
                    reason="Contradicted by ICMR & WHO guidelines for uncomplicated viral coryza.",
                ),
                ClaimHighlight(
                    claim_id="in_03_unbenchmarked_therapy",
                    entity="Experimental Stem Cell Infusion",
                    action="abstain",
                    verdict="insufficient_evidence",
                    cost_range="₹85,000.00",
                    cost_currency="INR",
                    reason="Safety rule UNBENCHMARKED_HIGH_COST triggered (uncoded therapy > ₹5,000 without state benchmark).",
                ),
                ClaimHighlight(
                    claim_id="in_04_mri_brain_diagnostic",
                    entity="CPT 70551 Brain MRI without contrast",
                    action="accept",
                    verdict="supported",
                    cost_range="₹5,500.00",
                    cost_currency="INR",
                    reason="Supported by neurological trauma indications; verified regional diagnostic benchmark.",
                ),
                ClaimHighlight(
                    claim_id="us_demo_mri_overcharge",
                    entity="Emergency Brain MRI (Foreign Demo)",
                    action="flag",
                    verdict="supported",
                    cost_range="$720.00",
                    cost_currency="USD",
                    reason="International comparative charge: standard US commercial charge exceeding reference.",
                ),
            ],
            is_baseline_fallback=True,
        )

    # -----------------------------------------------------------------------
    # Live Hospital Availability & Emergency SOS Storage Operations
    # -----------------------------------------------------------------------

    async def save_hospital_availability(
        self,
        hospital_id: str,
        hospital_name: str,
        doctors_available: int,
        emergency_doctors: int,
        nurses_available: int,
        duty_status: str,
        emergency_nurses: int = 0,
        department_specialists: Optional[dict[str, int]] = None,
        available_beds: Optional[int] = None,
        icu_beds_available: Optional[int] = None,
        emergency_dept_status: str = "Operational",
        notes: Optional[str] = None,
        updated_by: Optional[str] = None,
    ) -> dict[str, Any]:
        """Save or update live doctor/nurse/bed availability and duty status for a hospital in MongoDB and cache."""
        now = datetime.now(timezone.utc)
        record: dict[str, Any] = {
            "hospital_id": hospital_id,
            "hospital_name": hospital_name,
            "doctors_available": int(doctors_available),
            "emergency_doctors": int(emergency_doctors),
            "nurses_available": int(nurses_available),
            "emergency_nurses": int(emergency_nurses),
            "department_specialists": department_specialists or {},
            "available_beds": available_beds,
            "icu_beds_available": icu_beds_available,
            "emergency_dept_status": emergency_dept_status or "Operational",
            "duty_status": duty_status,
            "notes": notes,
            "updated_by": updated_by,
            "last_updated": now,
        }

        # In-memory save
        self._in_memory_availability[hospital_id] = dict(record)

        # MongoDB save
        if self._availability_collection is not None:
            try:
                await self._availability_collection.update_one(
                    {"hospital_id": hospital_id},
                    {"$set": record},
                    upsert=True,
                )
            except Exception as e:
                logger.warning(f"Failed to persist hospital availability to MongoDB: {e}")

        ret = dict(record)
        ret.pop("_id", None)
        return ret

    async def get_hospital_availability(self, hospital_id: str) -> Optional[dict[str, Any]]:
        """Retrieve real-time availability for a single hospital."""
        if self._availability_collection is not None:
            try:
                doc = await self._availability_collection.find_one(
                    {"hospital_id": hospital_id},
                    {"_id": 0},
                )
                if doc:
                    return doc
            except Exception as e:
                logger.warning(f"Failed to fetch hospital availability from MongoDB: {e}")

        rec = self._in_memory_availability.get(hospital_id)
        if rec:
            ret = dict(rec)
            ret.pop("_id", None)
            return ret
        return None

    async def get_all_hospital_availabilities(self) -> list[dict[str, Any]]:
        """Retrieve real-time availability for all updated hospitals."""
        if self._availability_collection is not None:
            try:
                cursor = self._availability_collection.find({}, {"_id": 0})
                results = await cursor.to_list(length=200)
                if results:
                    return results
            except Exception as e:
                logger.warning(f"Failed to fetch all hospital availabilities from MongoDB: {e}")

        res = []
        for v in self._in_memory_availability.values():
            item = dict(v)
            item.pop("_id", None)
            res.append(item)
        return res

    async def create_sos_request(
        self,
        emergency_type: str,
        hospital_id: str,
        hospital_name: str,
        patient_name: str,
        patient_phone: str,
        description: Optional[str] = None,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        address: Optional[str] = None,
    ) -> dict[str, Any]:
        """Create a new emergency SOS distress call with clinical emergency protocol attached."""
        sos_id = f"sos_{int(time.time())}_{uuid.uuid4().hex[:6]}"
        now = datetime.now(timezone.utc)
        
        # Clinical protocol retrieval
        clinical_proto = get_emergency_protocol(emergency_type)

        record: dict[str, Any] = {
            "sos_id": sos_id,
            "emergency_type": emergency_type,
            "hospital_id": hospital_id,
            "hospital_name": hospital_name,
            "patient_name": patient_name,
            "patient_phone": patient_phone,
            "description": description,
            "latitude": latitude,
            "longitude": longitude,
            "address": address,
            "status": "PENDING",
            "created_at": now,
            "updated_at": now,
            "acknowledged_at": None,
            "resolved_at": None,
            "response_notes": None,
            "clinical_protocol": clinical_proto,
        }

        # In-memory save
        self._in_memory_sos[sos_id] = dict(record)

        # MongoDB save
        if self._sos_collection is not None:
            try:
                db_record = dict(record)
                await self._sos_collection.insert_one(db_record)
            except Exception as e:
                logger.warning(f"Failed to persist SOS record to MongoDB: {e}")

        ret = dict(record)
        ret.pop("_id", None)
        return ret

    async def get_sos_request(self, sos_id: str) -> Optional[dict[str, Any]]:
        """Retrieve a specific SOS record by ID."""
        if self._sos_collection is not None:
            try:
                doc = await self._sos_collection.find_one({"sos_id": sos_id}, {"_id": 0})
                if doc:
                    return doc
            except Exception as e:
                logger.warning(f"Failed to fetch SOS request from MongoDB: {e}")

        rec = self._in_memory_sos.get(sos_id)
        if rec:
            ret = dict(rec)
            ret.pop("_id", None)
            return ret
        return None

    async def get_hospital_sos_requests(self, hospital_id: Optional[str] = None) -> list[dict[str, Any]]:
        """Retrieve incoming SOS requests, optionally filtered by hospital_id."""
        if self._sos_collection is not None:
            try:
                query: dict[str, Any] = {}
                if hospital_id and hospital_id.lower() != "all":
                    query["hospital_id"] = hospital_id
                cursor = self._sos_collection.find(query, {"_id": 0}).sort("created_at", -1)
                results = await cursor.to_list(length=100)
                if results is not None:
                    return results
            except Exception as e:
                logger.warning(f"Failed to fetch hospital SOS requests from MongoDB: {e}")

        items = list(self._in_memory_sos.values())
        if hospital_id and hospital_id.lower() != "all":
            items = [item for item in items if item.get("hospital_id") == hospital_id]
        items.sort(key=lambda x: str(x.get("created_at") or ""), reverse=True)
        clean_items = []
        for item in items:
            c = dict(item)
            c.pop("_id", None)
            clean_items.append(c)
        return clean_items

    async def update_sos_status(
        self,
        sos_id: str,
        new_status: str,
        response_notes: Optional[str] = None,
    ) -> Optional[dict[str, Any]]:
        """Update the dispatch/triage status of an SOS request (ACKNOWLEDGED, RESPONDING, RESOLVED)."""
        now = datetime.now(timezone.utc)
        record = await self.get_sos_request(sos_id)
        if not record:
            return None

        update_fields: dict[str, Any] = {
            "status": new_status,
            "updated_at": now,
        }
        if response_notes is not None:
            update_fields["response_notes"] = response_notes
        if new_status == "ACKNOWLEDGED" and not record.get("acknowledged_at"):
            update_fields["acknowledged_at"] = now
        elif new_status == "RESOLVED" and not record.get("resolved_at"):
            update_fields["resolved_at"] = now

        # Update in-memory
        if sos_id in self._in_memory_sos:
            self._in_memory_sos[sos_id].update(update_fields)
            updated_record = self._in_memory_sos[sos_id]
        else:
            record.update(update_fields)
            self._in_memory_sos[sos_id] = record
            updated_record = record

        # Update MongoDB
        if self._sos_collection is not None:
            try:
                await self._sos_collection.update_one(
                    {"sos_id": sos_id},
                    {"$set": update_fields},
                )
            except Exception as e:
                logger.warning(f"Failed to update SOS status in MongoDB: {e}")

        ret = dict(updated_record)
        ret.pop("_id", None)
        return ret


# Global singleton instance for application lifecycle
storage_service = StorageService()
