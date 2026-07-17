# Application workspace guide

This directory contains pnpm workspace applications. The repository currently has one app,
`apps/web`, whose local guide contains the implementation details.

- Keep application packages private and address them through their package name; the web package is
  `@touch-traversal/web`.
- Run package commands with `pnpm --filter <package> ...` or use the root `make` targets.
- If a new app is added, update `pnpm-workspace.yaml`, root scripts/tooling tests, lockfiles, and the
  root architecture documentation together.
- Do not add a server merely to load graph data. The MVP consumes static pipeline artifacts.
