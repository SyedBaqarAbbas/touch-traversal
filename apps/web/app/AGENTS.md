# App Router and UI guide

## Route responsibilities

- `/`: concise product entry route.
- `/demo`: loads and validates the static artifact bundle, then mounts the graph scene.
- `/calibration`: camera, mirrored pointer, and gesture-threshold calibration.
- `/debug`: artifact statistics, traversal history, raw payloads, and calibration diagnostics.
- `globals.css`: shared visual system, responsive behavior, scene overlays, and reduced motion.

## UI rules

- Keep pages as server components unless they directly require browser APIs or interactive state.
- Put reusable interactive behavior in `_components/` and deterministic calculations in `lib/`.
- Keep the graph dominant. HUD, route navigation, hints, and debug information should remain sparse
  and must not become a conventional dashboard overlay.
- Use semantic landmarks, named navigation, real buttons, visible focus states, and calm actionable
  error/recovery copy.
- Camera access must remain explicit. Never request permission on initial page load and never imply
  frames leave the device.
- When changing routes, headings, controls, loading states, or labels, update route contract tests
  and Playwright role-based assertions.
- When changing CSS motion, verify both normal and reduced-motion states. Labels should remain
  bounded and limited rather than filling the viewport.

## Verification

Run the most relevant unit file first, then at minimum:

```bash
pnpm --filter @touch-traversal/web typecheck
pnpm --filter @touch-traversal/web lint
pnpm --filter @touch-traversal/web test tests/unit/routes.test.ts
```

Visual or interactive route changes also require `make test-e2e` and a production `make build`.
