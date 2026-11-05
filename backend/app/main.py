"""
EvidenceBridge - Evidence-Auditing & Cost-Anomaly Engine
Foundational Layer: Local Extraction, Strict Provenance & MongoDB Storage.
"""

from contextlib import asynccontextmanager
from typing import AsyncGenerator
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as api_router
from app.config import get_settings
from app.services.storage import storage_service
from app.services.vector_store import vector_store_service
from app.utils.logger import logger

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan manager: connect to MongoDB and vector store on startup."""
    logger.info(f"Starting {settings.APP_NAME} v{settings.APP_VERSION} [{settings.APP_ENV}]")

    import os
    is_testing = bool(os.getenv("TESTING") or os.getenv("PYTEST_CURRENT_TEST"))

    if not is_testing:
        # Connect to MongoDB
        try:
            await storage_service.connect()
        except Exception as e:
            logger.warning(f"Could not connect to MongoDB at startup: {e}")

        if not storage_service.is_connected and settings.APP_ENV.lower() == "production":
            logger.warning(
                "[PRODUCTION WARNING] MongoDB persistent storage is NOT connected. "
                "EvidenceBridge is operating in ephemeral in-memory fallback mode. "
                "Data will not persist across server restarts or multi-process workers."
            )

        # Initialize ChromaDB vector store
        try:
            vector_store_service.initialize()
        except Exception as e:
            logger.warning(f"Could not initialize ChromaDB vector store at startup: {e}")

    yield

    # Clean shutdown
    if not is_testing:
        logger.info(f"Shutting down {settings.APP_NAME}...")
        try:
            await storage_service.close()
        except Exception as e:
            logger.warning(f"Error while closing storage service: {e}")


app = FastAPI(
    title=settings.APP_NAME,
    description=(
        "Evidence-Auditing & Cost-Anomaly Engine for healthcare claims and hospital bills. "
        "Foundational Layer: Ingests clinical notes, patient reports, and hospital bill lines, "
        "performs local structured extraction using Ollama, attaches immutable provenance, "
        "and persists claims in MongoDB."
    ),
    version=settings.APP_VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# Enable production-secure CORS with explicit origin allowlist and credential support
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routes at root for simplicity as specified in requirements
app.include_router(api_router, tags=["Foundational Claims Engine"])

# Mount routes under /api and /api/v1 for unified frontend API calls
app.include_router(api_router, prefix="/api", tags=["API"])
app.include_router(api_router, prefix="/api/v1", tags=["Version 1"])


@app.get("/", tags=["Root"])
async def root():
    """Root metadata endpoint."""
    return {
        "engine": settings.APP_NAME,
        "layer": "Foundational Layer 1: Extraction & Provenance",
        "version": settings.APP_VERSION,
        "docs": "/docs",
        "health": "/health",
        "description": "Evidence-Auditing & Cost-Anomaly Engine for healthcare claims and hospital bills.",
        "note": "This layer only does extraction + provenance. Claim verification, cost anomaly detection, and abstention come in later layers."
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=True)
