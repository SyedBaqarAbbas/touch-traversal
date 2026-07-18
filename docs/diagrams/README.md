# Architecture diagrams

Each diagram has an editable Mermaid source (`.mmd`) and a web-ready SVG export. The exports use an
opaque, high-contrast canvas so labels remain readable in GitHub's light and dark themes. Mermaid's
accessibility directives provide a diagram title and long description in every SVG.

| Diagram                         | Editable source                                        | Web-ready export                                       |
| ------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| System architecture             | [`system-architecture.mmd`](./system-architecture.mmd) | [`system-architecture.svg`](./system-architecture.svg) |
| Offline graph pipeline          | [`pipeline.mmd`](./pipeline.mmd)                       | [`pipeline.svg`](./pipeline.svg)                       |
| Local gesture and unified input | [`gesture-input.mmd`](./gesture-input.mmd)             | [`gesture-input.svg`](./gesture-input.svg)             |

To regenerate the exports from the repository root with Mermaid CLI 11.12.0:

```bash
npx --yes @mermaid-js/mermaid-cli@11.12.0 \
  --input docs/diagrams/system-architecture.mmd \
  --output docs/diagrams/system-architecture.svg \
  --backgroundColor white
npx --yes @mermaid-js/mermaid-cli@11.12.0 \
  --input docs/diagrams/pipeline.mmd \
  --output docs/diagrams/pipeline.svg \
  --backgroundColor white
npx --yes @mermaid-js/mermaid-cli@11.12.0 \
  --input docs/diagrams/gesture-input.mmd \
  --output docs/diagrams/gesture-input.svg \
  --backgroundColor white
```

The sources use line breaks and grouping rather than color alone to convey their structure.
