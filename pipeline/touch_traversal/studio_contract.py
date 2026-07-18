"""Versioned loopback-studio request, progress, result, and failure contracts."""

from __future__ import annotations

from enum import StrEnum
from pathlib import PurePath
from typing import Annotated, Literal, Self

from pydantic import AwareDatetime, Field, StringConstraints, model_validator

from touch_traversal.models import (
    ArtifactModel,
    GraphArtifact,
    GraphManifest,
    LayoutArtifact,
    PipelineReport,
)

STUDIO_CONTRACT_VERSION = 1
STUDIO_PROGRESS_STAGES = (
    "accepted",
    "materializing",
    "ingesting",
    "chunking",
    "relating",
    "embedding",
    "laying_out",
    "validating",
    "complete",
)

RequestIdentifier = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=128, pattern=r"^[\w.-]+$"),
]


class StudioProgressStage(StrEnum):
    ACCEPTED = "accepted"
    MATERIALIZING = "materializing"
    INGESTING = "ingesting"
    CHUNKING = "chunking"
    RELATING = "relating"
    EMBEDDING = "embedding"
    LAYING_OUT = "laying_out"
    VALIDATING = "validating"
    COMPLETE = "complete"


class StudioJobState(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class StudioErrorCode(StrEnum):
    INVALID_REQUEST = "invalid_request"
    UNAUTHORIZED = "unauthorized"
    UNSUPPORTED_ORIGIN = "unsupported_origin"
    PAYLOAD_TOO_LARGE = "payload_too_large"
    NOT_FOUND = "not_found"
    RESULT_NOT_READY = "result_not_ready"
    PIPELINE_UNAVAILABLE = "pipeline_unavailable"
    BUILD_FAILED = "build_failed"
    CANCELLED = "cancelled"
    PROTOCOL_MISMATCH = "protocol_mismatch"


class StudioNote(ArtifactModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=180)]
    media_type: Literal["text/markdown", "text/plain"]
    content: Annotated[str, StringConstraints(min_length=1)]
    modified_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def validate_name(self) -> Self:
        if self.name in {".", ".."} or PurePath(self.name).name != self.name:
            raise ValueError("name must be a single local filename without path components")
        if "\\" in self.name or "\x00" in self.name:
            raise ValueError("name must not contain path separators or NUL bytes")
        return self


class StudioBuildRequest(ArtifactModel):
    contract_version: Literal[1] = 1
    request_id: RequestIdentifier
    notes: Annotated[tuple[StudioNote, ...], Field(min_length=1, max_length=200)]

    @model_validator(mode="after")
    def validate_unique_names(self) -> Self:
        folded_names = [note.name.casefold() for note in self.notes]
        if len(folded_names) != len(set(folded_names)):
            raise ValueError("note names must be unique ignoring case")
        return self


class StudioProgress(ArtifactModel):
    sequence: int = Field(ge=0)
    stage: StudioProgressStage
    stage_index: int = Field(ge=0, lt=len(STUDIO_PROGRESS_STAGES))
    total_stages: Literal[9] = 9
    message: str = Field(min_length=1)

    @model_validator(mode="after")
    def validate_stage_index(self) -> Self:
        if STUDIO_PROGRESS_STAGES[self.stage_index] != self.stage.value:
            raise ValueError("stageIndex must identify stage in the versioned stage sequence")
        return self


class StudioFailure(ArtifactModel):
    code: StudioErrorCode
    message: str = Field(min_length=1)
    retryable: bool = False


class StudioArtifactBundle(ArtifactModel):
    graph: GraphArtifact
    layouts: LayoutArtifact
    manifest: GraphManifest
    report: PipelineReport


class StudioBuildResult(ArtifactModel):
    contract_version: Literal[1] = 1
    request_id: RequestIdentifier
    job_id: RequestIdentifier
    bundle: StudioArtifactBundle


class StudioJobSnapshot(ArtifactModel):
    contract_version: Literal[1] = 1
    request_id: RequestIdentifier
    job_id: RequestIdentifier
    state: StudioJobState
    progress: StudioProgress
    result_available: bool = False
    error: StudioFailure | None = None

    @model_validator(mode="after")
    def validate_terminal_state(self) -> Self:
        if self.result_available != (self.state is StudioJobState.SUCCEEDED):
            raise ValueError("resultAvailable must be true only for succeeded jobs")
        if (self.state is StudioJobState.FAILED) != (self.error is not None):
            raise ValueError("failed jobs must expose exactly one typed error")
        return self


class StudioLimits(ArtifactModel):
    max_notes: int = Field(ge=1)
    max_note_bytes: int = Field(ge=1)
    max_request_bytes: int = Field(ge=1)


class StudioPrivacy(ArtifactModel):
    transport: Literal["loopback-http"] = "loopback-http"
    note_contents_logged: Literal[False] = False
    writes_tracked_public_data: Literal[False] = False
    persistent_personal_cache: Literal[False] = False


class StudioCapabilities(ArtifactModel):
    contract_version: Literal[1] = 1
    provider: Literal["localhost-python"] = "localhost-python"
    status: Literal["ready"] = "ready"
    pipeline_version: str = Field(min_length=1)
    session_token: str = Field(min_length=32)
    progress_stages: tuple[StudioProgressStage, ...]
    limits: StudioLimits
    privacy: StudioPrivacy


class StudioErrorResponse(ArtifactModel):
    contract_version: Literal[1] = 1
    error: StudioFailure
