# Web test guide

## Test layers

- `unit/`: Vitest in a Node environment. Cover schemas, models, reducers, pure choreography,
  gesture fixtures, worker protocol, source contracts, and deterministic scene selectors.
- `e2e/`: Playwright against a managed `localhost:3000` dev server. Cover route shells and complete
  user-visible flows.
- `fixtures/`: versioned recorded gesture inputs; keep fixtures deterministic and privacy-safe.

## Conventions

- Name tests by observable contract, not internal implementation step.
- Prefer explicit fixture builders and exact boundary values for thresholds, durations, ranking,
  schema failures, and interruption behavior.
- Use accessible roles/names in Playwright. Mock `navigator.mediaDevices` for camera states and never
  require real hardware or permission dialogs in CI.
- Use the gesture-fixture route/source for hand flows. Real MediaPipe inference belongs outside
  browser CI.
- Visual checks attach screenshots for overview, hover, focus, topology, calibration, and reduced
  motion. Keep them stable by waiting for the relevant state rather than sleeping arbitrarily.
- Timeouts may cover authored choreography, but keep them close enough to expose regressions.
- Do not commit `playwright-report/`, `test-results/`, traces, or local screenshots unless they are
  intentionally promoted into `docs/assets/`.

## Commands

```bash
pnpm --filter @touch-traversal/web test tests/unit/<file>.test.ts
pnpm --filter @touch-traversal/web test
make test-e2e
```

If a Playwright failure is hard to diagnose, retain or inspect the trace before increasing a
timeout. Run the full browser suite after changing shared scene timing or route setup.
