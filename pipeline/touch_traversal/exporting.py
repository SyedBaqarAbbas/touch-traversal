"""Build, validate, and atomically export frontend graph artifacts."""

from __future__ import annotations

import math
import statistics
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from touch_traversal.artifacts import graph_statistics, validate_artifact_bundle
from touch_traversal.config import PipelineConfig
from touch_traversal.documents import DateSource, SourceDocument, ThoughtChunk
from touch_traversal.embeddings import EmbeddingBatch
from touch_traversal.graph_relations import RelationGraph
from touch_traversal.models import (
    EdgeType,
    GraphArtifact,
    GraphManifest,
    LayoutArtifact,
    PipelineReport,
    SimilarityDistribution,
    ThoughtMetadata,
    ThoughtNode,
    ThoughtVisual,
)
from touch_traversal.relations import RelationCandidate, entities_for_chunks

_ARTIFACT_FILENAMES = {
    "graph": "graph.json",
    "layouts": "layouts.json",
    "manifest": "manifest.json",
    "report": "pipeline-report.json",
}


@dataclass(frozen=True)
class ArtifactBundle:
    graph: GraphArtifact
    layouts: LayoutArtifact
    manifest: GraphManifest
    report: PipelineReport


class ArtifactExportError(ValueError):
    """An actionable artifact serialization or filesystem error."""


def _similarity_distribution(
    semantic_relations: tuple[RelationCandidate, ...],
) -> SimilarityDistribution:
    values = sorted(
        relation.evidence.similarity
        for relation in semantic_relations
        if relation.type is EdgeType.SEMANTIC and relation.evidence.similarity is not None
    )
    if not values:
        return SimilarityDistribution(count=0)
    p95_index = max(0, math.ceil(0.95 * len(values)) - 1)
    return SimilarityDistribution(
        count=len(values),
        minimum=values[0],
        median=statistics.median(values),
        p95=values[p95_index],
        maximum=values[-1],
    )


def _generated_at(chunks: tuple[ThoughtChunk, ...]) -> datetime:
    return max(
        (chunk.modified_at for chunk in chunks),
        default=datetime(1970, 1, 1, tzinfo=UTC),
    )


def _thought_nodes(
    documents: tuple[SourceDocument, ...],
    chunks: tuple[ThoughtChunk, ...],
    graph: RelationGraph,
    config: PipelineConfig,
) -> tuple[ThoughtNode, ...]:
    document_by_path = {document.path: document for document in documents}
    cluster_by_node = {
        node_id: community.id for community in graph.communities for node_id in community.node_ids
    }
    entities = entities_for_chunks(chunks)
    degrees: Counter[str] = Counter(
        endpoint for edge in graph.edges for endpoint in (edge.source, edge.target)
    )
    maximum_degree = max(degrees.values(), default=0)
    nodes: list[ThoughtNode] = []
    for chunk in sorted(chunks, key=lambda item: item.id):
        importance = degrees[chunk.id] / maximum_degree if maximum_degree else 0.0
        reliable_date = document_by_path[chunk.source.path].date_source is DateSource.FRONT_MATTER
        nodes.append(
            ThoughtNode(
                id=chunk.id,
                title=chunk.title,
                text=chunk.text,
                summary=chunk.summary,
                source=chunk.source,
                metadata=ThoughtMetadata(
                    created_at=chunk.created_at,
                    modified_at=chunk.modified_at,
                    tags=chunk.tags,
                    entities=entities[chunk.id],
                    word_count=chunk.word_count,
                    importance=importance,
                ),
                visual=ThoughtVisual(
                    cluster_id=cluster_by_node[chunk.id],
                    size=0.8 + 0.8 * importance,
                    base_opacity=(
                        0.82 if reliable_date else config.layouts.temporal.uncertain_date_opacity
                    ),
                ),
            )
        )
    return tuple(nodes)


def build_artifact_bundle(
    *,
    corpus_name: str,
    documents: tuple[SourceDocument, ...],
    chunks: tuple[ThoughtChunk, ...],
    embeddings: EmbeddingBatch,
    semantic_relations: tuple[RelationCandidate, ...],
    relation_graph: RelationGraph,
    layouts: LayoutArtifact,
    config: PipelineConfig,
    build_duration_ms: float,
) -> ArtifactBundle:
    """Construct and cross-validate the complete deterministic artifact bundle."""
    graph = GraphArtifact(
        nodes=_thought_nodes(documents, chunks, relation_graph, config),
        edges=relation_graph.edges,
    )
    statistics = graph_statistics(graph)
    generated_at = _generated_at(chunks)
    warnings: list[str] = []
    if statistics.isolated_node_count:
        warnings.append(f"{statistics.isolated_node_count} isolated thought nodes remain")
    similarity_distribution = _similarity_distribution(semantic_relations)
    if similarity_distribution.count == 0:
        warnings.append("no semantic relations met the configured threshold")

    manifest = GraphManifest(
        generated_at=generated_at,
        corpus_name=corpus_name,
        node_count=statistics.node_count,
        edge_count=statistics.edge_count,
        embedding_model=embeddings.model_name,
        pipeline_config_hash=config.fingerprint(),
    )
    report = PipelineReport(
        generated_at=generated_at,
        file_count=len(documents),
        chunk_count=len(chunks),
        node_count=statistics.node_count,
        edge_count=statistics.edge_count,
        edge_counts=statistics.edge_counts,
        isolated_node_count=statistics.isolated_node_count,
        average_degree=statistics.average_degree,
        cluster_count=len(relation_graph.communities),
        similarity_distribution=similarity_distribution,
        build_duration_ms=build_duration_ms,
        warnings=tuple(warnings),
    )
    validate_artifact_bundle(graph, layouts, manifest, report)
    return ArtifactBundle(graph=graph, layouts=layouts, manifest=manifest, report=report)


def _serialized_bundle(bundle: ArtifactBundle) -> dict[str, str]:
    serialized = {
        "graph": f"{bundle.graph.model_dump_json(indent=2)}\n",
        "layouts": f"{bundle.layouts.model_dump_json(indent=2)}\n",
        "manifest": f"{bundle.manifest.model_dump_json(indent=2)}\n",
        "report": f"{bundle.report.model_dump_json(indent=2)}\n",
    }
    round_trip = ArtifactBundle(
        graph=GraphArtifact.model_validate_json(serialized["graph"]),
        layouts=LayoutArtifact.model_validate_json(serialized["layouts"]),
        manifest=GraphManifest.model_validate_json(serialized["manifest"]),
        report=PipelineReport.model_validate_json(serialized["report"]),
    )
    validate_artifact_bundle(
        round_trip.graph,
        round_trip.layouts,
        round_trip.manifest,
        round_trip.report,
    )
    return serialized


def export_artifacts(output: Path, bundle: ArtifactBundle) -> tuple[Path, ...]:
    """Validate serialized artifacts before atomically replacing public output files."""
    validate_artifact_bundle(bundle.graph, bundle.layouts, bundle.manifest, bundle.report)
    serialized = _serialized_bundle(bundle)
    temporary_paths: dict[str, Path] = {}
    exported: list[Path] = []
    try:
        output.mkdir(parents=True, exist_ok=True)
        for name, content in serialized.items():
            final_path = output / _ARTIFACT_FILENAMES[name]
            temporary_path = final_path.with_suffix(f"{final_path.suffix}.tmp")
            temporary_path.write_text(content, encoding="utf-8")
            temporary_paths[name] = temporary_path
        for name in ("graph", "layouts", "manifest", "report"):
            final_path = output / _ARTIFACT_FILENAMES[name]
            temporary_paths[name].replace(final_path)
            exported.append(final_path)
    except OSError as error:
        raise ArtifactExportError(f"could not export artifacts to {output}: {error}") from error
    return tuple(exported)
