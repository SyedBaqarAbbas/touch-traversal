# Pipeline test guide

The suite uses `unittest.TestCase`-style tests collected by pytest under strict configuration.

- Keep tests deterministic, network-free, and independent of developer caches or installed ML
  models. Use fake embedding/reducer providers and `unittest.mock` at provider boundaries.
- Use `tempfile.TemporaryDirectory` for filesystem and export tests. Never write fixtures into the
  checked-in corpus or public artifact directory during a test.
- Assert stable order, identifiers, provenance, evidence, error locations, exit codes, and
  byte-for-byte output where those are product contracts.
- Keep `test_repository_foundation.py` aligned with root tooling/privacy and sample-corpus rules.
- Keep `test_exporting.py` as the cross-language guard for the checked-in frontend artifact bundle.
- Prefer compact typed fixture builders over copied full production JSON.

Run one file from `pipeline/` with:

```bash
uv run pytest tests/test_<area>.py
```

Before handing off shared pipeline changes, also run `uv run pytest`, `uv run ruff check .`, and
`uv run mypy touch_traversal tests`.
