# Touch Traversal

*Explore the topologies of your thoughts.*

Touch Traversal transforms notes into an animated knowledge graph that you can explore with
your hands. It is a local-first spatial interface for finding structural, semantic, and temporal
relationships across a personal Markdown corpus without turning the experience into a generic
dashboard.

The repository is currently at the foundation milestone. The web routes, offline pipeline package,
sample corpus, quality gates, and continuous integration are in place; graph extraction, WebGL
rendering, and hand tracking arrive in later milestones.

## Architecture

```text
Markdown notes
     |
     v
Python pipeline: parse -> relate -> cluster -> lay out -> export static JSON
     |
     v
Next.js experience: validate -> render -> navigate with mouse, keyboard, or gestures
```

- `sample-notes/` contains a small, fictional corpus for development and demonstrations.
- `pipeline/` contains the Python 3.11+ offline graph-building package.
- `apps/web/` contains the strict-TypeScript Next.js application.
- `implementation_plan.md` is the milestone-by-milestone product and engineering specification.

There is no application backend in the MVP. Note processing and graph generation happen locally,
then the web app reads static artifacts from `apps/web/public/data/`.

## Local setup

Requirements:

- Node.js 22–24
- pnpm 10.14.0 through Corepack
- Python 3.11+
- [uv](https://docs.astral.sh/uv/)

Install and verify the workspace:

```bash
make doctor
make install
make test
make lint
make typecheck
make format-check
```

Start the web application:

```bash
make dev
```

Then open `http://localhost:3000`. The current foundation routes are `/`, `/demo`,
`/calibration`, and `/debug`. Browser smoke tests run separately with `make test-e2e`.

The pipeline CLI contract can be inspected now:

```bash
cd pipeline
uv run touch-traversal --help
```

The `inspect` command discovers and parses a note corpus, while `validate` and `stats` enforce the
exported graph contracts. The `build` command currently parses, chunks, generates explainable
relations, computes cached local semantic neighbors, and builds a pruned weighted community graph,
then exits with a clear message until deterministic layouts are added in the next pipeline task.

## Sample data and privacy

Every checked-in note under `sample-notes/` is fictional and marked `sample: true` in its front
matter. The notes include dates, tags, headings, Markdown links, and Obsidian-style wiki links so
future ingestion work has representative public inputs.

Personal note content should stay under `private-notes/`, which Git ignores. Pipeline caches and
generated artifacts prefixed with `private-` under `apps/web/public/data/` are ignored as well.
Environment files are not tracked, apart from an explicitly safe `.env.example` template.

The intended product remains local-first: notes are processed on the developer's machine, note text
is not sent to analytics, and future webcam input will remain on-device. Ignore rules are a safety
net, not a substitute for checking `git status` before committing private data.

## Current limitations

- The graph pipeline commands are scaffolded but do not process notes yet.
- The web routes are accessible placeholders rather than the final WebGL experience.
- Hand tracking and webcam permission flows are not implemented.
- Performance targets in the implementation plan have not been measured yet.
