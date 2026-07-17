"""Deterministic discovery, parsing, and normalization of local note documents."""

from __future__ import annotations

import fnmatch
import math
import re
import unicodedata
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import frontmatter
import yaml
from markdown_it import MarkdownIt
from markdown_it.token import Token
from pydantic import JsonValue

from touch_traversal.config import CorpusConfig
from touch_traversal.documents import (
    CorpusInspection,
    DateSource,
    DocumentFormat,
    DocumentHeading,
    DocumentSummary,
    MarkdownLink,
    SourceDocument,
    WikiLink,
)

_MARKDOWN = MarkdownIt("commonmark", {"html": False})
_WIKI_LINK_PATTERN = re.compile(
    r"\[\[(?P<target>[^\]|#\n]+?)"
    r"(?:#(?P<anchor>[^\]|\n]+?))?"
    r"(?:\|(?P<alias>[^\]\n]+?))?\]\]"
)
_HASHTAG_PATTERN = re.compile(r"(?<![\w/])#(?P<tag>[\w][\w/-]*)", flags=re.UNICODE)
_CREATED_KEYS = ("created_at", "createdAt", "created", "date")
_MODIFIED_KEYS = ("modified_at", "modifiedAt", "modified", "updated_at", "updatedAt", "updated")


class DocumentIngestionError(ValueError):
    """An actionable error raised while discovering or parsing source documents."""


def _matches_pattern(relative_path: Path, pattern: str) -> bool:
    value = relative_path.as_posix().casefold()
    normalized_pattern = pattern.replace("\\", "/").casefold()
    candidates = [normalized_pattern]
    if normalized_pattern.startswith("**/"):
        candidates.append(normalized_pattern[3:])
    return any(fnmatch.fnmatchcase(value, candidate) for candidate in candidates)


def discover_document_paths(root: Path, config: CorpusConfig) -> tuple[Path, ...]:
    """Return supported, non-hidden files in stable relative-path order."""
    if not root.exists():
        raise DocumentIngestionError(f"input corpus does not exist: {root}")
    if not root.is_dir():
        raise DocumentIngestionError(f"input corpus must be a directory: {root}")

    discovered: list[Path] = []
    for path in root.rglob("*"):
        if path.is_symlink() or not path.is_file():
            continue
        relative_path = path.relative_to(root)
        if any(part.startswith(".") for part in relative_path.parts):
            continue
        if not any(_matches_pattern(relative_path, pattern) for pattern in config.include):
            continue
        if any(_matches_pattern(relative_path, pattern) for pattern in config.exclude):
            continue
        discovered.append(path)

    return tuple(sorted(discovered, key=lambda path: path.relative_to(root).as_posix().casefold()))


def _split_front_matter(path: Path, source: str) -> tuple[dict[str, Any], str, int]:
    lines = source.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        return {}, source, 1

    closing_index = next(
        (index for index, line in enumerate(lines[1:], start=1) if line.strip() in {"---", "..."}),
        None,
    )
    if closing_index is None:
        raise DocumentIngestionError(
            f"malformed front matter in {path}: missing closing --- delimiter"
        )

    try:
        post = frontmatter.loads(source)
        metadata = dict(post.metadata)
    except (TypeError, ValueError, yaml.YAMLError) as error:
        raise DocumentIngestionError(f"malformed front matter in {path}: {error}") from error

    body = "".join(lines[closing_index + 1 :])
    body_start_line = closing_index + 2
    return metadata, body, body_start_line


def _as_json_value(value: object, path: Path, key_path: str) -> JsonValue:
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise DocumentIngestionError(
                f"unsupported front matter value in {path} at {key_path}: number must be finite"
            )
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (list, tuple)):
        return [
            _as_json_value(item, path, f"{key_path}.{index}") for index, item in enumerate(value)
        ]
    if isinstance(value, dict):
        converted: dict[str, JsonValue] = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise DocumentIngestionError(
                    f"unsupported front matter key in {path} at {key_path}: keys must be strings"
                )
            converted[key] = _as_json_value(item, path, f"{key_path}.{key}")
        return converted
    raise DocumentIngestionError(
        f"unsupported front matter value in {path} at {key_path}: {type(value).__name__}"
    )


def _normalized_datetime(value: object, path: Path, field_name: str) -> datetime:
    parsed: datetime
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, date):
        parsed = datetime.combine(value, datetime.min.time(), tzinfo=UTC)
    elif isinstance(value, str):
        candidate = value.strip()
        try:
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}", candidate):
                parsed = datetime.combine(
                    date.fromisoformat(candidate), datetime.min.time(), tzinfo=UTC
                )
            else:
                parsed = datetime.fromisoformat(candidate.replace("Z", "+00:00"))
        except ValueError as error:
            raise DocumentIngestionError(
                f"invalid {field_name} date in {path}: {value!r}"
            ) from error
    else:
        raise DocumentIngestionError(
            f"invalid {field_name} date in {path}: expected an ISO date or datetime"
        )

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _first_metadata_value(
    metadata: dict[str, Any], keys: tuple[str, ...]
) -> tuple[str, object] | None:
    for key in keys:
        if key in metadata and metadata[key] is not None:
            return key, metadata[key]
    return None


def _inline_text(token: Token) -> str:
    if token.children is None:
        return token.content.strip()
    return "".join(
        child.content for child in token.children if child.type in {"text", "code_inline", "image"}
    ).strip()


def _parse_markdown(
    body: str, body_start_line: int
) -> tuple[tuple[DocumentHeading, ...], tuple[MarkdownLink, ...], str]:
    tokens = _MARKDOWN.parse(body)
    headings: list[DocumentHeading] = []
    heading_stack: list[tuple[int, str]] = []
    links: list[MarkdownLink] = []
    parseable_text: list[str] = []

    for index, token in enumerate(tokens):
        if token.type == "inline":
            parseable_text.append(token.content)
            if token.children is not None:
                links.extend(_markdown_links_from_children(token.children))

        if token.type != "heading_open" or index + 1 >= len(tokens):
            continue
        inline = tokens[index + 1]
        heading_text = _inline_text(inline)
        if not heading_text:
            continue
        level = int(token.tag.removeprefix("h"))
        while heading_stack and heading_stack[-1][0] >= level:
            heading_stack.pop()
        heading_stack.append((level, heading_text))
        heading_path = tuple(text for _, text in heading_stack)
        line_offset = token.map[0] if token.map is not None else 0
        headings.append(
            DocumentHeading(
                level=level,
                text=heading_text,
                path=heading_path,
                line=body_start_line + line_offset,
            )
        )

    return tuple(headings), tuple(links), "\n".join(parseable_text)


def _markdown_links_from_children(children: list[Token]) -> list[MarkdownLink]:
    links: list[MarkdownLink] = []
    for index, child in enumerate(children):
        if child.type != "link_open":
            continue
        destination = child.attrGet("href")
        if not isinstance(destination, str) or not destination:
            continue
        title = child.attrGet("title")
        label_parts: list[str] = []
        for nested in children[index + 1 :]:
            if nested.type == "link_close":
                break
            if nested.type in {"text", "code_inline", "image"}:
                label_parts.append(nested.content)
        links.append(
            MarkdownLink(
                text="".join(label_parts).strip(),
                destination=destination,
                title=title if isinstance(title, str) else None,
            )
        )
    return links


def _front_matter_tags(metadata: dict[str, Any], path: Path) -> list[str]:
    value = metadata.get("tags", [])
    if value is None:
        return []
    if isinstance(value, str):
        return [part for part in re.split(r"[,\s]+", value) if part]
    if isinstance(value, (list, tuple)):
        if not all(isinstance(item, str) for item in value):
            raise DocumentIngestionError(f"invalid tags in {path}: every tag must be a string")
        return list(value)
    raise DocumentIngestionError(f"invalid tags in {path}: expected a string or list of strings")


def _tags(metadata: dict[str, Any], parseable_text: str, path: Path) -> tuple[str, ...]:
    candidates = [
        *_front_matter_tags(metadata, path),
        *(match.group("tag") for match in _HASHTAG_PATTERN.finditer(parseable_text)),
    ]
    result: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        normalized = candidate.strip().removeprefix("#").casefold()
        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return tuple(result)


def _wiki_links(parseable_text: str) -> tuple[WikiLink, ...]:
    links: list[WikiLink] = []
    seen: set[tuple[str, str | None, str | None]] = set()
    for match in _WIKI_LINK_PATTERN.finditer(parseable_text):
        target = match.group("target").strip()
        anchor = match.group("anchor")
        alias = match.group("alias")
        key = (
            target,
            anchor.strip() if anchor is not None else None,
            alias.strip() if alias is not None else None,
        )
        if key in seen:
            continue
        seen.add(key)
        links.append(WikiLink(target=key[0], anchor=key[1], alias=key[2]))
    return tuple(links)


def normalize_text(text: str) -> str:
    """Create a matching copy while leaving source and display text untouched."""
    unicode_normalized = unicodedata.normalize("NFKC", text)
    return " ".join(unicode_normalized.casefold().split())


def parse_document(path: Path, root: Path) -> SourceDocument:
    """Parse one UTF-8 Markdown or text document into a normalized typed model."""
    try:
        source = path.read_bytes().decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise DocumentIngestionError(
            f"could not decode {path} as UTF-8 at byte {error.start}: {error.reason}"
        ) from error
    except OSError as error:
        raise DocumentIngestionError(f"could not read document {path}: {error}") from error

    metadata, display_text, body_start_line = _split_front_matter(path, source)
    relative_path = path.relative_to(root).as_posix()
    suffix = path.suffix.casefold()
    document_format = DocumentFormat.TEXT if suffix == ".txt" else DocumentFormat.MARKDOWN

    if document_format is DocumentFormat.MARKDOWN:
        headings, markdown_links, parseable_text = _parse_markdown(display_text, body_start_line)
    else:
        headings, markdown_links, parseable_text = (), (), display_text

    metadata_title = metadata.get("title")
    if metadata_title is not None and not isinstance(metadata_title, str):
        raise DocumentIngestionError(f"invalid title in {path}: expected a string")
    first_h1 = next((heading.text for heading in headings if heading.level == 1), None)
    fallback_title = re.sub(r"[-_]+", " ", path.stem).strip() or path.name
    title = (
        (metadata_title.strip() if isinstance(metadata_title, str) else "")
        or first_h1
        or fallback_title
    )

    stat = path.stat()
    filesystem_modified = datetime.fromtimestamp(stat.st_mtime, tz=UTC)
    created_value = _first_metadata_value(metadata, _CREATED_KEYS)
    modified_value = _first_metadata_value(metadata, _MODIFIED_KEYS)
    if created_value is None:
        created_at = filesystem_modified
        date_source = DateSource.FILESYSTEM
    else:
        created_at = _normalized_datetime(created_value[1], path, created_value[0])
        date_source = DateSource.FRONT_MATTER
    modified_at = (
        _normalized_datetime(modified_value[1], path, modified_value[0])
        if modified_value is not None
        else filesystem_modified
    )

    json_metadata = {key: _as_json_value(value, path, key) for key, value in metadata.items()}
    normalized_text = normalize_text(display_text)

    return SourceDocument(
        path=relative_path,
        format=document_format,
        title=title,
        source_text=source,
        display_text=display_text,
        normalized_text=normalized_text,
        front_matter=json_metadata,
        headings=headings,
        tags=_tags(metadata, parseable_text, path),
        wiki_links=_wiki_links(parseable_text),
        markdown_links=markdown_links,
        created_at=created_at,
        modified_at=modified_at,
        date_source=date_source,
        word_count=len(normalized_text.split()),
    )


def load_corpus(root: Path, config: CorpusConfig) -> tuple[SourceDocument, ...]:
    """Discover and parse all configured documents in deterministic order."""
    return tuple(parse_document(path, root) for path in discover_document_paths(root, config))


def inspect_documents(documents: tuple[SourceDocument, ...]) -> CorpusInspection:
    """Return a text-free corpus summary suitable for CLI output."""
    summaries = tuple(
        DocumentSummary(
            path=document.path,
            format=document.format,
            title=document.title,
            created_at=document.created_at,
            date_source=document.date_source,
            heading_count=len(document.headings),
            tag_count=len(document.tags),
            wiki_link_count=len(document.wiki_links),
            markdown_link_count=len(document.markdown_links),
            word_count=document.word_count,
        )
        for document in documents
    )
    tags = tuple(sorted({tag for document in documents for tag in document.tags}))
    return CorpusInspection(
        document_count=len(documents),
        markdown_count=sum(document.format is DocumentFormat.MARKDOWN for document in documents),
        text_count=sum(document.format is DocumentFormat.TEXT for document in documents),
        total_word_count=sum(document.word_count for document in documents),
        tags=tags,
        wiki_link_count=sum(len(document.wiki_links) for document in documents),
        markdown_link_count=sum(len(document.markdown_links) for document in documents),
        documents=summaries,
    )
