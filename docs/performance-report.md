# Scene performance report

Measured on 2026-07-18 against `/demo?input=mouse`. The checked-in raw result is
[`performance-measurements/2026-07-18-m2-pro-chromium.json`](performance-measurements/2026-07-18-m2-pro-chromium.json).

## Environment

| Item             | Measured value                                                                   |
| ---------------- | -------------------------------------------------------------------------------- |
| Device           | MacBook Pro (`Mac14,9`), Apple M2 Pro, 10 CPU cores, 16 GPU cores, 16 GiB memory |
| OS               | Darwin 25.5.0, arm64                                                             |
| Browser          | Playwright Chromium 149.0.7827.55, visible window                                |
| Renderer         | ANGLE Metal, Apple M2 Pro                                                        |
| Viewport         | 1440 × 900, DPR 1                                                                |
| Checked-in graph | 16 nodes and 48 edges, `high` quality                                            |
| Camera           | Off for scale probes; Chromium synthetic 640 × 480 camera for camera probes      |

## Method and limits

The headed-browser script keeps the real 16/48 WebGL sample scene active and adds deterministic
JavaScript work for node positions, focus distance/scaling, edge endpoint/length reads, topology
interpolation, and 21-landmark cursor smoothing. It measures browser frame intervals for overview,
focus, morph, and hand-tracking workloads at 100/400 and 300/1500 requested scales. Each recorded
scenario runs for 2.5 seconds after a 0.5-second warm-up.

These are synthetic scale probes, not alternate graph artifacts. They do not instantiate 100/400
or 300/1500 Three.js objects, and this is not a WebGL draw benchmark. The 300/1500 probes exercise
300 nodes but respect the runtime `low`-quality cap of 900 processed edges. Results therefore show
browser cadence while the sample scene and representative JavaScript work run together; they do
not establish the fill-rate or draw-call cost of a fully rendered 300/1500 graph.

## Scene scale results

| Scenario               | Quality | Processed edges | Avg FPS | Min FPS | Avg frame | p95 frame |
| ---------------------- | ------- | --------------: | ------: | ------: | --------: | --------: |
| overview-100-400       | high    |             400 |   120.0 |   106.4 |   8.33 ms |    9.2 ms |
| focus-100-400          | high    |             400 |   120.0 |   106.4 |   8.33 ms |    9.3 ms |
| morph-100-400          | high    |             400 |   120.0 |   106.4 |   8.33 ms |    9.2 ms |
| hand-tracking-100-400  | high    |             400 |   121.3 |    73.5 |   8.24 ms |    9.4 ms |
| overview-300-1500      | low     |             900 |   122.5 |    89.3 |   8.16 ms |   10.4 ms |
| focus-300-1500         | low     |             900 |   124.7 |    46.5 |   8.02 ms |   10.3 ms |
| morph-300-1500         | low     |             900 |   120.2 |    61.7 |   8.32 ms |   10.7 ms |
| hand-tracking-300-1500 | low     |             900 |   120.3 |    68.0 |   8.31 ms |   10.5 ms |

Target: 60 FPS. Minimum acceptable threshold: 45 FPS. Every scale probe stayed above the minimum,
including its slowest recorded frame, on this variable-refresh test display. Averages above 120 FPS
reflect observed presentation timestamps; they are not fixed display-rate claims.

## Real MediaPipe worker result

The second probe granted the app a privacy-safe synthetic Chromium camera. The app received
640 × 480 video, transferred 320 × 240 frames, loaded the checked-in MediaPipe hand landmarker in
the real module worker, and observed worker `RESULT` messages for eight seconds.

| Measurement                                    |                  Result |
| ---------------------------------------------- | ----------------------: |
| Worker results                                 |                     178 |
| Inference result rate                          |                22.4 FPS |
| Average inference time                         |                24.97 ms |
| p95 inference time                             |                 26.2 ms |
| Maximum inference time                         |                   69 ms |
| Main-thread render-loop rate under worker load |               108.2 FPS |
| Detected-hand frames                           |                       0 |
| Visible cursor-render rate                     | Not measurable (`null`) |

The 22.4 FPS inference result rate sits inside the worker's supported 15–30 FPS range. No hand was
recognized in Chromium's synthetic video, so reporting a cursor-render FPS would be fabricated;
the raw record stores `null` and the reason. The 108.2 FPS figure is the main-thread animation-loop
rate while real inference was active, not a substitute for a visible-cursor measurement.

## Visible performance presentation

The final probe opened `/perform` in the same visible Chromium window and kept the mirrored
640 × 480 video, sample WebGL graph, HTML HUD, and real MediaPipe worker active together. It then
added the same representative scale work used above. The larger scenario processes 900 of its
requested 1500 edges, matching the `low`-quality runtime cap.

| Scenario | Quality | Processed edges | Avg FPS | Min FPS | Avg frame | p95 frame |
| -------- | ------- | --------------: | ------: | ------: | --------: | --------: |
| 100/400  | high    |             400 |   109.3 |    68.5 |   9.15 ms |   10.7 ms |
| 300/1500 | low     |             900 |   113.6 |    59.5 |   8.81 ms |   10.8 ms |

The visible presentation's worker produced 110 results at 22.1 FPS, averaging 26.76 ms with a
29 ms p95. The app transferred 320 × 240 frames while the 640 × 480 video remained visible. The
composition reported a graph-layer z-index of 1, a mirrored video layer, and the balanced-emphasis
video opacity of 0.68. The synthetic camera again yielded no recognized hand, so cursor-render FPS
remains explicitly `null`.

These presentation scenarios still use the checked-in 16/48 WebGL graph plus synthetic scale work;
they do not claim the draw cost of a fully instantiated 100/400 or 300/1500 graph. The adaptive
15 FPS inference target for an actual `low`-quality artifact is covered by deterministic policy
tests rather than this sample graph, which remains `high` quality.

## Visible presentation with local recording

A second headed Chromium run added the production 2D compositor and native `MediaRecorder` to the
visible webcam + graph + real MediaPipe-worker presentation. The checked-in raw result is
[`performance-measurements/2026-07-18-m2-pro-chromium-recording.json`](performance-measurements/2026-07-18-m2-pro-chromium-recording.json).
It used the same host, 1440 × 900 viewport, synthetic 640 × 480 camera, and representative 300/1500
workload with the runtime 900-edge cap.

| Scenario                   | Avg FPS | Min FPS | Avg frame | p95 frame |
| -------------------------- | ------: | ------: | --------: | --------: |
| recording-300-1500         |   120.0 |   107.5 |   8.33 ms |    8.7 ms |
| MediaPipe during recording |    21.4 |       — |  25.63 ms |   28.4 ms |

The native recorder received one video track and zero audio tracks, selected
`video/webm;codecs=vp9`, and produced an 843 KiB in-memory take during the 2.5-second probe. The
script stopped and discarded the take, observed the recorder return to `idle-after-discard`, then
disabled the camera. This measures the real recording compositor/codec path, but the scene remains
the 16/48 sample plus representative scale work and the synthetic video contained no recognized
hand. It therefore does not establish a visible-cursor rate or full 300/1500 WebGL draw cost.

## Studio intake and local generation capacity

Two additional measurements use only generated fictional Markdown. The headed-browser intake
record is
[`performance-measurements/2026-07-18-m2-pro-studio-intake.json`](performance-measurements/2026-07-18-m2-pro-studio-intake.json),
and the production Python pipeline record is
[`performance-measurements/2026-07-18-m2-pro-studio-generation.json`](performance-measurements/2026-07-18-m2-pro-studio-generation.json).

| Profile                               | Files | Source bytes | Result                             | Wall time |
| ------------------------------------- | ----: | -----------: | ---------------------------------- | --------: |
| Browser preview, small                |     2 |        1,000 | 2 accepted and 2 metadata rows     |   58.6 ms |
| Browser preview, intake hard ceilings |   200 |   16,777,216 | 200 accepted and 200 metadata rows |  1,261 ms |
| Pipeline generation, small            |     2 |        1,000 | 2 nodes, 1 edge                    |   10.10 s |
| Pipeline generation, max file count   |   200 |      100,000 | 200 nodes, 600 edges               |   12.31 s |

The browser ceiling profile simultaneously reaches the 200-file and 16 MiB accepted-corpus limits
without sending a companion request. Its timing includes Playwright's file transfer, UTF-8 and
policy validation, and rendering every preview row. The generation ceiling profile intentionally
reaches the 200-file limit with compact notes, not the 16 MiB byte ceiling: expanding 16 MiB into an
unbounded number of chunks would describe a different graph-size product promise. The UI discloses
progress and elapsed time rather than guaranteeing generation time for all accepted text.

The two-note build includes local model initialization and spent 10.09 seconds in embedding. The
200-note build ran next in the same process with the model and optional modules warm; embedding took
4.13 seconds and layout generation 7.89 seconds. Model acquisition may still require a one-time
network download before either measurement can begin.

## Bottlenecks and adaptive quality

Real MediaPipe inference was the largest measured per-frame task: 24.97 ms on average in the
worker-only probe and 26.76 ms in the visible composition. Representative JavaScript work stayed
at or below 0.1 ms at p95, with one 1.3 ms transient maximum. Inference remains in the worker, and
the main thread stayed above the target during this no-hand run. At the larger
synthetic scale, presentation p95 rose to 10.5–10.7 ms in the overview, focus, and hand-load cases;
the runtime's pre-emptive edge cap and reduced decoration are appropriate safeguards.

The scene chooses a quality preset from artifact size and sustained measured FPS:

- `high`: DPR `[1, 1.75]`, no edge cap, up to 5 thought labels.
- `medium`: DPR `[1, 1.4]`, cap visible edges at 1200, up to 4 thought labels.
- `low`: DPR `[1, 1.15]`, cap visible edges at 900, up to 3 thought labels.

Once sustained cadence causes a downgrade, the session retains the lower measurement to avoid
oscillation. Decorative features are disabled in this order:

1. Edge shimmer.
2. Dust.
3. Bloom.
4. Camera drift.
5. Node breathing.
6. Vignette, retained as the final low-cost depth cue.

Depth of field and chromatic aberration remain off in every preset. Traversal, mouse, keyboard, and
camera recovery stay available when visual density is reduced.

## Unsupported stretch claims

This run does not prove performance for a fully rendered 300/1500 artifact, an actual hand and
visible cursor, mobile or integrated low-power hardware, high-DPR displays, Safari or Firefox,
multiple hands, or graphs larger than the stated targets. Those require separate measurements. The
small fictional sample is a deterministic demonstration, not large-corpus performance evidence.

## Repeat the measurement

Start the development server, then run the visible Playwright benchmark from the repository root:

```bash
make dev
PERF_TARGET_URL=http://127.0.0.1:3000 \
  PERF_SCENARIO_DURATION_MS=2500 \
  PERF_WORKER_DURATION_MS=8000 \
PERF_OUTPUT_PATH=/tmp/touch-traversal-performance.json \
  node scripts/measure-performance.mjs

PERF_TARGET_URL=http://127.0.0.1:3000 \
  PERF_OUTPUT_PATH=/tmp/touch-traversal-studio-intake.json \
  node scripts/measure-studio-intake.mjs

cd pipeline && uv run python ../scripts/measure-studio-generation.py \
  --output /tmp/touch-traversal-studio-generation.json
```

The output path is deliberately restricted to `/tmp`; review the measured environment and results
before replacing a checked-in raw record. The script now includes the visible recording probe and
explicit discard cleanup. `/demo?input=mouse` remains the repeatable mouse route,
and browser tests cover load, hover, selection, traversal, return, label density, performance-mode
camera lifecycle, denial fallback, graph-only switching, reduced motion, and accessible controls.
