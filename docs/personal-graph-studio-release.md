# Personal Graph Studio release guide

This guide describes the shipped Personal Graph Studio and its privacy boundary. The public site
remains a static fictional demo. Personal graph generation is an optional local workflow that uses
the same browser UI plus a loopback-only Python companion on the user's computer.

## What is public and what stays local

| Path               | Data source                                    | Processing boundary                                    | Persistence                                  |
| ------------------ | ---------------------------------------------- | ------------------------------------------------------ | -------------------------------------------- |
| Public demo        | Checked-in fictional `sample-notes/` artifacts | Static browser assets                                  | Public by design                             |
| Local demo         | The same checked-in fictional artifacts        | Local Next.js development server                       | Public sample only                           |
| Personal Studio    | Files explicitly selected in `/studio`         | Browser memory and authenticated `127.0.0.1` companion | Memory only unless exported                  |
| Performance camera | Camera explicitly enabled in `/perform`        | Browser, local worker, and local compositor            | Memory only unless a recording is downloaded |

There is no cloud ingestion API, account, database, sync service, telemetry collector, or hosted
embedding request. The companion is not an internet-facing application backend: it refuses
non-loopback bind addresses, accepts only explicitly allowed browser origins, creates a fresh capability token for
its process, and stores each build in a temporary workspace that is removed after completion,
cancellation, or failure.

The release's data and media flow is:

```text
fictional sample bundle -------------------------------> browser graph

explicit file/folder choice
  -> browser preview and validation
  -> content-free loopback capability probe
  -> explicit Start local graph build
  -> authenticated 127.0.0.1:8765 request
  -> temporary corpus -> local Python pipeline
  -> validated artifact bundle -> browser-memory session
  -> optional private JSON export

explicit camera enable
  -> one silent local stream -> hand worker
                             -> visible performance layer
  -> optional explicit record -> bounded canvas -> in-memory Blob
  -> optional explicit download
```

## Setup and start

Requirements are Node.js 22-24, pnpm 10.14.0 through Corepack, Python 3.11+, `uv`, and a current
WebGL-capable browser. Run these commands from the repository root unless a command changes
directory:

```bash
make doctor
make install
make build-graph
make dev
```

Open `http://localhost:3000/demo` for the fictional graph or `http://localhost:3000/studio` for
personal intake. The public static site can run the fictional demo without Python.

For personal generation, keep the web app running and start the companion in a second terminal:

```bash
cd pipeline && uv sync --extra embeddings --extra layouts --all-groups && uv run touch-traversal studio
```

The companion listens on `http://127.0.0.1:8765`. The first real graph build may download the
configured Sentence Transformers model. That model download contains no note content. Later builds
reuse the model manager's cache; Studio itself reports and implements no persistent personal cache.

The equivalent locked one-time workspace setup is:

```bash
pnpm install --frozen-lockfile --optimistic-repeat-install
cd pipeline && uv sync --extra embeddings --extra layouts --all-groups --locked
```

## Build and verification commands

The supported repository commands are:

```bash
make build-graph   # regenerate the checked-in fictional bundle from sample-notes/
make test          # root contract, Vitest, and pytest
make test-e2e      # Playwright against a managed development server
make lint          # ESLint and Ruff
make typecheck     # strict TypeScript and mypy
make format-check  # non-mutating Prettier and Ruff formatting check
make build         # production Next.js build
```

`make build-graph` is only for the fictional checked-in corpus. Personal Studio does not overwrite
`apps/web/public/data/`.

## Build a personal graph

1. Open `/studio`, then choose files, choose a folder, or drag a directory/files onto the intake
   surface. No picker opens automatically.
2. Review the accepted and excluded paths, counts, sizes, warnings, and modification dates. Remove
   individual entries or clear the selection if needed. Note bodies are not rendered in the
   preview.
3. Select **Continue to graph generation**. The browser sends a capability probe with no note
   names or contents. If the companion is unavailable, start it with the command shown above and
   choose **Check again**.
4. Review the disclosed endpoint and privacy capabilities, then select **Start local graph build**.
   This second confirmation is the first point at which accepted note contents cross from browser
   memory to the loopback companion.
5. Follow the named nine-stage progress indicator: accepted, materializing, ingesting, chunking,
   relating, embedding, laying out, validating, and complete. Elapsed time stays visible. **Cancel
   build** requests cancellation and retains the previously displayed graph; typed failures offer a
   retry path without changing source files.
6. Select **Open personal graph**. The validated bundle is activated atomically; an incomplete or
   invalid build never replaces the current graph.

Supported source extensions are `.md`, `.markdown`, and `.txt`, encoded as valid UTF-8. Paths are
canonicalized and ordered deterministically. Hidden paths, `.git`, `node_modules`, `attachments`,
`generated`, `AGENTS.md`, unsupported or binary files, empty files, unsafe paths, case-insensitive
duplicate paths, unreadable files, and files beyond a hard limit are excluded with a reason.

The browser intake budgets are:

| Budget          | Warning threshold | Hard limit |
| --------------- | ----------------: | ---------: |
| Selected files  |               100 |        200 |
| One file        |             1 MiB |      2 MiB |
| Accepted corpus |             8 MiB |     16 MiB |

The companion independently enforces 200 notes, 2 MiB per note, and a 20 MiB request-body limit.
It runs at most two builds concurrently, retains at most eight job records, and automatically erases
terminal results/errors after five minutes if normal browser cleanup does not remove them first.

## Personal sessions, import, export, and reset

The graph source controls on `/demo` make the active source explicit:

- **sample** selects the checked-in fictional bundle.
- **personal** selects the current in-memory personal session and is disabled until one exists.
- **import private JSON** validates and activates a compatible version 1 session file up to 32 MiB
  in memory.
- **export private JSON** downloads `touch-traversal-personal-session.json` only after an explicit
  click.
- **remove personal graph** always clears the personal bundle from browser memory, returns to the
  sample, and does not change the original source files or a previously downloaded export. It also
  attempts to remove derived traversal history from `sessionStorage`. If browser storage blocks
  that cleanup, the status message warns you to close the tab or clear site data.

Switching between sample and personal sources does not reload the page. Refreshing or closing the
tab always clears a generated/imported personal session. An explicitly exported download remains
on disk and can be imported later. Private JSON is portable and readable, not encrypted; it may
contain full chunk text, note titles, relationships, links, tags, dates, and source provenance.
Treat it like the original notes.

## Graph controls

Every graph remains usable without a camera. Named buttons are keyboard reachable and the browser
honors reduced-motion preferences.

| Input                               | Action                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------- |
| Hover or click a node/dot-rail item | Preview or focus a thought; selecting an active neighbor traverses its edge |
| `Escape` or **return**              | Return to overview                                                          |
| `Backspace`                         | Restore the previous focused thought when traversal history exists          |
| `1`, `2`, `3`, `4`                  | Semantic, community, temporal, or force topology                            |
| `A`, `D`                            | Orbit the graph view left or right                                          |
| `Shift` + arrow keys                | Pan the graph view                                                          |
| `+`, `-`, or mouse wheel            | Zoom in or out                                                              |
| `0` or **Reset view**               | Restore the authored camera view                                            |
| Named view buttons                  | Orbit, pan, zoom, or reset without a shortcut                               |

Temporal topology is disabled with an explanation when the graph lacks adequate dates. Topology and
view shortcuts do not steal input from editable controls or conflicting scene transitions.

## Webcam, hand, and finger controls

Camera permission is never requested on load. **Enable hand camera** requests silent video only and
starts same-origin MediaPipe inference in a browser worker. **Disable camera**, route exit, track
end, or worker failure stops owned resources; denial or missing hardware leaves mouse and keyboard
fully available. `/calibration` provides a mirrored preview and versioned numeric pinch, depth, and
mirror settings.

| Gesture                                                              | Action                                              |
| -------------------------------------------------------------------- | --------------------------------------------------- |
| Point at a node                                                      | Move the hand cursor and establish its hover target |
| Pinch over a node                                                    | Focus it or traverse to an active connected thought |
| Hold an open palm                                                    | Return to overview                                  |
| Swipe horizontally                                                   | Cycle available topologies                          |
| Pinch empty space and move horizontally                              | Orbit the graph                                     |
| Pinch empty space and move vertically                                | Pan the graph                                       |
| Keep the empty-space pinch and move the palm toward/away from camera | Zoom by depth                                       |
| Release the pinch                                                    | End the direct manipulation grab                    |

Node pinches retain selection/traversal priority over empty-space manipulation. Conflicting
transitions and hand loss cancel a grab safely. Recent mouse movement takes temporary precedence,
then hand input resumes automatically.

## Performance presentation and local recording

`/perform` begins graph-only and does not prompt for a camera. After explicit camera enable, the
same stream supplies the mirrored visible layer and hand inference. Presentation controls preserve
the selected thought, history, topology, stream, and worker:

- **Graph only** / **Show video layer** hides or reveals video without requesting a new stream.
- **emphasis / balanced**, **graph**, and **video** cycle relative composition emphasis.
- **mirror** changes the visible horizontal orientation.
- **reset framing** restores center/cover framing after resize or orientation changes.
- **exit performance** stops owned media tracks and returns to `/demo`.

When supported and the camera layer is active, **Start recording** creates a local silent take. A
maximum 1280 x 720, 30 FPS canvas explicitly composes the visible webcam, transparent WebGL graph,
hand cursor, topology, selection, and traversal overlays. The red recording indicator and controls
are intentionally not in the saved frame, and no microphone or audio track is included.

**Stop recording** produces an in-memory object. **Download recording** is the only operation that
writes it to disk; **Discard recording** releases chunks and the object URL. Filenames are
`touch-traversal-performance-<UTC timestamp>` and contain no note title. The app tries WebM VP9,
WebM VP8, plain WebM, then browser-confirmed MP4. It warns at four minutes or 96 MiB and stops at
five minutes or 128 MiB. Camera disable, performance exit, track end, encoding error, backgrounding,
and component unmount stop or discard recorder resources.

## Tutorial

The first-run invitation and `/tutorial` provide eight short steps covering the graph model,
sources, universal controls, optional hand input, direct manipulation, performance mode, recording,
and privacy. Choose the full path, **Mouse and keyboard only**, or **Skip for now**. Optional steps
never activate a camera or file picker themselves.

The hand and manipulation steps include visual movement cards and links to interactive practice on
the real sample graph. The persistent coach recognizes the ordered point, select pinch, connected
pinch, open-palm return, and topology swipe flow, plus empty-space grab, orbit, vertical pan, depth
zoom, and release. It uses the same guarded runtime as the graph rather than a tutorial-only
simulator. Camera permission remains explicit, and the written guide remains available after
denial. The guide also states the intentional gaps: swipes cycle instead of selecting topology
`1`–`4`, hand pan is vertical, and reset uses **Reset view** or `0`.

Tutorial progress is resumable and stores only version 2 status, step IDs, input-path choice, and
completed action names in browser `localStorage`; it stores no note or camera data. **Tutorial**,
**Help**, and **Controls** links reopen it from production routes. After completion, **Replay
tutorial** starts over. Clearing the site data keys `touch-traversal:tutorial:v2` and the legacy
`touch-traversal:tutorial` also resets it. Exiting restores the route and graph source recorded for
that browser tab when possible.

## Privacy inventory

| Data                    | Location and lifetime                                                                              | Leaves the device?                                            | User-controlled release                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Public sample artifacts | Checked into the repository and served statically                                                  | Already public                                                | Rebuilt only by developer command                                            |
| Selected note contents  | Browser memory while the Studio selection remains mounted, including after success or cancellation | Only to authenticated loopback companion                      | Clear selection, navigate away, or close/refresh tab                         |
| Temporary build corpus  | Per-job temporary directory until terminal state                                                   | No                                                            | Completion, cancel, failure, or process stop                                 |
| Build result/error      | Companion memory, normally deleted by browser                                                      | No                                                            | Authenticated delete, five-minute expiry, or process stop                    |
| Embedding/model caches  | Local Python/model cache                                                                           | Model acquisition may contact its host; note text is not sent | Remove local caches manually                                                 |
| Personal graph session  | Browser memory                                                                                     | No                                                            | Export private JSON or remove/refresh/close                                  |
| Traversal history       | Browser `sessionStorage`; may contain personal-derived IDs                                         | No                                                            | Remove personal graph when permitted; otherwise close tab or clear site data |
| Calibration             | Versioned numeric settings in `localStorage`                                                       | No                                                            | Clear site data or recalibrate                                               |
| Tutorial progress       | Versioned IDs/action names in `localStorage`                                                       | No                                                            | Replay/reset or clear site data                                              |
| Camera frames/landmarks | Browser media stream and worker memory                                                             | No                                                            | Disable camera, exit, track end, or close                                    |
| Finished recording      | In-memory Blob/object URL; may show likeness and personal graph titles                             | No                                                            | Download or discard                                                          |

Local does not mean encrypted. Source files, model caches, downloaded private JSON, browser storage,
and recordings inherit the operating system account, browser profile, disk encryption, backup, and
file-permission protections of the device. Touch Traversal does not add encryption or secure erase.

## Browser support and known limitations

Chromium is the primary automated release browser and the most thoroughly exercised path. A compact
portable-path suite also runs against current Playwright Firefox and WebKit to verify tutorial,
standard file input, graph view controls, denied-camera behavior, recording-unavailable copy, and a
390 x 844 viewport. This is fallback coverage, not equivalent real-device camera/codec certification.
On 2026-07-18 those two tests passed in Playwright Chromium 149, Firefox 151, and WebKit 26.5 on
macOS arm64. Reproduce the portable matrix from the repository root with:

```bash
pnpm --filter @touch-traversal/web exec playwright test tests/e2e/browser-fallbacks.spec.ts
pnpm --filter @touch-traversal/web exec playwright test tests/e2e/browser-fallbacks.spec.ts --browser=firefox
pnpm --filter @touch-traversal/web exec playwright test tests/e2e/browser-fallbacks.spec.ts --browser=webkit
```

| Capability                             | Chromium release path                                                   | Firefox/WebKit fallback                                                      |
| -------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Static sample and mouse/keyboard graph | Full Chromium suite plus portable-path checks                           | Portable-path checks; named HTML controls remain the fallback                |
| Folder choice                          | Native directory picker when available                                  | Multiple-file/folder input or drag-and-drop path when exposed by the browser |
| Camera and hand input                  | Secure-context `getUserMedia`, Worker, local WASM                       | Camera-free mouse/keyboard if any required API/model step fails              |
| Personal companion                     | Authenticated loopback fetch with CORS/private-network response headers | Run the web app locally if hosted-to-loopback policy blocks the request      |
| Recording                              | Browser-confirmed MediaRecorder/canvas codec                            | Recording is unavailable with an explanation; live performance still works   |
| Output codec                           | WebM preferred; confirmed MP4 fallback                                  | Depends on the MIME types reported by the browser                            |

Other known limits:

- Personal sessions are tab-memory state, not a durable graph library, merge system, or sync layer.
- The app accepts text notes only; PDFs, word-processing files, images, audio, and automatic OCR are
  not ingested.
- The pipeline can take time and download model weights on first use. Build duration depends on
  corpus, hardware, and cache state.
- Graph legibility, hand accuracy, and recording cadence vary with graph density, GPU/CPU, camera,
  lighting, framing, and browser codec implementation. See the measured
  [performance report](performance-report.md) for the tested host rather than a universal promise.
- Browser downloads are ordinary unencrypted files and may be copied by backup or sync software.
- Private browsing, restrictive enterprise policy, or cleared site data can prevent or remove
  tutorial/calibration persistence.
- The loopback token and explicit Origin allowlist isolate ordinary browser callers, but do not
  defend against malicious software already running as the same operating-system user or a local
  process impersonating the companion on port 8765.

## Release verification map

The release suite maps deterministic product outcomes to production routes rather than replacing
them with component-only mocks:

| Outcome                                                                                               | Automated evidence                                                                               |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| First visit, tutorial, mouse/keyboard focus/traverse/return                                           | `routes.spec.ts` first-run, help/replay, graph, keyboard, and reduced-motion cases               |
| One-note and folder preview, consent, progress, cancel/retry/failure, load/traverse/switch/reset      | `studio-intake.spec.ts` plus the real loopback vertical slice in `pipeline/tests/test_studio.py` |
| Private export/download, reload clearing, re-import, and derived-history cleanup                      | Studio E2E round-trip plus personal-session and traversal-history unit contracts                 |
| Personal graph, camera opt-in/calibration, hand select/traverse/manipulation, and graph-only fallback | Integrated Studio E2E with synthetic camera and recorded landmarks                               |
| Camera denial, late permission, track end, worker error, route exit                                   | Route E2E lifecycle cases plus camera/worker unit contracts                                      |
| Record, download, second-take discard, camera disable, exit                                           | Deterministic compositor/MediaRecorder E2E plus native headed-Chromium measurement               |
| Graph-only startup, adaptive quality, low-resource policy, and no-camera operation                    | Performance route E2E, policy/presentation unit tests, and the measured performance report       |
| Missing folder API, missing MediaRecorder, denied camera, narrow viewport                             | Portable smoke assertions in `browser-fallbacks.spec.ts` on Chromium, Firefox, and WebKit        |
| Blocked/full storage and companion disconnect                                                         | Chromium route E2E plus typed provider/storage tests                                             |
| Keyboard traversal, focus restoration, live status, and reduced motion                                | Role-based route E2E assertions in Chromium                                                      |
| Terminal companion, personal session, camera, worker, compositor, and object-URL cleanup              | Python integration, lifecycle E2E, and focused resource-release unit tests                       |

The synthetic Chromium camera proves the real `getUserMedia`/worker/compositor/codec lifecycle
without retaining a person's image. Recorded privacy-safe landmarks prove the classifier and graph
action path repeatably. They do not certify recognition accuracy for a particular hand, camera,
lighting setup, mobile device, or browser codec. Before presenting a specific physical setup as
supported, manually repeat this short hardware check on that setup: enable `/calibration`, verify
point/pinch/open-palm/swipe and empty-space orbit/pan/depth zoom, enter `/perform`, create and discard
a silent take, then disable the camera and confirm its browser indicator turns off. Record the
browser/device separately; do not add captured frames or recordings to the repository.

## Troubleshooting

### Studio says the companion is unavailable

Start or restart it, leave the terminal open, then select **Check again**:

```bash
cd pipeline && uv sync --extra embeddings --extra layouts --all-groups && uv run touch-traversal studio
```

Confirm that another process is not using port 8765 and that browser privacy software is not
blocking loopback requests. If a hosted browser blocks public-to-private network access, run
`make dev` and use `http://localhost:3000/studio`.

### The first build stops at embedding or model loading

Ensure the initial model download is allowed and the pipeline extras are installed with the command
above. Retry after the model is available. Note data is not part of that model-host request.

### Files are excluded

Use UTF-8 `.md`, `.markdown`, or `.txt` files under the documented limits. Rename duplicate or
unsafe relative paths and remove binary/empty content. The preview keeps each excluded reason
visible before generation.

### Camera or hand tracking is unavailable

Use a current browser in a secure context (`http://localhost` is accepted), grant video permission,
check operating-system camera privacy settings, and close other exclusive camera users. Then try
`/calibration`. Mouse, keyboard, wheel, and named view controls require no camera.

### Recording is unavailable or stops

Enable the camera and visible video layer first. Recording also requires `MediaRecorder`, canvas
stream capture, and a browser-confirmed video MIME type. The app intentionally stops at its time or
memory cap, when the tab backgrounds, or when camera/encoder resources end. Download a finished take
before refreshing or leaving the route.

### A personal graph disappeared

Refresh/close clears the in-memory session by design. Import the private JSON file if it was
explicitly exported; otherwise rebuild from the original notes. The app never modifies those source
files.

### The tutorial does not reappear

Open `/tutorial` and choose **Replay tutorial** after completion. To reset skipped or interrupted
state, clear this site's storage, including `touch-traversal:tutorial:v2`.
