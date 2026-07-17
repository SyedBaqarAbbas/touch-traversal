from __future__ import annotations

import hashlib
import tempfile
import unittest
from collections.abc import Sequence
from dataclasses import replace
from pathlib import Path

from touch_traversal.artifacts import (
    ArtifactValidationError,
    load_artifact,
    validate_artifact_bundle,
)
from touch_traversal.chunking import chunk_corpus
from touch_traversal.config import load_config
from touch_traversal.embeddings import (
    EmbeddingBatch,
    EmbeddingRecord,
    generate_semantic_relations,
)
from touch_traversal.exporting import build_artifact_bundle, export_artifacts
from touch_traversal.graph_relations import assemble_relation_graph
from touch_traversal.ingestion import load_corpus
from touch_traversal.layouts import generate_layouts
from touch_traversal.models import GraphArtifact, GraphManifest, LayoutArtifact, PipelineReport
from touch_traversal.relations import generate_nonsemantic_relations


class _Reducer:
    def reduce(
        self,
        vectors: Sequence[Sequence[float]],
        *,
        n_neighbors: int,
        min_dist: float,
        metric: str,
        random_seed: int,
    ) -> tuple[tuple[float, float, float], ...]:
        del n_neighbors, min_dist, metric, random_seed
        return tuple((vector[0], vector[1], float(index)) for index, vector in enumerate(vectors))


class ArtifactExportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = load_config(Path("config/default.yaml"))
        self.documents = load_corpus(Path("../sample-notes"), self.config.corpus)
        self.chunks = chunk_corpus(self.documents, self.config.chunking)
        self.embeddings = EmbeddingBatch(
            model_name="fixture-model",
            records=tuple(
                EmbeddingRecord(
                    chunk_id=chunk.id,
                    text_hash=hashlib.sha256(chunk.id.encode("utf-8")).hexdigest(),
                    vector=(1.0, (index + 1) / 100, (index % 3) / 100),
                )
                for index, chunk in enumerate(self.chunks)
            ),
            cache_hits=0,
            cache_misses=len(self.chunks),
        )
        self.semantic = generate_semantic_relations(self.embeddings, self.config.semantic)
        nonsemantic = generate_nonsemantic_relations(self.documents, self.chunks)
        self.relation_graph = assemble_relation_graph(
            self.chunks,
            (*nonsemantic, *self.semantic),
            self.config.scoring,
            self.config.pruning,
            self.config.clustering,
        )
        self.layouts = generate_layouts(
            self.chunks,
            self.documents,
            self.embeddings,
            self.relation_graph,
            self.config.layouts,
            _Reducer(),
        )
        self.bundle = build_artifact_bundle(
            corpus_name="sample-notes",
            documents=self.documents,
            chunks=self.chunks,
            embeddings=self.embeddings,
            semantic_relations=self.semantic,
            relation_graph=self.relation_graph,
            layouts=self.layouts,
            config=self.config,
            build_duration_ms=12.5,
        )

    def test_bundle_contains_complete_frontend_nodes_and_report_statistics(self) -> None:
        self.assertEqual(len(self.bundle.graph.nodes), len(self.chunks))
        self.assertEqual(len(self.bundle.graph.edges), len(self.relation_graph.edges))
        self.assertEqual(self.bundle.manifest.corpus_name, "sample-notes")
        self.assertEqual(self.bundle.manifest.embedding_model, "fixture-model")
        self.assertEqual(self.bundle.report.file_count, len(self.documents))
        self.assertEqual(self.bundle.report.chunk_count, len(self.chunks))
        self.assertEqual(self.bundle.report.node_count, len(self.chunks))
        self.assertEqual(
            sum(self.bundle.report.edge_counts.values()), self.bundle.report.edge_count
        )
        self.assertEqual(
            self.bundle.report.isolated_node_count,
            len(self.relation_graph.isolated_node_ids),
        )
        self.assertEqual(self.bundle.report.cluster_count, len(self.relation_graph.communities))
        self.assertGreater(self.bundle.report.similarity_distribution.count, 0)
        self.assertEqual(self.bundle.report.build_duration_ms, 12.5)
        first_node = self.bundle.graph.nodes[0]
        self.assertTrue(first_node.metadata.entities)
        self.assertTrue(first_node.visual.cluster_id.startswith("cluster_"))

    def test_export_writes_four_round_trip_validated_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            exported = export_artifacts(output, self.bundle)
            graph = load_artifact(output / "graph.json", GraphArtifact, "graph")
            layouts = load_artifact(output / "layouts.json", LayoutArtifact, "layouts")
            manifest = load_artifact(output / "manifest.json", GraphManifest, "manifest")
            report = load_artifact(output / "pipeline-report.json", PipelineReport, "report")

        self.assertEqual(
            [path.name for path in exported],
            ["graph.json", "layouts.json", "manifest.json", "pipeline-report.json"],
        )
        validate_artifact_bundle(graph, layouts, manifest, report)
        self.assertEqual(graph, self.bundle.graph)
        self.assertEqual(layouts, self.bundle.layouts)

    def test_identical_builds_export_byte_stable_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first_paths = export_artifacts(root / "first", self.bundle)
            second_paths = export_artifacts(root / "second", self.bundle)
            first_bytes = {path.name: path.read_bytes() for path in first_paths}
            second_bytes = {path.name: path.read_bytes() for path in second_paths}

        self.assertEqual(first_bytes, second_bytes)

    def test_bundle_mismatch_is_rejected_before_output_directory_is_created(self) -> None:
        mismatched_graph = self.bundle.graph.model_copy(
            update={"nodes": self.bundle.graph.nodes[:-1]}
        )
        invalid_bundle = replace(self.bundle, graph=mismatched_graph)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "not-created"
            with self.assertRaisesRegex(
                ArtifactValidationError, "layout node ids must match graph node ids"
            ):
                export_artifacts(output, invalid_bundle)
            self.assertFalse(output.exists())

    def test_checked_in_frontend_fixture_matches_pipeline_contracts(self) -> None:
        fixture_root = Path("../apps/web/public/data")
        graph = load_artifact(fixture_root / "graph.json", GraphArtifact, "graph")
        layouts = load_artifact(fixture_root / "layouts.json", LayoutArtifact, "layouts")
        manifest = load_artifact(fixture_root / "manifest.json", GraphManifest, "manifest")
        report = load_artifact(fixture_root / "pipeline-report.json", PipelineReport, "report")

        validate_artifact_bundle(graph, layouts, manifest, report)


if __name__ == "__main__":
    unittest.main()
