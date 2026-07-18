# Touch Traversal project guide

This guide describes the implemented MVP. It covers local setup, the runtime boundaries, data and
camera privacy, supported controls, known limitations, and common recovery paths.

For the newer personal file/folder workflow, local companion, in-memory sessions, direct hand view
manipulation, tutorial, recording, and browser fallbacks, use the
[`Personal Graph Studio release guide`](personal-graph-studio-release.md).

## Run the project

### Requirements

- Node.js 22–24 (`.nvmrc` pins major version 22).
- pnpm 10.14.0 through Corepack.
- Python 3.11+ (`.python-version` pins 3.11).
- `uv` for the Python environment and locked dependencies.
- A WebGL-capable current browser. Camera use also requires browser media-device support and a
  secure context; `http://localhost` is suitable for local development.

From the repository root, verify the tools with:

```bash
make doctor
```

### One-time setup

There is one setup command per workspace. The web command runs at the repository root:

```bash
pnpm install --frozen-lockfile --optimistic-repeat-install
```

The pipeline command installs its development groups and both optional feature sets required by a
real graph build:

```bash
cd pipeline && uv sync --extra embeddings --extra layouts --all-groups --locked
```

`make install` is the convenient common setup and runs both commands above, including the pipeline
extras needed by `make build-graph`.

### Build data and develop

Run all remaining commands from the repository root:

```bash
make build-graph
make dev
```

`make build-graph` reads `sample-notes/`, applies `pipeline/config/default.yaml`, validates a
complete bundle, and atomically replaces these files together:

- `apps/web/public/data/graph.json`
- `apps/web/public/data/layouts.json`
- `apps/web/public/data/manifest.json`
- `apps/web/public/data/pipeline-report.json`

Open `http://localhost:3000/demo`. Other implemented routes are:

- `/`: product entry and route navigation.
- `/studio`: explicit personal file/folder preview and loopback graph generation.
- `/perform`: opt-in mirrored webcam composition with the same graph and hand worker.
- `/calibration`: explicit camera setup, mirrored preview, landmarks, numeric settings, and a
  production-classifier rehearsal for point, pinch, open palm, horizontal sweep, empty-space grab,
  orbit, pan, depth zoom, and release.
- `/tutorial`: resumable eight-step orientation with a camera-free path, visual hand-movement
  cards, and links to ordered practice on the real graph runtime.
- `/debug`: artifact statistics, raw sample payload, traversal history, and hand diagnostics.

The release build is also published as a static GitHub Pages project site at
[`https://syedbaqarabbas.github.io/touch-traversal/`](https://syedbaqarabbas.github.io/touch-traversal/).
The Pages workflow builds with `NEXT_PUBLIC_BASE_PATH=/touch-traversal`; data, model, WASM, route,
and Next.js asset URLs retain that prefix. The hosted site is still the same backend-free static
application, and HTTPS permits the browser to offer the optional camera prompt.

The first graph build may download `all-MiniLM-L6-v2`, the configured Sentence Transformers model.
Inference then runs in the local Python process. Exact-text embedding results are cached under
`pipeline/.cache/embeddings/`; the model manager also keeps its own model cache.

### Test and build commands

```bash
make test          # root tooling contract, web unit tests, and pipeline tests
make test-e2e      # browser flows against a managed local dev server
make lint          # ESLint and Ruff
make typecheck     # TypeScript and strict Python mypy
make format-check  # non-mutating Prettier and Ruff formatting checks
make build         # production Next.js build
```

Use `make build-graph` whenever pipeline source or configuration changes. Do not edit one generated
JSON file by hand; the frontend treats all four as one versioned, cross-validated bundle.

## Architecture and data flow

```text
Markdown, .markdown, or .txt files on disk
  -> discover and parse
  -> heading-aware chunks with stable source provenance
  -> explicit, structural, temporal, entity, and local semantic candidates
  -> score, prune, repair isolated nodes, and seed Louvain communities
  -> semantic, community, temporal, and settled force layouts
  -> validate and export four static JSON artifacts
  -> browser fetch + Zod cross-artifact validation
  -> Graphology graph + render-ready buffers
  -> React Three Fiber / Three.js scene
```

The Python pipeline uses seeded algorithms, stable identifiers, explainable edge evidence, and a
local Sentence Transformers provider. It runs either as the sample batch command or behind the
optional authenticated loopback-only Studio companion. A network connection can still be required
once to acquire the configured embedding model; no hosted embedding API is used.

The web application fetches `/data/graph.json`, `/data/layouts.json`, `/data/manifest.json`, and
`/data/pipeline-report.json` as static assets. It rejects a missing, malformed, schema-incompatible,
or internally inconsistent bundle before creating the Graphology model. The graph scene then uses
React Three Fiber and Three.js for instanced nodes, relationship lines, labels, focus/traversal
camera choreography, and layout morphing.

There is no hosted application backend in the MVP: no Next.js API route, database, account,
telemetry collector, cloud ingestion, or sync process. The public path reads only static fictional
artifacts. Personal Studio sends explicitly confirmed notes to `127.0.0.1:8765`, receives a
validated bundle into browser memory, and never overwrites the public sample.

Editable Mermaid sources and accessible SVG exports document the
[system architecture](diagrams/system-architecture.svg),
[offline pipeline](diagrams/pipeline.svg), and
[gesture input path](diagrams/gesture-input.svg).

### Hand input boundary

Hand input is optional and browser-local:

1. The app calls `getUserMedia` only after the user activates a camera button. Audio is disabled.
2. One video element holds the local stream. It is hidden in `/demo`, visible and mirrored behind
   the graph in `/perform`, and never duplicated for inference.
3. Frames are resized to at most 320 pixels wide and transferred as `ImageBitmap` objects to a Web
   Worker at a target cadence of 24 FPS.
4. The worker loads the checked-in same-origin MediaPipe model and WASM runtime, runs one-hand
   inference, and returns normalized landmarks and timing data.
5. The camera panel smooths landmarks into a cursor; calibration can store versioned numeric
   threshold/mirroring settings in `localStorage`.
6. The existing guarded gesture controller classifies pointing, pinch, open-palm hold, and
   horizontal swipe frames. Node-space gestures route through the same select, traverse, return, and
   topology actions used by mouse and keyboard input. An empty-space pinch drives guarded orbit,
   vertical pan, depth zoom, and release through the shared view-control path.

The implementation does not upload camera frames or landmarks. Recording is a separate explicit
local action described below. Disabling the camera, leaving the component, or disposing the worker
stops all media tracks and terminates the worker.

Performance presentation keeps the scene component mounted when its video layer is hidden, so the
selected thought, topology, traversal history, camera permission, stream, and worker are preserved.
Disabling or exiting owns the opposite lifecycle: ended-track listeners detach, every media track
stops, the worker is disposed, and the graph falls back to mouse/keyboard input. Background tabs
skip frame submission, while resize and orientation changes retain cover-fit framing.

Performance recording is a separate local boundary. It composites the visible webcam/fixture,
preserved transparent WebGL frame, cursor, and curated authored overlays into a bounded 2D canvas,
then gives only that canvas's silent video stream to `MediaRecorder`. The visible red recording
indicator is excluded from the exported frame by product decision. Output exists only as an
in-memory Blob/object URL after explicit stop, and an explicit download uses a UTC app/mode
filename without graph content. Download, discard, camera shutdown, route exit, track end, error,
backgrounding, and unmount release the compositor stream and revoke any URL. There is no recorder
construction on load and no network, upload, remote cache, telemetry, or automatic/browser-storage
persistence path; an explicit download is the only durable output.

Classifier/controller modules use hysteresis, holds, cooldowns, and transition guards rather than
single-frame activation. Recorded privacy-safe fixtures exercise the same runtime cursor and
landmark handlers used by the live camera path. Mouse and fingertip cursors share one hover state,
and the most recently moved cursor immediately owns the highlight and title label. Recent mouse
movement suppresses pinch, swipe, and manipulation actions for 700 ms to avoid simultaneous
commands; it does not suppress visible fingertip hover.

## Controls and fallbacks

Mouse, keyboard, and optional live hand input share the graph interaction state. Camera permission
is never required.

| Input                               | Action                                                               |
| ----------------------------------- | -------------------------------------------------------------------- |
| Hover a node or a dot-rail item     | Show the thought label and make it the focus candidate.              |
| Click a node or dot-rail item       | Focus it; selecting an active related target starts traversal.       |
| Click **hide text** / **show text** | Collapse or restore titles and summaries for the nearest thoughts.   |
| Click **focus**                     | Focus the latest hovered thought; disabled until one is available.   |
| Click **overview**                  | Clear a selection; disabled while overview is already active.        |
| Click **return** or press `Escape`  | Return to graph overview; the button requires an active selection.   |
| Hover **inspect**                   | Explain the future detailed-reading mode; the button stays disabled. |
| Press `Backspace`                   | Restore the previous focused node when traversal history exists.     |
| Press `1`, `2`, `3`, or `4`         | Select semantic, community, temporal, or force topology.             |
| Click a topology button             | Select the same topology without a keyboard shortcut.                |
| Press `A` or `D`                    | Orbit the graph view left or right.                                  |
| Press `Shift` + an arrow key        | Pan the graph view.                                                  |
| Press `+`, `-`, or use the wheel    | Zoom the graph view.                                                 |
| Press `0` or click **Reset view**   | Restore the authored camera view.                                    |
| Click **Enable hand camera**        | Request optional local camera access and start the hand worker.      |
| Click **Disable camera**            | Stop the tracks and return to mouse/keyboard-only use.               |
| Open `/perform`                     | Enter camera-off performance presentation without a prompt.          |
| Click **Graph only**                | Hide video but keep the scene, stream, and hand input mounted.       |
| Change emphasis or mirror           | Adjust only the visible composition; graph state stays intact.       |
| Click **exit performance**          | Stop owned tracks and return to `/demo`.                             |
| Click **Start recording**           | Begin an explicit silent local webcam + graph composition.           |
| Click **Stop recording**            | Finalize an in-memory local file for download or discard.            |
| Click **Discard recording**         | Immediately release the local recording and object URL.              |
| Point at a node                     | Move the live hand cursor and establish the hover target.            |
| Pinch over a target                 | Focus it, or traverse to it when it is an active neighbor.           |
| Hold an open palm                   | Return from a focused thought to the overview.                       |
| Swipe horizontally                  | Cycle through the available topology modes.                          |
| Pinch empty space and move          | Orbit horizontally, pan vertically, and zoom with palm depth.        |
| Release the empty-space pinch       | End direct view manipulation.                                        |

Topology shortcuts are ignored while focus is inside an editable control or while a conflicting
scene transition is active. Temporal topology is disabled, with a reason in the HUD, if the bundle
does not have enough reliable date coverage. Reduced-motion preferences shorten state transitions
and disable nonessential motion while retaining navigation.

See [`interaction-controls.md`](interaction-controls.md) for the compact control contract and
[`hand-tracking-worker.md`](hand-tracking-worker.md) for the worker asset and message contract.

## Privacy and local data

### Notes and artifacts

The repository's checked-in `sample-notes/` corpus is fictional and intended for public demos. For
personal source files, use `private-notes/`; Git ignores that directory. The pipeline discovers
only configured Markdown/plain-text patterns and performs parsing, chunking, relation generation,
embedding inference, clustering, and layout generation on the local machine.

Generated artifacts are not a secret or encrypted format. `graph.json` can include titles,
summaries/excerpts, links, tags, dates, and source provenance. Anything under `apps/web/public/` is
also served by the local web app. Therefore:

- Never build a personal corpus into the tracked `apps/web/public/data/` bundle.
- Prefer an output directory outside the repository for private processing.
- If a private browser experiment is intentional, only use an
  `apps/web/public/data/private-*` directory, which Git ignores, and remember that the running web
  server can still serve it by URL.
- Run `git status --short` before staging or committing. Ignore rules are a safety net, not content
  inspection.

The relevant private-data ignores are:

- `private-notes/`: personal input corpus.
- `pipeline/.cache/`: exact-text-hash embedding cache and other pipeline cache data.
- `apps/web/public/data/private-*`: deliberately named local artifact directories/files.
- `.env` and `.env.*`, except the safe `.env.example` template.
- model/build/test caches such as `.venv/`, `node_modules/`, `.next/`, and Playwright reports.

The default `make build-graph` command always uses the fictional `sample-notes/` corpus. Inspecting a
private corpus without writing artifacts can be done from the root with:

```bash
cd pipeline && uv run touch-traversal inspect --input ../private-notes
```

### Camera

The camera is idle on page load. The app explains the purpose before asking, requests video without
audio, and leaves the rest of the product available after denial, dismissal, unsupported-browser,
device-not-found, worker, or model errors. **Disable camera** stops the active media tracks.

`/perform` uses that same explicit permission flow. Its visible video is mirrored and cover-fit,
has no audio, and shares the stream already feeding the worker. A persistent local-camera indicator
and disable action stay above the composition. Track end, worker failure, disable, exit, and route
unmount all return to the graph-only fallback and release owned resources. Deterministic browser
fixtures use a CSS camera-free stand-in rather than captured or prerecorded frames.

The pinned hand model and MediaPipe WASM files are served from the same local Next.js origin. No
camera frames are written to disk or included in test fixtures. Browser permission state remains
under browser and operating-system control.

## Capabilities and limitations

Implemented and directly exercised today:

- Deterministic local ingestion, chunking, relation scoring/pruning, clustering, four layouts,
  bundle validation, and atomic static export.
- Runtime Zod validation, Graphology construction, WebGL rendering, hover/focus/traversal/return,
  topology switching, reduced-motion handling, and mouse/keyboard browser coverage.
- Explicit webcam permission, local same-origin model assets, worker inference, mirrored
  calibration, cursor smoothing, live gesture routing, recoverable errors, and deterministic
  injected-landmark fixtures.
- Adaptive high/medium/low scene presets based on graph size and sustained measured FPS.
- Opt-in full-viewport performance presentation with single-stream video/hand reuse, adaptive
  inference cadence, deterministic camera-free fixtures, and lifecycle cleanup coverage.
- File/folder Studio intake with deterministic exclusions and budgets, an authenticated loopback
  build provider, progress/cancel/retry, atomic in-memory activation, source switching, and explicit
  private JSON import/export/reset.
- Empty-space hand orbit/pan/depth zoom with keyboard, wheel, named-control, and camera-free
  fallbacks.
- Explicit bounded local recording and a replayable first-run tutorial that stores no note data.

Current limits, stated without product claims beyond the code:

- The checked-in graph is a small fictional demonstration, not evidence of quality on a large or
  personal corpus.
- Studio has file and folder pickers, but no file watcher, incremental rebuild, durable graph
  library, automatic refresh, or cross-device sync.
- The default semantic model must be downloaded before its first local use unless already cached.
  Optional pipeline dependencies are comparatively large and CPU inference/build time varies by
  corpus and hardware.
- Public artifacts remain static JSON. Personal sessions and exports have no application-level
  encryption, private hosting, sync, multi-user editing, or conflict resolution.
- Hand accuracy depends on framing, light, occlusion, device/browser support, and individual
  calibration. Mouse and keyboard remain the reliable fallback.
- Performance figures are measurements for stated hardware/browser scenarios and synthetic scale
  probes, not universal guarantees. See [`performance-report.md`](performance-report.md).

## Troubleshooting

Studio companion, intake, session, recording, and tutorial recovery paths are in the
[`Personal Graph Studio release guide`](personal-graph-studio-release.md#troubleshooting).

### Graph artifacts fail to load or validate

The demo requires all four bundle files. Rebuild them together from the root:

```bash
make build-graph
```

Then validate the exact bundle independently:

```bash
cd pipeline && uv run touch-traversal validate \
  --graph ../apps/web/public/data/graph.json \
  --layouts ../apps/web/public/data/layouts.json \
  --manifest ../apps/web/public/data/manifest.json \
  --report ../apps/web/public/data/pipeline-report.json
```

- An HTTP 404 in the demo usually means the dev server is not running from this workspace or one
  of the fixed files is missing.
- A schema or node/layout identity error means files from different builds were mixed or the
  Python and TypeScript schemas disagree. Rebuild; do not repair one JSON file manually.
- **No notes to draw** means the validated graph contains zero nodes. Check the corpus include and
  exclude patterns, then run `cd pipeline && uv run touch-traversal inspect --input ../sample-notes`.
- A disabled temporal topology is not a bundle failure. Use another topology or add sufficient
  reliably dated notes and rebuild.

If `make build-graph` cannot import Sentence Transformers or UMAP, run the pipeline setup command
from this guide. If the model cannot download on first use, restore network access long enough to
populate the model cache, then retry. Note text is embedded by the local Python process.

### Camera permission or device failure

1. Open `/calibration` and press **Enable hand camera**; the app never opens the prompt on load.
2. If the prompt was denied or dismissed, allow camera access for `localhost` in the browser's site
   settings, confirm operating-system camera permission, and press **Retry camera**.
3. Confirm another application has not exclusively claimed the device and that the browser exposes
   `navigator.mediaDevices.getUserMedia`.
4. Continue with mouse and keyboard if access remains unavailable; graph loading and traversal do
   not depend on the camera.

Use **Disable camera** before changing devices or when camera input is no longer wanted. A camera
permission error and a hand-model error are distinct states in the UI.

If a live performance stream ends after permission was granted, `/perform` removes the video layer,
stops remaining tracks, and shows **Retry camera**. Graph controls remain usable. **Graph only** is
not a failure state: it deliberately hides the video without stopping the shared hand-input stream.

### Hand model or WASM fails to load

The worker expects these local URLs:

- `/models/hand_landmarker/hand_landmarker.task`
- `/vendor/mediapipe/tasks-vision/wasm`

With `make dev` running, confirm the main assets resolve:

```bash
curl -I http://localhost:3000/models/hand_landmarker/hand_landmarker.task
curl -I http://localhost:3000/vendor/mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm
```

Both should return a successful response. If not, verify the checked-in files under
`apps/web/public/`, reinstall locked JavaScript dependencies, restart `make dev`, and reload. Do not
replace the model with an arbitrary version: package, asset, protocol constant, documented hash,
and worker tests are pinned together. Model initialization or inference failure leaves mouse and
keyboard available.

### The scene reports medium or low quality

This is the expected performance guard, not graph corruption. The policy observes graph size and
sustained frame cadence. It lowers device pixel ratio, visible-edge/label limits, and decorative
work while keeping focus, traversal, return, and topology switching available. Once downgraded in a
session, quality remains stable rather than oscillating.

Try closing GPU-heavy tabs, reducing browser zoom/display load, or using the smaller sample bundle.
Honor reduced-motion mode when motion is uncomfortable; it separately removes nonessential bloom,
dust, shimmer, drift, and breathing. For the exact thresholds, measurement context, and downgrade
order, use [`performance-report.md`](performance-report.md).

If WebGL cannot initialize at all, use a current hardware-accelerated browser. The MVP does not
provide a non-WebGL graph renderer.
