# Interactive component guide

## Component map

- `artifact-boundary.tsx`: fetches four JSON files, validates them, and owns loading/error/empty
  states before the scene mounts.
- `graph-scene.tsx`: React Three Fiber scene, interaction reducer wiring, topology controls, HUD,
  camera choreography, traversal rendering, and mouse/fixture inputs.
- `camera-access-panel.tsx`: explicit permission and recoverable camera state.
- `hand-calibration-panel.tsx`: calibration workflow shared by calibration and debug routes.
- `traversal-history-debug.tsx`: compact session-history diagnostics.
- `route-placeholder.tsx`: shared non-scene route shell.

## Scene invariants

- Route user intent through the shared interaction actions so mouse, keyboard, and hand input have
  equivalent outcomes.
- Keep state-machine rules, ranking, timing math, layout math, and classifiers in `lib/` where they
  can be unit tested. Components should coordinate and render them.
- Do not put per-frame values into React state. Use refs, instanced attributes, transferable worker
  messages, and `useFrame` for hot paths.
- Preserve node identity and edge attachment across focus, traversal, return, and topology morphs.
- Treat animation interruption as a first-class path. Never allow a topology switch to corrupt an
  active traversal.
- Keep reduced motion and quality downgrade behavior paired with every new decorative effect.
- Camera denial, worker errors, and missing temporal data must leave a complete mouse/keyboard path.
- Avoid splitting `graph-scene.tsx` mechanically. Extract only when the new boundary owns a coherent
  model or render responsibility and has focused tests.

## Testing

Add or update unit tests for extracted logic and Playwright coverage for visible behavior. Gesture
flows use injected fixtures; browser tests must not depend on a real webcam. Timing assertions need
room for rendering but should still fail when choreography no longer completes.
