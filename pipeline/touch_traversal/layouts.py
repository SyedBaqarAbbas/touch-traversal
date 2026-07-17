"""Deterministic offline semantic, community, temporal, and force layouts."""

from __future__ import annotations

import hashlib
import math
from collections.abc import Mapping, Sequence
from importlib import import_module
from typing import Any, Protocol

import networkx as nx

from touch_traversal.config import LayoutConfig, SemanticLayoutConfig
from touch_traversal.documents import DateSource, SourceDocument, ThoughtChunk
from touch_traversal.embeddings import EmbeddingBatch
from touch_traversal.graph_relations import Community, RelationGraph
from touch_traversal.models import LayoutArtifact, LayoutBounds, LayoutMaps, ThoughtEdge, Vec3


class LayoutError(ValueError):
    """An actionable deterministic layout generation error."""


class SemanticReducer(Protocol):
    """Small injectable interface around three-dimensional semantic reduction."""

    def reduce(
        self,
        vectors: Sequence[Sequence[float]],
        *,
        n_neighbors: int,
        min_dist: float,
        metric: str,
        random_seed: int,
    ) -> Sequence[Sequence[float]]: ...


class UmapReducer:
    """Lazy UMAP adapter configured for reproducible offline coordinates."""

    def reduce(
        self,
        vectors: Sequence[Sequence[float]],
        *,
        n_neighbors: int,
        min_dist: float,
        metric: str,
        random_seed: int,
    ) -> Sequence[Sequence[float]]:
        try:
            module = import_module("umap")
        except ImportError as error:
            raise LayoutError(
                "UMAP is not installed; run "
                "`uv sync --extra embeddings --extra layouts --all-groups` in pipeline/"
            ) from error
        umap = getattr(module, "UMAP", None)
        if umap is None:
            raise LayoutError("umap does not expose UMAP")
        reducer = umap(
            n_components=3,
            n_neighbors=n_neighbors,
            min_dist=min_dist,
            metric=metric,
            random_state=random_seed,
            transform_seed=random_seed,
            n_jobs=1,
        )
        reduced = reducer.fit_transform([list(vector) for vector in vectors])
        values = reduced.tolist() if hasattr(reduced, "tolist") else reduced
        return tuple(tuple(float(value) for value in point) for point in values)


def _validate_raw_positions(
    positions: Mapping[str, Sequence[float]], expected_ids: tuple[str, ...]
) -> None:
    if set(positions) != set(expected_ids):
        raise LayoutError("layout positions must match the complete thought-node set")
    for node_id, point in positions.items():
        if len(point) != 3 or any(not math.isfinite(float(value)) for value in point):
            raise LayoutError(f"layout position for {node_id} must contain three finite values")


def _normalize_positions(
    positions: Mapping[str, Sequence[float]], expected_ids: tuple[str, ...]
) -> dict[str, Vec3]:
    _validate_raw_positions(positions, expected_ids)
    if not positions:
        return {}
    axes = tuple(
        tuple(float(positions[node_id][axis]) for node_id in expected_ids) for axis in range(3)
    )
    centers = tuple((min(axis) + max(axis)) / 2 for axis in axes)
    maximum_half_span = max((max(axis) - min(axis)) / 2 for axis in axes)
    if maximum_half_span == 0:
        return {node_id: (0.0, 0.0, 0.0) for node_id in expected_ids}
    normalized: dict[str, Vec3] = {}
    for node_id in expected_ids:
        values = tuple(
            round((float(positions[node_id][axis]) - centers[axis]) / maximum_half_span, 8)
            for axis in range(3)
        )
        normalized[node_id] = (values[0], values[1], values[2])
    return normalized


def semantic_layout(
    embeddings: EmbeddingBatch,
    config: SemanticLayoutConfig,
    random_seed: int,
    reducer: SemanticReducer | None = None,
) -> dict[str, Vec3]:
    """Reduce stable embedding order to a normalized three-dimensional UMAP layout."""
    records = tuple(sorted(embeddings.records, key=lambda record: record.chunk_id))
    node_ids = tuple(record.chunk_id for record in records)
    if len(records) < 4:
        raw: dict[str, Sequence[float]] = {
            record.chunk_id: (float(index), 0.0, 0.0) for index, record in enumerate(records)
        }
        return _normalize_positions(raw, node_ids)
    active_reducer = reducer or UmapReducer()
    n_neighbors = min(config.n_neighbors, len(records) - 1)
    reduced = active_reducer.reduce(
        [record.vector for record in records],
        n_neighbors=n_neighbors,
        min_dist=config.min_dist,
        metric=config.metric,
        random_seed=random_seed,
    )
    if len(reduced) != len(records):
        raise LayoutError(
            f"semantic reducer returned {len(reduced)} positions for {len(records)} vectors"
        )
    semantic_raw: dict[str, Sequence[float]] = {}
    for record, point in zip(records, reduced, strict=True):
        semantic_raw[record.chunk_id] = tuple(float(value) for value in point)
    return _normalize_positions(semantic_raw, node_ids)


def community_layout(
    chunks: tuple[ThoughtChunk, ...],
    communities: tuple[Community, ...],
    radius: float,
) -> dict[str, Vec3]:
    """Place non-overlapping community islands around separated deterministic centroids."""
    node_ids = tuple(sorted(chunk.id for chunk in chunks))
    ordered = tuple(sorted(communities, key=lambda community: community.id))
    community_count = len(ordered)
    if community_count == 0 and node_ids:
        raise LayoutError("community layout requires a community for every thought node")

    if community_count <= 1:
        island_radius = radius * 0.3
    else:
        neighbor_half_distance = radius * math.sin(math.pi / community_count)
        island_radius = min(radius * 0.25, neighbor_half_distance * 0.4)
    raw: dict[str, Vec3] = {}
    golden_angle = math.pi * (3 - math.sqrt(5))
    for community_index, community in enumerate(ordered):
        if community_count == 1:
            centroid = (0.0, 0.0, 0.0)
        else:
            angle = 2 * math.pi * community_index / community_count
            centroid = (
                radius * math.cos(angle),
                radius * 0.18 * math.sin(angle * 2),
                radius * math.sin(angle),
            )
        members = tuple(sorted(community.node_ids))
        for member_index, node_id in enumerate(members):
            if len(members) == 1:
                raw[node_id] = centroid
                continue
            member_radius = island_radius * math.sqrt((member_index + 0.5) / len(members))
            member_angle = member_index * golden_angle
            raw[node_id] = (
                centroid[0] + member_radius * math.cos(member_angle),
                centroid[1] + member_radius * math.sin(member_angle),
                centroid[2] + island_radius * 0.12 * ((member_index % 3) - 1),
            )
    return _normalize_positions(raw, node_ids)


def _deterministic_jitter(node_id: str, amplitude: float) -> float:
    digest = hashlib.sha256(node_id.encode("utf-8")).digest()
    unit = int.from_bytes(digest[:8], "big") / (2**64 - 1)
    return (unit * 2 - 1) * amplitude


def temporal_layout(
    chunks: tuple[ThoughtChunk, ...],
    documents: tuple[SourceDocument, ...],
    communities: tuple[Community, ...],
    depth_jitter: float,
) -> dict[str, Vec3]:
    """Map reliable source time to X, community topic to Y, and stable jitter to Z."""
    node_ids = tuple(sorted(chunk.id for chunk in chunks))
    document_by_path = {document.path: document for document in documents}
    lane_by_node = {
        node_id: lane
        for lane, community in enumerate(sorted(communities, key=lambda item: item.id))
        for node_id in community.node_ids
    }
    reliable_times = {
        chunk.id: chunk.created_at.timestamp()
        for chunk in chunks
        if document_by_path[chunk.source.path].date_source is DateSource.FRONT_MATTER
    }
    fallback_time = sum(reliable_times.values()) / len(reliable_times) if reliable_times else 0.0
    lane_center = (len(communities) - 1) / 2
    raw = {
        chunk.id: (
            reliable_times.get(chunk.id, fallback_time),
            float(lane_by_node[chunk.id]) - lane_center,
            _deterministic_jitter(chunk.id, depth_jitter),
        )
        for chunk in chunks
    }
    return _normalize_positions(raw, node_ids)


def force_layout(
    chunks: tuple[ThoughtChunk, ...],
    edges: tuple[ThoughtEdge, ...],
    config: LayoutConfig,
) -> dict[str, Vec3]:
    """Precompute a settled weighted three-dimensional spring layout."""
    node_ids = tuple(sorted(chunk.id for chunk in chunks))
    graph: nx.Graph[str] = nx.Graph()
    graph.add_nodes_from(node_ids)
    for edge in sorted(edges, key=lambda item: item.id):
        graph.add_edge(edge.source, edge.target, weight=edge.weight)
    positions: dict[str, Any] = nx.spring_layout(
        graph,
        dim=3,
        iterations=config.force.iterations,
        scale=config.force.scale,
        seed=config.random_seed,
        weight="weight",
    )
    raw = {node_id: tuple(float(value) for value in positions[node_id]) for node_id in node_ids}
    return _normalize_positions(raw, node_ids)


def generate_layouts(
    chunks: tuple[ThoughtChunk, ...],
    documents: tuple[SourceDocument, ...],
    embeddings: EmbeddingBatch,
    graph: RelationGraph,
    config: LayoutConfig,
    reducer: SemanticReducer | None = None,
) -> LayoutArtifact:
    """Generate all four normalized layouts with an identical stable node set."""
    node_ids = tuple(sorted(chunk.id for chunk in chunks))
    if {record.chunk_id for record in embeddings.records} != set(node_ids):
        raise LayoutError("embedding node ids must match thought chunks before layout generation")
    community_nodes = [node_id for community in graph.communities for node_id in community.node_ids]
    if len(community_nodes) != len(set(community_nodes)) or set(community_nodes) != set(node_ids):
        raise LayoutError("communities must partition the complete thought-node set")

    return LayoutArtifact(
        bounds=LayoutBounds(min=(-1.0, -1.0, -1.0), max=(1.0, 1.0, 1.0)),
        layouts=LayoutMaps(
            semantic=semantic_layout(
                embeddings,
                config.semantic,
                config.random_seed,
                reducer,
            ),
            clusters=community_layout(chunks, graph.communities, config.clusters.radius),
            temporal=temporal_layout(
                chunks,
                documents,
                graph.communities,
                config.temporal.depth_jitter,
            ),
            force=force_layout(chunks, graph.edges, config),
        ),
    )
