#!/usr/bin/env python3
"""Measure production local-pipeline generation with fictional capacity corpora."""

from __future__ import annotations

import argparse
import json
import platform
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path

from touch_traversal.building import BuildStage, build_corpus_bundle
from touch_traversal.config import load_config
from touch_traversal.embeddings import SentenceTransformerProvider


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("/tmp/touch-traversal-studio-generation.json"),
    )
    return parser.parse_args()


def fictional_note(index: int, count: int) -> str:
    next_index = (index + 1) % count
    cohort = index % 10
    return f"""---
title: Synthetic capacity note {index:03d}
date: 2026-07-{(index % 28) + 1:02d}
sample: true
tags:
  - capacity-benchmark
  - cohort-{cohort}
---

# Synthetic capacity note {index:03d}

This fictional benchmark thought describes a quiet constellation, a paper observatory, and a
repeatable local traversal. It connects to [[Synthetic capacity note {next_index:03d}]] while
sharing cohort {cohort} language for deterministic structural and semantic relationships. No
personal source, filename, identifier, or camera data enters this generated capacity corpus.
"""


def measure_profile(
    *,
    config_path: Path,
    note_count: int,
    profile_id: str,
    provider: SentenceTransformerProvider,
) -> dict[str, object]:
    with tempfile.TemporaryDirectory(prefix="touch-traversal-capacity-") as directory:
        workspace = Path(directory)
        corpus = workspace / profile_id
        corpus.mkdir()
        source_bytes = 0
        for index in range(note_count):
            content = fictional_note(index, note_count)
            source_bytes += len(content.encode("utf-8"))
            (corpus / f"synthetic-{index:03d}.md").write_text(content, encoding="utf-8")

        stages: list[dict[str, object]] = []
        previous_at = time.perf_counter()

        def on_progress(stage: BuildStage) -> None:
            nonlocal previous_at
            now = time.perf_counter()
            if stages:
                stages[-1]["durationMs"] = round((now - previous_at) * 1000, 1)
            stages.append({"stage": stage})
            previous_at = now

        started_at = time.perf_counter()
        bundle = build_corpus_bundle(
            corpus,
            load_config(config_path),
            embedding_cache_dir=workspace / "embedding-cache",
            embedding_provider=provider,
            on_progress=on_progress,
        )
        completed_at = time.perf_counter()
        if stages:
            stages[-1]["durationMs"] = round((completed_at - previous_at) * 1000, 1)

        return {
            "durationMs": round((completed_at - started_at) * 1000, 1),
            "edgeCount": len(bundle.graph.edges),
            "noteCount": note_count,
            "nodeCount": len(bundle.graph.nodes),
            "profile": profile_id,
            "sourceBytes": source_bytes,
            "stages": stages,
        }


def main() -> None:
    args = parse_args()
    if not args.output.resolve().is_relative_to(Path("/tmp").resolve()):
        raise SystemExit("--output must point inside /tmp")

    config_path = Path(__file__).resolve().parents[1] / "pipeline/config/default.yaml"
    config = load_config(config_path)
    provider = SentenceTransformerProvider(
        config.embeddings.model,
        config.embeddings.device,
    )
    profiles = [
        measure_profile(
            config_path=config_path,
            note_count=2,
            profile_id="small-two-note",
            provider=provider,
        ),
        measure_profile(
            config_path=config_path,
            note_count=200,
            profile_id="maximum-file-count-compact",
            provider=provider,
        ),
    ]
    output = {
        "capturedAt": datetime.now(UTC).isoformat(),
        "environment": {
            "machine": platform.machine(),
            "operatingSystem": platform.platform(),
            "python": platform.python_version(),
        },
        "limits": {
            "acceptedCorpusBytes": 16 * 1024 * 1024,
            "fileCount": 200,
            "noteBytes": 2 * 1024 * 1024,
        },
        "model": config.embeddings.model,
        "notes": [
            "Both profiles are generated fictional Markdown and are deleted with their temporary workspaces.",
            "The compact upper profile reaches the 200-file limit, not the 16 MiB byte ceiling.",
            "The model and optional pipeline modules are warmed by the small profile before the 200-file profile.",
        ],
        "profiles": profiles,
        "schemaVersion": 1,
    }
    args.output.write_text(f"{json.dumps(output, indent=2)}\n", encoding="utf-8")
    print(f"Studio generation data written to {args.output}")


if __name__ == "__main__":
    main()
