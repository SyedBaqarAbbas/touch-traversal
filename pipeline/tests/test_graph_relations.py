from __future__ import annotations

import tempfile
import unittest
from collections import Counter
from pathlib import Path

from touch_traversal.chunking import chunk_corpus
from touch_traversal.config import PruningConfig, load_config
from touch_traversal.graph_relations import (
    ScoredRelation,
    assemble_relation_graph,
    combine_relation_candidates,
    detect_communities,
    prune_relations,
    to_thought_edge,
)
from touch_traversal.ingestion import load_corpus
from touch_traversal.models import EdgeEvidence, EdgeType
from touch_traversal.relations import RelationCandidate, generate_nonsemantic_relations


def _candidate(
    source: str,
    target: str,
    edge_type: EdgeType,
    score: float,
    description: str,
    *,
    directed: bool = False,
) -> RelationCandidate:
    return RelationCandidate(
        source=source,
        target=target,
        directed=directed,
        type=edge_type,
        score=score,
        evidence=EdgeEvidence(
            description=description,
            similarity=score if edge_type is EdgeType.SEMANTIC else None,
        ),
    )


def _scored(
    source: str,
    target: str,
    score: float,
    *,
    mutual: bool = False,
) -> ScoredRelation:
    description = "semantic: cosine relation"
    if mutual:
        description += "; mutual top-K neighbors"
    return ScoredRelation(
        source=source,
        target=target,
        directed=False,
        type=EdgeType.SEMANTIC,
        score=score,
        confidence=1.0,
        signal_scores={EdgeType.SEMANTIC: score},
        evidence=EdgeEvidence(description=description, similarity=score),
    )


def _words(prefix: str) -> str:
    return " ".join(f"{prefix}{index}" for index in range(40))


class GraphRelationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = load_config(Path("config/default.yaml"))

    def test_signal_combination_uses_coefficients_and_preserves_all_evidence(self) -> None:
        candidates = (
            _candidate(
                "b",
                "a",
                EdgeType.EXPLICIT,
                0.8,
                "declared link",
                directed=True,
            ),
            _candidate("a", "b", EdgeType.STRUCTURAL, 1.0, "adjacent sections"),
            _candidate("a", "b", EdgeType.SEMANTIC, 0.5, "cosine relation"),
        )

        combined = combine_relation_candidates(candidates, self.config.scoring)

        self.assertEqual(len(combined), 1)
        relation = combined[0]
        self.assertEqual((relation.source, relation.target), ("b", "a"))
        self.assertTrue(relation.directed)
        self.assertEqual(relation.type, EdgeType.EXPLICIT)
        self.assertEqual(relation.score, 1.0)
        self.assertEqual(
            relation.signal_scores,
            {
                EdgeType.EXPLICIT: 0.8,
                EdgeType.STRUCTURAL: 1.0,
                EdgeType.SEMANTIC: 0.5,
            },
        )
        self.assertIn("explicit: declared link", relation.evidence.description)
        self.assertIn("structural: adjacent sections", relation.evidence.description)
        self.assertIn("semantic: cosine relation", relation.evidence.description)

    def test_pruning_caps_edges_and_repairs_isolated_nodes_with_explainable_candidates(
        self,
    ) -> None:
        relations = (
            _scored("a", "b", 0.90),
            _scored("a", "c", 0.85),
            _scored("b", "c", 0.80),
            _scored("a", "d", 0.75),
            _scored("b", "d", 0.70),
            _scored("c", "d", 0.65),
            _scored("e", "f", 0.10),
        )
        config = PruningConfig(
            maximum_degree=4,
            target_average_degree=4.0,
            minimum_score=0.5,
            maximum_edges=4,
            repair_isolated_nodes=True,
        )

        retained = prune_relations(("a", "b", "c", "d", "e", "f"), relations, config)
        degrees: Counter[str] = Counter(
            endpoint for relation in retained for endpoint in (relation.source, relation.target)
        )

        self.assertEqual(len(retained), 4)
        self.assertTrue(all(degrees[node_id] >= 1 for node_id in "abcdef"))
        self.assertTrue(all(degree <= config.maximum_degree for degree in degrees.values()))
        repaired = next(r for r in retained if {r.source, r.target} == {"e", "f"})
        self.assertLess(repaired.score, config.minimum_score)
        self.assertTrue(repaired.evidence.description)

    def test_mutual_semantic_neighbors_win_the_pruning_preference(self) -> None:
        relations = (
            _scored("a", "b", 0.60, mutual=True),
            _scored("c", "d", 0.95),
        )
        config = PruningConfig(
            maximum_degree=4,
            target_average_degree=4.0,
            minimum_score=0.1,
            maximum_edges=1,
            repair_isolated_nodes=False,
        )

        retained = prune_relations(("a", "b", "c", "d"), relations, config)

        self.assertEqual(len(retained), 1)
        self.assertEqual({retained[0].source, retained[0].target}, {"a", "b"})

    def test_seeded_communities_have_stable_corpus_derived_labels(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, tag in (
                ("alpha-one", "alpha"),
                ("alpha-two", "alpha"),
                ("beta-one", "beta"),
                ("beta-two", "beta"),
            ):
                (root / f"{name}.md").write_text(
                    f"---\ntags: [{tag}]\n---\n# {name}\n\n{_words(name)}\n",
                    encoding="utf-8",
                )
            documents = load_corpus(root, self.config.corpus)
            chunks = chunk_corpus(documents, self.config.chunking)

        edges = (
            to_thought_edge(_scored(chunks[0].id, chunks[1].id, 0.9)),
            to_thought_edge(_scored(chunks[2].id, chunks[3].id, 0.9)),
        )
        first = detect_communities(chunks, edges, self.config.clustering)
        second = detect_communities(chunks, edges, self.config.clustering)

        self.assertEqual(first, second)
        self.assertEqual(len(first), 2)
        self.assertEqual(
            {community.label.split(" · ")[0] for community in first}, {"Alpha", "Beta"}
        )
        self.assertEqual(
            {node_id for community in first for node_id in community.node_ids},
            {chunk.id for chunk in chunks},
        )

    def test_sample_graph_hits_density_and_degree_targets_deterministically(self) -> None:
        documents = load_corpus(Path("../sample-notes"), self.config.corpus)
        chunks = chunk_corpus(documents, self.config.chunking)
        candidates = generate_nonsemantic_relations(documents, chunks)

        first = assemble_relation_graph(
            chunks,
            candidates,
            self.config.scoring,
            self.config.pruning,
            self.config.clustering,
        )
        second = assemble_relation_graph(
            chunks,
            candidates,
            self.config.scoring,
            self.config.pruning,
            self.config.clustering,
        )
        degrees = Counter(
            endpoint for edge in first.edges for endpoint in (edge.source, edge.target)
        )

        self.assertEqual(first, second)
        self.assertGreaterEqual(first.average_degree, 4.0)
        self.assertLessEqual(first.average_degree, 8.0)
        self.assertLessEqual(max(degrees.values()), self.config.pruning.maximum_degree)
        self.assertEqual(first.isolated_node_ids, ())
        self.assertTrue(all(edge.evidence.description for edge in first.edges))
        self.assertTrue(all(community.label for community in first.communities))


if __name__ == "__main__":
    unittest.main()
