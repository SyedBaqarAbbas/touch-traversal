"""Load, cross-check, and summarize exported pipeline artifacts."""

from __future__ import annotations

import json
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel, ValidationError

from touch_traversal.models import (
    EdgeType,
    GraphArtifact,
    GraphManifest,
    GraphStatistics,
    LayoutArtifact,
    PipelineReport,
)

ModelT = TypeVar("ModelT", bound=BaseModel)


class ArtifactValidationError(ValueError):
    """An actionable error raised while loading or cross-checking artifacts."""


def _format_validation_error(error: ValidationError) -> str:
    messages: list[str] = []
    for issue in error.errors(include_url=False):
        location = ".".join(str(part) for part in issue["loc"]) or "artifact"
        messages.append(f"{location}: {issue['msg']}")
    return "; ".join(messages)


def load_artifact(path: Path, model_type: type[ModelT], label: str) -> ModelT:
    """Load a JSON artifact through the requested Pydantic contract."""
    try:
        content = path.read_text(encoding="utf-8")
    except FileNotFoundError as error:
        raise ArtifactValidationError(f"{label} artifact does not exist: {path}") from error
    except OSError as error:
        raise ArtifactValidationError(f"could not read {label} artifact {path}: {error}") from error

    try:
        raw: object = json.loads(content)
    except json.JSONDecodeError as error:
        raise ArtifactValidationError(
            f"invalid JSON in {label} artifact {path} at line {error.lineno}, "
            f"column {error.colno}: {error.msg}"
        ) from error

    try:
        return model_type.model_validate(raw)
    except ValidationError as error:
        details = _format_validation_error(error)
        raise ArtifactValidationError(f"invalid {label} artifact {path}: {details}") from error


def validate_artifact_bundle(
    graph: GraphArtifact,
    layouts: LayoutArtifact | None = None,
    manifest: GraphManifest | None = None,
    report: PipelineReport | None = None,
) -> None:
    """Reject inconsistencies across individually valid artifacts."""
    node_ids = {node.id for node in graph.nodes}
    if layouts is not None and set(layouts.layouts.semantic) != node_ids:
        raise ArtifactValidationError("layout node ids must match graph node ids")
    if manifest is not None:
        if manifest.node_count != len(graph.nodes):
            raise ArtifactValidationError("manifest nodeCount must match graph node count")
        if manifest.edge_count != len(graph.edges):
            raise ArtifactValidationError("manifest edgeCount must match graph edge count")
    if report is not None:
        if report.node_count != len(graph.nodes):
            raise ArtifactValidationError("report nodeCount must match graph node count")
        if report.edge_count != len(graph.edges):
            raise ArtifactValidationError("report edgeCount must match graph edge count")


def graph_statistics(graph: GraphArtifact) -> GraphStatistics:
    """Calculate deterministic high-level graph statistics."""
    edge_counts = {edge_type: 0 for edge_type in EdgeType}
    degrees = {node.id: 0 for node in graph.nodes}
    for edge in graph.edges:
        edge_counts[edge.type] += 1
        degrees[edge.source] += 1
        degrees[edge.target] += 1

    node_count = len(graph.nodes)
    total_degree = sum(degrees.values())
    average_degree = total_degree / node_count if node_count else 0.0
    isolated_node_count = sum(degree == 0 for degree in degrees.values())

    return GraphStatistics(
        node_count=node_count,
        edge_count=len(graph.edges),
        edge_counts=edge_counts,
        isolated_node_count=isolated_node_count,
        average_degree=average_degree,
    )
