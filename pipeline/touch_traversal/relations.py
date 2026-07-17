"""Explainable deterministic relation candidates derived without embeddings."""

from __future__ import annotations

import math
import posixpath
import re
import unicodedata
from collections import Counter, defaultdict
from itertools import pairwise
from pathlib import PurePosixPath
from urllib.parse import unquote, urlsplit

from markdown_it import MarkdownIt
from pydantic import model_validator

from touch_traversal.documents import DateSource, SourceDocument, ThoughtChunk
from touch_traversal.models import (
    ArtifactModel,
    EdgeEvidence,
    EdgeType,
    NonEmptyString,
    UnitFloat,
)

_MARKDOWN = MarkdownIt("commonmark", {"html": False})
_WIKI_LINK_PATTERN = re.compile(
    r"\[\[(?P<target>[^\]|#\n]+?)"
    r"(?:#(?P<anchor>[^\]|\n]+?))?"
    r"(?:\|(?P<alias>[^\]\n]+?))?\]\]"
)
_CAPITALIZED_PHRASE = re.compile(r"\b[A-Z][\w'-]+(?:\s+[A-Z][\w'-]+){1,3}\b")
_DECLARED_RELATION_KEYS = ("relations", "related", "related_to", "links")


class RelationCandidate(ArtifactModel):
    """One explainable signal that can support a final graph edge."""

    source: NonEmptyString
    target: NonEmptyString
    directed: bool
    type: EdgeType
    score: UnitFloat
    confidence: UnitFloat = 1.0
    evidence: EdgeEvidence

    @model_validator(mode="after")
    def reject_self_relation(self) -> RelationCandidate:
        if self.source == self.target:
            raise ValueError("source and target must identify different chunks")
        return self


def _canonical_reference(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", unquote(value)).replace("\\", "/")
    normalized = re.sub(r"\.(?:md|markdown|txt)$", "", normalized, flags=re.IGNORECASE)
    normalized = re.sub(r"[-_\s]+", " ", normalized.strip(" /"))
    return normalized.casefold()


def _document_aliases(document: SourceDocument) -> set[str]:
    path = PurePosixPath(document.path)
    aliases = {
        document.path,
        str(path.with_suffix("")),
        path.name,
        path.stem,
        document.title,
    }
    return {_canonical_reference(alias) for alias in aliases if _canonical_reference(alias)}


class _TargetIndex:
    def __init__(
        self,
        documents: tuple[SourceDocument, ...],
        chunks: tuple[ThoughtChunk, ...],
    ) -> None:
        self.documents = {document.path: document for document in documents}
        self.chunks_by_path: dict[str, list[ThoughtChunk]] = defaultdict(list)
        for chunk in chunks:
            self.chunks_by_path[chunk.source.path].append(chunk)
        for path_chunks in self.chunks_by_path.values():
            path_chunks.sort(key=lambda chunk: (chunk.source.start_line or 0, chunk.id))

        aliases: dict[str, list[str]] = defaultdict(list)
        for document in documents:
            for alias in _document_aliases(document):
                aliases[alias].append(document.path)
        self.aliases = {alias: tuple(sorted(set(paths))) for alias, paths in aliases.items()}

    def resolve(
        self,
        reference: str,
        anchor: str | None = None,
        source_path: str | None = None,
    ) -> ThoughtChunk | None:
        candidate_paths: list[str] = []
        if source_path is not None:
            source_parent = str(PurePosixPath(source_path).parent)
            relative = posixpath.normpath(posixpath.join(source_parent, reference))
            relative_alias = _canonical_reference(relative)
            candidate_paths.extend(self.aliases.get(relative_alias, ()))
        candidate_paths.extend(self.aliases.get(_canonical_reference(reference), ()))
        unique_paths = tuple(dict.fromkeys(candidate_paths))
        if len(unique_paths) != 1:
            return None

        target_chunks = self.chunks_by_path.get(unique_paths[0], [])
        if not target_chunks:
            return None
        if anchor:
            canonical_anchor = _canonical_reference(anchor)
            for chunk in target_chunks:
                if any(
                    _canonical_reference(part) == canonical_anchor
                    for part in chunk.source.heading_path
                ):
                    return chunk
        return target_chunks[0]


def _markdown_links(markdown: str) -> tuple[tuple[str, str], ...]:
    links: list[tuple[str, str]] = []
    for token in _MARKDOWN.parse(markdown):
        if token.type != "inline" or token.children is None:
            continue
        for index, child in enumerate(token.children):
            if child.type != "link_open":
                continue
            destination = child.attrGet("href")
            if not isinstance(destination, str) or not destination:
                continue
            label: list[str] = []
            for nested in token.children[index + 1 :]:
                if nested.type == "link_close":
                    break
                if nested.type in {"text", "code_inline", "image"}:
                    label.append(nested.content)
            links.append(("".join(label).strip(), destination))
    return tuple(links)


def _split_reference(reference: str) -> tuple[str, str | None]:
    target, separator, anchor = reference.partition("#")
    return target.strip(), anchor.strip() if separator and anchor.strip() else None


def _declared_targets(value: object) -> tuple[str, ...]:
    if isinstance(value, str):
        return (value.strip(),) if value.strip() else ()
    if isinstance(value, list):
        return tuple(target for item in value for target in _declared_targets(item))
    if isinstance(value, dict):
        preferred = [value[key] for key in ("target", "to", "note", "path") if key in value]
        candidates = preferred or list(value.values())
        return tuple(target for item in candidates for target in _declared_targets(item))
    return ()


def _relation(
    source: ThoughtChunk,
    target: ThoughtChunk,
    *,
    directed: bool,
    type: EdgeType,
    score: float,
    description: str,
    shared_terms: tuple[str, ...] = (),
    shared_entities: tuple[str, ...] = (),
    time_distance_days: float | None = None,
) -> RelationCandidate | None:
    if source.id == target.id:
        return None
    source_id, target_id = source.id, target.id
    if not directed and target_id < source_id:
        source_id, target_id = target_id, source_id
    return RelationCandidate(
        source=source_id,
        target=target_id,
        directed=directed,
        type=type,
        score=max(0.0, min(1.0, score)),
        evidence=EdgeEvidence(
            description=description,
            shared_terms=shared_terms,
            shared_entities=shared_entities,
            time_distance_days=time_distance_days,
        ),
    )


def generate_explicit_relations(
    documents: tuple[SourceDocument, ...],
    chunks: tuple[ThoughtChunk, ...],
) -> tuple[RelationCandidate, ...]:
    """Resolve local wiki links, Markdown links, and declared front-matter relations."""
    index = _TargetIndex(documents, chunks)
    candidates: list[RelationCandidate] = []

    for source in chunks:
        for match in _WIKI_LINK_PATTERN.finditer(source.text):
            target_name = match.group("target").strip()
            anchor = match.group("anchor")
            target = index.resolve(target_name, anchor, source.source.path)
            if target is None:
                continue
            relation = _relation(
                source,
                target,
                directed=True,
                type=EdgeType.EXPLICIT,
                score=1.0,
                description=f'wiki link to "{target_name}"'
                + (f' heading "{anchor.strip()}"' if anchor else ""),
            )
            if relation is not None:
                candidates.append(relation)

        for label, destination in _markdown_links(source.text):
            parsed = urlsplit(destination)
            if parsed.scheme or parsed.netloc:
                continue
            target_name = parsed.path or source.source.path
            anchor = parsed.fragment or None
            target = index.resolve(target_name, anchor, source.source.path)
            if target is None:
                continue
            relation = _relation(
                source,
                target,
                directed=True,
                type=EdgeType.EXPLICIT,
                score=1.0,
                description=f'Markdown link "{label or destination}" to "{destination}"',
            )
            if relation is not None:
                candidates.append(relation)

    first_chunk_by_path = {
        path: path_chunks[0] for path, path_chunks in index.chunks_by_path.items() if path_chunks
    }
    for document in documents:
        declared_source = first_chunk_by_path.get(document.path)
        if declared_source is None:
            continue
        for key in _DECLARED_RELATION_KEYS:
            if key not in document.front_matter:
                continue
            for reference in _declared_targets(document.front_matter[key]):
                target_name, anchor = _split_reference(reference)
                target = index.resolve(target_name, anchor, document.path)
                if target is None:
                    continue
                relation = _relation(
                    declared_source,
                    target,
                    directed=True,
                    type=EdgeType.EXPLICIT,
                    score=1.0,
                    description=f'front-matter relation "{key}" to "{reference}"',
                )
                if relation is not None:
                    candidates.append(relation)

    return _deduplicate(candidates)


def generate_structural_relations(
    chunks: tuple[ThoughtChunk, ...],
) -> tuple[RelationCandidate, ...]:
    """Connect chunks by document membership, adjacency, and shared heading ancestry."""
    chunks_by_path: dict[str, list[ThoughtChunk]] = defaultdict(list)
    for chunk in chunks:
        chunks_by_path[chunk.source.path].append(chunk)

    candidates: list[RelationCandidate] = []
    for document_chunks in chunks_by_path.values():
        document_chunks.sort(key=lambda chunk: (chunk.source.start_line or 0, chunk.id))
        for left_index, left in enumerate(document_chunks):
            for right_index in range(left_index + 1, len(document_chunks)):
                right = document_chunks[right_index]
                adjacent = right_index == left_index + 1
                common_heading_parts: list[str] = []
                for left_part, right_part in zip(
                    left.source.heading_path,
                    right.source.heading_path,
                    strict=False,
                ):
                    if left_part != right_part:
                        break
                    common_heading_parts.append(left_part)
                common_heading = tuple(common_heading_parts)
                score = 1.0 if adjacent else 0.35
                reasons = [f'same document "{left.source.path}"']
                if adjacent:
                    reasons.append("adjacent source sections")
                if common_heading:
                    score = max(score, 0.75)
                    reasons.append(f'shared heading "{common_heading[-1]}"')
                relation = _relation(
                    left,
                    right,
                    directed=False,
                    type=EdgeType.STRUCTURAL,
                    score=score,
                    description="; ".join(reasons),
                    shared_terms=common_heading,
                )
                if relation is not None:
                    candidates.append(relation)
    return _deduplicate(candidates)


def generate_temporal_relations(
    documents: tuple[SourceDocument, ...],
    chunks: tuple[ThoughtChunk, ...],
) -> tuple[RelationCandidate, ...]:
    """Connect consecutive reliably dated documents within each source directory."""
    chunks_by_path: dict[str, list[ThoughtChunk]] = defaultdict(list)
    for chunk in chunks:
        chunks_by_path[chunk.source.path].append(chunk)

    sequences: dict[str, list[SourceDocument]] = defaultdict(list)
    for document in documents:
        if document.date_source is DateSource.FRONT_MATTER and chunks_by_path[document.path]:
            sequences[str(PurePosixPath(document.path).parent)].append(document)

    candidates: list[RelationCandidate] = []
    for sequence in sequences.values():
        sequence.sort(key=lambda document: (document.created_at, document.path))
        for earlier, later in pairwise(sequence):
            earlier_chunks = sorted(
                chunks_by_path[earlier.path],
                key=lambda chunk: (chunk.source.end_line or 0, chunk.id),
            )
            later_chunks = sorted(
                chunks_by_path[later.path],
                key=lambda chunk: (chunk.source.start_line or 0, chunk.id),
            )
            source = earlier_chunks[-1]
            target = later_chunks[0]
            day_distance = max(
                0.0, (later.created_at - earlier.created_at).total_seconds() / 86_400
            )
            proximity = 1.0 / (1.0 + day_distance / 30.0)
            relation = _relation(
                source,
                target,
                directed=True,
                type=EdgeType.TEMPORAL,
                score=proximity,
                description=(
                    f'reliable source sequence from "{earlier.path}" '
                    f'to "{later.path}" ({day_distance:g} days)'
                ),
                time_distance_days=day_distance,
            )
            if relation is not None:
                candidates.append(relation)
    return _deduplicate(candidates)


def entities_for_chunks(chunks: tuple[ThoughtChunk, ...]) -> dict[str, tuple[str, ...]]:
    """Extract deterministic metadata entities used for overlap scoring and labels."""
    entities: dict[str, tuple[str, ...]] = {}
    for chunk in chunks:
        values = {tag.casefold() for tag in chunk.tags if tag.strip()}
        values.update(
            _canonical_reference(match.group("target"))
            for match in _WIKI_LINK_PATTERN.finditer(chunk.text)
        )
        values.update(
            _canonical_reference(match.group(0))
            for match in _CAPITALIZED_PHRASE.finditer(chunk.text)
        )
        values.discard("")
        entities[chunk.id] = tuple(sorted(values))
    return entities


def generate_entity_relations(
    chunks: tuple[ThoughtChunk, ...],
) -> tuple[RelationCandidate, ...]:
    """Score shared entities with inverse document frequency across thought chunks."""
    entities = entities_for_chunks(chunks)
    frequencies = Counter(entity for values in entities.values() for entity in values)
    chunk_count = len(chunks)
    if chunk_count < 2:
        return ()
    maximum_shared_idf = math.log((chunk_count + 1) / 3) + 1

    candidates: list[RelationCandidate] = []
    for left_index, left in enumerate(chunks):
        left_entities = set(entities[left.id])
        for right in chunks[left_index + 1 :]:
            shared = tuple(sorted(left_entities.intersection(entities[right.id])))
            if not shared:
                continue
            overlap = sum(
                math.log((chunk_count + 1) / (frequencies[entity] + 1)) + 1 for entity in shared
            )
            score = min(1.0, overlap / maximum_shared_idf)
            relation = _relation(
                left,
                right,
                directed=False,
                type=EdgeType.ENTITY,
                score=score,
                description=f"shared entities weighted by rarity: {', '.join(shared)}",
                shared_entities=shared,
            )
            if relation is not None:
                candidates.append(relation)
    return _deduplicate(candidates)


def _deduplicate(candidates: list[RelationCandidate]) -> tuple[RelationCandidate, ...]:
    by_key: dict[tuple[EdgeType, bool, str, str], RelationCandidate] = {}
    for candidate in candidates:
        key = (candidate.type, candidate.directed, candidate.source, candidate.target)
        previous = by_key.get(key)
        if previous is None or candidate.score > previous.score:
            by_key[key] = candidate
    return tuple(
        sorted(
            by_key.values(),
            key=lambda candidate: (
                candidate.type.value,
                candidate.source,
                candidate.target,
                candidate.evidence.description,
            ),
        )
    )


def generate_nonsemantic_relations(
    documents: tuple[SourceDocument, ...],
    chunks: tuple[ThoughtChunk, ...],
) -> tuple[RelationCandidate, ...]:
    """Generate all deterministic relation signals that do not require embeddings."""
    return tuple(
        sorted(
            (
                *generate_explicit_relations(documents, chunks),
                *generate_structural_relations(chunks),
                *generate_temporal_relations(documents, chunks),
                *generate_entity_relations(chunks),
            ),
            key=lambda candidate: (
                candidate.type.value,
                candidate.source,
                candidate.target,
                candidate.evidence.description,
            ),
        )
    )
