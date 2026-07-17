# Touch Traversal agent guide

## Scope and precedence

This file applies to the whole repository. More specific `AGENTS.md` files in child directories
extend or override it for their subtree. Read the nearest applicable guide before changing files.

## Product and architecture

Touch Traversal is a local-first knowledge-graph experience. The Python pipeline turns a fictional
Markdown corpus into four static JSON artifacts; the Next.js app validates those artifacts, builds
a Graphology model, renders it with React Three Fiber, and exposes mouse, keyboard, and optional
on-device hand input. There is no application backend in the MVP.

The main boundaries are:

- `pipeline/`: deterministic Python 3.11 graph generation.
- `apps/web/`: strict-TypeScript Next.js 16 application.
- `apps/web/public/data/`: checked-in pipeline output consumed by the web app.
- `sample-notes/`: public, fictional source corpus.
- `docs/`: interaction, visual, worker, and performance decisions.
- `implementation_plan.md`: product and engineering specification supplied by the user.

Treat code and tests as the source of truth for current behavior. Some overview prose can lag behind
completed milestones; update stale documentation when a task changes the behavior it describes.

## Working rules

- Start with `git status --short`. Preserve unrelated and user-authored changes.
- Treat root `image.png` and `implementation_plan.md` as user-supplied reference inputs. Do not
  rewrite, stage, or commit them unless the user explicitly asks.
- Never commit personal notes, camera frames, environment secrets, model caches, or files under
  ignored private-data paths.
- Change pipeline source/config and regenerate artifacts; do not hand-edit generated JSON unless a
  task explicitly calls for a small fixture-only edit.
- Keep Python and TypeScript artifact schemas compatible whenever either side changes.
- Preserve mouse and keyboard access when hand tracking is unavailable or denied.
- Prefer deterministic fixtures, seeded algorithms, stable identifiers, and explainable edge data.
- For Linear-backed work, satisfy the issue acceptance criteria, add an implementation/verification
  note, and only move the issue to Done after the code is committed and checks pass.

## Commands

Run commands from the repository root unless a scoped guide says otherwise.

```bash
make doctor        # verify Node, pnpm, Python, and uv expectations
make install       # install locked JavaScript and Python dependencies
make dev           # run the web app on localhost:3000
make build-graph   # rebuild public JSON from sample-notes
make test          # root contract, Vitest, and pytest
make test-e2e      # Playwright against a managed dev server
make lint          # ESLint and Ruff
make typecheck     # TypeScript and strict mypy
make format        # Prettier and Ruff formatting
make format-check  # non-mutating formatting check
make build         # production Next.js build
```

Use the narrowest relevant test while iterating, then expand verification in proportion to risk.
Cross-boundary changes should normally finish with `make test`, `make lint`, `make typecheck`, and
`make format-check`; scene or route changes also require `make build` and `make test-e2e`.

## Completion checklist

- Acceptance criteria are reflected in code, tests, and relevant documentation.
- Runtime fallbacks, reduced motion, privacy, and deterministic output still work.
- `git diff --check` is clean and only intended files are staged if a commit was requested.
- Report exact verification commands and any intentionally untracked files in the handoff.
