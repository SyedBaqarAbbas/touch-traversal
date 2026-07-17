from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from touch_traversal.config import ConfigurationError, load_config

DEFAULT_CONFIG = Path("config/default.yaml")


class PipelineConfigTests(unittest.TestCase):
    def test_default_configuration_loads_every_pipeline_section(self) -> None:
        config = load_config(DEFAULT_CONFIG)

        self.assertEqual(config.chunking.min_words, 30)
        self.assertEqual(config.embeddings.model, "all-MiniLM-L6-v2")
        self.assertEqual(config.scoring.explicit, 1.0)
        self.assertEqual(config.pruning.maximum_degree, 12)
        self.assertEqual(config.pruning.target_average_degree, 6.0)
        self.assertEqual(config.clustering.random_seed, 42)
        self.assertEqual(config.layouts.semantic.metric, "cosine")
        self.assertEqual(len(config.fingerprint()), 64)
        self.assertEqual(config.fingerprint(), load_config(DEFAULT_CONFIG).fingerprint())

    def test_invalid_cross_field_values_include_the_configuration_path(self) -> None:
        content = DEFAULT_CONFIG.read_text(encoding="utf-8").replace(
            "preferred_max_words: 180", "preferred_max_words: 20"
        )

        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / "invalid.yaml"
            config_path.write_text(content, encoding="utf-8")

            with self.assertRaisesRegex(
                ConfigurationError,
                r"chunking: Value error, expected min_words <= preferred_max_words",
            ):
                load_config(config_path)

    def test_unknown_configuration_values_are_rejected(self) -> None:
        content = f"{DEFAULT_CONFIG.read_text(encoding='utf-8')}\nunexpected: true\n"

        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / "unknown.yaml"
            config_path.write_text(content, encoding="utf-8")

            with self.assertRaisesRegex(
                ConfigurationError,
                r"unexpected: Extra inputs are not permitted",
            ):
                load_config(config_path)

    def test_yaml_parser_errors_include_line_and_column(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config_path = Path(directory) / "broken.yaml"
            config_path.write_text("chunking: [\n", encoding="utf-8")

            with self.assertRaisesRegex(
                ConfigurationError,
                rf"invalid YAML in {config_path} at line \d+, column \d+",
            ):
                load_config(config_path)


if __name__ == "__main__":
    unittest.main()
