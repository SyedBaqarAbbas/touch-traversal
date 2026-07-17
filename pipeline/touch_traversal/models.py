"""Pydantic contracts for exported graph, layout, manifest, and report artifacts."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal, Self

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)
from pydantic.alias_generators import to_camel

NonEmptyString = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
UnitFloat = Annotated[float, Field(ge=0.0, le=1.0)]
PositiveFloat = Annotated[float, Field(gt=0.0)]
Vec3 = tuple[float, float, float]


class ArtifactModel(BaseModel):
    """Strict immutable model with frontend-compatible camelCase aliases."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        allow_inf_nan=False,
        extra="forbid",
        frozen=True,
        populate_by_name=True,
        serialize_by_alias=True,
    )


class SourceProvenance(ArtifactModel):
    path: NonEmptyString
    document_id: NonEmptyString
    heading_path: tuple[str, ...] = ()
    start_line: int | None = Field(default=None, ge=1)
    end_line: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def validate_line_range(self) -> Self:
        if (
            self.start_line is not None
            and self.end_line is not None
            and self.end_line < self.start_line
        ):
            raise ValueError("endLine must be greater than or equal to startLine")
        return self


class ThoughtMetadata(ArtifactModel):
    created_at: datetime | None = None
    modified_at: datetime | None = None
    tags: tuple[str, ...] = ()
    entities: tuple[str, ...] = ()
    word_count: int = Field(ge=0)
    importance: UnitFloat


class ThoughtVisual(ArtifactModel):
    cluster_id: NonEmptyString
    size: PositiveFloat
    base_opacity: UnitFloat


class ThoughtNode(ArtifactModel):
    id: NonEmptyString
    title: NonEmptyString
    text: NonEmptyString
    summary: NonEmptyString
    source: SourceProvenance
    metadata: ThoughtMetadata
    visual: ThoughtVisual


class EdgeType(StrEnum):
    EXPLICIT = "explicit"
    STRUCTURAL = "structural"
    SEMANTIC = "semantic"
    TEMPORAL = "temporal"
    ENTITY = "entity"
    MANUAL = "manual"


class EdgeEvidence(ArtifactModel):
    description: NonEmptyString
    shared_terms: tuple[str, ...] = ()
    shared_entities: tuple[str, ...] = ()
    similarity: UnitFloat | None = None
    time_distance_days: float | None = Field(default=None, ge=0.0)


class EdgeVisual(ArtifactModel):
    opacity: UnitFloat
    width: PositiveFloat


class ThoughtEdge(ArtifactModel):
    id: NonEmptyString
    source: NonEmptyString
    target: NonEmptyString
    directed: bool
    type: EdgeType
    weight: UnitFloat
    confidence: UnitFloat
    evidence: EdgeEvidence
    visual: EdgeVisual

    @model_validator(mode="after")
    def reject_self_edge(self) -> Self:
        if self.source == self.target:
            raise ValueError("source and target must identify different nodes")
        return self


class GraphArtifact(ArtifactModel):
    schema_version: Literal[1] = 1
    nodes: tuple[ThoughtNode, ...]
    edges: tuple[ThoughtEdge, ...]

    @model_validator(mode="after")
    def validate_graph_references(self) -> Self:
        node_ids = [node.id for node in self.nodes]
        if len(node_ids) != len(set(node_ids)):
            raise ValueError("node ids must be unique")

        edge_ids = [edge.id for edge in self.edges]
        if len(edge_ids) != len(set(edge_ids)):
            raise ValueError("edge ids must be unique")

        known_nodes = set(node_ids)
        dangling = sorted(
            {
                endpoint
                for edge in self.edges
                for endpoint in (edge.source, edge.target)
                if endpoint not in known_nodes
            }
        )
        if dangling:
            raise ValueError(f"edges reference unknown node ids: {', '.join(dangling)}")
        return self


class LayoutBounds(ArtifactModel):
    min: Vec3
    max: Vec3

    @model_validator(mode="after")
    def validate_axis_order(self) -> Self:
        if any(lower > upper for lower, upper in zip(self.min, self.max, strict=True)):
            raise ValueError("bounds.min must not exceed bounds.max on any axis")
        return self


class LayoutMaps(ArtifactModel):
    semantic: dict[str, Vec3]
    clusters: dict[str, Vec3]
    temporal: dict[str, Vec3]
    force: dict[str, Vec3]

    @model_validator(mode="after")
    def validate_node_sets(self) -> Self:
        expected = set(self.semantic)
        for name, layout in (
            ("clusters", self.clusters),
            ("temporal", self.temporal),
            ("force", self.force),
        ):
            if set(layout) != expected:
                raise ValueError(f"{name} node ids must match semantic node ids")
        if any(not node_id.strip() for node_id in expected):
            raise ValueError("layout node ids must not be blank")
        return self


class LayoutArtifact(ArtifactModel):
    version: Literal[1] = 1
    bounds: LayoutBounds
    layouts: LayoutMaps


class GraphManifest(ArtifactModel):
    schema_version: Literal[1] = 1
    generated_at: AwareDatetime
    corpus_name: NonEmptyString
    node_count: int = Field(ge=0)
    edge_count: int = Field(ge=0)
    embedding_model: NonEmptyString
    pipeline_config_hash: NonEmptyString


class SimilarityDistribution(ArtifactModel):
    count: int = Field(ge=0)
    minimum: UnitFloat | None = None
    median: UnitFloat | None = None
    p95: UnitFloat | None = None
    maximum: UnitFloat | None = None

    @model_validator(mode="after")
    def validate_distribution(self) -> Self:
        values = (self.minimum, self.median, self.p95, self.maximum)
        if self.count == 0:
            if any(value is not None for value in values):
                raise ValueError("an empty distribution must not include summary values")
            return self
        if any(value is None for value in values):
            raise ValueError("a non-empty distribution requires minimum, median, p95, and maximum")
        numeric_values = tuple(value for value in values if value is not None)
        if tuple(sorted(numeric_values)) != numeric_values:
            raise ValueError("similarity summary values must be ordered")
        return self


class PipelineReport(ArtifactModel):
    schema_version: Literal[1] = 1
    generated_at: AwareDatetime
    file_count: int = Field(ge=0)
    chunk_count: int = Field(ge=0)
    node_count: int = Field(ge=0)
    edge_count: int = Field(ge=0)
    edge_counts: dict[EdgeType, int]
    isolated_node_count: int = Field(ge=0)
    average_degree: float = Field(ge=0.0)
    cluster_count: int = Field(ge=0)
    similarity_distribution: SimilarityDistribution
    build_duration_ms: float = Field(ge=0.0)
    warnings: tuple[str, ...] = ()

    @model_validator(mode="after")
    def validate_report_counts(self) -> Self:
        if any(count < 0 for count in self.edge_counts.values()):
            raise ValueError("edgeCounts values must be non-negative")
        if sum(self.edge_counts.values()) != self.edge_count:
            raise ValueError("edgeCounts values must sum to edgeCount")
        if self.isolated_node_count > self.node_count:
            raise ValueError("isolatedNodeCount must not exceed nodeCount")
        if self.cluster_count > self.node_count:
            raise ValueError("clusterCount must not exceed nodeCount")
        return self


class GraphStatistics(ArtifactModel):
    node_count: int = Field(ge=0)
    edge_count: int = Field(ge=0)
    edge_counts: dict[EdgeType, int]
    isolated_node_count: int = Field(ge=0)
    average_degree: float = Field(ge=0.0)
