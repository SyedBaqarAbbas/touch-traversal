# Touch Traversal

_Explore the topologies of your thoughts._

Touch Traversal is a local-first prototype that turns Markdown or plain-text notes into a static,
explainable knowledge graph. A Next.js application renders that graph as a spatial field with
mouse and keyboard navigation plus optional on-device hand tracking.

The MVP has no application backend. Note processing is a local Python batch job; the browser reads
four generated JSON files and performs rendering and hand inference on the device.

## Quick start

Requirements: Node.js 22–24, pnpm 10.14.0 through Corepack, Python 3.11+, and
[uv](https://docs.astral.sh/uv/).

Check the toolchain:

```bash
make doctor
```

Install both locked workspaces with the repository command:

```bash
make install
```

The equivalent one-command setup for each workspace is:

```bash
# Web application (run from the repository root)
pnpm install --frozen-lockfile --optimistic-repeat-install

# Offline pipeline, including graph-build extras
cd pipeline && uv sync --extra embeddings --extra layouts --all-groups --locked
```

Return to the repository root, build the sample graph, and start the app:

```bash
make build-graph
make dev
```

Open `http://localhost:3000/demo`. The first graph build can download the configured local
Sentence Transformers model; subsequent builds reuse `pipeline/.cache/embeddings/` and the model
manager's cache.

## Exact development commands

Run these from the repository root:

```bash
make dev           # Next.js development server at http://localhost:3000
make build-graph   # rebuild all four public artifacts from sample-notes/
make test          # root contract checks, Vitest, and pytest
make test-e2e      # Playwright against a managed development server
make lint          # ESLint and Ruff
make typecheck     # TypeScript and strict mypy
make format-check  # non-mutating Prettier and Ruff check
make build         # production Next.js build
```

The routes are `/`, `/demo`, `/calibration`, and `/debug`. Camera access is optional and is only
requested after pressing **Enable hand camera**; mouse and keyboard controls remain available if
permission is denied or hand-model loading fails.

## How it works

```text
local Markdown/text corpus
  -> deterministic Python pipeline
  -> graph.json + layouts.json + manifest.json + pipeline-report.json
  -> browser validation and Graphology model
  -> React Three Fiber scene
  -> mouse/keyboard and optional local webcam/MediaPipe input
```

The editable Mermaid sources and accessible SVG exports for the
[system architecture](docs/diagrams/system-architecture.svg),
[offline pipeline](docs/diagrams/pipeline.svg), and
[gesture input path](docs/diagrams/gesture-input.svg) live under [`docs/diagrams/`](docs/diagrams/).

- `pipeline/` discovers, parses, chunks, relates, clusters, lays out, validates, and exports graph
  data. Relations retain their type, score, and evidence.
- `apps/web/public/data/` holds the checked-in sample artifact bundle. The frontend validates all
  four files before constructing the graph.
- `apps/web/public/models/` and `apps/web/public/vendor/` hold the same-origin MediaPipe model and
  WASM runtime. Camera frames are downscaled and transferred to a browser worker; they are not sent
  to an application server.
- `sample-notes/` is a fictional public corpus; every checked-in note declares `sample: true`.
  There is no API route, database, account system, cloud sync, or server-side note ingestion in the
  MVP.

## Privacy and current scope

Put personal source files under the ignored `private-notes/` directory, and inspect `git status`
before every commit. `pipeline/.cache/` and `apps/web/public/data/private-*` are also ignored.
Generated JSON can contain source titles, excerpts, links, and provenance, so never overwrite the
tracked public sample bundle with personal output and never publish a private bundle.

The pipeline computes embeddings locally and does not call a hosted embedding API. Its first use
may contact the model host to download model files. Webcam permission is explicit; disabling the
camera stops its media tracks, and calibration stores only versioned numeric settings in browser
local storage.

This is a measured prototype, not a finished personal-knowledge platform. The checked-in sample is
small at 16 thoughts and 48 relationships, graph generation is a manual batch step, and
private-bundle selection is not integrated into the UI. Live landmark frames drive the same guarded
select, traverse, return, and topology actions as mouse input; accuracy still depends on camera,
lighting, framing, and calibration, so mouse and keyboard remain complete fallbacks.

Performance results are hardware- and browser-specific. Read the
[`performance report`](docs/performance-report.md) and its
[`raw measurement record`](docs/performance-measurements/2026-07-18-m2-pro-chromium.json) rather
than treating the measured host as a universal guarantee. Licensing and asset provenance are
recorded in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

For the full runbook, architecture, controls, privacy boundaries, limitations, and recovery steps,
read [`docs/project-guide.md`](docs/project-guide.md).
