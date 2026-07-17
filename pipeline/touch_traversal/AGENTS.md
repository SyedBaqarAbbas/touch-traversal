# Pipeline source guide

## Module ownership

- `documents.py`, `ingestion.py`: parsed source models, discovery, front matter, headings, and links.
- `chunking.py`: stable document/chunk IDs, heading-aware chunking, and provenance ranges.
- `relations.py`: explicit, structural, temporal, and entity relation candidates.
- `embeddings.py`: provider protocol, cache, normalized vectors, and semantic candidates.
- `graph_relations.py`: weighted combination, pruning, isolated-node repair, and communities.
- `layouts.py`: semantic, community, temporal, and force layouts with normalized coordinates.
- `models.py`, `artifacts.py`: strict wire models and bundle validation/statistics.
- `exporting.py`: frontend bundle construction and byte-stable writes.
- `config.py`: strict YAML configuration models.
- `cli.py`, `__main__.py`: user-facing commands, messages, and exit codes.

## Implementation rules

- Use `Path`, immutable tuples/frozen dataclasses where appropriate, explicit return types, and
  deterministic sorting/tie-breakers.
- Pydantic models should reject unexpected or malformed external data and serialize the established
  camel-case JSON contract. Validation errors must identify the artifact/source path and field.
- Stable IDs derive from canonical source identity/content boundaries. Never use process-random
  hashes or unseeded layout/community algorithms.
- Keep source line ranges, heading paths, link evidence, similarity values, and other explanations
  intact through export.
- Inject embedding and dimensionality-reduction providers so tests can use small local fakes.
- Validate the whole bundle before creating/replacing output files; a failed build must not leave a
  plausible partial bundle.
- CLI commands return structured, script-friendly output and use nonzero exit codes with concise
  stderr for user input or validation failures.

Add a focused test in `pipeline/tests/` for every behavior change, including boundary and failure
cases. Update frontend schema tests when a serialized contract changes.
