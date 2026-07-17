from __future__ import annotations

import hashlib
import math
import unittest
from collections.abc import Sequence
from itertools import combinations
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from touch_traversal.chunking import chunk_corpus
from touch_traversal.config import load_config
from touch_traversal.embeddings import EmbeddingBatch, EmbeddingRecord
from touch_traversal.graph_relations import assemble_relation_graph
from touch_traversal.ingestion import load_corpus
from touch_traversal.layouts import (
    UmapReducer,
    community_layout,
    force_layout,
    generate_layouts,
    temporal_layout,
)
from touch_traversal.relations import generate_nonsemantic_relations


class _FakeReducer:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def reduce(
        self,
        vectors: Sequence[Sequence[float]],
        *,
        n_neighbors: int,
        min_dist: float,
        metric: str,
        random_seed: int,
    ) -> tuple[tuple[float, float, float], ...]:
        self.calls.append(
            {
                "count": len(vectors),
                "n_neighbors": n_neighbors,
                "min_dist": min_dist,
                "metric": metric,
                "random_seed": random_seed,
            }
        )
        return tuple((vector[0], vector[1], float(index)) for index, vector in enumerate(vectors))


class DeterministicLayoutTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = load_config(Path("config/default.yaml"))
        self.documents = load_corpus(Path("../sample-notes"), self.config.corpus)
        self.chunks = chunk_corpus(self.documents, self.config.chunking)
        candidates = generate_nonsemantic_relations(self.documents, self.chunks)
        self.graph = assemble_relation_graph(
            self.chunks,
            candidates,
            self.config.scoring,
            self.config.pruning,
            self.config.clustering,
        )
        self.embeddings = EmbeddingBatch(
            model_name="fixture-model",
            records=tuple(
                EmbeddingRecord(
                    chunk_id=chunk.id,
                    text_hash=hashlib.sha256(chunk.id.encode("utf-8")).hexdigest(),
                    vector=(
                        math.cos(index),
                        math.sin(index),
                        (index + 1) / len(self.chunks),
                        1.0,
                    ),
                )
                for index, chunk in enumerate(reversed(self.chunks))
            ),
            cache_hits=0,
            cache_misses=len(self.chunks),
        )

    def test_umap_adapter_fixes_seed_dimension_and_single_threaded_execution(self) -> None:
        calls: list[object] = []

        class FakeUmap:
            def __init__(self, **kwargs: object) -> None:
                calls.append(kwargs)

            def fit_transform(self, vectors: list[list[float]]) -> list[list[float]]:
                calls.append(vectors)
                return [[float(index), 0.0, 1.0] for index, _vector in enumerate(vectors)]

        with patch(
            "touch_traversal.layouts.import_module",
            return_value=SimpleNamespace(UMAP=FakeUmap),
        ):
            reduced = UmapReducer().reduce(
                ((1.0, 0.0), (0.0, 1.0)),
                n_neighbors=2,
                min_dist=0.18,
                metric="cosine",
                random_seed=42,
            )

        options = calls[0]
        assert isinstance(options, dict)
        self.assertEqual(options["n_components"], 3)
        self.assertEqual(options["random_state"], 42)
        self.assertEqual(options["transform_seed"], 42)
        self.assertEqual(options["n_jobs"], 1)
        self.assertEqual(reduced, ((0.0, 0.0, 1.0), (1.0, 0.0, 1.0)))

    def test_community_islands_are_separated_after_normalization(self) -> None:
        positions = community_layout(
            self.chunks,
            self.graph.communities,
            self.config.layouts.clusters.radius,
        )
        centroids: dict[str, tuple[float, float, float]] = {}
        extents: dict[str, float] = {}
        for community in self.graph.communities:
            points = [positions[node_id] for node_id in community.node_ids]
            values = tuple(sum(point[axis] for point in points) / len(points) for axis in range(3))
            centroid = (values[0], values[1], values[2])
            centroids[community.id] = centroid
            extents[community.id] = max(math.dist(point, centroid) for point in points)

        for left, right in combinations(self.graph.communities, 2):
            self.assertGreater(
                math.dist(centroids[left.id], centroids[right.id]),
                extents[left.id] + extents[right.id],
            )

    def test_temporal_layout_orders_reliable_dates_and_force_layout_is_settled(self) -> None:
        temporal = temporal_layout(
            self.chunks,
            self.documents,
            self.graph.communities,
            self.config.layouts.temporal.depth_jitter,
        )
        journal_chunks = {
            chunk.source.path: chunk
            for chunk in self.chunks
            if chunk.source.path.startswith("journal/")
        }
        earlier = journal_chunks["journal/field-note-2026-04-14.md"]
        later = journal_chunks["journal/field-note-2026-04-24.md"]
        self.assertLess(temporal[earlier.id][0], temporal[later.id][0])

        first_force = force_layout(self.chunks, self.graph.edges, self.config.layouts)
        second_force = force_layout(self.chunks, self.graph.edges, self.config.layouts)
        self.assertEqual(first_force, second_force)
        self.assertGreater(len(set(first_force.values())), 1)

    def test_all_layouts_are_stable_normalized_and_share_the_node_set(self) -> None:
        first_reducer = _FakeReducer()
        first = generate_layouts(
            self.chunks,
            self.documents,
            self.embeddings,
            self.graph,
            self.config.layouts,
            first_reducer,
        )
        second = generate_layouts(
            self.chunks,
            self.documents,
            self.embeddings,
            self.graph,
            self.config.layouts,
            _FakeReducer(),
        )
        expected_ids = {chunk.id for chunk in self.chunks}

        self.assertEqual(first, second)
        self.assertEqual(first_reducer.calls[0]["random_seed"], self.config.layouts.random_seed)
        for layout in (
            first.layouts.semantic,
            first.layouts.clusters,
            first.layouts.temporal,
            first.layouts.force,
        ):
            self.assertEqual(set(layout), expected_ids)
            self.assertTrue(
                all(abs(coordinate) <= 1.0 for point in layout.values() for coordinate in point)
            )


if __name__ == "__main__":
    unittest.main()
