"""Signal combination, graph pruning, isolated-node repair, and communities."""

from __future__ import annotations

import hashlib
import math
import re
from collections import Counter, defaultdict

import networkx as nx
from pydantic import Field, model_validator

from touch_traversal.config import ClusteringConfig, PruningConfig, ScoringConfig
from touch_traversal.documents import ThoughtChunk
from touch_traversal.models import (
    ArtifactModel,
    EdgeEvidence,
    EdgeType,
    EdgeVisual,
    NonEmptyString,
    ThoughtEdge,
    UnitFloat,
)
from touch_traversal.relations import RelationCandidate, entities_for_chunks

_TYPE_PRIORITY = {
    EdgeType.EXPLICIT: 0,
    EdgeType.MANUAL: 1,
    EdgeType.SEMANTIC: 2,
    EdgeType.STRUCTURAL: 3,
    EdgeType.ENTITY: 4,
    EdgeType.TEMPORAL: 5,
}
_TOKEN_PATTERN = re.compile(r"\b[a-z][a-z0-9-]{2,}\b")
_STOP_WORDS = {
    "and",
    "about",
    "after",
    "again",
    "also",
    "because",
    "before",
    "between",
    "could",
    "from",
    "for",
    "have",
    "into",
    "not",
    "more",
    "only",
    "other",
    "should",
    "that",
    "the",
    "their",
    "there",
    "these",
    "they",
    "this",
    "through",
    "under",
    "using",
    "what",
    "when",
    "where",
    "which",
    "while",
    "with",
    "would",
}


class GraphAssemblyError(ValueError):
    """An actionable error in candidate combination or graph construction."""


class ScoredRelation(ArtifactModel):
    source: NonEmptyString
    target: NonEmptyString
    directed: bool
    type: EdgeType
    score: UnitFloat
    confidence: UnitFloat
    signal_scores: dict[EdgeType, UnitFloat]
    evidence: EdgeEvidence

    @model_validator(mode="after")
    def validate_relation(self) -> ScoredRelation:
        if self.source == self.target:
            raise ValueError("source and target must identify different chunks")
        if not self.signal_scores:
            raise ValueError("a scored relation requires at least one signal")
        return self


class Community(ArtifactModel):
    id: NonEmptyString
    label: NonEmptyString
    node_ids: tuple[str, ...] = Field(min_length=1)


class RelationGraph(ArtifactModel):
    edges: tuple[ThoughtEdge, ...]
    communities: tuple[Community, ...]
    isolated_node_ids: tuple[str, ...]
    average_degree: float = Field(ge=0.0)


def _coefficient(config: ScoringConfig, edge_type: EdgeType) -> float:
    return {
        EdgeType.EXPLICIT: config.explicit,
        EdgeType.MANUAL: config.explicit,
        EdgeType.STRUCTURAL: config.structural,
        EdgeType.SEMANTIC: config.semantic,
        EdgeType.TEMPORAL: config.temporal,
        EdgeType.ENTITY: config.entity,
    }[edge_type]


def _pair(source: str, target: str) -> tuple[str, str]:
    return (source, target) if source < target else (target, source)


def combine_relation_candidates(
    candidates: tuple[RelationCandidate, ...],
    config: ScoringConfig,
) -> tuple[ScoredRelation, ...]:
    """Combine all evidence for an endpoint pair using configured signal coefficients."""
    grouped: dict[tuple[str, str], list[RelationCandidate]] = defaultdict(list)
    for candidate in candidates:
        grouped[_pair(candidate.source, candidate.target)].append(candidate)

    combined: list[ScoredRelation] = []
    for pair, supports in sorted(grouped.items()):
        signal_scores: dict[EdgeType, float] = {}
        for support in supports:
            signal_scores[support.type] = max(signal_scores.get(support.type, 0.0), support.score)

        contributions = {
            edge_type: _coefficient(config, edge_type) * score
            for edge_type, score in signal_scores.items()
        }
        primary_type = max(
            contributions,
            key=lambda edge_type: (contributions[edge_type], -_TYPE_PRIORITY[edge_type]),
        )
        primary_support = sorted(
            (support for support in supports if support.type is primary_type),
            key=lambda support: (
                -support.score,
                -support.confidence,
                support.source,
                support.target,
                support.evidence.description,
            ),
        )[0]
        directed = primary_support.directed
        source, target = (primary_support.source, primary_support.target) if directed else pair
        ordered_supports = sorted(
            supports,
            key=lambda support: (
                _TYPE_PRIORITY[support.type],
                support.source,
                support.target,
                support.evidence.description,
            ),
        )
        descriptions = tuple(
            dict.fromkeys(
                f"{support.type.value}: {support.evidence.description}"
                for support in ordered_supports
            )
        )
        shared_terms = tuple(
            sorted({term for support in supports for term in support.evidence.shared_terms})
        )
        shared_entities = tuple(
            sorted({entity for support in supports for entity in support.evidence.shared_entities})
        )
        similarities = [
            support.evidence.similarity
            for support in supports
            if support.evidence.similarity is not None
        ]
        time_distances = [
            support.evidence.time_distance_days
            for support in supports
            if support.evidence.time_distance_days is not None
        ]
        combined.append(
            ScoredRelation(
                source=source,
                target=target,
                directed=directed,
                type=primary_type,
                score=min(1.0, sum(contributions.values())),
                confidence=max(support.confidence for support in supports),
                signal_scores=signal_scores,
                evidence=EdgeEvidence(
                    description=" | ".join(descriptions),
                    shared_terms=shared_terms,
                    shared_entities=shared_entities,
                    similarity=max(similarities) if similarities else None,
                    time_distance_days=min(time_distances) if time_distances else None,
                ),
            )
        )
    return tuple(combined)


def _rank(relation: ScoredRelation) -> tuple[float | int | str, ...]:
    explicit = relation.signal_scores.get(EdgeType.EXPLICIT, 0.0) > 0
    mutual_semantic = "mutual top-K neighbors" in relation.evidence.description
    return (
        -int(explicit),
        -int(mutual_semantic),
        -relation.score,
        _TYPE_PRIORITY[relation.type],
        relation.source,
        relation.target,
    )


def _degrees(
    node_ids: tuple[str, ...], relations: dict[tuple[str, str], ScoredRelation]
) -> dict[str, int]:
    degrees = dict.fromkeys(node_ids, 0)
    for relation in relations.values():
        degrees[relation.source] += 1
        degrees[relation.target] += 1
    return degrees


def prune_relations(
    node_ids: tuple[str, ...],
    relations: tuple[ScoredRelation, ...],
    config: PruningConfig,
) -> tuple[ScoredRelation, ...]:
    """Apply score, degree, target-density, global limits, then repair isolated nodes."""
    known_nodes = set(node_ids)
    unknown = sorted(
        {
            endpoint
            for relation in relations
            for endpoint in (relation.source, relation.target)
            if endpoint not in known_nodes
        }
    )
    if unknown:
        raise GraphAssemblyError(f"relations reference unknown chunk ids: {', '.join(unknown)}")
    if len(known_nodes) != len(node_ids):
        raise GraphAssemblyError("node ids must be unique")

    target_edges = int(len(node_ids) * config.target_average_degree / 2)
    edge_limit = min(config.maximum_edges, target_edges)
    selected: dict[tuple[str, str], ScoredRelation] = {}
    degrees = dict.fromkeys(node_ids, 0)
    score_eligible = tuple(
        (relation for relation in relations if relation.score >= config.minimum_score),
    )
    top_k_selections: Counter[tuple[str, str]] = Counter()
    for node_id in node_ids:
        incident = sorted(
            (
                relation
                for relation in score_eligible
                if node_id in {relation.source, relation.target}
            ),
            key=_rank,
        )
        top_k_selections.update(
            _pair(relation.source, relation.target)
            for relation in incident[: config.maximum_degree]
        )
    eligible = sorted(
        (
            relation
            for relation in score_eligible
            if _pair(relation.source, relation.target) in top_k_selections
        ),
        key=lambda relation: (
            -top_k_selections[_pair(relation.source, relation.target)],
            *_rank(relation),
        ),
    )
    for relation in eligible:
        if len(selected) >= edge_limit:
            break
        if (
            degrees[relation.source] >= config.maximum_degree
            or degrees[relation.target] >= config.maximum_degree
        ):
            continue
        key = _pair(relation.source, relation.target)
        selected[key] = relation
        degrees[relation.source] += 1
        degrees[relation.target] += 1

    if config.repair_isolated_nodes:
        all_ranked = sorted(relations, key=_rank)
        for isolated in sorted(node for node, degree in degrees.items() if degree == 0):
            if degrees[isolated] > 0:
                continue
            options = [
                relation
                for relation in all_ranked
                if isolated in {relation.source, relation.target}
                and _pair(relation.source, relation.target) not in selected
            ]
            for relation in options:
                neighbor = relation.target if relation.source == isolated else relation.source
                removable: ScoredRelation | None = None
                if len(selected) >= edge_limit or degrees[neighbor] >= config.maximum_degree:
                    removable_options = [
                        current
                        for current in selected.values()
                        if current.signal_scores.get(EdgeType.EXPLICIT, 0.0) == 0
                        and degrees[current.source] > 1
                        and degrees[current.target] > 1
                        and (
                            degrees[neighbor] < config.maximum_degree
                            or neighbor in {current.source, current.target}
                        )
                    ]
                    if not removable_options:
                        continue
                    removable = sorted(removable_options, key=_rank, reverse=True)[0]
                    del selected[_pair(removable.source, removable.target)]
                    degrees[removable.source] -= 1
                    degrees[removable.target] -= 1
                if degrees[neighbor] >= config.maximum_degree or len(selected) >= edge_limit:
                    if removable is not None:
                        selected[_pair(removable.source, removable.target)] = removable
                        degrees[removable.source] += 1
                        degrees[removable.target] += 1
                    continue
                selected[_pair(relation.source, relation.target)] = relation
                degrees[relation.source] += 1
                degrees[relation.target] += 1
                break

    return tuple(sorted(selected.values(), key=lambda relation: (relation.source, relation.target)))


def _edge_id(relation: ScoredRelation) -> str:
    identity = "\0".join(
        (
            relation.source,
            relation.target,
            str(relation.directed),
            relation.type.value,
        )
    )
    return f"edge_{hashlib.sha256(identity.encode('utf-8')).hexdigest()[:24]}"


def to_thought_edge(relation: ScoredRelation) -> ThoughtEdge:
    """Convert a retained scored relation into the strict frontend edge contract."""
    return ThoughtEdge(
        id=_edge_id(relation),
        source=relation.source,
        target=relation.target,
        directed=relation.directed,
        type=relation.type,
        weight=relation.score,
        confidence=relation.confidence,
        evidence=relation.evidence,
        visual=EdgeVisual(
            opacity=min(1.0, 0.25 + 0.65 * relation.score),
            width=0.6 + 1.8 * relation.score,
        ),
    )


def _community_term_weights(
    chunks: tuple[ThoughtChunk, ...], node_ids: set[str], entities: dict[str, tuple[str, ...]]
) -> Counter[str]:
    weights: Counter[str] = Counter()
    for chunk in chunks:
        if chunk.id not in node_ids:
            continue
        weights.update({tag: 4 for tag in chunk.tags if tag})
        weights.update({entity: 2 for entity in entities[chunk.id] if entity})
        text_terms = Counter(
            token
            for token in _TOKEN_PATTERN.findall(chunk.normalized_text)
            if token not in _STOP_WORDS
        )
        weights.update({term: min(count, 3) for term, count in text_terms.items()})
    return weights


def _community_id(node_ids: tuple[str, ...]) -> str:
    digest = hashlib.sha256("\0".join(node_ids).encode("utf-8")).hexdigest()
    return f"cluster_{digest[:16]}"


def detect_communities(
    chunks: tuple[ThoughtChunk, ...],
    edges: tuple[ThoughtEdge, ...],
    config: ClusteringConfig,
) -> tuple[Community, ...]:
    """Detect seeded weighted Louvain communities and label them from corpus terms."""
    graph: nx.Graph[str] = nx.Graph()
    graph.add_nodes_from(sorted(chunk.id for chunk in chunks))
    for edge in sorted(edges, key=lambda item: item.id):
        graph.add_edge(edge.source, edge.target, weight=edge.weight)

    if graph.number_of_edges() == 0:
        node_sets = [{node_id} for node_id in sorted(graph.nodes)]
    else:
        node_sets = [
            set(community)
            for community in nx.community.louvain_communities(
                graph,
                weight="weight",
                resolution=config.resolution,
                seed=config.random_seed,
            )
        ]
        node_sets.sort(key=lambda node_set: min(node_set))

    entities = entities_for_chunks(chunks)
    term_weights = [_community_term_weights(chunks, node_set, entities) for node_set in node_sets]
    term_document_frequency = Counter(term for weights in term_weights for term in weights)
    community_count = len(node_sets)
    communities: list[Community] = []
    for node_set, weights in zip(node_sets, term_weights, strict=True):
        ranked_terms = sorted(
            weights,
            key=lambda term: (
                -weights[term]
                * (math.log((community_count + 1) / (term_document_frequency[term] + 1)) + 1),
                term,
            ),
        )
        label_terms = [term.replace("-", " ").title() for term in ranked_terms[:3]]
        node_ids = tuple(sorted(node_set))
        communities.append(
            Community(
                id=_community_id(node_ids),
                label=" · ".join(label_terms) if label_terms else "General Notes",
                node_ids=node_ids,
            )
        )
    return tuple(communities)


def assemble_relation_graph(
    chunks: tuple[ThoughtChunk, ...],
    candidates: tuple[RelationCandidate, ...],
    scoring_config: ScoringConfig,
    pruning_config: PruningConfig,
    clustering_config: ClusteringConfig,
) -> RelationGraph:
    """Combine, prune, repair, and cluster all graph relation candidates."""
    node_ids = tuple(chunk.id for chunk in chunks)
    combined = combine_relation_candidates(candidates, scoring_config)
    retained = prune_relations(node_ids, combined, pruning_config)
    edges = tuple(to_thought_edge(relation) for relation in retained)
    degrees = _degrees(
        node_ids,
        {_pair(relation.source, relation.target): relation for relation in retained},
    )
    isolated = tuple(sorted(node_id for node_id, degree in degrees.items() if degree == 0))
    average_degree = 2 * len(edges) / len(node_ids) if node_ids else 0.0
    communities = detect_communities(chunks, edges, clustering_config)
    return RelationGraph(
        edges=edges,
        communities=communities,
        isolated_node_ids=isolated,
        average_degree=average_degree,
    )
