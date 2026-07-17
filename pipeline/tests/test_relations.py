from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from touch_traversal.chunking import chunk_corpus
from touch_traversal.config import load_config
from touch_traversal.documents import SourceDocument, ThoughtChunk
from touch_traversal.ingestion import load_corpus
from touch_traversal.models import EdgeType
from touch_traversal.relations import (
    generate_entity_relations,
    generate_explicit_relations,
    generate_nonsemantic_relations,
    generate_structural_relations,
    generate_temporal_relations,
)


def _words(prefix: str, count: int = 40) -> str:
    return " ".join(f"{prefix}{index}" for index in range(count))


def _write(root: Path, relative_path: str, content: str) -> None:
    path = root / relative_path
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


class NonsemanticRelationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = load_config(Path("config/default.yaml"))

    def _load(self, root: Path) -> tuple[tuple[SourceDocument, ...], tuple[ThoughtChunk, ...]]:
        documents = load_corpus(root, self.config.corpus)
        return documents, chunk_corpus(documents, self.config.chunking)

    def test_wiki_markdown_and_declared_relations_resolve_to_chunks(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _write(
                root,
                "alpha.md",
                """---
title: Alpha
relations:
  - Delta
---
# Alpha

## Links

[[Beta#Target]] and [Gamma](gamma.md#Area) provide direct context. """
                + _words("source")
                + "\n",
            )
            _write(root, "beta.md", f"# Beta\n\n## Target\n\n{_words('beta')}\n")
            _write(root, "gamma.md", f"# Gamma\n\n## Area\n\n{_words('gamma')}\n")
            _write(root, "delta.md", f"# Delta\n\n{_words('delta')}\n")
            documents, chunks = self._load(root)

        relations = generate_explicit_relations(documents, chunks)
        target_by_title = {chunk.title: chunk.id for chunk in chunks}

        self.assertEqual(len(relations), 3)
        self.assertEqual(
            {relation.target for relation in relations},
            {target_by_title["Target"], target_by_title["Area"], target_by_title["Delta"]},
        )
        self.assertTrue(all(relation.type is EdgeType.EXPLICIT for relation in relations))
        self.assertTrue(all(relation.directed for relation in relations))
        self.assertTrue(all(relation.score == 1.0 for relation in relations))
        descriptions = " ".join(relation.evidence.description for relation in relations)
        self.assertIn("wiki link", descriptions)
        self.assertIn("Markdown link", descriptions)
        self.assertIn("front-matter relation", descriptions)

    def test_structural_relations_explain_adjacency_and_heading_ancestry(self) -> None:
        source = (
            f"# Root\n\n## One\n\n{_words('one')}\n\n"
            f"### Detail\n\n{_words('detail')}\n\n"
            f"## Two\n\n{_words('two')}\n"
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _write(root, "structure.md", source)
            _documents, chunks = self._load(root)

        relations = generate_structural_relations(chunks)

        self.assertEqual(len(relations), 3)
        self.assertTrue(all(not relation.directed for relation in relations))
        self.assertTrue(all(relation.type is EdgeType.STRUCTURAL for relation in relations))
        self.assertEqual(
            sum("adjacent source sections" in r.evidence.description for r in relations), 2
        )
        self.assertTrue(all("same document" in r.evidence.description for r in relations))
        self.assertTrue(
            all(r.evidence.shared_terms == ("Root",) or r.score == 1.0 for r in relations)
        )

    def test_temporal_relations_require_reliable_consecutive_source_dates(self) -> None:
        dated = "---\ndate: {date}\n---\n# {title}\n\n{body}\n"
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            _write(
                root,
                "journal/a.md",
                dated.format(date="2026-04-01", title="Earlier", body=_words("earlier")),
            )
            _write(
                root,
                "journal/b.md",
                dated.format(date="2026-04-04", title="Later", body=_words("later")),
            )
            _write(root, "journal/unreliable.md", f"# Unreliable\n\n{_words('unknown')}\n")
            _write(
                root,
                "other/dated.md",
                dated.format(date="2026-04-02", title="Other", body=_words("other")),
            )
            documents, chunks = self._load(root)

        relations = generate_temporal_relations(documents, chunks)
        chunk_by_title = {chunk.title: chunk for chunk in chunks}

        self.assertEqual(len(relations), 1)
        self.assertEqual(relations[0].source, chunk_by_title["Earlier"].id)
        self.assertEqual(relations[0].target, chunk_by_title["Later"].id)
        self.assertTrue(relations[0].directed)
        self.assertEqual(relations[0].evidence.time_distance_days, 3.0)
        self.assertIn("reliable source sequence", relations[0].evidence.description)

    def test_rare_shared_entities_score_more_strongly_than_common_entities(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for index in range(5):
                tags = "[common, rare]" if index < 2 else "[common]"
                _write(
                    root,
                    f"note-{index}.md",
                    f"---\ntags: {tags}\n---\n# Note {index}\n\n{_words(f'body{index}-')}\n",
                )
            _documents, chunks = self._load(root)

        relations = generate_entity_relations(chunks)
        chunk_ids = [chunk.id for chunk in chunks]
        by_pair = {
            frozenset((relation.source, relation.target)): relation for relation in relations
        }
        rare_pair = by_pair[frozenset((chunk_ids[0], chunk_ids[1]))]
        common_pair = by_pair[frozenset((chunk_ids[0], chunk_ids[2]))]

        self.assertGreater(rare_pair.score, common_pair.score)
        self.assertEqual(rare_pair.evidence.shared_entities, ("common", "rare"))
        self.assertEqual(common_pair.evidence.shared_entities, ("common",))
        self.assertIn("weighted by rarity", rare_pair.evidence.description)

    def test_sample_nonsemantic_relations_are_deterministic_and_explained(self) -> None:
        documents = load_corpus(Path("../sample-notes"), self.config.corpus)
        chunks = chunk_corpus(documents, self.config.chunking)

        first = generate_nonsemantic_relations(documents, chunks)
        second = generate_nonsemantic_relations(documents, chunks)

        self.assertEqual(first, second)
        self.assertEqual(len(first), 75)
        self.assertTrue(all(relation.evidence.description for relation in first))
        self.assertEqual(
            {relation.type for relation in first},
            {EdgeType.EXPLICIT, EdgeType.STRUCTURAL, EdgeType.TEMPORAL, EdgeType.ENTITY},
        )


if __name__ == "__main__":
    unittest.main()
