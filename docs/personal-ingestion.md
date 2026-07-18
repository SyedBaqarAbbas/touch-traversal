# Personal ingestion contract

THO-63 establishes the executable provider boundary and THO-66 adds the private intake surface at
`/studio`. The public static build remains a working sample viewer with fixed public artifacts.

## Select and preview a corpus

Open `/studio` and use the standard multi-file picker, drop files or a folder, or use **Choose
folder**. Browsers with the File System Access API use its directory picker; other browsers fall
back to a directory-enabled file input. The ordinary multi-file input remains the baseline and does
not depend on either directory API.

Selection is a local, in-memory preview step. It makes no HTTP requests, starts no graph work,
writes no tracked artifacts, and uses neither localStorage nor IndexedDB. Navigating away, clearing
the selection, or unmounting the route releases the selected `File` references and any prepared
request. The fictional sample link works without filesystem access.

The preview displays relative paths and metadata, never note bodies. It accepts UTF-8 `.md`,
`.markdown`, and `.txt` files in deterministic relative-path order. It mirrors the pipeline's hidden
path and configured exclusions for `AGENTS.md`, `.git`, `node_modules`, `attachments`, and
`generated`. Unsafe or traversal paths, case-insensitive duplicate relative paths, unsupported
extensions, empty or binary-looking content, invalid UTF-8, unreadable files, and files over the
hard budgets remain visible as exclusions with an actionable reason.

Intake budgets intentionally fit within the companion's request envelope:

| Budget          | Soft warning | Hard acceptance limit |
| --------------- | -----------: | --------------------: |
| File count      |          100 |                   200 |
| Individual file |        1 MiB |                 2 MiB |
| Accepted corpus |        8 MiB |                16 MiB |

The companion retains its 20 MiB HTTP request limit for JSON framing and metadata overhead. The
Continue action is an explicit consent boundary that prepares a versioned request in memory and
performs a content-free capability probe. A second **Start local graph build** action sends the
accepted notes to the authenticated loopback companion after showing the endpoint and privacy
contract.

## Generate and open a personal graph

The Studio reports the companion's real nine-stage progress sequence and elapsed wall time. Cancel
requests abort browser polling and ask the companion to clean its temporary job. Disconnects,
protocol mismatches, model/pipeline failures, invalid bundles, and zero-node results remain on the
Studio route with a recovery action; they never replace the currently active graph. Retry performs
a fresh capability probe so a restarted companion can issue a new process token.

A successful response is parsed and cross-file validated, then converted to the same Graphology
model used by the sample. Only after all validation succeeds is the in-memory personal session
published atomically. **Open personal graph** navigates to `/demo` and passes that model directly to
the existing scene—personal artifacts are never loaded from fixed public URLs.

The graph-source controls switch between sample and personal models without reloading the page.
They can explicitly export a versioned private-session JSON file, import a compatible file back
into memory, or remove the personal graph. Import validates before replacing the active session.
Remove/reset clears only browser memory and returns to the sample; it never deletes or modifies the
original source files. Sessions intentionally disappear on full page reload and are not written to
localStorage, IndexedDB, public data, or a hosted service.

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
      "relativePath": "field-notes/origin.md",
      "mediaType": "text/markdown",
      "content": "# A local note\n\nContents stay on this machine."
    }
  ]
}
```

`name` remains the pathless basename for backward compatibility. Folder imports may additionally
provide a canonical POSIX `relativePath`; it must be relative, contain no dot or empty segments,
end with `name`, and be unique ignoring case. The companion creates nested directories only inside
the per-job temporary corpus and verifies filesystem containment before writing. Supported media
types are `text/markdown` and `text/plain`. The companion returns a job snapshot immediately.

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
pnpm --filter @touch-traversal/web test tests/unit/studio-intake.test.ts
npx playwright test tests/e2e/studio-intake.spec.ts --project=chromium
```
