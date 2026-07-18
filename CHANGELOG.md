# Changelog

## Unreleased

- Gives the visible fingertip cursor the same highlight and title-label hover behavior as the mouse;
  the most recently moved cursor owns hover while the existing 700 ms guard still protects pinch,
  swipe, and direct-manipulation actions after mouse activity.
- Makes **overview**, **focus**, **inspect**, and **return** describe their purpose in tooltips and
  remain disabled whenever their action is unavailable. **inspect** is explicitly marked as a
  future detailed-reading mode.
- Documents note intake versus private JSON import, links the complete version 1 JSON Schema and
  importable Linear project example, and records the nearby-thought text toggle.
- Expands the hand guide and calibration contract to cover point, pinch, open-palm return,
  horizontal topology sweep, empty-space grab, orbit, pan, depth zoom, and release.

## 0.1.0 — 2026-07-18

First public MVP release.

- Builds a deterministic, explainable graph from a fictional Markdown corpus and exports four
  validated static artifacts.
- Renders semantic, community, temporal, and force topologies with accessible mouse and keyboard
  traversal plus optional local MediaPipe hand input.
- Routes live pointing, pinch, open-palm, and swipe frames through the shared interaction
  controller while preserving denial and failure fallbacks.
- Includes a fixed six-beat recording mode, architecture diagrams, optimized portfolio media, a
  complete runbook, raw performance measurements, and runtime license notices.
- Publishes a base-path-aware static export through GitHub Pages.

Measured release evidence and its limits are recorded in
[`docs/performance-report.md`](docs/performance-report.md). Media captions and provenance are in
[`docs/portfolio-media.md`](docs/portfolio-media.md) and
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
