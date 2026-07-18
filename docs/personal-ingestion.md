# Personal ingestion contract

THO-63 establishes an executable provider boundary; it does not add the later file-picker or studio
route. The public static build remains a working sample viewer with fixed public artifacts.

## Start local studio mode

```bash
cd pipeline
uv sync --extra embeddings --extra layouts --all-groups
uv run touch-traversal studio
```

The default companion listens on `http://127.0.0.1:8765` and allows the local dev origin plus the
project's GitHub Pages origin. To use another static deployment:

```bash
uv run touch-traversal studio --allow-origin https://notes.example.test
```

`--host` exists for explicit local configuration, but non-loopback values are rejected. Request
bodies and paths are not logged. Stop the process with `Ctrl+C`; process exit releases all jobs and
in-memory results.

The first full build may download local Sentence Transformers model weights after the optional
extras are installed. Model acquisition contains no note contents. Each studio job places its
note-derived embedding cache inside the job's temporary workspace rather than the repository or a
persistent user cache.

## Capability behavior

The browser first calls `GET /v1/capabilities`. A ready response includes:

- `contractVersion: 1` and provider `localhost-python`;
- the exact deterministic progress stage list;
- note/request byte limits and privacy assertions;
- a random token valid only for the current companion process.

All note-bearing routes require `Authorization: Bearer <sessionToken>`. Browser preflight validates
the Origin and explicitly grants Private Network Access. If the probe is unreachable or
incompatible, public static mode stays sample-only and reports this recovery command:

```text
cd pipeline && uv sync --extra embeddings --extra layouts --all-groups && uv run touch-traversal studio
```

No remote fallback is attempted.

## HTTP job flow

`POST /v1/jobs` accepts a versioned request:

```json
{
  "contractVersion": 1,
  "requestId": "browser-generated-id",
  "notes": [
    {
      "name": "origin.md",
      "mediaType": "text/markdown",
      "content": "# A local note\n\nContents stay on this machine."
    }
  ]
}
```

Filenames are single pathless names and unique ignoring case. Supported media types are
`text/markdown` and `text/plain`. The companion returns a job snapshot immediately.

- `GET /v1/jobs/{jobId}` returns typed state and monotonic progress.
- `GET /v1/jobs/{jobId}/result` returns `{graph, layouts, manifest, report}` only after success.
- `DELETE /v1/jobs/{jobId}` requests cancellation for active work.
- `DELETE /v1/jobs/{jobId}` after a terminal state removes the in-memory result and job metadata.

Failures use stable codes such as `invalid_request`, `payload_too_large`, `pipeline_unavailable`,
`build_failed`, `cancelled`, and `protocol_mismatch`. Cancellation is checked between deterministic
stages; a native embedding/model call already in progress must return before temporary cleanup.

## Browser boundaries

- `personal-ingestion-contract.ts` mirrors the Python version 1 wire models.
- `local-studio-provider.ts` performs capability negotiation, enforces loopback-only transport,
  reports progress, cancels jobs, validates results, and cleans terminal companion state.
- `personal-graph-session.ts` validates again, constructs the existing Graphology model, keeps the
  active personal session in memory, supports explicit JSON export, and resets without touching
  IndexedDB or localStorage.

The provider returns an `ArtifactBundle`; it cannot activate malformed or cross-file-inconsistent
data. Scene code receives the same `GraphModel` type as the public sample loader.

## Deterministic vertical slice

The public fixtures in `pipeline/tests/fixtures/studio-two-note/` contain one Markdown note and one
plain-text note. The integration test sends both across the real loopback HTTP boundary, runs the
pipeline with a deterministic network-free embedding test provider, validates all four artifacts,
checks temporary cleanup, and proves the checked-in public bundle is byte-unchanged.

Run the focused contract checks from the repository root:

```bash
cd pipeline && uv run pytest tests/test_studio.py
pnpm --filter @touch-traversal/web test tests/unit/personal-ingestion.test.ts
```
