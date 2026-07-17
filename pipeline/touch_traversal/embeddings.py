"""Local embedding providers, persistent vector caching, and semantic neighbors."""

from __future__ import annotations

import hashlib
import json
import math
from collections.abc import Sequence
from importlib import import_module
from pathlib import Path
from typing import Any, Protocol

from pydantic import Field, model_validator

from touch_traversal.config import EmbeddingConfig, SemanticConfig
from touch_traversal.documents import ThoughtChunk
from touch_traversal.models import ArtifactModel, EdgeEvidence, EdgeType, NonEmptyString
from touch_traversal.relations import RelationCandidate


class EmbeddingError(ValueError):
    """An actionable local embedding or cache error."""


class EmbeddingProvider(Protocol):
    """Minimal provider contract for deterministic batched text embeddings."""

    @property
    def model_name(self) -> str: ...

    def encode(
        self,
        texts: Sequence[str],
        *,
        batch_size: int,
    ) -> Sequence[Sequence[float]]: ...


class SentenceTransformerProvider:
    """Lazy local Sentence Transformers adapter with no paid API dependency."""

    def __init__(self, model_name: str, device: str = "cpu") -> None:
        self._model_name = model_name
        self._device = device
        self._model: Any | None = None

    @property
    def model_name(self) -> str:
        return self._model_name

    def _load_model(self) -> Any:
        if self._model is not None:
            return self._model
        try:
            module = import_module("sentence_transformers")
        except ImportError as error:
            raise EmbeddingError(
                "Sentence Transformers is not installed; run "
                "`uv sync --extra embeddings --all-groups` in pipeline/"
            ) from error
        sentence_transformer = getattr(module, "SentenceTransformer", None)
        if sentence_transformer is None:
            raise EmbeddingError("sentence_transformers does not expose SentenceTransformer")
        self._model = sentence_transformer(self.model_name, device=self._device)
        return self._model

    def encode(
        self,
        texts: Sequence[str],
        *,
        batch_size: int,
    ) -> Sequence[Sequence[float]]:
        model = self._load_model()
        encoded = model.encode(
            list(texts),
            batch_size=batch_size,
            convert_to_numpy=False,
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        values = encoded.tolist() if hasattr(encoded, "tolist") else encoded
        return tuple(tuple(float(value) for value in vector) for vector in values)


class EmbeddingRecord(ArtifactModel):
    chunk_id: NonEmptyString
    text_hash: NonEmptyString
    vector: tuple[float, ...] = Field(min_length=1)


class EmbeddingBatch(ArtifactModel):
    model_name: NonEmptyString
    records: tuple[EmbeddingRecord, ...]
    cache_hits: int = Field(ge=0)
    cache_misses: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_records(self) -> EmbeddingBatch:
        chunk_ids = [record.chunk_id for record in self.records]
        if len(chunk_ids) != len(set(chunk_ids)):
            raise ValueError("embedding chunk ids must be unique")
        dimensions = {len(record.vector) for record in self.records}
        if len(dimensions) > 1:
            raise ValueError("embedding vectors must have a consistent dimension")
        if self.cache_hits + self.cache_misses != len(self.records):
            raise ValueError("cache hit and miss counts must match embedding records")
        return self

    def vectors_by_chunk(self) -> dict[str, tuple[float, ...]]:
        return {record.chunk_id: record.vector for record in self.records}


class EmbeddingCache:
    """Small JSON vector cache keyed by exact model name and embedding-text hash."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def _path(self, model_name: str, text_hash: str) -> Path:
        model_hash = hashlib.sha256(model_name.encode("utf-8")).hexdigest()[:20]
        return self.root / model_hash / f"{text_hash}.json"

    def load(self, model_name: str, text_hash: str) -> tuple[float, ...] | None:
        path = self._path(model_name, text_hash)
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, OSError, json.JSONDecodeError):
            return None
        if not isinstance(payload, dict):
            return None
        if payload.get("model") != model_name or payload.get("textHash") != text_hash:
            return None
        vector = payload.get("vector")
        if not isinstance(vector, list) or not vector:
            return None
        if any(not isinstance(value, (int, float)) or not math.isfinite(value) for value in vector):
            return None
        return tuple(float(value) for value in vector)

    def store(self, model_name: str, text_hash: str, vector: tuple[float, ...]) -> None:
        path = self._path(model_name, text_hash)
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "schemaVersion": 1,
            "model": model_name,
            "textHash": text_hash,
            "vector": vector,
        }
        temporary = path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
            encoding="utf-8",
        )
        temporary.replace(path)


def _embedding_text(chunk: ThoughtChunk) -> str:
    return f"{chunk.title}\n\n{chunk.normalized_text}"


def embedding_text_hash(text: str) -> str:
    """Return the stable cache hash for the exact text sent to the provider."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _normalize_vector(vector: Sequence[float]) -> tuple[float, ...]:
    values = tuple(float(value) for value in vector)
    if not values or any(not math.isfinite(value) for value in values):
        raise EmbeddingError("embedding vectors must be non-empty and finite")
    magnitude = math.sqrt(sum(value * value for value in values))
    if magnitude == 0:
        raise EmbeddingError("embedding vectors must not have zero magnitude")
    return tuple(value / magnitude for value in values)


def embed_chunks(
    chunks: tuple[ThoughtChunk, ...],
    config: EmbeddingConfig,
    provider: EmbeddingProvider | None = None,
) -> EmbeddingBatch:
    """Embed chunks in stable ID order, reusing model-and-text-addressed cache entries."""
    active_provider = provider or SentenceTransformerProvider(config.model, config.device)
    if active_provider.model_name != config.model:
        raise EmbeddingError(
            f'provider model "{active_provider.model_name}" does not match configured model '
            f'"{config.model}"'
        )

    ordered_chunks = tuple(sorted(chunks, key=lambda chunk: chunk.id))
    cache = EmbeddingCache(config.cache_dir)
    chunk_hashes = {
        chunk.id: embedding_text_hash(_embedding_text(chunk)) for chunk in ordered_chunks
    }
    vector_by_hash: dict[str, tuple[float, ...] | None] = {}
    representative_text: dict[str, str] = {}
    cache_hits = 0
    cache_misses = 0

    for chunk in ordered_chunks:
        text_hash = chunk_hashes[chunk.id]
        if text_hash not in vector_by_hash:
            vector_by_hash[text_hash] = cache.load(config.model, text_hash)
            representative_text[text_hash] = _embedding_text(chunk)
        if vector_by_hash[text_hash] is None:
            cache_misses += 1
        else:
            cache_hits += 1

    missing_hashes = tuple(
        text_hash for text_hash, vector in vector_by_hash.items() if vector is None
    )
    if missing_hashes:
        encoded = active_provider.encode(
            [representative_text[text_hash] for text_hash in missing_hashes],
            batch_size=config.batch_size,
        )
        if len(encoded) != len(missing_hashes):
            raise EmbeddingError(
                f"provider returned {len(encoded)} vectors for {len(missing_hashes)} texts"
            )
        for text_hash, encoded_vector in zip(missing_hashes, encoded, strict=True):
            normalized = _normalize_vector(encoded_vector)
            vector_by_hash[text_hash] = normalized
            cache.store(config.model, text_hash, normalized)

    records: list[EmbeddingRecord] = []
    expected_dimension: int | None = None
    for chunk in ordered_chunks:
        text_hash = chunk_hashes[chunk.id]
        cached_vector = vector_by_hash[text_hash]
        if cached_vector is None:
            raise EmbeddingError(f"embedding vector was not generated for chunk {chunk.id}")
        normalized = _normalize_vector(cached_vector)
        if expected_dimension is None:
            expected_dimension = len(normalized)
        elif len(normalized) != expected_dimension:
            raise EmbeddingError("provider returned inconsistent embedding dimensions")
        records.append(EmbeddingRecord(chunk_id=chunk.id, text_hash=text_hash, vector=normalized))

    return EmbeddingBatch(
        model_name=config.model,
        records=tuple(records),
        cache_hits=cache_hits,
        cache_misses=cache_misses,
    )


def _cosine(left: tuple[float, ...], right: tuple[float, ...]) -> float:
    if len(left) != len(right):
        raise EmbeddingError("cannot compare embedding vectors with different dimensions")
    normalized_left = _normalize_vector(left)
    normalized_right = _normalize_vector(right)
    return max(
        -1.0,
        min(
            1.0,
            sum(a * b for a, b in zip(normalized_left, normalized_right, strict=True)),
        ),
    )


def generate_semantic_relations(
    embeddings: EmbeddingBatch,
    config: SemanticConfig,
) -> tuple[RelationCandidate, ...]:
    """Generate a sparse union of configured per-node cosine top-K neighborhoods."""
    records = tuple(sorted(embeddings.records, key=lambda record: record.chunk_id))
    selected: dict[str, tuple[str, ...]] = {}
    similarities: dict[tuple[str, str], float] = {}

    for source_record in records:
        ranked: list[tuple[float, str]] = []
        for target_record in records:
            if target_record.chunk_id == source_record.chunk_id:
                continue
            similarity = _cosine(source_record.vector, target_record.vector)
            if similarity < config.minimum_similarity:
                continue
            source_id, target_id = sorted((source_record.chunk_id, target_record.chunk_id))
            similarities[(source_id, target_id)] = similarity
            ranked.append((similarity, target_record.chunk_id))
        ranked.sort(key=lambda item: (-item[0], item[1]))
        selected[source_record.chunk_id] = tuple(
            target_id for _score, target_id in ranked[: config.top_k]
        )

    selected_sets = {source: set(targets) for source, targets in selected.items()}
    selected_pairs: set[tuple[str, str]] = set()
    for source_id, targets in selected.items():
        for target_id in targets:
            left_id, right_id = sorted((source_id, target_id))
            selected_pairs.add((left_id, right_id))
    candidates: list[RelationCandidate] = []
    for source_id, target_id in sorted(selected_pairs):
        similarity = similarities[(source_id, target_id)]
        mutual = target_id in selected_sets[source_id] and source_id in selected_sets[target_id]
        score = min(1.0, similarity + (config.mutual_neighbor_bonus if mutual else 0.0))
        preference = "mutual top-K neighbors" if mutual else "selected by one top-K neighborhood"
        candidates.append(
            RelationCandidate(
                source=source_id,
                target=target_id,
                directed=False,
                type=EdgeType.SEMANTIC,
                score=score,
                evidence=EdgeEvidence(
                    description=f"cosine similarity {similarity:.4f}; {preference}",
                    similarity=similarity,
                ),
            )
        )
    return tuple(candidates)


def run_semantic_pipeline(
    chunks: tuple[ThoughtChunk, ...],
    embedding_config: EmbeddingConfig,
    semantic_config: SemanticConfig,
    provider: EmbeddingProvider | None = None,
) -> tuple[EmbeddingBatch, tuple[RelationCandidate, ...]]:
    """Compute cached embeddings and their sparse semantic relation candidates."""
    embeddings = embed_chunks(chunks, embedding_config, provider)
    return embeddings, generate_semantic_relations(embeddings, semantic_config)
