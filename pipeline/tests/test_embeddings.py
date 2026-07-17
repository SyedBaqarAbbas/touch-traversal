from __future__ import annotations

import math
import tempfile
import unittest
from collections.abc import Sequence
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from touch_traversal.chunking import chunk_corpus
from touch_traversal.config import load_config
from touch_traversal.embeddings import (
    EmbeddingBatch,
    EmbeddingRecord,
    SentenceTransformerProvider,
    embed_chunks,
    generate_semantic_relations,
)
from touch_traversal.ingestion import load_corpus


class _FakeProvider:
    def __init__(self, model_name: str) -> None:
        self.model_name = model_name
        self.calls: list[tuple[tuple[str, ...], int]] = []

    def encode(
        self,
        texts: Sequence[str],
        *,
        batch_size: int,
    ) -> tuple[tuple[float, ...], ...]:
        self.calls.append((tuple(texts), batch_size))
        return tuple((float(index + 1), 1.0, 0.5) for index, _text in enumerate(texts))


class LocalEmbeddingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = load_config(Path("config/default.yaml"))
        documents = load_corpus(Path("../sample-notes"), self.config.corpus)
        self.chunks = chunk_corpus(documents, self.config.chunking)[:3]

    def test_embedding_cache_avoids_reencoding_and_vectors_are_normalized(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            embedding_config = self.config.embeddings.model_copy(
                update={"cache_dir": Path(directory) / "embeddings"}
            )
            first_provider = _FakeProvider(embedding_config.model)
            first = embed_chunks(self.chunks, embedding_config, first_provider)
            second_provider = _FakeProvider(embedding_config.model)
            second = embed_chunks(self.chunks, embedding_config, second_provider)
            cache_files = tuple((Path(directory) / "embeddings").rglob("*.json"))

        self.assertEqual(len(first_provider.calls), 1)
        self.assertEqual(first_provider.calls[0][1], embedding_config.batch_size)
        self.assertEqual(second_provider.calls, [])
        self.assertEqual(first.cache_hits, 0)
        self.assertEqual(first.cache_misses, 3)
        self.assertEqual(second.cache_hits, 3)
        self.assertEqual(second.cache_misses, 0)
        self.assertEqual(first.records, second.records)
        self.assertEqual(
            [record.chunk_id for record in first.records], sorted(c.id for c in self.chunks)
        )
        self.assertEqual(len(cache_files), 3)
        for record in first.records:
            magnitude = math.sqrt(sum(value * value for value in record.vector))
            self.assertAlmostEqual(magnitude, 1.0)

    def test_sentence_transformer_adapter_batches_and_requests_normalized_vectors(self) -> None:
        calls: list[tuple[object, ...]] = []

        class FakeModel:
            def __init__(self, model_name: str, *, device: str) -> None:
                calls.append(("init", model_name, device))

            def encode(self, texts: list[str], **kwargs: object) -> list[list[float]]:
                calls.append(("encode", tuple(texts), kwargs))
                return [[3.0, 4.0] for _text in texts]

        module = SimpleNamespace(SentenceTransformer=FakeModel)
        with patch("touch_traversal.embeddings.import_module", return_value=module):
            provider = SentenceTransformerProvider("fixture-model", "cpu")
            vectors = provider.encode(("first", "second"), batch_size=2)

        self.assertEqual(calls[0], ("init", "fixture-model", "cpu"))
        self.assertEqual(vectors, ((3.0, 4.0), (3.0, 4.0)))
        encode_options = calls[1][2]
        assert isinstance(encode_options, dict)
        self.assertEqual(encode_options["batch_size"], 2)
        self.assertEqual(encode_options["normalize_embeddings"], True)
        self.assertEqual(encode_options["show_progress_bar"], False)

    def test_semantic_candidates_apply_top_k_threshold_and_mutual_preference(self) -> None:
        embeddings = EmbeddingBatch(
            model_name="fixture-model",
            records=(
                EmbeddingRecord(chunk_id="c", text_hash="c" * 64, vector=(0.0, 1.0)),
                EmbeddingRecord(chunk_id="a", text_hash="a" * 64, vector=(1.0, 0.0)),
                EmbeddingRecord(
                    chunk_id="b",
                    text_hash="b" * 64,
                    vector=(0.9, math.sqrt(0.19)),
                ),
            ),
            cache_hits=0,
            cache_misses=3,
        )
        semantic_config = self.config.semantic.model_copy(
            update={"top_k": 1, "minimum_similarity": 0.4, "mutual_neighbor_bonus": 0.1}
        )

        relations = generate_semantic_relations(embeddings, semantic_config)
        by_pair = {(relation.source, relation.target): relation for relation in relations}

        self.assertEqual(set(by_pair), {("a", "b"), ("b", "c")})
        self.assertAlmostEqual(by_pair[("a", "b")].score, 1.0)
        self.assertAlmostEqual(by_pair[("a", "b")].evidence.similarity or 0.0, 0.9)
        self.assertIn("mutual top-K", by_pair[("a", "b")].evidence.description)
        self.assertLess(by_pair[("b", "c")].score, by_pair[("a", "b")].score)
        self.assertIn("one top-K", by_pair[("b", "c")].evidence.description)


if __name__ == "__main__":
    unittest.main()
