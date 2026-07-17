# Documentation guide

Documentation here records implemented contracts rather than aspirational marketing copy.

- `visual-language.md`: reference translation, palette, typography, density, and rejection rules.
- `interaction-controls.md`: current keyboard/mouse topology and navigation controls.
- `hand-tracking-worker.md`: model/runtime URLs, privacy, worker protocol, and frame budgets.
- `performance-report.md`: measured scenarios, hardware/browser context, thresholds, and downgrade
  behavior.
- `assets/`: deliberately checked-in documentation screenshots only.

Keep prose concise, factual, and synchronized with code. Preserve exact measured values, dates,
viewport/DPR, browser/hardware context, and the distinction between measured sample behavior and
synthetic scale probes. Do not claim a feature or performance result without current evidence.

When UI behavior changes, update the relevant control/visual document in the same change. When
worker assets or cadence changes, update the worker contract. When performance policy or results
change, rerun the measurement path before editing the report.

Screenshots must show public sample data, use a stated route/state/viewport, and avoid personal
content or camera frames. Optimize only if legibility remains adequate.
