"""
Vector Store Service for EvidenceBridge.
Provides local vector storage using ChromaDB for semantic retrieval,
claim indexing, and future verification layers.
Runs 100% offline with zero external API dependencies.
"""

from typing import Any, Optional
import chromadb
from chromadb.config import Settings as ChromaSettings

from app.config import get_settings
from app.models.schemas import Claim
from app.utils.logger import logger


class VectorStoreService:
    """Local ChromaDB vector store client."""

    def __init__(self, persist_directory: Optional[str] = None):
        self.settings = get_settings()
        self.persist_directory = persist_directory or self.settings.CHROMA_PERSIST_DIRECTORY
        self.collection_name = self.settings.CHROMA_COLLECTION_NAME
        self._client: Optional[chromadb.PersistentClient] = None
        self._collection = None

    def initialize(self) -> bool:
        """Initialize local persistent Chroma client and collection."""
        try:
            logger.info(f"Initializing local ChromaDB vector store at '{self.persist_directory}'")
            self._client = chromadb.PersistentClient(
                path=self.persist_directory,
                settings=ChromaSettings(anonymized_telemetry=False)
            )
            ef = None
            try:
                from app.services.embedding import embedding_service
                ef = embedding_service.get_chroma_embedding_function()
            except Exception as ef_err:
                logger.debug(f"Could not load BGE embedding function for ChromaDB: {ef_err}")

            try:
                self._collection = self._client.get_or_create_collection(
                    name=self.collection_name,
                    metadata={"description": "EvidenceBridge Claims Vector Store"},
                    embedding_function=ef
                )
            except Exception as coll_err:
                logger.debug(f"Opening existing collection '{self.collection_name}' without overriding embedding function: {coll_err}")
                self._collection = self._client.get_collection(name=self.collection_name)
            logger.info(f"ChromaDB collection '{self.collection_name}' ready with {self._collection.count()} vectors")
            return True
        except Exception as e:
            logger.warning(f"Could not initialize ChromaDB vector store: {e}")
            return False

    def add_claim(self, claim: Claim) -> bool:
        """Index a claim into the local vector store."""
        if self._collection is None:
            if not self.initialize():
                return False

        try:
            # Build searchable document text
            doc_text = (
                f"Entity: {claim.extracted_fields.entity}\n"
                f"Outcome: {claim.extracted_fields.effect_or_outcome or 'None'}\n"
                f"Cost: {claim.extracted_fields.cost_range or 'None'}\n"
                f"Location: {claim.extracted_fields.location_city or 'None'}\n"
                f"Original Text: {claim.original_text}"
            )

            metadata = {
                "claim_id": claim.claim_id,
                "source_type": claim.source_type,
                "entity": claim.extracted_fields.entity,
                "sentiment": claim.extracted_fields.sentiment.value,
                "cost_range": claim.extracted_fields.cost_range or "",
                "location_city": claim.extracted_fields.location_city or "",
                "confidence": claim.confidence,
                "source_hash": claim.provenance.source_hash,
            }

            self._collection.upsert(
                ids=[claim.claim_id],
                documents=[doc_text],
                metadatas=[metadata]
            )
            logger.info(f"Indexed claim {claim.claim_id} into ChromaDB")
            return True
        except Exception as e:
            logger.warning(f"Failed to index claim {claim.claim_id} into ChromaDB: {e}")
            return False

    def search_similar(self, query: str, n_results: int = 5) -> list[dict[str, Any]]:
        """Search for semantically similar claims in local vector store."""
        if self._collection is None:
            if not self.initialize():
                return []

        try:
            results = self._collection.query(
                query_texts=[query],
                n_results=n_results
            )
            formatted = []
            if results and results.get("ids"):
                ids = results["ids"][0]
                docs = results.get("documents", [[]])[0]
                metas = results.get("metadatas", [[]])[0]
                dists = results.get("distances", [[]])[0] if results.get("distances") else [None] * len(ids)

                for cid, doc, meta, dist in zip(ids, docs, metas, dists):
                    formatted.append({
                        "claim_id": cid,
                        "document": doc,
                        "metadata": meta,
                        "distance": dist
                    })
            return formatted
        except Exception as e:
            logger.error(f"Vector search failed: {e}")
            return []

    def check_health(self) -> dict[str, Any]:
        """Check vector store status and count."""
        try:
            if self._collection is None:
                self.initialize()
            count = self._collection.count() if self._collection else 0
            return {
                "status": "healthy" if self._collection is not None else "degraded",
                "persist_directory": self.persist_directory,
                "collection_name": self.collection_name,
                "vector_count": count
            }
        except Exception as e:
            return {
                "status": "unreachable",
                "error": str(e)
            }


vector_store_service = VectorStoreService()
