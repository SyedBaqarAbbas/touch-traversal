# Web domain-library guide

## Module map

- `artifacts/schema.ts`: Zod wire contracts and cross-artifact validation.
- `graph-model.ts`, `scene-model.ts`: Graphology construction and render-ready selectors.
- `layout-registry.ts`, `layout-morph.ts`, `topology-controls.ts`: stable layout identity and morphs.
- `interaction-model.ts`, `pointer-model.ts`: state-machine and hover behavior.
- `traversal-choreography.ts`, `traversal-history.ts`: traversal timing and session history.
- `camera-access.ts`: permission-state model.
- `hand-*`, `gesture-*`: worker protocol, smoothing, calibration, classification, and actions.
- `performance-policy.ts`: quality thresholds, frame summaries, and decorative downgrade order.

## Coding rules

- Prefer small pure functions with explicit input/output types and deterministic ordering.
- Model invalid states at boundaries and return actionable errors; do not let malformed artifacts
  reach Graphology or Three.js.
- Keep the Zod artifact schema aligned with `pipeline/touch_traversal/models.py`, including field
  names, enum values, schema version, and cross-file node/layout identity rules.
- Stable IDs, seeded layout assumptions, ranking tie-breakers, thresholds, and timing ranges are
  contracts. Change their focused tests with the implementation.
- Worker messages must be structured-clone safe and exhaustively discriminated. Transfer image data
  rather than copying it, and keep inference failures recoverable.
- Gesture classification must use temporal guards, hysteresis/debounce, calibration values, and
  recorded fixtures. Do not introduce single-frame activation shortcuts.
- Browser globals belong only in modules that are intentionally client-side; most model functions
  should remain testable in Vitest's Node environment.

Place focused coverage in `tests/unit/<area>.test.ts`. Run that file while iterating, then the full
web unit suite for changes to shared models or schemas.
