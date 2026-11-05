"""
Application configuration for EvidenceBridge using Pydantic Settings.
Reads environment variables or fallback defaults.
"""

import os
from functools import lru_cache
from pathlib import Path
from typing import Optional
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


_ROOT_ENV = Path(__file__).resolve().parent.parent.parent / ".env"
_LOCAL_ENV = Path(".env")
_PARENT_ENV = Path("../.env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=tuple(str(p) for p in [_ROOT_ENV, _LOCAL_ENV, _PARENT_ENV] if p.exists() or True),
        env_file_encoding="utf-8",
        extra="ignore"
    )

    APP_NAME: str = "EvidenceBridge"
    APP_VERSION: str = "0.1.0"
    APP_ENV: str = "development"
    DEBUG: bool = False
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # CORS Configuration
    ALLOWED_ORIGINS: str = Field(
        default_factory=lambda: os.getenv("ALLOWED_ORIGINS")
        or "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000,http://localhost:8000,http://127.0.0.1:8000"
    )

    @property
    def cors_allowed_origins(self) -> list[str]:
        """
        Parses and returns list of allowed origins from ALLOWED_ORIGINS setting or environment variable.
        In development (APP_ENV == 'development'), ensures local dev origins (e.g. localhost:5173) are included.
        In production, allows only explicitly configured frontend origins.
        Never emits wildcard '*' when allow_credentials=True.
        """
        raw = os.getenv("ALLOWED_ORIGINS") or self.ALLOWED_ORIGINS or ""
        parsed = [o.strip().rstrip("/") for o in raw.split(",") if o.strip() and o.strip() != "*"]

        # In development mode, always ensure standard local dev origins are present
        if self.APP_ENV.lower() == "development":
            dev_defaults = [
                "http://localhost:5173",
                "http://127.0.0.1:5173",
                "http://localhost:3000",
                "http://127.0.0.1:3000",
                "http://localhost:8000",
                "http://127.0.0.1:8000",
            ]
            for d in dev_defaults:
                if d not in parsed:
                    parsed.append(d)

        return parsed if parsed else ["http://localhost:5173", "http://127.0.0.1:5173"]

    # MongoDB Configuration
    # Supports MONGODB_URI (e.g. from Atlas / cloud deployment) or fallback MONGODB_URL
    MONGODB_URI: Optional[str] = None
    MONGODB_URL: Optional[str] = "mongodb://localhost:27017"
    MONGODB_DB_NAME: str = "evidencebridge"
    MONGODB_USERS_COLLECTION: str = "users"
    MONGODB_CLAIMS_COLLECTION: str = "claims"
    MONGODB_VERIFICATIONS_COLLECTION: str = "verifications"
    MONGODB_AUDIT_TRAILS_COLLECTION: str = "audit_trails"
    MONGODB_TRUST_DENSITY_COLLECTION: str = "trust_density"
    MONGODB_COMMUNITY_STORIES_COLLECTION: str = "community_stories"
    MONGODB_TIMEOUT_MS: int = 5000

    # JWT / Auth Configuration
    AUTH_SECRET_KEY: str = Field(
        default_factory=lambda: os.getenv("AUTH_SECRET_KEY") or os.getenv("JWT_SECRET") or "evidencebridge_jwt_secret_portfolio_key_change_in_prod_2026"
    )
    AUTH_ALGORITHM: str = "HS256"
    AUTH_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    # SMTP Email Configuration
    SMTP_HOST: str = Field(
        default_factory=lambda: os.getenv("SMTP_HOST") or "smtp.gmail.com"
    )
    SMTP_PORT: int = Field(
        default_factory=lambda: int(os.getenv("SMTP_PORT", "587"))
    )
    SMTP_USERNAME: Optional[str] = Field(
        default_factory=lambda: os.getenv("SMTP_USERNAME") or os.getenv("SMTP_USER")
    )
    SMTP_PASSWORD: Optional[str] = Field(
        default_factory=lambda: os.getenv("SMTP_PASSWORD") or os.getenv("SMTP_PASS")
    )
    SMTP_FROM_EMAIL: str = Field(
        default_factory=lambda: os.getenv("SMTP_FROM_EMAIL") or os.getenv("SMTP_FROM") or "security@evidencebridge.local"
    )
    SMTP_FROM_NAME: str = Field(
        default_factory=lambda: os.getenv("SMTP_FROM_NAME") or "EvidenceBridge Security Desk"
    )
    SMTP_TLS: bool = Field(
        default_factory=lambda: os.getenv("SMTP_TLS", "true").lower() in ("true", "1", "yes")
    )
    SMTP_SSL: bool = Field(
        default_factory=lambda: os.getenv("SMTP_SSL", "false").lower() in ("true", "1", "yes")
    )
    SMTP_TIMEOUT_SECONDS: float = Field(
        default_factory=lambda: float(os.getenv("SMTP_TIMEOUT_SECONDS", "10.0"))
    )

    # OTP Security Policy Configuration
    OTP_EXPIRATION_SECONDS: int = Field(
        default_factory=lambda: int(os.getenv("OTP_EXPIRATION_SECONDS", "600"))  # 10 minutes
    )
    OTP_RESEND_COOLDOWN_SECONDS: int = Field(
        default_factory=lambda: int(os.getenv("OTP_RESEND_COOLDOWN_SECONDS", "30"))  # 30 seconds
    )
    OTP_MAX_ATTEMPTS: int = Field(
        default_factory=lambda: int(os.getenv("OTP_MAX_ATTEMPTS", "5"))
    )
    OTP_ALLOW_DEV_FALLBACK: bool = Field(
        default_factory=lambda: os.getenv("OTP_ALLOW_DEV_FALLBACK", "true").lower() in ("true", "1", "yes")
    )

    @property
    def mongodb_connection_uri(self) -> str:
        """
        Securely returns MongoDB connection URI from MONGODB_URI or MONGODB_URL.
        Prefers valid connection strings without unreplaced placeholders (<password>, <db_password>).
        Strict security rule: never log, print, or expose this string.
        """
        for candidate in (self.MONGODB_URI, self.MONGODB_URL):
            if candidate and candidate.strip():
                clean = candidate.strip()
                if "<db_password>" not in clean and "<password>" not in clean:
                    return clean
        # If neither has real credentials or placeholders remain, return local default
        return "mongodb://localhost:27017"

    # LLM Provider Configuration ("gemini" or "ollama")
    LLM_PROVIDER: str = Field(
        default_factory=lambda: os.getenv("LLM_PROVIDER") or "gemini"
    )

    # Google Gemini API Configuration
    GEMINI_API_KEY: Optional[str] = Field(
        default_factory=lambda: os.getenv("GEMINI_API_KEY")
    )
    GEMINI_MODEL: str = Field(
        default_factory=lambda: os.getenv("GEMINI_MODEL") or "gemini-3.1-flash-lite"
    )
    GEMINI_BASE_URL: str = "https://generativelanguage.googleapis.com/v1beta"
    GEMINI_TIMEOUT_SECONDS: float = 45.0

    # Ollama Local LLM Configuration
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    OLLAMA_MODEL: str = "phi3:mini"
    OLLAMA_TIMEOUT_SECONDS: float = 60.0

    # Knowledge Base & Verification
    KNOWLEDGE_BASE_DIR: str = "./data/knowledge"
    COST_ANOMALY_THRESHOLD_MULTIPLIER: float = 3.0
    RETRIEVAL_RELEVANCE_THRESHOLD: float = 0.35
    MIN_CONFIDENCE_THRESHOLD: float = 0.40
    ABSTAIN_ON_UNBENCHMARKED_HIGH_COST: bool = True

    # Hyperlocal Trust Density Configuration
    TRUST_DENSITY_SUPPORT_WEIGHT: float = 0.45
    TRUST_DENSITY_ANOMALY_WEIGHT: float = 0.35
    TRUST_DENSITY_VOLUME_WEIGHT: float = 0.20
    TRUST_DENSITY_MIN_VOLUME: int = 5
    TRUST_DENSITY_TIME_DECAY_DAYS: float = 45.0

    # Vector Store Configuration
    CHROMA_PERSIST_DIRECTORY: str = "./chroma_db"
    CHROMA_COLLECTION_NAME: str = "evidencebridge_claims"
    CHROMA_GUIDELINES_COLLECTION: str = "evidencebridge_guidelines"

    # Evaluation Configuration (Layer 6)
    MONGODB_EVALUATIONS_COLLECTION: str = "evaluation_runs"
    EVALUATION_DATASET_PATH: str = "./data/evaluation/controlled_cases.json"

    # AI Models Integration Configuration (Models 1 - 5)
    AI_DEVICE: str = Field(
        default_factory=lambda: os.getenv("AI_DEVICE") or "cuda"
    )
    MODEL_1_BIOBERT_PATH: str = Field(
        default_factory=lambda: os.getenv("MODEL_1_BIOBERT_PATH") or "models/EvidenceBridge_BioBERT/model_1_biobert_v4/best_model"
    )
    MODEL_2_BGE_PATH: str = Field(
        default_factory=lambda: os.getenv("MODEL_2_BGE_PATH") or "models/EvidenceBridge_BGE/base_model"
    )
    MODEL_2_BGE_FINETUNED_PATH: str = Field(
        default_factory=lambda: os.getenv("MODEL_2_BGE_FINETUNED_PATH") or "models/EvidenceBridge_BioBERT/model_2_retrieval/bge_finetuned"
    )
    MODEL_3_DEBERTA_PATH: str = Field(
        default_factory=lambda: os.getenv("MODEL_3_DEBERTA_PATH") or "evidencebridge-model3-deberta-v1"
    )
    MODEL_3_CONFIDENCE_THRESHOLD: float = 0.80
    MODEL_4_ANOMALY_PATH: str = Field(
        default_factory=lambda: os.getenv("MODEL_4_ANOMALY_PATH") or "evidencebridge-model4-anomaly/v3/isolation_forest_v3.joblib"
    )
    MODEL_4_ANOMALY_V1_PATH: str = Field(
        default_factory=lambda: os.getenv("MODEL_4_ANOMALY_V1_PATH") or "evidencebridge-model4-anomaly/v1/isolation_forest.joblib"
    )
    MODEL_4_ANOMALY_V2_PATH: str = Field(
        default_factory=lambda: os.getenv("MODEL_4_ANOMALY_V2_PATH") or "evidencebridge-model4-anomaly/v2/isolation_forest_v2.joblib"
    )
    MODEL_5_CLAIM_ANOMALY_PATH: str = Field(
        default_factory=lambda: os.getenv("MODEL_5_CLAIM_ANOMALY_PATH") or "evidencebridge-model5-claim-anomaly/models/EvidenceBridge_Model5_V3_Strict.joblib"
    )
    MODEL_5_CLAIM_ANOMALY_V4A_PATH: str = Field(
        default_factory=lambda: os.getenv("MODEL_5_CLAIM_ANOMALY_V4A_PATH") or "evidencebridge-model5-claim-anomaly/models/EvidenceBridge_Model5_V4A_Experimental.joblib"
    )
    MODEL_5_MEDICINE_MATCHER_PATH: str = Field(
        default_factory=lambda: os.getenv("MODEL_5_MEDICINE_MATCHER_PATH") or "models/EvidenceBridge_BioBERT/model_5_medicine/medicine_matcher.joblib"
    )

    # Model 6: Image-Based Medical Document AI (ResNet18)
    MODEL_6_DOCUMENT_AI_PATH: str = Field(
        default_factory=lambda: os.getenv("MODEL_6_DOCUMENT_AI_PATH")
        or r"C:\Users\tejes\Downloads\EvidenceBridge_Model6_COMPLETE\EvidenceBridge_Model6\models\evidencebridge_model6_resnet18.pth"
    )
    MODEL_6_CONFIDENCE_THRESHOLD: float = Field(
        default_factory=lambda: float(os.getenv("MODEL_6_CONFIDENCE_THRESHOLD", "0.55"))
    )
    MODEL_6_DEVICE: str = Field(
        default_factory=lambda: os.getenv("MODEL_6_DEVICE") or "cpu"
    )

    # External Karnataka ML API Integration Configuration
    KARNATAKA_ML_BASE_URL: str = Field(
        default_factory=lambda: os.getenv("KARNATAKA_ML_BASE_URL") or "https://evidencebridge-karnataka-ml.onrender.com"
    )
    KARNATAKA_ML_TIMEOUT_SECONDS: float = Field(
        default_factory=lambda: float(os.getenv("KARNATAKA_ML_TIMEOUT_SECONDS", "25.0"))
    )


@lru_cache()
def get_settings() -> Settings:
    """Return cached application settings."""
    return Settings()
