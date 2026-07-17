# Touch Traversal pipeline

The pipeline is the offline half of Touch Traversal. It will turn Markdown and
plain-text notes into validated graph and layout artifacts for the web app.

The package provides strict Pydantic contracts for graph artifacts, validated
YAML configuration, and command boundaries for the deterministic pipeline.
Artifact validation and statistics are available now. Note discovery and graph
construction are implemented incrementally during Milestone 1.

## Local commands

```bash
uv sync
uv run touch-traversal --help
uv run touch-traversal validate --graph path/to/graph.json
uv run touch-traversal stats --graph path/to/graph.json
uv run pytest
```

The default pipeline settings live in `config/default.yaml`. The `build` and
`inspect` commands validate their paths and configuration, then report that
document ingestion is the next required implementation step.
