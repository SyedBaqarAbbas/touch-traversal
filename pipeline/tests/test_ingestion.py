from __future__ import annotations

import os
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

from touch_traversal.config import CorpusConfig, load_config
from touch_traversal.documents import DateSource, DocumentFormat
from touch_traversal.ingestion import (
    DocumentIngestionError,
    discover_document_paths,
    parse_document,
)


class DocumentDiscoveryTests(unittest.TestCase):
    def test_discovery_is_recursive_stable_and_honors_exclusions(self) -> None:
        config = load_config(Path("config/default.yaml")).corpus

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixtures = {
                "AGENTS.md": "# Corpus instructions\n",
                "keep.md": "# Keep\n",
                "notes/also-keep.markdown": "# Also keep\n",
                "notes/AGENTS.md": "# Nested corpus instructions\n",
                "plain.TXT": "Plain text\n",
                ".hidden.md": "# Hidden\n",
                ".hidden/note.md": "# Hidden directory\n",
                "attachments/ignored.md": "# Attachment\n",
                "generated/ignored.txt": "Generated\n",
                "notes/image.png": "not a document\n",
            }
            for relative_path, content in fixtures.items():
                path = root / relative_path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")

            discovered = discover_document_paths(root, config)

        self.assertEqual(
            [path.relative_to(root).as_posix() for path in discovered],
            ["keep.md", "notes/also-keep.markdown", "plain.TXT"],
        )

    def test_discovery_rejects_a_non_directory_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "note.md"
            path.write_text("# Note\n", encoding="utf-8")

            with self.assertRaisesRegex(DocumentIngestionError, "must be a directory"):
                discover_document_paths(path, CorpusConfig())


class DocumentParsingTests(unittest.TestCase):
    def test_markdown_parsing_preserves_display_text_and_extracts_metadata(self) -> None:
        source = """---
title: Navigation Trial
date: 2026-04-08
tags:
  - Design-Research
  - navigation
---
# Project Atlas

Cafe\u0301     observations connect to #Research and [[Memory Observatory#Premise|the observatory]].

## Question

Can a [spatial index](https://example.test/index "Reference") preserve context?

### Detail

Punctuation stays: calm, legible, and deliberate.
"""

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "trial.md"
            path.write_bytes(b"\xef\xbb\xbf" + source.encode("utf-8"))
            os.utime(path, (1_900_000_000, 1_900_000_000))

            document = parse_document(path, root)

        self.assertEqual(document.path, "trial.md")
        self.assertEqual(document.format, DocumentFormat.MARKDOWN)
        self.assertEqual(document.title, "Navigation Trial")
        self.assertEqual(document.source_text, source)
        self.assertEqual(document.display_text, source.split("---\n", maxsplit=2)[2])
        self.assertIn("café observations connect", document.normalized_text)
        self.assertNotIn("     ", document.normalized_text)
        self.assertEqual(document.tags, ("design-research", "navigation", "research"))
        self.assertEqual(document.date_source, DateSource.FRONT_MATTER)
        self.assertEqual(document.created_at, datetime(2026, 4, 8, tzinfo=UTC))
        self.assertEqual(
            [heading.path for heading in document.headings],
            [
                ("Project Atlas",),
                ("Project Atlas", "Question"),
                ("Project Atlas", "Question", "Detail"),
            ],
        )
        self.assertEqual(document.wiki_links[0].target, "Memory Observatory")
        self.assertEqual(document.wiki_links[0].anchor, "Premise")
        self.assertEqual(document.wiki_links[0].alias, "the observatory")
        self.assertEqual(document.markdown_links[0].text, "spatial index")
        self.assertEqual(document.markdown_links[0].destination, "https://example.test/index")
        self.assertEqual(document.markdown_links[0].title, "Reference")
        self.assertEqual(document.front_matter["date"], "2026-04-08")

    def test_filesystem_time_is_used_when_front_matter_has_no_date(self) -> None:
        timestamp = 1_700_000_000

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "plain-note.txt"
            path.write_text("An unadorned text thought.\n", encoding="utf-8")
            os.utime(path, (timestamp, timestamp))

            document = parse_document(path, root)

        self.assertEqual(document.format, DocumentFormat.TEXT)
        self.assertEqual(document.title, "plain note")
        self.assertEqual(document.date_source, DateSource.FILESYSTEM)
        self.assertEqual(document.created_at, datetime.fromtimestamp(timestamp, tz=UTC))
        self.assertEqual(document.modified_at, datetime.fromtimestamp(timestamp, tz=UTC))

    def test_missing_front_matter_delimiter_is_actionable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "broken.md"
            path.write_text("---\ntitle: Broken\n# No closing delimiter\n", encoding="utf-8")

            with self.assertRaisesRegex(DocumentIngestionError, "missing closing --- delimiter"):
                parse_document(path, root)

    def test_invalid_front_matter_metadata_is_actionable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "broken.md"
            path.write_text("---\ntags: [one, two\n---\n# Broken\n", encoding="utf-8")

            with self.assertRaisesRegex(DocumentIngestionError, "malformed front matter"):
                parse_document(path, root)

    def test_invalid_utf8_reports_the_byte_offset(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "invalid.md"
            path.write_bytes(b"# Valid prefix\n\xff")

            with self.assertRaisesRegex(
                DocumentIngestionError, r"could not decode .* as UTF-8 at byte 15"
            ):
                parse_document(path, root)


if __name__ == "__main__":
    unittest.main()
