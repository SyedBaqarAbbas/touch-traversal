# Scene performance report

Measured on 2026-07-17 against `/demo?input=mouse` in Chrome 147 at a 1440 × 900 viewport and DPR 1.

The benchmark uses a deterministic browser-side scene workload for the required scale targets. It exercises the same class of per-frame work the WebGL scene depends on: node position updates, focus scaling, edge endpoint reads, and edge-length calculations. The checked-in sample graph is intentionally small at 4 nodes and 4 edges, so the 100/400 and 300/1500 scenarios are synthetic scale probes rather than alternate public data files.

## Results

| Scenario | Mode | Nodes | Edges | Avg FPS | Min FPS | Avg frame | p95 frame |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| overview-100-400 | overview | 100 | 400 | 120.1 | 106.4 | 8.3 ms | 9.3 ms |
| focus-100-400 | focus | 100 | 400 | 119.9 | 106.4 | 8.3 ms | 9.3 ms |
| overview-300-1500 | overview | 300 | 1500 | 119.9 | 106.4 | 8.3 ms | 9.3 ms |
| focus-300-1500 | focus | 300 | 1500 | 120.0 | 106.4 | 8.3 ms | 9.3 ms |

Target: 60 FPS. Minimum acceptable threshold: 45 FPS. All measured scenarios exceeded the target on the test laptop.

## Adaptive hooks

The scene now chooses a quality preset from node count, edge count, and optional measured FPS:

- `high`: DPR `[1, 1.75]`, no edge cap, up to 5 thought labels.
- `medium`: DPR `[1, 1.4]`, cap visible edges at 1200, up to 4 thought labels.
- `low`: DPR `[1, 1.15]`, cap visible edges at 900, up to 3 thought labels.

This is intentionally a hook, not a premature optimizer. The current small sample stays on `high`; larger artifacts can downgrade DPR, edge visibility, and label density without changing the interaction model.

## Mouse route coverage

`/demo?input=mouse` is the repeatable mouse rehearsal route. Browser tests cover load, hover label, selection, selected excerpt, return, and label-density limits.
