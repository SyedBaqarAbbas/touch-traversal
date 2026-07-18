# Personal graph JSON format

The **import private JSON** control on `/demo` accepts one version 1 session envelope, up to 32 MiB.
The browser parses and validates the complete session before replacing the active in-memory graph.
It does not upload the file or retain it after a page reload.

```json
{
  "sessionVersion": 1,
  "metadata": {
    "id": "my-graph",
    "createdAt": "2026-07-18T12:00:00.000Z",
    "noteCount": 2
  },
  "bundle": {
    "graph": {},
    "layouts": {},
    "manifest": {},
    "report": {}
  }
}
```

`metadata.id` must be non-empty, `createdAt` must be an ISO 8601 timestamp with an offset, and
`noteCount` must be a non-negative integer. Metadata emitted by Touch Traversal also records the
origin, node and edge counts, and corpus name.

## Bundle artifacts

The bundle uses the same strict contracts as the checked-in pipeline output:

- `graph` has `schemaVersion: 1`, unique thought nodes, and unique edges. Each node contains its
  title, full text, summary, source provenance, metadata, and visual defaults. Every edge references
  two existing node IDs and records its direction, type, weight, confidence, evidence, and visual
  defaults.
- `layouts` has `version: 1`, a 3D bounding box, and `semantic`, `clusters`, `temporal`, and `force`
  position maps. All four maps must contain exactly the graph node IDs, with each position written
  as `[x, y, z]`.
- `manifest` records the generation timestamp, corpus name, node and edge counts, embedding model,
  and pipeline configuration hash.
- `report` records source/chunk/node/edge counts, counts by edge type, isolation and degree metrics,
  cluster count, similarity statistics, build duration, and warnings.

Runtime cross-validation also requires edge endpoints to exist, line ranges and bounds to be
ordered, edge-type counts to sum correctly, graph/layout IDs to match, and manifest/report counts to
match the graph. The canonical machine-readable contract is
`apps/web/public/examples/personal-graph-session.schema.json`; constraints described there as
runtime-only are enforced by the Zod bundle validator.

## Linear project example

`apps/web/public/examples/touch-traversal-linear-project.json` is directly importable. It contains a
project node for **Touch Traversal — Personal Graph Studio**, issue nodes THO-62 through THO-69,
structural project-membership edges, and the 16 directed dependency links reported by Linear on
2026-07-18. It contains concise project/issue summaries and links, not personal note content.

On `/demo`, open **JSON format + example**, download the Linear project graph, then choose
**import private JSON** and select that file. The graph becomes the active personal source and can be
traversed with the same mouse, keyboard, and optional hand controls as the sample graph.
