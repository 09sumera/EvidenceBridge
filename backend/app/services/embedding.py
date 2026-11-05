"""
Model 2: BGE Retrieval Service for Evidence Retrieval.
Provides offline embeddings using BGE Small (384-d normalized),
integrates with ChromaDB via custom EmbeddingFunction,
and ranks relevant evidence passages for claims.
"""

from pathlib import Path
from typing import Any, Optional, Union
import numpy as np
import torch
from sentence_transformers import SentenceTransformer, util

from app.config import get_settings
from app.models.schemas import RetrievalResultPassage
from app.utils.logger import logger


class BGEEmbeddingFunction:
    """
    ChromaDB compatible embedding function using local BGE model.
    Runs 100% offline without external internet calls.
    """
    def __init__(self, service: "BGEEmbeddingService"):
        self.service = service

    @staticmethod
    def is_legacy() -> bool:
        return False

    @classmethod
    def name(cls) -> str:
        return "bge_embedding_function"

    def default_space(self) -> str:
        return "cosine"

    def supported_spaces(self) -> list[str]:
        return ["cosine", "l2", "ip"]

    def get_config(self) -> dict[str, Any]:
        return {"model_name": "bge-small-en-v1.5"}

    def __call__(self, input: Union[str, list[str]]) -> Union[list[float], list[list[float]]]:
        if isinstance(input, str):
            texts = [input]
            single = True
        else:
            texts = list(input)
            single = False

        embeddings = self.service.encode(texts, normalize=True)
        embeddings_list = [emb.tolist() for emb in embeddings]
        return embeddings_list[0] if single else embeddings_list

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        embeddings = self.service.encode(texts, normalize=True)
        return [emb.tolist() for emb in embeddings]

    def embed_query(self, input: Union[str, list[str]]) -> Union[list[float], list[list[float]]]:
        return self(input)


class BGEEmbeddingService:
    """Service wrapping Model 2 BGE Small embeddings."""

    def __init__(
        self,
        base_path: Optional[str] = None,
        finetuned_path: Optional[str] = None,
        use_finetuned: bool = False,
        device: Optional[str] = None
    ):
        self.settings = get_settings()
        self.raw_base_path = base_path or self.settings.MODEL_2_BGE_PATH
        self.raw_finetuned_path = finetuned_path or self.settings.MODEL_2_BGE_FINETUNED_PATH
        self.use_finetuned = use_finetuned
        self.configured_device = device or self.settings.AI_DEVICE
        self._model: Optional[SentenceTransformer] = None
        self._active_path: Optional[Path] = None
        self._embedding_function: Optional[BGEEmbeddingFunction] = None

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
        """Check if active BGE model checkpoint files exist."""
        path = self._resolve_path(self.raw_finetuned_path if self.use_finetuned else self.raw_base_path)
        return (path / "model.safetensors").exists() or (path / "pytorch_model.bin").exists()

    def _load_model(self) -> None:
        """Lazy load SentenceTransformer onto configured device."""
        if self._model is not None:
            return

        active_str = self.raw_finetuned_path if self.use_finetuned else self.raw_base_path
        self._active_path = self._resolve_path(active_str)

        if not self._active_path.exists():
            # Fallback to the other checkpoint if one is missing
            alt_str = self.raw_base_path if self.use_finetuned else self.raw_finetuned_path
            alt_path = self._resolve_path(alt_str)
            if alt_path.exists():
                logger.warning(f"Preferred BGE model '{self._active_path}' not found; falling back to '{alt_path}'")
                self._active_path = alt_path
            else:
                raise FileNotFoundError(f"Neither BGE checkpoint found at '{self._active_path}' or '{alt_path}'")

        target_device = "cuda" if (self.configured_device == "cuda" and torch.cuda.is_available()) else "cpu"
        logger.info(f"Loading Model 2 BGE from '{self._active_path}' onto {target_device}...")
        self._model = SentenceTransformer(str(self._active_path), device=target_device, local_files_only=True)
        logger.info("Model 2 BGE initialized successfully (dimension: 384).")

    def get_chroma_embedding_function(self) -> BGEEmbeddingFunction:
        """Return a ChromaDB-compatible embedding function using this BGE service."""
        if self._embedding_function is None:
            self._embedding_function = BGEEmbeddingFunction(self)
        return self._embedding_function

    def encode(
        self,
        texts: list[str],
        normalize: bool = True,
        convert_to_tensor: bool = False
    ) -> Any:
        """Compute 384-dimensional embeddings with L2 normalization."""
        if not texts:
            return np.zeros((0, 384), dtype=np.float32)

        self._load_model()
        return self._model.encode(
            texts,
            normalize_embeddings=normalize,
            convert_to_tensor=convert_to_tensor,
            show_progress_bar=False
        )

    def retrieve_passages(
        self,
        query: str,
        corpus: list[dict[str, Any]],
        top_k: int = 5,
        instruction_prefix: str = "Represent this sentence for searching relevant passages: "
    ) -> list[RetrievalResultPassage]:
        """
        Rank corpus documents against query using cosine similarity.
        Corpus entries must contain 'text' and optionally 'id'/'title'/'source'.
        """
        if not query or not corpus:
            return []

        self._load_model()
        query_text = f"{instruction_prefix}{query}".strip()
        corpus_texts = [d.get("text", "") for d in corpus]

        query_emb = self.encode([query_text], normalize=True, convert_to_tensor=True)
        corpus_emb = self.encode(corpus_texts, normalize=True, convert_to_tensor=True)

        similarities = util.cos_sim(query_emb, corpus_emb)[0]
        top_indices = torch.topk(similarities, k=min(top_k, len(corpus))).indices.tolist()

        results: list[RetrievalResultPassage] = []
        for idx in top_indices:
            doc = corpus[idx]
            sim_score = round(float(similarities[idx].item()), 4)
            results.append(RetrievalResultPassage(
                passage_id=str(doc.get("id") or doc.get("guideline_id") or f"pass_{idx}"),
                guideline_id=doc.get("guideline_id"),
                title=doc.get("title", "Clinical Passage"),
                source=doc.get("source", "Knowledge Base"),
                text=doc.get("text", ""),
                similarity_score=max(0.0, min(1.0, sim_score)),
                model_name=f"BGE Small ({'Fine-tuned' if self.use_finetuned else 'Base'})"
            ))

        return results


embedding_service = BGEEmbeddingService()
