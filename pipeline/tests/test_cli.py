from __future__ import annotations

import contextlib
import io
import json
import subprocess
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from touch_traversal import __version__
from touch_traversal.cli import main
from touch_traversal.embeddings import EmbeddingBatch
from touch_traversal.models import GraphArtifact


def _node_payload(node_id: str) -> dict[str, object]:
    return {
        "id": node_id,
        "title": f"Node {node_id}",
        "text": "A complete sample thought with enough content for a contract fixture.",
        "summary": "A complete sample thought.",
        "source": {
            "path": f"notes/{node_id}.md",
            "documentId": node_id,
            "headingPath": ["Section"],
            "startLine": 3,
            "endLine": 5,
        },
        "metadata": {
            "tags": ["sample"],
            "entities": [],
            "wordCount": 11,
            "importance": 0.5,
        },
        "visual": {"clusterId": "cluster-1", "size": 1.0, "baseOpacity": 0.8},
    }


def _graph() -> GraphArtifact:
    return GraphArtifact.model_validate(
        {
            "schemaVersion": 1,
            "nodes": [_node_payload("a"), _node_payload("b")],
            "edges": [
                {
                    "id": "a--b",
                    "source": "a",
                    "target": "b",
                    "directed": False,
                    "type": "explicit",
                    "weight": 0.9,
                    "confidence": 1.0,
                    "evidence": {"description": "a links to b"},
                    "visual": {"opacity": 0.6, "width": 1.0},
                }
            ],
        }
    )


class CliTests(unittest.TestCase):
    def test_module_help_lists_pipeline_commands(self) -> None:
        result = subprocess.run(
            [sys.executable, "-m", "touch_traversal", "--help"],
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 0)
        for command in ("build", "inspect", "validate", "stats", "studio"):
            self.assertIn(command, result.stdout)

    def test_version_matches_project_metadata(self) -> None:
        metadata = tomllib.loads(Path("pyproject.toml").read_text(encoding="utf-8"))
        result = subprocess.run(
            [sys.executable, "-m", "touch_traversal", "--version"],
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 0)
        self.assertEqual(__version__, metadata["project"]["version"])
        self.assertEqual(result.stdout.strip(), f"touch-traversal {__version__}")

    def test_studio_rejects_a_non_loopback_bind_address(self) -> None:
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            exit_code = main(["studio", "--host", "0.0.0.0"])

        self.assertEqual(exit_code, 2)
        self.assertIn("studio host must be a loopback address", stderr.getvalue())

    def test_build_exports_the_complete_validated_bundle(self) -> None:
        stdout = io.StringIO()
        stderr = io.StringIO()

        semantic_result = (
            EmbeddingBatch(
                model_name="all-MiniLM-L6-v2",
                records=(),
                cache_hits=0,
                cache_misses=0,
            ),
            (),
        )
        exported_bundle = SimpleNamespace(
            graph=SimpleNamespace(nodes=tuple(range(16)), edges=tuple(range(48)))
        )
        with (
            patch("touch_traversal.cli.run_semantic_pipeline", return_value=semantic_result),
            patch("touch_traversal.cli.generate_layouts", return_value=object()),
            patch(
                "touch_traversal.cli.build_artifact_bundle",
                return_value=exported_bundle,
            ) as build_bundle_mock,
            patch(
                "touch_traversal.cli.export_artifacts",
                return_value=tuple(
                    Path(name)
                    for name in (
                        "graph.json",
                        "layouts.json",
                        "manifest.json",
                        "pipeline-report.json",
                    )
                ),
            ),
            patch("touch_traversal.cli.perf_counter", side_effect=(10.0, 42.5)),
            contextlib.redirect_stdout(stdout),
            contextlib.redirect_stderr(stderr),
        ):
            exit_code = main(
                [
                    "build",
                    "--input",
                    "../sample-notes",
                    "--output",
                    "../apps/web/public/data",
                ]
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(stderr.getvalue(), "")
        self.assertIn(
            "graph.json, layouts.json, manifest.json, pipeline-report.json", stdout.getvalue()
        )
        self.assertEqual(build_bundle_mock.call_args.kwargs["build_duration_ms"], 0.0)
        self.assertIn("in 32500.0 ms", stdout.getvalue())

    def test_inspect_reports_the_sample_corpus_without_note_text(self) -> None:
        stdout = io.StringIO()

        with contextlib.redirect_stdout(stdout):
            exit_code = main(["inspect", "--input", "../sample-notes"])

        self.assertEqual(exit_code, 0)
        inspection = json.loads(stdout.getvalue())
        self.assertEqual(inspection["documentCount"], 8)
        self.assertEqual(inspection["markdownCount"], 8)
        self.assertEqual(inspection["textCount"], 0)
        self.assertEqual(len(inspection["documents"]), 8)
        self.assertNotIn("displayText", stdout.getvalue())

    def test_validate_and_stats_accept_a_valid_graph(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            graph_path = Path(directory) / "graph.json"
            graph_path.write_text(_graph().model_dump_json(indent=2), encoding="utf-8")

            validate_stdout = io.StringIO()
            with contextlib.redirect_stdout(validate_stdout):
                validate_exit_code = main(["validate", "--graph", str(graph_path)])

            stats_stdout = io.StringIO()
            with contextlib.redirect_stdout(stats_stdout):
                stats_exit_code = main(["stats", "--graph", str(graph_path)])

        self.assertEqual(validate_exit_code, 0)
        self.assertEqual(
            json.loads(validate_stdout.getvalue()),
            {"edgeCount": 1, "nodeCount": 2, "valid": True},
        )
        self.assertEqual(stats_exit_code, 0)
        statistics = json.loads(stats_stdout.getvalue())
        self.assertEqual(statistics["nodeCount"], 2)
        self.assertEqual(statistics["edgeCount"], 1)
        self.assertEqual(statistics["edgeCounts"]["explicit"], 1)
        self.assertEqual(statistics["isolatedNodeCount"], 0)
        self.assertEqual(statistics["averageDegree"], 1.0)

    def test_validate_reports_artifact_location_and_schema_error(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            graph_path = Path(directory) / "broken.json"
            graph_path.write_text(
                json.dumps({"schemaVersion": 1, "nodes": [], "edges": [{"source": "missing"}]}),
                encoding="utf-8",
            )
            stderr = io.StringIO()

            with contextlib.redirect_stderr(stderr):
                exit_code = main(["validate", "--graph", str(graph_path)])

        self.assertEqual(exit_code, 2)
        self.assertIn(f"invalid graph artifact {graph_path}", stderr.getvalue())
        self.assertIn("edges.0", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
