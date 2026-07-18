"""Authenticated loopback-only HTTP companion for personal graph builds."""

from __future__ import annotations

import hmac
import ipaddress
import json
import os
import secrets
import tempfile
import threading
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from typing import Protocol
from urllib.parse import urlparse
from uuid import uuid4

from pydantic import ValidationError

from touch_traversal import __version__
from touch_traversal.building import (
    BuildProgressCallback,
    BuildStage,
    CancellationCheck,
    CorpusBuildCancelled,
    build_corpus_bundle,
)
from touch_traversal.config import PipelineConfig
from touch_traversal.embeddings import EmbeddingError
from touch_traversal.exporting import ArtifactBundle
from touch_traversal.layouts import LayoutError
from touch_traversal.studio_contract import (
    STUDIO_CONTRACT_VERSION,
    STUDIO_PROGRESS_STAGES,
    StudioArtifactBundle,
    StudioBuildRequest,
    StudioBuildResult,
    StudioCapabilities,
    StudioErrorCode,
    StudioErrorResponse,
    StudioFailure,
    StudioJobSnapshot,
    StudioJobState,
    StudioLimits,
    StudioPrivacy,
    StudioProgress,
    StudioProgressStage,
)

DEFAULT_STUDIO_HOST = "127.0.0.1"
DEFAULT_STUDIO_PORT = 8765
DEFAULT_ALLOWED_ORIGINS = (
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://syedbaqarabbas.github.io",
)
MAX_NOTES = 200
MAX_NOTE_BYTES = 2 * 1024 * 1024
MAX_REQUEST_BYTES = 20 * 1024 * 1024
MAX_ACTIVE_JOBS = 2
MAX_RETAINED_JOBS = 8
JOB_RETENTION_SECONDS = 5 * 60.0

_STAGE_MESSAGES = {
    StudioProgressStage.ACCEPTED: "request accepted",
    StudioProgressStage.MATERIALIZING: "preparing temporary local notes",
    StudioProgressStage.INGESTING: "parsing local notes",
    StudioProgressStage.CHUNKING: "building deterministic thought chunks",
    StudioProgressStage.RELATING: "assembling explainable relation candidates",
    StudioProgressStage.EMBEDDING: "computing local semantic vectors",
    StudioProgressStage.LAYING_OUT: "generating four deterministic layouts",
    StudioProgressStage.VALIDATING: "cross-validating the artifact bundle",
    StudioProgressStage.COMPLETE: "personal graph bundle ready",
}


class StudioBundleBuilder(Protocol):
    """Injectable build boundary used by the server and deterministic tests."""

    def __call__(
        self,
        corpus_path: Path,
        embedding_cache_dir: Path,
        on_progress: BuildProgressCallback,
        cancellation_requested: CancellationCheck,
    ) -> ArtifactBundle: ...


class StudioRequestError(ValueError):
    """Typed HTTP-facing request failure without note-bearing diagnostics."""

    def __init__(
        self,
        status: HTTPStatus,
        code: StudioErrorCode,
        message: str,
        *,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.failure = StudioFailure(code=code, message=message, retryable=retryable)


@dataclass
class _StudioJob:
    request_id: str
    job_id: str
    state: StudioJobState = StudioJobState.QUEUED
    progress: StudioProgress = field(
        default_factory=lambda: StudioProgress(
            sequence=0,
            stage=StudioProgressStage.ACCEPTED,
            stage_index=0,
            message=_STAGE_MESSAGES[StudioProgressStage.ACCEPTED],
        )
    )
    result: StudioBuildResult | None = None
    error: StudioFailure | None = None
    cancel_event: threading.Event = field(default_factory=threading.Event)
    cleanup_timer: threading.Timer | None = field(default=None, repr=False)


def _pipeline_builder(config: PipelineConfig) -> StudioBundleBuilder:
    def build(
        corpus_path: Path,
        embedding_cache_dir: Path,
        on_progress: BuildProgressCallback,
        cancellation_requested: CancellationCheck,
    ) -> ArtifactBundle:
        return build_corpus_bundle(
            corpus_path,
            config,
            embedding_cache_dir=embedding_cache_dir,
            on_progress=on_progress,
            cancellation_requested=cancellation_requested,
        )

    return build


def _studio_bundle(bundle: ArtifactBundle) -> StudioArtifactBundle:
    return StudioArtifactBundle(
        graph=bundle.graph,
        layouts=bundle.layouts,
        manifest=bundle.manifest,
        report=bundle.report,
    )


def _is_loopback_hostname(host: str) -> bool:
    if host.casefold() == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


class StudioService:
    """Own authenticated in-memory jobs and their temporary local workspaces."""

    def __init__(
        self,
        builder: StudioBundleBuilder,
        *,
        allowed_origins: tuple[str, ...] = DEFAULT_ALLOWED_ORIGINS,
        session_token: str | None = None,
        job_retention_seconds: float = JOB_RETENTION_SECONDS,
    ) -> None:
        if job_retention_seconds <= 0:
            raise ValueError("studio job retention must be positive")
        self._builder = builder
        self._allowed_origins = frozenset(origin.rstrip("/") for origin in allowed_origins)
        self._session_token = session_token or secrets.token_urlsafe(32)
        self._job_retention_seconds = job_retention_seconds
        self._jobs: dict[str, _StudioJob] = {}
        self._lock = threading.RLock()

    @property
    def session_token(self) -> str:
        return self._session_token

    def origin_allowed(self, origin: str | None) -> bool:
        if origin is None:
            return True
        normalized = origin.rstrip("/")
        return normalized in self._allowed_origins

    def authorized(self, authorization: str | None) -> bool:
        if authorization is None or not authorization.startswith("Bearer "):
            return False
        return hmac.compare_digest(authorization.removeprefix("Bearer "), self._session_token)

    def capabilities(self) -> StudioCapabilities:
        return StudioCapabilities(
            pipeline_version=__version__,
            session_token=self._session_token,
            progress_stages=tuple(StudioProgressStage(stage) for stage in STUDIO_PROGRESS_STAGES),
            limits=StudioLimits(
                max_notes=MAX_NOTES,
                max_note_bytes=MAX_NOTE_BYTES,
                max_request_bytes=MAX_REQUEST_BYTES,
            ),
            privacy=StudioPrivacy(),
        )

    def submit(self, request: StudioBuildRequest) -> StudioJobSnapshot:
        for note in request.notes:
            if len(note.content.encode("utf-8")) > MAX_NOTE_BYTES:
                raise StudioRequestError(
                    HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                    StudioErrorCode.PAYLOAD_TOO_LARGE,
                    f"each note must be at most {MAX_NOTE_BYTES} UTF-8 bytes",
                )

        job_id = f"job-{uuid4().hex}"
        job = _StudioJob(request_id=request.request_id, job_id=job_id)
        with self._lock:
            active_jobs = sum(
                candidate.state in {StudioJobState.QUEUED, StudioJobState.RUNNING}
                for candidate in self._jobs.values()
            )
            if active_jobs >= MAX_ACTIVE_JOBS:
                raise StudioRequestError(
                    HTTPStatus.SERVICE_UNAVAILABLE,
                    StudioErrorCode.BUILD_FAILED,
                    "the local studio is already building the maximum number of graphs",
                    retryable=True,
                )
            while len(self._jobs) >= MAX_RETAINED_JOBS:
                terminal_job_id = next(
                    (
                        retained_id
                        for retained_id, retained in self._jobs.items()
                        if retained.state
                        in {
                            StudioJobState.SUCCEEDED,
                            StudioJobState.FAILED,
                            StudioJobState.CANCELLED,
                        }
                    ),
                    None,
                )
                if terminal_job_id is None:
                    raise StudioRequestError(
                        HTTPStatus.SERVICE_UNAVAILABLE,
                        StudioErrorCode.BUILD_FAILED,
                        "the local studio job queue is full; retry after an active build finishes",
                        retryable=True,
                    )
                self._delete_job(terminal_job_id)
            self._jobs[job_id] = job
        worker = threading.Thread(
            target=self._run_job,
            args=(job_id, request),
            daemon=True,
            name=f"touch-traversal-{job_id}",
        )
        worker.start()
        return self.snapshot(job_id)

    def _run_job(self, job_id: str, request: StudioBuildRequest) -> None:
        result: StudioBuildResult | None = None
        try:
            with tempfile.TemporaryDirectory(prefix="touch-traversal-studio-") as directory:
                workspace = Path(directory)
                corpus = workspace / "notes"
                corpus.mkdir()
                self._advance(job_id, StudioProgressStage.MATERIALIZING)
                for note in sorted(
                    request.notes,
                    key=lambda candidate: candidate.effective_relative_path.casefold(),
                ):
                    if self._cancel_requested(job_id):
                        raise CorpusBuildCancelled("personal graph build cancelled")
                    note_path = corpus.joinpath(*PurePosixPath(note.effective_relative_path).parts)
                    if not note_path.resolve(strict=False).is_relative_to(corpus.resolve()):
                        raise ValueError("note relative path escaped the temporary corpus")
                    note_path.parent.mkdir(parents=True, exist_ok=True)
                    note_path.write_text(note.content, encoding="utf-8")
                    modified_timestamp = note.modified_at.timestamp() if note.modified_at else 0.0
                    os.utime(note_path, (modified_timestamp, modified_timestamp))

                def on_progress(stage: BuildStage) -> None:
                    self._advance(job_id, StudioProgressStage(stage))

                bundle = self._builder(
                    corpus,
                    workspace / "embedding-cache",
                    on_progress,
                    lambda: self._cancel_requested(job_id),
                )
                if self._cancel_requested(job_id):
                    raise CorpusBuildCancelled("personal graph build cancelled")
                result = StudioBuildResult(
                    request_id=request.request_id,
                    job_id=job_id,
                    bundle=_studio_bundle(bundle),
                )
            if result is None:
                raise RuntimeError("studio build completed without a result")
            self._succeed(job_id, result)
        except CorpusBuildCancelled:
            self._cancelled(job_id)
        except (EmbeddingError, LayoutError) as error:
            self._fail(
                job_id,
                StudioFailure(
                    code=StudioErrorCode.PIPELINE_UNAVAILABLE,
                    message=str(error),
                    retryable=False,
                ),
            )
        except Exception:
            self._fail(
                job_id,
                StudioFailure(
                    code=StudioErrorCode.BUILD_FAILED,
                    message=(
                        "Personal graph build failed locally. Review note encoding and "
                        "pipeline configuration, then retry."
                    ),
                    retryable=False,
                ),
            )

    def _job(self, job_id: str) -> _StudioJob:
        try:
            return self._jobs[job_id]
        except KeyError as error:
            raise StudioRequestError(
                HTTPStatus.NOT_FOUND,
                StudioErrorCode.NOT_FOUND,
                "studio job was not found or has already been cleaned up",
            ) from error

    def _cancel_requested(self, job_id: str) -> bool:
        with self._lock:
            return self._job(job_id).cancel_event.is_set()

    def _advance(self, job_id: str, stage: StudioProgressStage) -> None:
        with self._lock:
            job = self._job(job_id)
            if job.cancel_event.is_set():
                raise CorpusBuildCancelled("personal graph build cancelled")
            stage_index = STUDIO_PROGRESS_STAGES.index(stage.value)
            job.state = StudioJobState.RUNNING
            job.progress = StudioProgress(
                sequence=job.progress.sequence + 1,
                stage=stage,
                stage_index=stage_index,
                message=_STAGE_MESSAGES[stage],
            )

    def _succeed(self, job_id: str, result: StudioBuildResult) -> None:
        with self._lock:
            job = self._job(job_id)
            if job.cancel_event.is_set():
                job.state = StudioJobState.CANCELLED
                job.result = None
            else:
                job.state = StudioJobState.SUCCEEDED
                job.result = result
                job.progress = StudioProgress(
                    sequence=job.progress.sequence + 1,
                    stage=StudioProgressStage.COMPLETE,
                    stage_index=len(STUDIO_PROGRESS_STAGES) - 1,
                    message=_STAGE_MESSAGES[StudioProgressStage.COMPLETE],
                )
        self._schedule_expiry(job_id)

    def _fail(self, job_id: str, failure: StudioFailure) -> None:
        with self._lock:
            job = self._job(job_id)
            job.state = StudioJobState.FAILED
            job.error = failure
        self._schedule_expiry(job_id)

    def _cancelled(self, job_id: str) -> None:
        with self._lock:
            job = self._job(job_id)
            job.state = StudioJobState.CANCELLED
            job.error = None
            job.result = None
        self._schedule_expiry(job_id)

    def _schedule_expiry(self, job_id: str) -> None:
        timer = threading.Timer(
            self._job_retention_seconds,
            self._expire_job,
            args=(job_id,),
        )
        timer.daemon = True
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            if job.cleanup_timer is not None:
                job.cleanup_timer.cancel()
            job.cleanup_timer = timer
        timer.start()

    def _expire_job(self, job_id: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.state in {
                StudioJobState.QUEUED,
                StudioJobState.RUNNING,
            }:
                return
            self._delete_job(job_id)

    def _delete_job(self, job_id: str) -> None:
        job = self._jobs.pop(job_id)
        if job.cleanup_timer is not None:
            job.cleanup_timer.cancel()
        job.cleanup_timer = None
        job.result = None
        job.error = None

    def snapshot(self, job_id: str) -> StudioJobSnapshot:
        with self._lock:
            job = self._job(job_id)
            return StudioJobSnapshot(
                request_id=job.request_id,
                job_id=job.job_id,
                state=job.state,
                progress=job.progress,
                result_available=job.state is StudioJobState.SUCCEEDED,
                error=job.error,
            )

    def result(self, job_id: str) -> StudioBuildResult:
        with self._lock:
            job = self._job(job_id)
            if job.result is None or job.state is not StudioJobState.SUCCEEDED:
                raise StudioRequestError(
                    HTTPStatus.CONFLICT,
                    StudioErrorCode.RESULT_NOT_READY,
                    "studio job result is not ready",
                    retryable=job.state in {StudioJobState.QUEUED, StudioJobState.RUNNING},
                )
            return job.result

    def cancel_or_cleanup(self, job_id: str) -> StudioJobSnapshot | None:
        with self._lock:
            job = self._job(job_id)
            if job.state in {
                StudioJobState.SUCCEEDED,
                StudioJobState.FAILED,
                StudioJobState.CANCELLED,
            }:
                self._delete_job(job_id)
                return None
            job.cancel_event.set()
            return self.snapshot(job_id)


class _StudioHttpServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request: object, client_address: object) -> None:
        del request, client_address
        # Avoid BaseServer's traceback/path logging when a browser cancels a note-bearing request.


def _handler_for(service: StudioService) -> type[BaseHTTPRequestHandler]:
    class StudioRequestHandler(BaseHTTPRequestHandler):
        server_version = "TouchTraversalStudio/1"

        def log_message(self, format: str, *args: object) -> None:
            del format, args
            # Deliberately silent: request paths and note-bearing bodies never reach console logs.

        def _origin(self) -> str | None:
            return self.headers.get("Origin")

        def _cors_headers(self) -> None:
            origin = self._origin()
            if origin is None or not service.origin_allowed(origin):
                return
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            if self.headers.get("Access-Control-Request-Private-Network") == "true":
                self.send_header("Access-Control-Allow-Private-Network", "true")

        def _send_model(
            self,
            status: HTTPStatus,
            payload: StudioCapabilities
            | StudioJobSnapshot
            | StudioBuildResult
            | StudioErrorResponse,
        ) -> None:
            content = payload.model_dump_json().encode("utf-8")
            self.send_response(status)
            self._cors_headers()
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)

        def _send_empty(self, status: HTTPStatus) -> None:
            self.send_response(status)
            self._cors_headers()
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def _send_error(self, error: StudioRequestError) -> None:
            self._send_model(error.status, StudioErrorResponse(error=error.failure))

        def _require_origin(self) -> None:
            if not service.origin_allowed(self._origin()):
                raise StudioRequestError(
                    HTTPStatus.FORBIDDEN,
                    StudioErrorCode.UNSUPPORTED_ORIGIN,
                    "browser origin is not allowed by this local studio process",
                )

        def _require_authorization(self) -> None:
            if not service.authorized(self.headers.get("Authorization")):
                raise StudioRequestError(
                    HTTPStatus.UNAUTHORIZED,
                    StudioErrorCode.UNAUTHORIZED,
                    "missing or invalid local studio session token",
                )

        def _read_request(self) -> StudioBuildRequest:
            length_header = self.headers.get("Content-Length")
            try:
                length = int(length_header or "0")
            except ValueError as error:
                raise StudioRequestError(
                    HTTPStatus.BAD_REQUEST,
                    StudioErrorCode.INVALID_REQUEST,
                    "Content-Length must be an integer",
                ) from error
            if length <= 0:
                raise StudioRequestError(
                    HTTPStatus.BAD_REQUEST,
                    StudioErrorCode.INVALID_REQUEST,
                    "request body must contain JSON",
                )
            if length > MAX_REQUEST_BYTES:
                raise StudioRequestError(
                    HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                    StudioErrorCode.PAYLOAD_TOO_LARGE,
                    f"request body must be at most {MAX_REQUEST_BYTES} bytes",
                )
            try:
                raw: object = json.loads(self.rfile.read(length))
            except (json.JSONDecodeError, UnicodeDecodeError) as error:
                raise StudioRequestError(
                    HTTPStatus.BAD_REQUEST,
                    StudioErrorCode.INVALID_REQUEST,
                    "request body must be valid UTF-8 JSON",
                ) from error
            if isinstance(raw, dict) and raw.get("contractVersion") != STUDIO_CONTRACT_VERSION:
                raise StudioRequestError(
                    HTTPStatus.CONFLICT,
                    StudioErrorCode.PROTOCOL_MISMATCH,
                    f"local studio requires contractVersion {STUDIO_CONTRACT_VERSION}",
                )
            try:
                return StudioBuildRequest.model_validate(raw)
            except ValidationError as error:
                first = error.errors(include_url=False)[0]
                location = ".".join(str(part) for part in first["loc"]) or "request"
                raise StudioRequestError(
                    HTTPStatus.BAD_REQUEST,
                    StudioErrorCode.INVALID_REQUEST,
                    f"invalid {location}: {first['msg']}",
                ) from error

        def do_OPTIONS(self) -> None:
            try:
                self._require_origin()
                self.send_response(HTTPStatus.NO_CONTENT)
                self._cors_headers()
                self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
                self.send_header("Access-Control-Allow-Methods", "DELETE, GET, OPTIONS, POST")
                self.send_header("Access-Control-Max-Age", "600")
                self.send_header("Content-Length", "0")
                self.end_headers()
            except StudioRequestError as error:
                self._send_error(error)

        def do_GET(self) -> None:
            try:
                self._require_origin()
                path = urlparse(self.path).path
                if path == "/v1/capabilities":
                    self._send_model(HTTPStatus.OK, service.capabilities())
                    return
                self._require_authorization()
                parts = tuple(part for part in path.split("/") if part)
                if len(parts) == 3 and parts[:2] == ("v1", "jobs"):
                    self._send_model(HTTPStatus.OK, service.snapshot(parts[2]))
                    return
                if len(parts) == 4 and parts[:2] == ("v1", "jobs") and parts[3] == "result":
                    self._send_model(HTTPStatus.OK, service.result(parts[2]))
                    return
                raise StudioRequestError(
                    HTTPStatus.NOT_FOUND,
                    StudioErrorCode.NOT_FOUND,
                    "local studio endpoint was not found",
                )
            except StudioRequestError as error:
                self._send_error(error)

        def do_POST(self) -> None:
            try:
                self._require_origin()
                self._require_authorization()
                if urlparse(self.path).path != "/v1/jobs":
                    raise StudioRequestError(
                        HTTPStatus.NOT_FOUND,
                        StudioErrorCode.NOT_FOUND,
                        "local studio endpoint was not found",
                    )
                request = self._read_request()
                self._send_model(HTTPStatus.ACCEPTED, service.submit(request))
            except StudioRequestError as error:
                self._send_error(error)

        def do_DELETE(self) -> None:
            try:
                self._require_origin()
                self._require_authorization()
                parts = tuple(part for part in urlparse(self.path).path.split("/") if part)
                if len(parts) != 3 or parts[:2] != ("v1", "jobs"):
                    raise StudioRequestError(
                        HTTPStatus.NOT_FOUND,
                        StudioErrorCode.NOT_FOUND,
                        "local studio endpoint was not found",
                    )
                snapshot = service.cancel_or_cleanup(parts[2])
                if snapshot is None:
                    self._send_empty(HTTPStatus.NO_CONTENT)
                else:
                    self._send_model(HTTPStatus.ACCEPTED, snapshot)
            except StudioRequestError as error:
                self._send_error(error)

    return StudioRequestHandler


def create_studio_server(
    host: str,
    port: int,
    config: PipelineConfig,
    *,
    allowed_origins: tuple[str, ...] = DEFAULT_ALLOWED_ORIGINS,
    builder: StudioBundleBuilder | None = None,
    session_token: str | None = None,
    job_retention_seconds: float = JOB_RETENTION_SECONDS,
) -> ThreadingHTTPServer:
    """Create a loopback server; non-loopback binding is rejected before socket creation."""
    if not _is_loopback_hostname(host):
        raise ValueError("studio host must be a loopback address such as 127.0.0.1")
    if not 0 <= port <= 65535:
        raise ValueError("studio port must be between 0 and 65535")
    service = StudioService(
        builder or _pipeline_builder(config),
        allowed_origins=allowed_origins,
        session_token=session_token,
        job_retention_seconds=job_retention_seconds,
    )
    return _StudioHttpServer((host, port), _handler_for(service))


def serve_studio(
    host: str,
    port: int,
    config: PipelineConfig,
    *,
    allowed_origins: tuple[str, ...] = DEFAULT_ALLOWED_ORIGINS,
) -> None:
    """Serve until interrupted without logging note-bearing requests."""
    server = create_studio_server(host, port, config, allowed_origins=allowed_origins)
    try:
        server.serve_forever(poll_interval=0.2)
    finally:
        server.server_close()
