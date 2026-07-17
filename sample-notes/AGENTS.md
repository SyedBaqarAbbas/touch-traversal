# Public sample-corpus guide

Everything in this directory is a fictional, sanitized demonstration corpus. Never copy real
personal notes, names, secrets, or identifying events into it. This guidance file is explicitly
excluded by `pipeline/config/default.yaml`; preserve that exclusion so it never becomes a graph
document.

Corpus contracts enforced by `pipeline/tests/test_repository_foundation.py` include:

- Themes/directories are `ideas`, `journal`, `learning`, and `work`, with at least two notes each.
- Every note has YAML front matter with a unique `title`, ISO `date`, matching `theme`, block-style
  `tags`, and `sample: true`.
- The body repeats the title as an H1, includes at least one H2, contains meaningful prose, and has
  at least one resolvable wiki link.
- Wiki links form one connected corpus and target exact note titles.
- The corpus exercises Markdown links, headings, dates, tags, and Obsidian-style links without
  placeholder/lorem text.

After changing this corpus, run:

```bash
cd pipeline
uv run pytest tests/test_repository_foundation.py tests/test_ingestion.py tests/test_chunking.py
cd ..
make build-graph
make test
```

Review the regenerated four-file artifact bundle before committing it; corpus changes can alter
stable IDs, relations, communities, layouts, and screenshots.
