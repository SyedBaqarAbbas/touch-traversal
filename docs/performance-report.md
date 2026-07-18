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
| Camera           | Off for scale probes; Chromium synthetic 640 × 480 camera for the worker probe   |

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
| overview-100-400       | high    |             400 |   120.1 |   101.0 |   8.33 ms |    9.1 ms |
| focus-100-400          | high    |             400 |   120.0 |   107.5 |   8.33 ms |    8.8 ms |
| morph-100-400          | high    |             400 |   120.0 |   106.4 |   8.33 ms |    9.2 ms |
| hand-tracking-100-400  | high    |             400 |   120.0 |   106.4 |   8.34 ms |    9.3 ms |
| overview-300-1500      | low     |             900 |   116.7 |    68.5 |   8.57 ms |   10.7 ms |
| focus-300-1500         | low     |             900 |   118.9 |    88.5 |   8.41 ms |   10.5 ms |
| morph-300-1500         | low     |             900 |   126.3 |    75.2 |   7.92 ms |    9.5 ms |
| hand-tracking-300-1500 | low     |             900 |   118.3 |    66.7 |   8.45 ms |   10.6 ms |

Target: 60 FPS. Minimum acceptable threshold: 45 FPS. Every scale probe stayed above the minimum,
including its slowest recorded frame, on this variable-refresh test display. The 126.3 FPS morph
average reflects observed presentation timestamps; it is not a fixed display-rate claim.

## Real MediaPipe worker result

The second probe granted the app a privacy-safe synthetic Chromium camera. The app received
640 × 480 video, transferred 320 × 240 frames, loaded the checked-in MediaPipe hand landmarker in
the real module worker, and observed worker `RESULT` messages for eight seconds.

| Measurement                                    |                  Result |
| ---------------------------------------------- | ----------------------: |
| Worker results                                 |                     179 |
| Inference result rate                          |                22.5 FPS |
| Average inference time                         |                24.91 ms |
| p95 inference time                             |                 26.3 ms |
| Maximum inference time                         |                 68.5 ms |
| Main-thread render-loop rate under worker load |               108.5 FPS |
| Detected-hand frames                           |                       0 |
| Visible cursor-render rate                     | Not measurable (`null`) |

The 22.5 FPS inference result rate sits inside the worker's supported 15–30 FPS range. No hand was
recognized in Chromium's synthetic video, so reporting a cursor-render FPS would be fabricated;
the raw record stores `null` and the reason. The 108.5 FPS figure is the main-thread animation-loop
rate while real inference was active, not a substitute for a visible-cursor measurement.

## Bottlenecks and adaptive quality

Real MediaPipe inference was the largest measured per-frame task: 24.91 ms on average, compared
with at most 0.2 ms of recorded representative JavaScript work in these scale probes. It remains in
the worker, and the main thread stayed above the target during this no-hand run. At the larger
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
```

The output path is deliberately restricted to `/tmp`; review the measured environment and results
before replacing the checked-in raw record. `/demo?input=mouse` remains the repeatable mouse route,
and browser tests cover load, hover, selection, traversal, return, and label-density behavior.
