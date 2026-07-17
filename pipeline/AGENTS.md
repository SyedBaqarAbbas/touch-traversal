# Offline pipeline guide

## Purpose and toolchain

This Python 3.11 package turns Markdown/text into a deterministic, validated graph bundle. Use
`uv`; dependencies and dev tools are pinned in `uv.lock` and `pyproject.toml`. Ruff uses a 100-column
limit, and mypy is strict for both source and tests.

The build flow is:

```text
discover/parse -> chunk -> relation candidates -> embeddings -> score/prune/repair
-> communities -> four layouts -> cross-artifact validation -> atomic JSON export
```

The CLI contract is `touch-traversal build|inspect|validate|stats`. Default settings live in
`config/default.yaml`. The exported filenames and schema are consumed directly by `apps/web`.

## Pipeline rules

- Preserve deterministic discovery order, stable IDs, seeded algorithms, byte-stable export, and
  actionable source provenance.
- Every edge must retain an explainable type, confidence/weight, and evidence. Do not replace the
  deterministic relation pipeline with opaque generated labels or relations.
- Keep optional heavy dependencies behind the `embeddings` and `layouts` extras. Unit tests must not
  download models or require network access.
- Treat config as validated input. Update `config.py`, the YAML default, tests, and documentation
  together when adding a setting.
- Treat artifact models as an external API. Coordinate schema changes with the web Zod boundary and
  regenerate all four checked-in artifacts.
- Keep personal corpora and embedding caches out of version control.

## Commands

From `pipeline/`:

```bash
uv sync --all-groups
uv sync --extra embeddings --extra layouts --all-groups  # real graph builds
uv run touch-traversal inspect --input ../sample-notes
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run mypy touch_traversal tests
```

Use `uv run pytest tests/test_<area>.py` while iterating. A pipeline-to-web contract change should
finish with the root `make test`, `make typecheck`, and a successful graph rebuild/validation.
