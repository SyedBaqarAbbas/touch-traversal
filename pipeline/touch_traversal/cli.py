"""Command-line contracts for the offline graph pipeline."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from touch_traversal import __version__
from touch_traversal.artifacts import (
    ArtifactValidationError,
    graph_statistics,
    load_artifact,
    validate_artifact_bundle,
)
from touch_traversal.chunking import chunk_corpus
from touch_traversal.config import ConfigurationError, PipelineConfig, load_config
from touch_traversal.documents import SourceDocument
from touch_traversal.embeddings import EmbeddingError, run_semantic_pipeline
from touch_traversal.graph_relations import GraphAssemblyError, assemble_relation_graph
from touch_traversal.ingestion import (
    DocumentIngestionError,
    inspect_documents,
    load_corpus,
)
from touch_traversal.models import GraphArtifact, GraphManifest, LayoutArtifact, PipelineReport
from touch_traversal.relations import generate_nonsemantic_relations

_INVALID_INPUT_EXIT_CODE = 2
_NOT_IMPLEMENTED_EXIT_CODE = 3


def _default_config_path() -> Path:
    source_config = Path(__file__).resolve().parents[1] / "config" / "default.yaml"
    if source_config.is_file():
        return source_config
    return Path(__file__).resolve().parent / "config" / "default.yaml"


_DEFAULT_CONFIG_PATH = _default_config_path()


class CommandInputError(ValueError):
    """An actionable CLI precondition error."""


def build_parser() -> argparse.ArgumentParser:
    """Create the public CLI parser without performing pipeline work."""
    parser = argparse.ArgumentParser(
        prog="touch-traversal",
        description="Build deterministic knowledge graphs from local notes.",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {__version__}",
    )

    commands = parser.add_subparsers(dest="command", metavar="COMMAND")

    build = commands.add_parser(
        "build",
        help="build graph artifacts from a note corpus",
    )
    build.add_argument("--input", type=Path, required=True, help="note corpus directory")
    build.add_argument("--output", type=Path, required=True, help="artifact output directory")
    build.add_argument(
        "--config",
        type=Path,
        default=_DEFAULT_CONFIG_PATH,
        help="pipeline configuration file",
    )

    inspect = commands.add_parser(
        "inspect",
        help="inspect a note corpus before building",
    )
    inspect.add_argument("--input", type=Path, required=True, help="note corpus directory")
    inspect.add_argument(
        "--config",
        type=Path,
        default=_DEFAULT_CONFIG_PATH,
        help="pipeline configuration file",
    )

    validate = commands.add_parser(
        "validate",
        help="validate an exported graph artifact (Milestone 1)",
    )
    validate.add_argument("--graph", type=Path, required=True, help="graph JSON path")
    validate.add_argument("--layouts", type=Path, help="optional layouts JSON path")
    validate.add_argument("--manifest", type=Path, help="optional manifest JSON path")
    validate.add_argument("--report", type=Path, help="optional pipeline report JSON path")

    stats = commands.add_parser(
        "stats",
        help="report statistics for an exported graph (Milestone 1)",
    )
    stats.add_argument("--graph", type=Path, required=True, help="graph JSON path")

    return parser


def _load_source_request(
    input_path: Path, config_path: Path
) -> tuple[PipelineConfig, tuple[SourceDocument, ...]]:
    if not input_path.exists():
        raise CommandInputError(f"input corpus does not exist: {input_path}")
    if not input_path.is_dir():
        raise CommandInputError(f"input corpus must be a directory: {input_path}")
    config = load_config(config_path)
    return config, load_corpus(input_path, config.corpus)


def _run_build(args: argparse.Namespace) -> int:
    input_path: Path = args.input
    output_path: Path = args.output
    config_path: Path = args.config
    if output_path.exists() and not output_path.is_dir():
        raise CommandInputError(f"output path must be a directory: {output_path}")
    config, documents = _load_source_request(input_path, config_path)
    chunks = chunk_corpus(documents, config.chunking)
    relations = generate_nonsemantic_relations(documents, chunks)
    embedding_batch, semantic_relations = run_semantic_pipeline(
        chunks,
        config.embeddings,
        config.semantic,
    )
    graph = assemble_relation_graph(
        chunks,
        (*relations, *semantic_relations),
        config.scoring,
        config.pruning,
        config.clustering,
    )
    print(
        f"error: retained {len(graph.edges)} weighted edges across "
        f"{len(graph.communities)} communities from {len(chunks)} thought chunks "
        f"(average degree {graph.average_degree:.2f}, {len(graph.isolated_node_ids)} isolated) "
        f"with {embedding_batch.model_name}, but deterministic layouts require THO-25.",
        file=sys.stderr,
    )
    return _NOT_IMPLEMENTED_EXIT_CODE


def _run_inspect(args: argparse.Namespace) -> int:
    input_path: Path = args.input
    config_path: Path = args.config
    _, documents = _load_source_request(input_path, config_path)
    print(inspect_documents(documents).model_dump_json(indent=2))
    return 0


def _run_validate(args: argparse.Namespace) -> int:
    graph_path: Path = args.graph
    graph = load_artifact(graph_path, GraphArtifact, "graph")
    layouts = (
        load_artifact(args.layouts, LayoutArtifact, "layouts") if args.layouts is not None else None
    )
    manifest = (
        load_artifact(args.manifest, GraphManifest, "manifest")
        if args.manifest is not None
        else None
    )
    report = (
        load_artifact(args.report, PipelineReport, "report") if args.report is not None else None
    )
    validate_artifact_bundle(graph, layouts, manifest, report)
    print(
        json.dumps(
            {
                "edgeCount": len(graph.edges),
                "nodeCount": len(graph.nodes),
                "valid": True,
            },
            sort_keys=True,
        )
    )
    return 0


def _run_stats(args: argparse.Namespace) -> int:
    graph = load_artifact(args.graph, GraphArtifact, "graph")
    statistics = graph_statistics(graph)
    print(statistics.model_dump_json(indent=2))
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    """Parse and run a pipeline command with user-facing validation errors."""
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.command is None:
        parser.print_help()
        return 0

    try:
        if args.command == "build":
            return _run_build(args)
        if args.command == "inspect":
            return _run_inspect(args)
        if args.command == "validate":
            return _run_validate(args)
        if args.command == "stats":
            return _run_stats(args)
    except (
        ArtifactValidationError,
        CommandInputError,
        ConfigurationError,
        DocumentIngestionError,
        EmbeddingError,
        GraphAssemblyError,
    ) as error:
        print(f"error: {error}", file=sys.stderr)
        return _INVALID_INPUT_EXIT_CODE

    parser.error(f"unknown command: {args.command}")
    return _INVALID_INPUT_EXIT_CODE


if __name__ == "__main__":
    raise SystemExit(main())
