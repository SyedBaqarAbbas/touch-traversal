# Web application guide

## Stack and boundaries

This is a Next.js 16 App Router application using React 19, strict TypeScript, Graphology, React
Three Fiber, Three.js, MediaPipe, Zod, Vitest, and Playwright. The `@/*` alias resolves from this
directory. Graph artifacts are fetched from `/data/*.json`; there is no API route or backend.

Keep responsibilities separated:

- `app/`: routes, client boundaries, scene composition, and global styles.
- `lib/`: schemas, pure models/controllers, gesture logic, workers, and performance policy.
- `public/`: generated graph data and pinned local MediaPipe assets.
- `tests/`: Node-environment unit tests and browser end-to-end tests.

## Implementation conventions

- Default to server components. Add `"use client"` only at a real browser/state boundary.
- Preserve strict types; avoid `any`, unchecked casts, and duplicated wire-format types.
- Validate all artifact data at runtime before constructing the Graphology model.
- Keep high-frequency render, pointer, and gesture values in refs, buffers, workers, or Three.js
  objects rather than React render state.
- Keep scene behavior accessible by mouse and keyboard even when camera setup or inference fails.
- Any motion change must account for `prefers-reduced-motion`, interruption, and the performance
  quality presets.
- Follow `docs/visual-language.md`: sparse monochrome surfaces, fine lines, small labels, matte
  panels, no rainbow clusters, neon, glass cards, or dense always-visible chrome.

## Commands

From the repository root:

```bash
pnpm --filter @touch-traversal/web test
pnpm --filter @touch-traversal/web lint
pnpm --filter @touch-traversal/web typecheck
pnpm --filter @touch-traversal/web format
pnpm --filter @touch-traversal/web format:check
pnpm --filter @touch-traversal/web build
pnpm --filter @touch-traversal/web test:e2e
```

For one unit file, pass its path after `test`, for example:

```bash
pnpm --filter @touch-traversal/web test tests/unit/scene.test.ts
```

Route, CSS, WebGL, camera, or gesture-flow changes require the corresponding unit tests plus the
Playwright suite. Do not commit `.next/`, `playwright-report/`, or `test-results/`.
