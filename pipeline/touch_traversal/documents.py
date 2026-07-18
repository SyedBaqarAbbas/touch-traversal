"""Typed source-document models used by the ingestion pipeline."""

from __future__ import annotations

from enum import StrEnum

from pydantic import AwareDatetime, Field, JsonValue

from touch_traversal.models import ArtifactModel, NonEmptyString, SourceProvenance


class DocumentFormat(StrEnum):
    MARKDOWN = "markdown"
    TEXT = "text"


class DateSource(StrEnum):
    FRONT_MATTER = "front_matter"
    FALLBACK = "fallback"


class DocumentHeading(ArtifactModel):
    level: int = Field(ge=1, le=6)
    text: NonEmptyString
    path: tuple[str, ...]
    line: int = Field(ge=1)


class WikiLink(ArtifactModel):
    target: NonEmptyString
    anchor: str | None = None
    alias: str | None = None


class MarkdownLink(ArtifactModel):
    text: str
    destination: NonEmptyString
    title: str | None = None


class SourceDocument(ArtifactModel):
    path: NonEmptyString
    format: DocumentFormat
    title: NonEmptyString
    source_text: str
    display_text: str
    body_start_line: int = Field(ge=1)
    normalized_text: str
    front_matter: dict[str, JsonValue]
    headings: tuple[DocumentHeading, ...]
    tags: tuple[str, ...]
    wiki_links: tuple[WikiLink, ...]
    markdown_links: tuple[MarkdownLink, ...]
    created_at: AwareDatetime
    modified_at: AwareDatetime
    date_source: DateSource
    word_count: int = Field(ge=0)


class ThoughtChunk(ArtifactModel):
    id: NonEmptyString
    title: NonEmptyString
    text: NonEmptyString
    summary: NonEmptyString
    normalized_text: NonEmptyString
    source: SourceProvenance
    created_at: AwareDatetime
    modified_at: AwareDatetime
    tags: tuple[str, ...]
    word_count: int = Field(ge=1)


class DocumentSummary(ArtifactModel):
    path: NonEmptyString
    format: DocumentFormat
    title: NonEmptyString
    created_at: AwareDatetime
    date_source: DateSource
    heading_count: int = Field(ge=0)
    tag_count: int = Field(ge=0)
    wiki_link_count: int = Field(ge=0)
    markdown_link_count: int = Field(ge=0)
    word_count: int = Field(ge=0)


class CorpusInspection(ArtifactModel):
    document_count: int = Field(ge=0)
    markdown_count: int = Field(ge=0)
    text_count: int = Field(ge=0)
    total_word_count: int = Field(ge=0)
    tags: tuple[str, ...]
    wiki_link_count: int = Field(ge=0)
    markdown_link_count: int = Field(ge=0)
    documents: tuple[DocumentSummary, ...]
