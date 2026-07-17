"""Deterministic thought chunking with stable identity and source provenance."""

from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass

from markdown_it import MarkdownIt
from markdown_it.token import Token

from touch_traversal.config import ChunkingConfig
from touch_traversal.documents import DocumentFormat, SourceDocument, ThoughtChunk
from touch_traversal.ingestion import normalize_text
from touch_traversal.models import SourceProvenance

_MARKDOWN = MarkdownIt("commonmark", {"html": False})
_SENTENCE_BOUNDARY = re.compile(r"(?<=[.!?])\s+")
_SUMMARY_MAX_CHARACTERS = 200


@dataclass(frozen=True)
class _Section:
    title: str
    heading_path: tuple[str, ...]
    start: int
    end: int


@dataclass(frozen=True)
class _Candidate:
    title: str
    heading_path: tuple[str, ...]
    text: str
    normalized_text: str
    word_count: int
    start_line: int
    end_line: int
    boundary_key: str


def canonical_document_id(path: str) -> str:
    """Build a cross-platform document ID from its canonical corpus-relative path."""
    canonical_path = unicodedata.normalize("NFC", path.replace("\\", "/")).casefold()
    digest = hashlib.sha256(canonical_path.encode("utf-8")).hexdigest()
    return f"doc_{digest[:20]}"


def _inline_text(token: Token) -> str:
    if token.children is None:
        return token.content.strip()
    parts = [
        " " if child.type in {"softbreak", "hardbreak"} else child.content
        for child in token.children
        if child.type in {"text", "code_inline", "image", "softbreak", "hardbreak"}
    ]
    return "".join(parts).strip()


def _plain_text(markdown: str) -> str:
    tokens = _MARKDOWN.parse(markdown)
    parts = [
        token.content.strip() if token.type in {"fence", "code_block"} else _inline_text(token)
        for token in tokens
        if token.type in {"inline", "fence", "code_block"}
    ]
    return " ".join(part for part in parts if part)


def _word_count(text: str) -> int:
    return len(normalize_text(_plain_text(text)).split())


def _heading_sections(document: SourceDocument) -> tuple[_Section, ...]:
    lines = document.display_text.splitlines(keepends=True)
    if document.format is DocumentFormat.TEXT:
        return (_Section(document.title, (), 0, len(lines)),)

    tokens = _MARKDOWN.parse(document.display_text)
    headings: list[tuple[int, int, int, str, tuple[str, ...]]] = []
    stack: list[tuple[int, str]] = []
    for index, token in enumerate(tokens):
        if token.type != "heading_open" or token.map is None or index + 1 >= len(tokens):
            continue
        title = _inline_text(tokens[index + 1])
        if not title:
            continue
        level = int(token.tag.removeprefix("h"))
        while stack and stack[-1][0] >= level:
            stack.pop()
        stack.append((level, title))
        headings.append(
            (token.map[0], token.map[1], level, title, tuple(text for _, text in stack))
        )

    if not headings:
        return (_Section(document.title, (), 0, len(lines)),)

    sections: list[_Section] = []
    if headings[0][0] > 0:
        sections.append(_Section(document.title, (), 0, headings[0][0]))
    for index, (_heading_start, body_start, _level, title, heading_path) in enumerate(headings):
        body_end = headings[index + 1][0] if index + 1 < len(headings) else len(lines)
        sections.append(_Section(title, heading_path, body_start, body_end))
    return tuple(sections)


def _trimmed_range(lines: list[str], start: int, end: int) -> tuple[int, int]:
    while start < end and not lines[start].strip():
        start += 1
    while end > start and not lines[end - 1].strip():
        end -= 1
    return start, end


def _candidate_from_range(
    document: SourceDocument,
    lines: list[str],
    section: _Section,
    start: int,
    end: int,
) -> _Candidate | None:
    start, end = _trimmed_range(lines, start, end)
    if start >= end:
        return None
    text = "".join(lines[start:end]).strip()
    normalized = normalize_text(_plain_text(text))
    if not normalized:
        return None
    return _Candidate(
        title=section.title or document.title,
        heading_path=section.heading_path,
        text=text,
        normalized_text=normalized,
        word_count=len(normalized.split()),
        start_line=document.body_start_line + start,
        end_line=document.body_start_line + end - 1,
        boundary_key=f"lines:{document.body_start_line + start}-{document.body_start_line + end - 1}",
    )


def _block_ranges(section_text: str) -> tuple[tuple[int, int], ...]:
    tokens = _MARKDOWN.parse(section_text)
    list_ranges = sorted(
        {
            (token.map[0], token.map[1])
            for token in tokens
            if token.type == "list_item_open" and token.map is not None
        }
    )
    non_overlapping_lists: list[tuple[int, int]] = []
    for item_range in list_ranges:
        if any(
            existing_start <= item_range[0] and item_range[1] <= existing_end
            for existing_start, existing_end in non_overlapping_lists
        ):
            continue
        non_overlapping_lists.append(item_range)

    ranges = list(non_overlapping_lists)
    for token in tokens:
        if token.map is None or token.type not in {"paragraph_open", "fence", "code_block"}:
            continue
        token_range = (token.map[0], token.map[1])
        if any(start <= token_range[0] and token_range[1] <= end for start, end in ranges):
            continue
        ranges.append(token_range)
    return tuple(sorted(set(ranges)))


def _split_long_candidate(candidate: _Candidate, config: ChunkingConfig) -> list[_Candidate]:
    sentences = [part.strip() for part in _SENTENCE_BOUNDARY.split(candidate.text) if part.strip()]
    fragments: list[str] = []
    for sentence in sentences:
        if _word_count(sentence) <= config.hard_max_words:
            fragments.append(sentence)
            continue
        words = sentence.split()
        for start in range(0, len(words), config.preferred_max_words):
            fragments.append(" ".join(words[start : start + config.preferred_max_words]))

    groups: list[tuple[str, int, int]] = []
    current: list[str] = []
    current_words = 0
    group_start = 0
    consumed_words = 0
    for fragment in fragments:
        fragment_words = _word_count(fragment)
        would_exceed = current_words + fragment_words > config.preferred_max_words
        if current and would_exceed:
            groups.append((" ".join(current), group_start, consumed_words))
            current = []
            current_words = 0
            group_start = consumed_words
        current.append(fragment)
        current_words += fragment_words
        consumed_words += fragment_words
    if current:
        groups.append((" ".join(current), group_start, consumed_words))

    split_candidates = [
        _Candidate(
            title=candidate.title,
            heading_path=candidate.heading_path,
            text=group_text,
            normalized_text=normalize_text(_plain_text(group_text)),
            word_count=_word_count(group_text),
            start_line=candidate.start_line,
            end_line=candidate.end_line,
            boundary_key=f"{candidate.boundary_key}/words:{start_word}-{end_word}",
        )
        for group_text, start_word, end_word in groups
    ]
    return _coalesce_short_candidates(split_candidates, config, candidate.title)


def _merge_candidates(left: _Candidate, right: _Candidate, document_title: str) -> _Candidate:
    common_path: list[str] = []
    for left_part, right_part in zip(left.heading_path, right.heading_path, strict=False):
        if left_part != right_part:
            break
        common_path.append(left_part)
    text = f"{left.text.rstrip()}\n\n{right.text.lstrip()}"
    normalized = normalize_text(_plain_text(text))
    heading_path = tuple(common_path)
    return _Candidate(
        title=heading_path[-1] if heading_path else document_title,
        heading_path=heading_path,
        text=text,
        normalized_text=normalized,
        word_count=len(normalized.split()),
        start_line=min(left.start_line, right.start_line),
        end_line=max(left.end_line, right.end_line),
        boundary_key=f"{left.boundary_key}..{right.boundary_key}",
    )


def _coalesce_short_candidates(
    candidates: list[_Candidate], config: ChunkingConfig, document_title: str
) -> list[_Candidate]:
    """Join only undersized neighbors, preserving meaningful sections and blocks."""
    grouped: list[_Candidate] = []
    for candidate in candidates:
        if not grouped:
            grouped.append(candidate)
            continue
        previous = grouped[-1]
        combined_words = previous.word_count + candidate.word_count
        should_merge = (
            previous.word_count < config.min_words or candidate.word_count < config.min_words
        ) and combined_words <= config.hard_max_words
        if should_merge:
            grouped[-1] = _merge_candidates(previous, candidate, document_title)
        else:
            grouped.append(candidate)

    if len(grouped) > 1 and grouped[-1].word_count < config.min_words:
        combined_words = grouped[-2].word_count + grouped[-1].word_count
        if combined_words <= config.hard_max_words:
            grouped[-2:] = [_merge_candidates(grouped[-2], grouped[-1], document_title)]
    return grouped


def _split_section(
    document: SourceDocument,
    lines: list[str],
    section: _Section,
    config: ChunkingConfig,
) -> list[_Candidate]:
    whole = _candidate_from_range(document, lines, section, section.start, section.end)
    if whole is None:
        return []
    if whole.word_count <= config.hard_max_words:
        return [whole]

    section_text = "".join(lines[section.start : section.end])
    blocks: list[_Candidate] = []
    for local_start, local_end in _block_ranges(section_text):
        block = _candidate_from_range(
            document,
            lines,
            section,
            section.start + local_start,
            section.start + local_end,
        )
        if block is None:
            continue
        if block.word_count > config.hard_max_words:
            blocks.extend(_split_long_candidate(block, config))
        else:
            blocks.append(block)
    if not blocks:
        return _split_long_candidate(whole, config)
    return _coalesce_short_candidates(blocks, config, document.title)


def _summary(text: str) -> str:
    plain = " ".join(_plain_text(text).split())
    if len(plain) <= _SUMMARY_MAX_CHARACTERS:
        return plain
    prefix = plain[: _SUMMARY_MAX_CHARACTERS - 1]
    if " " in prefix:
        prefix = prefix.rsplit(" ", maxsplit=1)[0]
    return f"{prefix.rstrip()}…"


def _fallback_title(text: str, document_title: str) -> str:
    plain = " ".join(_plain_text(text).split())
    if not plain:
        return document_title
    clause = re.split(r"(?<=[.!?;:])\s+", plain, maxsplit=1)[0]
    if len(clause) <= 80:
        return clause
    prefix = clause[:79]
    if " " in prefix:
        prefix = prefix.rsplit(" ", maxsplit=1)[0]
    return f"{prefix.rstrip()}…"


def _chunk_id(document_id: str, candidate: _Candidate) -> str:
    identity = "\0".join(
        (
            document_id,
            "/".join(candidate.heading_path),
            str(candidate.start_line),
            str(candidate.end_line),
            candidate.boundary_key,
            candidate.normalized_text,
        )
    )
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()
    return f"thought_{digest[:24]}"


def chunk_document(document: SourceDocument, config: ChunkingConfig) -> tuple[ThoughtChunk, ...]:
    """Chunk a parsed document by sections, blocks, then bounded sentence groups."""
    lines = document.display_text.splitlines(keepends=True)
    preliminary: list[_Candidate] = []
    for section in _heading_sections(document):
        preliminary.extend(_split_section(document, lines, section, config))
    candidates = _coalesce_short_candidates(preliminary, config, document.title)

    document_id = canonical_document_id(document.path)
    chunks = tuple(
        ThoughtChunk(
            id=_chunk_id(document_id, candidate),
            title=(
                candidate.title
                if candidate.heading_path
                else _fallback_title(candidate.text, document.title)
            ),
            text=candidate.text,
            summary=_summary(candidate.text),
            normalized_text=candidate.normalized_text,
            source=SourceProvenance(
                path=document.path,
                document_id=document_id,
                heading_path=candidate.heading_path,
                start_line=candidate.start_line,
                end_line=candidate.end_line,
            ),
            created_at=document.created_at,
            modified_at=document.modified_at,
            tags=document.tags,
            word_count=candidate.word_count,
        )
        for candidate in candidates
    )
    if len({chunk.id for chunk in chunks}) != len(chunks):
        raise ValueError(f"chunk identity collision in {document.path}")
    return chunks


def chunk_corpus(
    documents: tuple[SourceDocument, ...], config: ChunkingConfig
) -> tuple[ThoughtChunk, ...]:
    """Chunk a corpus in deterministic document and source order."""
    chunks = tuple(chunk for document in documents for chunk in chunk_document(document, config))
    if len({chunk.id for chunk in chunks}) != len(chunks):
        raise ValueError("chunk identity collision across the corpus")
    return chunks
