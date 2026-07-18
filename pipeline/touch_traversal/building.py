"""Reusable deterministic corpus build orchestration."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Literal

from touch_traversal.artifacts import validate_artifact_bundle
from touch_traversal.chunking import chunk_corpus
from touch_traversal.config import PipelineConfig
from touch_traversal.embeddings import EmbeddingProvider, run_semantic_pipeline
from touch_traversal.exporting import ArtifactBundle, build_artifact_bundle
from touch_traversal.graph_relations import assemble_relation_graph
from touch_traversal.ingestion import load_corpus
from touch_traversal.layouts import SemanticReducer, generate_layouts
from touch_traversal.relations import generate_nonsemantic_relations

BuildStage = Literal[
    "ingesting",
    "chunking",
    "relating",
    "embedding",
    "laying_out",
    "validating",
]
BuildProgressCallback = Callable[[BuildStage], None]
CancellationCheck = Callable[[], bool]


class CorpusBuildCancelled(RuntimeError):
    """Raised when a local build is cancelled between deterministic stages."""


class CorpusBuildInputError(ValueError):
    """Raised when a reusable corpus build receives an invalid local source."""


def _advance(
    stage: BuildStage,
    *,
    on_progress: BuildProgressCallback | None,
    cancellation_requested: CancellationCheck | None,
) -> None:
    if cancellation_requested is not None and cancellation_requested():
        raise CorpusBuildCancelled("personal graph build cancelled")
    if on_progress is not None:
        on_progress(stage)
    if cancellation_requested is not None and cancellation_requested():
        raise CorpusBuildCancelled("personal graph build cancelled")


def build_corpus_bundle(
    input_path: Path,
    config: PipelineConfig,
    *,
    embedding_cache_dir: Path | None = None,
    embedding_provider: EmbeddingProvider | None = None,
    semantic_reducer: SemanticReducer | None = None,
    on_progress: BuildProgressCallback | None = None,
    cancellation_requested: CancellationCheck | None = None,
) -> ArtifactBundle:
    """Build one in-memory, cross-validated bundle without exporting tracked files."""
    if not input_path.exists():
        raise CorpusBuildInputError(f"input corpus does not exist: {input_path}")
    if not input_path.is_dir():
        raise CorpusBuildInputError(f"input corpus must be a directory: {input_path}")

    embedding_config = config.embeddings
    if embedding_cache_dir is not None:
        embedding_config = config.embeddings.model_copy(update={"cache_dir": embedding_cache_dir})

    _advance(
        "ingesting",
        on_progress=on_progress,
        cancellation_requested=cancellation_requested,
    )
    documents = load_corpus(input_path, config.corpus)

    _advance(
        "chunking",
        on_progress=on_progress,
        cancellation_requested=cancellation_requested,
    )
    chunks = chunk_corpus(documents, config.chunking)

    _advance(
        "relating",
        on_progress=on_progress,
        cancellation_requested=cancellation_requested,
    )
    nonsemantic_relations = generate_nonsemantic_relations(documents, chunks)

    _advance(
        "embedding",
        on_progress=on_progress,
        cancellation_requested=cancellation_requested,
    )
    embeddings, semantic_relations = run_semantic_pipeline(
        chunks,
        embedding_config,
        config.semantic,
        embedding_provider,
    )
    relation_graph = assemble_relation_graph(
        chunks,
        (*nonsemantic_relations, *semantic_relations),
        config.scoring,
        config.pruning,
        config.clustering,
    )

    _advance(
        "laying_out",
        on_progress=on_progress,
        cancellation_requested=cancellation_requested,
    )
    layouts = generate_layouts(
        chunks,
        documents,
        embeddings,
        relation_graph,
        config.layouts,
        semantic_reducer,
    )

    _advance(
        "validating",
        on_progress=on_progress,
        cancellation_requested=cancellation_requested,
    )
    bundle = build_artifact_bundle(
        corpus_name=input_path.name,
        documents=documents,
        chunks=chunks,
        embeddings=embeddings,
        semantic_relations=semantic_relations,
        relation_graph=relation_graph,
        layouts=layouts,
        config=config,
        build_duration_ms=0.0,
    )
    validate_artifact_bundle(bundle.graph, bundle.layouts, bundle.manifest, bundle.report)
    if cancellation_requested is not None and cancellation_requested():
        raise CorpusBuildCancelled("personal graph build cancelled")
    return bundle
