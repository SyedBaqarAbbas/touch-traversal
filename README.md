# Touch Traversal

_Explore the topologies of your thoughts._

Touch Traversal is a local-first prototype that turns Markdown or plain-text notes into an
explainable knowledge graph. A Next.js application renders that graph as a spatial field with
mouse and keyboard navigation plus optional on-device hand tracking, webcam performance, and local
recording.

The public demo has no application backend and reads a checked-in fictional graph bundle. Personal
Graph Studio adds an opt-in, loopback-only Python companion for private generation; selected notes,
the resulting session, camera inference, and recordings remain local unless explicitly exported or
downloaded.

[Open the public demo](https://syedbaqarabbas.github.io/touch-traversal/) or follow the local setup
below. Camera access remains optional in both environments.

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

Open `http://localhost:3000/demo` for the fictional sample. For personal notes, keep the web app
running, open `http://localhost:3000/studio`, and start the loopback companion in a second terminal:

```bash
cd pipeline && uv sync --extra embeddings --extra layouts --all-groups && uv run touch-traversal studio
```

The first graph build can download the configured local Sentence Transformers model; subsequent
sample builds reuse `pipeline/.cache/embeddings/` and the model manager's cache. The Studio
companion uses a temporary personal workspace and does not persist a personal cache.

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

The routes are `/`, `/demo`, `/studio`, `/perform`, `/calibration`, `/tutorial`, and `/debug`.
`/studio` previews and validates selected notes before any local build. `/perform` is an opt-in
full-viewport camera composition; the camera stays off until **Enable hand camera** is pressed.
Mouse and keyboard controls remain available if permission is denied or hand-model loading fails.

## How it works

```text
fictional sample-notes/
  -> deterministic Python pipeline
  -> four checked-in static JSON artifacts
  -> browser validation and Graphology model

explicitly selected personal notes
  -> authenticated loopback-only Python companion
  -> temporary build and validated in-memory browser session

selected graph
  -> React Three Fiber scene
  -> mouse/keyboard and optional local webcam/MediaPipe input
  -> optional local performance recording and explicit download
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
  There is no Next.js API route, database, account system, cloud sync, telemetry, or hosted note
  ingestion.
- `/studio` accepts explicit `.md`, `.markdown`, and `.txt` file/folder choices. It performs a
  content-free capability probe before a second confirmation sends accepted notes to authenticated
  `127.0.0.1:8765`, then activates the validated graph atomically in browser memory.

## Portfolio preview

![Touch Traversal reveals a fictional thought constellation, focuses and traverses connected thoughts, changes topology, and returns to overview.](docs/assets/portfolio/touch-traversal-demo.gif)

The [full media gallery](docs/portfolio-media.md) includes overview, focus, traversal, temporal, and
camera-free calibration stills. The authored sequence is also available as a
[silent 26.52-second WebM](docs/assets/portfolio/touch-traversal-demo.webm).

## Privacy and current scope

Put repository-managed personal source files under the ignored `private-notes/` directory, and
inspect `git status` before every commit. `pipeline/.cache/` and
`apps/web/public/data/private-*` are also ignored. Studio does not overwrite the tracked public
sample bundle. Generated or exported JSON can contain full chunk text, source titles, links,
relationships, tags, dates, and provenance, so never publish a private bundle.

The pipeline computes embeddings locally and does not call a hosted embedding API. Its first use
may contact the model host to download model files. Webcam permission is explicit. Performance mode
reuses one silent stream for its mirrored video layer and hand inference; hiding the video layer
does not request another stream. Disabling the camera or exiting performance mode stops its media
tracks, and calibration stores only versioned numeric settings in browser local storage.

The personal session is memory-only; refreshing or closing the tab always clears it. An explicit
**export private JSON** download remains on disk and can be imported later. Exported graph JSON and
downloaded recordings are readable local files, not encrypted containers. **remove personal
graph** always clears the in-memory bundle without changing source files and attempts to remove its
derived traversal history from `sessionStorage`. If browser storage blocks that cleanup, the UI
warns you to close the tab or clear site data. Studio accepts up to 200 UTF-8 text notes, 2 MiB each
and 16 MiB total at intake; private session imports are capped at 32 MiB.

This is a measured prototype, not a finished personal-knowledge platform. The checked-in sample is
small at 16 thoughts and 48 relationships. Live landmark frames drive guarded select, traverse,
return, topology, orbit, pan, and zoom actions; accuracy still depends on camera, lighting, framing,
and calibration, so mouse, keyboard, wheel, and named view buttons remain complete fallbacks.

Performance results are hardware- and browser-specific. Read the
[`performance report`](docs/performance-report.md) and its
[`raw measurement record`](docs/performance-measurements/2026-07-18-m2-pro-chromium.json) rather
than treating the measured host as a universal guarantee. A second
[`recording measurement`](docs/performance-measurements/2026-07-18-m2-pro-chromium-recording.json)
covers the visible webcam + graph + hand worker + native recorder composition; the report also
includes Studio preview and local-generation capacity profiles. Licensing and asset provenance are
recorded in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

For Studio setup, file limits, session controls, webcam/hand traversal, the visual and interactive
gesture tutorial, recording, tutorial replay, browser fallbacks, privacy inventory, and recovery
steps, read the
[`Personal Graph Studio release guide`](docs/personal-graph-studio-release.md). The broader MVP
architecture remains in [`docs/project-guide.md`](docs/project-guide.md).
