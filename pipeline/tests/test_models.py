from __future__ import annotations

import unittest
from datetime import UTC, datetime

from pydantic import ValidationError

from touch_traversal.artifacts import ArtifactValidationError, validate_artifact_bundle
from touch_traversal.models import (
    EdgeType,
    GraphArtifact,
    GraphManifest,
    LayoutArtifact,
    PipelineReport,
    SimilarityDistribution,
)


def _node_payload(node_id: str) -> dict[str, object]:
    return {
        "id": node_id,
        "title": f"Node {node_id}",
        "text": "A complete graph-contract fixture.",
        "summary": "A complete fixture.",
        "source": {
            "path": f"notes/{node_id}.md",
            "documentId": node_id,
            "headingPath": ["Section"],
            "startLine": 1,
            "endLine": 3,
        },
        "metadata": {
            "createdAt": "2026-04-03T00:00:00Z",
            "tags": ["sample"],
            "entities": [],
            "wordCount": 4,
            "importance": 0.5,
        },
        "visual": {"clusterId": "cluster-1", "size": 1.0, "baseOpacity": 0.8},
    }


def _graph_payload() -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "nodes": [_node_payload("a"), _node_payload("b")],
        "edges": [
            {
                "id": "a--b",
                "source": "a",
                "target": "b",
                "directed": False,
                "type": "semantic",
                "weight": 0.75,
                "confidence": 0.8,
                "evidence": {
                    "description": "similar fixture text",
                    "sharedTerms": ["fixture"],
                    "similarity": 0.75,
                },
                "visual": {"opacity": 0.5, "width": 1.0},
            }
        ],
    }


def _layout_payload() -> dict[str, object]:
    positions = {"a": [-1.0, 0.0, 0.0], "b": [1.0, 0.0, 0.0]}
    return {
        "version": 1,
        "bounds": {"min": [-1.0, -1.0, -1.0], "max": [1.0, 1.0, 1.0]},
        "layouts": {
            "semantic": positions,
            "clusters": positions,
            "temporal": positions,
            "force": positions,
        },
    }


class ArtifactModelTests(unittest.TestCase):
    def test_graph_contract_accepts_camel_case_and_serializes_for_the_frontend(self) -> None:
        graph = GraphArtifact.model_validate(_graph_payload())
        serialized = graph.model_dump(mode="json")

        self.assertEqual(serialized["schemaVersion"], 1)
        self.assertEqual(serialized["nodes"][0]["source"]["documentId"], "a")
        self.assertEqual(serialized["nodes"][0]["metadata"]["wordCount"], 4)
        self.assertEqual(serialized["edges"][0]["evidence"]["sharedTerms"], ["fixture"])

    def test_graph_contract_rejects_dangling_edges(self) -> None:
        payload = _graph_payload()
        edges = payload["edges"]
        assert isinstance(edges, list)
        edge = edges[0]
        assert isinstance(edge, dict)
        edge["target"] = "unknown"

        with self.assertRaisesRegex(ValidationError, "edges reference unknown node ids: unknown"):
            GraphArtifact.model_validate(payload)

    def test_layout_contract_requires_identical_node_sets(self) -> None:
        payload = _layout_payload()
        layouts = payload["layouts"]
        assert isinstance(layouts, dict)
        layouts["force"] = {"a": [0.0, 0.0, 0.0]}

        with self.assertRaisesRegex(ValidationError, "force node ids must match semantic node ids"):
            LayoutArtifact.model_validate(payload)

    def test_manifest_report_and_bundle_counts_are_consistent(self) -> None:
        graph = GraphArtifact.model_validate(_graph_payload())
        layouts = LayoutArtifact.model_validate(_layout_payload())
        manifest = GraphManifest(
            generated_at=datetime(2026, 4, 24, tzinfo=UTC),
            corpus_name="sample-notes",
            node_count=2,
            edge_count=1,
            embedding_model="all-MiniLM-L6-v2",
            pipeline_config_hash="a" * 64,
        )
        report = PipelineReport(
            generated_at=datetime(2026, 4, 24, tzinfo=UTC),
            file_count=2,
            chunk_count=2,
            node_count=2,
            edge_count=1,
            edge_counts={EdgeType.SEMANTIC: 1},
            isolated_node_count=0,
            average_degree=1.0,
            cluster_count=1,
            similarity_distribution=SimilarityDistribution(
                count=1,
                minimum=0.75,
                median=0.75,
                p95=0.75,
                maximum=0.75,
            ),
            build_duration_ms=12.5,
        )

        validate_artifact_bundle(graph, layouts, manifest, report)

        invalid_manifest = manifest.model_copy(update={"node_count": 3})
        with self.assertRaisesRegex(
            ArtifactValidationError, "manifest nodeCount must match graph node count"
        ):
            validate_artifact_bundle(graph, layouts, invalid_manifest, report)

    def test_report_rejects_edge_count_mismatch(self) -> None:
        with self.assertRaisesRegex(ValidationError, "edgeCounts values must sum to edgeCount"):
            PipelineReport(
                generated_at=datetime(2026, 4, 24, tzinfo=UTC),
                file_count=1,
                chunk_count=1,
                node_count=1,
                edge_count=2,
                edge_counts={EdgeType.EXPLICIT: 1},
                isolated_node_count=0,
                average_degree=0.0,
                cluster_count=1,
                similarity_distribution=SimilarityDistribution(count=0),
                build_duration_ms=1.0,
            )


if __name__ == "__main__":
    unittest.main()
