from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from touch_traversal.chunking import canonical_document_id, chunk_corpus, chunk_document
from touch_traversal.config import ChunkingConfig, load_config
from touch_traversal.ingestion import load_corpus, parse_document


def _numbered_words(prefix: str, count: int) -> str:
    return " ".join(f"{prefix}{index}" for index in range(count))


class ThoughtChunkingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.default_config = load_config(Path("config/default.yaml"))

    def test_sample_corpus_chunks_are_bounded_complete_and_repeatable(self) -> None:
        documents = load_corpus(Path("../sample-notes"), self.default_config.corpus)

        first_build = chunk_corpus(documents, self.default_config.chunking)
        second_build = chunk_corpus(documents, self.default_config.chunking)

        self.assertEqual(first_build, second_build)
        self.assertEqual(len(first_build), 16)
        self.assertEqual(len({chunk.id for chunk in first_build}), len(first_build))
        self.assertTrue(
            all(
                self.default_config.chunking.min_words
                <= chunk.word_count
                <= self.default_config.chunking.hard_max_words
                for chunk in first_build
            )
        )
        for chunk in first_build:
            self.assertEqual(
                chunk.source.document_id,
                canonical_document_id(chunk.source.path),
            )
            self.assertTrue(chunk.source.heading_path)
            self.assertIsNotNone(chunk.source.start_line)
            self.assertIsNotNone(chunk.source.end_line)
            self.assertLessEqual(len(chunk.summary), 200)

    def test_title_falls_back_to_first_clause_and_front_matter_lines_are_retained(self) -> None:
        first_clause = "A quieter way to navigate memories begins with one deliberate pause."
        source = "\n".join(
            (
                "---",
                "title: File Label",
                "date: 2026-04-08",
                "---",
                f"{first_clause} {_numbered_words('detail', 32)}",
                "",
            )
        )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "fallback.md"
            path.write_text(source, encoding="utf-8")
            chunks = chunk_document(parse_document(path, root), self.default_config.chunking)

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].title, first_clause)
        self.assertEqual(chunks[0].source.heading_path, ())
        self.assertEqual(chunks[0].source.start_line, 5)
        self.assertEqual(chunks[0].source.end_line, 5)
        self.assertLessEqual(len(chunks[0].summary), 200)

    def test_nearest_heading_and_nested_provenance_are_retained(self) -> None:
        source = "\n".join(
            (
                "---",
                "title: Provenance Fixture",
                "date: 2026-04-08",
                "---",
                "# Root",
                "",
                "## Area",
                "",
                "### Detail",
                "",
                _numbered_words("context", 40),
                "",
            )
        )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "nested.md"
            path.write_text(source, encoding="utf-8")
            chunks = chunk_document(parse_document(path, root), self.default_config.chunking)

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].title, "Detail")
        self.assertEqual(chunks[0].source.heading_path, ("Root", "Area", "Detail"))
        self.assertEqual(chunks[0].source.start_line, 11)
        self.assertEqual(chunks[0].source.end_line, 11)

    def test_oversized_sections_split_by_paragraph_and_meaningful_list_item(self) -> None:
        config = ChunkingConfig(min_words=30, preferred_max_words=80, hard_max_words=120)
        paragraph_source = "# Paragraphs\n\n" + "\n\n".join(
            _numbered_words(f"paragraph{index}-", 45) for index in range(3)
        )
        list_source = "# List\n\n" + "\n".join(
            f"- {_numbered_words(f'item{index}-', 45)}" for index in range(4)
        )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paragraph_path = root / "paragraphs.md"
            paragraph_path.write_text(paragraph_source, encoding="utf-8")
            list_path = root / "list.md"
            list_path.write_text(list_source, encoding="utf-8")

            paragraph_chunks = chunk_document(parse_document(paragraph_path, root), config)
            list_chunks = chunk_document(parse_document(list_path, root), config)

        self.assertEqual(len(paragraph_chunks), 3)
        self.assertEqual(len(list_chunks), 4)
        self.assertTrue(all(chunk.word_count == 45 for chunk in paragraph_chunks))
        self.assertTrue(all(chunk.word_count == 45 for chunk in list_chunks))
        self.assertTrue(all(chunk.text.startswith("-") for chunk in list_chunks))

    def test_oversized_paragraph_uses_bounded_sentence_groups_with_unique_ids(self) -> None:
        sentence = (
            "Signal remains visible because each deliberate pause preserves spatial context "
            "for everyone."
        )
        source = f"# Long Thought\n\n{' '.join(sentence for _ in range(30))}\n"
        config = ChunkingConfig(min_words=30, preferred_max_words=60, hard_max_words=100)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "long.md"
            path.write_text(source, encoding="utf-8")
            chunks = chunk_document(parse_document(path, root), config)

        self.assertEqual(len(chunks), 6)
        self.assertTrue(all(chunk.word_count == 60 for chunk in chunks))
        self.assertEqual(len({chunk.id for chunk in chunks}), len(chunks))
        self.assertTrue(all(chunk.source.start_line == 3 for chunk in chunks))
        self.assertTrue(all(chunk.source.end_line == 3 for chunk in chunks))

    def test_editing_one_section_changes_only_its_chunk_id(self) -> None:
        first_section = _numbered_words("anchor", 40)
        second_section = _numbered_words("before", 40)
        source = f"# Stable\n\n## First\n\n{first_section}\n\n## Second\n\n{second_section}\n"

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "stable.md"
            path.write_text(source, encoding="utf-8")
            before = chunk_document(parse_document(path, root), self.default_config.chunking)

            path.write_text(source.replace("before17", "after17"), encoding="utf-8")
            after = chunk_document(parse_document(path, root), self.default_config.chunking)

        self.assertEqual(len(before), 2)
        self.assertEqual(len(after), 2)
        self.assertEqual(before[0].id, after[0].id)
        self.assertNotEqual(before[1].id, after[1].id)


if __name__ == "__main__":
    unittest.main()
