from __future__ import annotations

import contextlib
import hashlib
import io
import json
import threading
import time
import unittest
import urllib.error
import urllib.request
from collections.abc import Iterator, Sequence
from http import HTTPStatus
from pathlib import Path

from touch_traversal.artifacts import validate_artifact_bundle
from touch_traversal.building import (
    BuildProgressCallback,
    CancellationCheck,
    CorpusBuildCancelled,
    build_corpus_bundle,
)
from touch_traversal.config import PipelineConfig, load_config
from touch_traversal.embeddings import EmbeddingProvider
from touch_traversal.exporting import ArtifactBundle
from touch_traversal.studio_contract import StudioBuildResult
from touch_traversal.studio_server import StudioBundleBuilder, create_studio_server

_ORIGIN = "http://localhost:3000"
_TOKEN = "fixture-token-that-is-long-enough-for-contract"
_FIXTURE_ROOT = Path("tests/fixtures/studio-two-note")


class _FixtureEmbeddingProvider:
    def __init__(self, model_name: str) -> None:
        self._model_name = model_name

    @property
    def model_name(self) -> str:
        return self._model_name

    def encode(
        self,
        texts: Sequence[str],
        *,
        batch_size: int,
    ) -> tuple[tuple[float, ...], ...]:
        del batch_size
        vectors: list[tuple[float, ...]] = []
        for text in texts:
            digest = hashlib.sha256(text.encode("utf-8")).digest()
            vectors.append(tuple(0.25 + byte / 255 for byte in digest[:8]))
        return tuple(vectors)


class _PipelineFixtureBuilder:
    def __init__(self, config: PipelineConfig) -> None:
        self.config = config
        self.workspaces: list[Path] = []
        self.provider: EmbeddingProvider = _FixtureEmbeddingProvider(config.embeddings.model)

    def __call__(
        self,
        corpus_path: Path,
        embedding_cache_dir: Path,
        on_progress: BuildProgressCallback,
        cancellation_requested: CancellationCheck,
    ) -> ArtifactBundle:
        self.workspaces.append(corpus_path.parent)
        return build_corpus_bundle(
            corpus_path,
            self.config,
            embedding_cache_dir=embedding_cache_dir,
            embedding_provider=self.provider,
            on_progress=on_progress,
            cancellation_requested=cancellation_requested,
        )


class _BlockingBuilder:
    def __init__(self) -> None:
        self.started = threading.Event()
        self.workspaces: list[Path] = []

    def __call__(
        self,
        corpus_path: Path,
        embedding_cache_dir: Path,
        on_progress: BuildProgressCallback,
        cancellation_requested: CancellationCheck,
    ) -> ArtifactBundle:
        del embedding_cache_dir
        self.workspaces.append(corpus_path.parent)
        self.started.set()
        on_progress("ingesting")
        while not cancellation_requested():
            time.sleep(0.005)
        raise CorpusBuildCancelled("fixture cancellation")


@contextlib.contextmanager
def _running_server(
    config: PipelineConfig,
    builder: StudioBundleBuilder,
    *,
    session_token: str = _TOKEN,
) -> Iterator[str]:
    server = create_studio_server(
        "127.0.0.1",
        0,
        config,
        allowed_origins=(_ORIGIN,),
        builder=builder,
        session_token=session_token,
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        host, port = server.server_address[:2]
        if not isinstance(host, str):
            raise AssertionError("studio test server returned a non-text host")
        yield f"http://{host}:{port}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def _request(
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    body: object | None = None,
    token: str | None = None,
    origin: str = _ORIGIN,
    private_network: bool = False,
) -> tuple[int, object | None, dict[str, str]]:
    headers = {"Accept": "application/json", "Origin": origin}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    if private_network:
        headers["Access-Control-Request-Private-Network"] = "true"
    request = urllib.request.Request(
        f"{base_url}{path}",
        data=data,
        headers=headers,
        method=method,
    )
    try:
        response = urllib.request.urlopen(request, timeout=5)
    except urllib.error.HTTPError as error:
        content = error.read()
        payload = json.loads(content) if content else None
        return error.code, payload, dict(error.headers.items())
    with response:
        content = response.read()
        payload = json.loads(content) if content else None
        return response.status, payload, dict(response.headers.items())


def _fixture_request(request_id: str = "two-note") -> dict[str, object]:
    notes = []
    for path in sorted(_FIXTURE_ROOT.iterdir(), key=lambda candidate: candidate.name):
        notes.append(
            {
                "name": path.name,
                **({"relativePath": f"nested/{path.name}"} if path.name == "companion.txt" else {}),
                "mediaType": "text/markdown" if path.suffix == ".md" else "text/plain",
                "content": path.read_text(encoding="utf-8"),
            }
        )
    return {"contractVersion": 1, "requestId": request_id, "notes": notes}


def _wait_for_terminal(base_url: str, job_id: str) -> dict[str, object]:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        status, payload, _headers = _request(
            base_url,
            f"/v1/jobs/{job_id}",
            token=_TOKEN,
        )
        if status != HTTPStatus.OK or not isinstance(payload, dict):
            raise AssertionError(f"unexpected studio snapshot: {status} {payload}")
        if payload["state"] not in {"queued", "running"}:
            return payload
        time.sleep(0.01)
    raise AssertionError("studio job did not reach a terminal state")


class StudioServerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = load_config(Path("config/default.yaml"))

    def test_two_note_loopback_slice_returns_a_valid_four_artifact_bundle(self) -> None:
        builder = _PipelineFixtureBuilder(self.config)
        public_paths = tuple(sorted(Path("../apps/web/public/data").glob("*.json")))
        public_before = {path: path.read_bytes() for path in public_paths}
        stderr = io.StringIO()

        with contextlib.redirect_stderr(stderr), _running_server(self.config, builder) as base_url:
            capability_status, capabilities, _headers = _request(base_url, "/v1/capabilities")
            self.assertEqual(capability_status, HTTPStatus.OK)
            self.assertIsInstance(capabilities, dict)
            self.assertEqual(capabilities["sessionToken"], _TOKEN)  # type: ignore[index]
            self.assertFalse(capabilities["privacy"]["noteContentsLogged"])  # type: ignore[index]

            status, accepted, _headers = _request(
                base_url,
                "/v1/jobs",
                method="POST",
                body=_fixture_request(),
                token=_TOKEN,
            )
            self.assertEqual(status, HTTPStatus.ACCEPTED)
            self.assertIsInstance(accepted, dict)
            job_id = str(accepted["jobId"])  # type: ignore[index]
            terminal = _wait_for_terminal(base_url, job_id)
            self.assertEqual(terminal["state"], "succeeded")
            self.assertTrue(terminal["resultAvailable"])

            result_status, raw_result, _headers = _request(
                base_url,
                f"/v1/jobs/{job_id}/result",
                token=_TOKEN,
            )
            self.assertEqual(result_status, HTTPStatus.OK)
            result = StudioBuildResult.model_validate(raw_result)
            validate_artifact_bundle(
                result.bundle.graph,
                result.bundle.layouts,
                result.bundle.manifest,
                result.bundle.report,
            )
            self.assertEqual(len(result.bundle.graph.nodes), 2)
            self.assertEqual(result.bundle.report.file_count, 2)
            self.assertEqual(result.bundle.manifest.pipeline_config_hash, self.config.fingerprint())
            self.assertEqual(
                set(result.bundle.model_dump(by_alias=True)),
                {"graph", "layouts", "manifest", "report"},
            )
            self.assertEqual(
                {node.source.path for node in result.bundle.graph.nodes},
                {"nested/companion.txt", "origin.md"},
            )
            cleanup_status, _payload, _headers = _request(
                base_url,
                f"/v1/jobs/{job_id}",
                method="DELETE",
                token=_TOKEN,
            )
            self.assertEqual(cleanup_status, HTTPStatus.NO_CONTENT)

            repeat_status, repeat_accepted, _headers = _request(
                base_url,
                "/v1/jobs",
                method="POST",
                body=_fixture_request("two-note-repeat"),
                token=_TOKEN,
            )
            self.assertEqual(repeat_status, HTTPStatus.ACCEPTED)
            repeat_job_id = str(repeat_accepted["jobId"])  # type: ignore[index]
            self.assertEqual(_wait_for_terminal(base_url, repeat_job_id)["state"], "succeeded")
            _status, repeat_raw, _headers = _request(
                base_url,
                f"/v1/jobs/{repeat_job_id}/result",
                token=_TOKEN,
            )
            repeat_result = StudioBuildResult.model_validate(repeat_raw)
            self.assertEqual(repeat_result.bundle, result.bundle)
            _request(
                base_url,
                f"/v1/jobs/{repeat_job_id}",
                method="DELETE",
                token=_TOKEN,
            )

        self.assertEqual(stderr.getvalue(), "")
        self.assertEqual({path: path.read_bytes() for path in public_paths}, public_before)
        self.assertTrue(builder.workspaces)
        self.assertTrue(all(not path.exists() for path in builder.workspaces))

    def test_capability_preflight_requires_allowed_origin_and_exposes_pna(self) -> None:
        builder = _PipelineFixtureBuilder(self.config)
        with _running_server(self.config, builder) as base_url:
            status, _payload, headers = _request(
                base_url,
                "/v1/capabilities",
                method="OPTIONS",
                private_network=True,
            )
            self.assertEqual(status, HTTPStatus.NO_CONTENT)
            self.assertEqual(headers["Access-Control-Allow-Origin"], _ORIGIN)
            self.assertEqual(headers["Access-Control-Allow-Private-Network"], "true")
            self.assertIn("Authorization", headers["Access-Control-Allow-Headers"])

            denied_status, denied, denied_headers = _request(
                base_url,
                "/v1/capabilities",
                origin="https://attacker.example",
            )
            self.assertEqual(denied_status, HTTPStatus.FORBIDDEN)
            self.assertEqual(denied["error"]["code"], "unsupported_origin")  # type: ignore[index]
            self.assertNotIn("Access-Control-Allow-Origin", denied_headers)

    def test_note_routes_require_the_per_process_capability_token(self) -> None:
        first_builder = _PipelineFixtureBuilder(self.config)
        second_builder = _PipelineFixtureBuilder(self.config)
        with (
            _running_server(
                self.config,
                first_builder,
                session_token="first-process-token-with-enough-entropy",
            ) as first_url,
            _running_server(
                self.config,
                second_builder,
                session_token="second-process-token-with-enough-entropy",
            ) as second_url,
        ):
            _status, first_capabilities, _headers = _request(first_url, "/v1/capabilities")
            _status, second_capabilities, _headers = _request(second_url, "/v1/capabilities")
            self.assertNotEqual(
                first_capabilities["sessionToken"],  # type: ignore[index]
                second_capabilities["sessionToken"],  # type: ignore[index]
            )
            status, payload, _headers = _request(
                first_url,
                "/v1/jobs",
                method="POST",
                body=_fixture_request("unauthorized"),
            )
            self.assertEqual(status, HTTPStatus.UNAUTHORIZED)
            self.assertEqual(payload["error"]["code"], "unauthorized")  # type: ignore[index]

    def test_relative_paths_are_nested_and_traversal_is_rejected_before_materializing(self) -> None:
        builder = _PipelineFixtureBuilder(self.config)
        invalid = _fixture_request("unsafe-relative-path")
        notes = invalid["notes"]
        self.assertIsInstance(notes, list)
        notes[0]["relativePath"] = "../origin.md"  # type: ignore[index]

        with _running_server(self.config, builder) as base_url:
            status, payload, _headers = _request(
                base_url,
                "/v1/jobs",
                method="POST",
                body=invalid,
                token=_TOKEN,
            )

        self.assertEqual(status, HTTPStatus.BAD_REQUEST)
        self.assertEqual(payload["error"]["code"], "invalid_request")  # type: ignore[index]
        self.assertEqual(builder.workspaces, [])

    def test_cancellation_cleans_the_temporary_corpus(self) -> None:
        builder = _BlockingBuilder()
        with _running_server(self.config, builder) as base_url:
            status, accepted, _headers = _request(
                base_url,
                "/v1/jobs",
                method="POST",
                body=_fixture_request("cancel-me"),
                token=_TOKEN,
            )
            self.assertEqual(status, HTTPStatus.ACCEPTED)
            self.assertTrue(builder.started.wait(timeout=2))
            job_id = str(accepted["jobId"])  # type: ignore[index]
            cancel_status, _snapshot, _headers = _request(
                base_url,
                f"/v1/jobs/{job_id}",
                method="DELETE",
                token=_TOKEN,
            )
            self.assertEqual(cancel_status, HTTPStatus.ACCEPTED)
            terminal = _wait_for_terminal(base_url, job_id)
            self.assertEqual(terminal["state"], "cancelled")
            self.assertTrue(all(not path.exists() for path in builder.workspaces))

    def test_non_loopback_binding_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "loopback"):
            create_studio_server("0.0.0.0", 8765, self.config)


if __name__ == "__main__":
    unittest.main()
