# Touch Traversal pipeline

The pipeline is the offline half of Touch Traversal. It will turn Markdown and
plain-text notes into validated graph and layout artifacts for the web app.

The package provides strict Pydantic contracts for graph artifacts, validated
YAML configuration, and deterministic discovery and parsing for Markdown and
text corpora. Artifact validation, graph statistics, and corpus inspection are
available now, along with deterministic thought chunking, stable source
provenance, and explainable explicit, structural, temporal, and entity relation
candidates. A provider-based local Sentence Transformers path adds cached,
normalized semantic neighbors without a paid API. Configured signal combination,
density-aware pruning, isolated-node repair, and seeded Louvain communities now
produce the legible weighted relation graph. Seeded UMAP, separated community,
reliable-time, and settled weighted-force layouts provide four normalized views.
Validated artifact export is the next Milestone 1 step.

## Local commands

```bash
uv sync --all-groups
uv sync --extra embeddings --extra layouts --all-groups  # required for graph builds
uv run touch-traversal --help
uv run touch-traversal inspect --input ../sample-notes
uv run touch-traversal validate --graph path/to/graph.json
uv run touch-traversal stats --graph path/to/graph.json
uv run pytest
```

The default pipeline settings live in `config/default.yaml`. The `build`
command parses and chunks the configured corpus, generates non-semantic and
semantic relation candidates, combines and prunes them to the configured degree
target, repairs explainable isolated nodes, and assigns corpus-derived community
labels and generates four stable normalized layouts. It then reports that
validated artifact export is the next required step.
Embeddings are cached under `.cache/embeddings/` by model name and exact text
hash; the first real build downloads the configured model, while later builds
reuse local vectors.
