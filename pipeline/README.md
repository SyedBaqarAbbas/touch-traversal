# Touch Traversal pipeline

The pipeline is the offline half of Touch Traversal. It will turn Markdown and
plain-text notes into validated graph and layout artifacts for the web app.

The package provides strict Pydantic contracts for graph artifacts, validated
YAML configuration, and deterministic discovery and parsing for Markdown and
text corpora. Artifact validation, graph statistics, and corpus inspection are
available now, along with deterministic thought chunking and stable source
provenance. Relationship generation and graph construction are implemented in
the next Milestone 1 steps.

## Local commands

```bash
uv sync
uv run touch-traversal --help
uv run touch-traversal inspect --input ../sample-notes
uv run touch-traversal validate --graph path/to/graph.json
uv run touch-traversal stats --graph path/to/graph.json
uv run pytest
```

The default pipeline settings live in `config/default.yaml`. The `build`
command parses and chunks the configured corpus, then reports that relationship
generation is the next required implementation step.
