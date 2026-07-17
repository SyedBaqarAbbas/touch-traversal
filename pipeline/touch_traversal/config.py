"""Validated configuration for the deterministic graph pipeline."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Literal, Self

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator


class ConfigurationError(ValueError):
    """An actionable error raised while loading pipeline configuration."""


class ConfigModel(BaseModel):
    """Immutable base model for strict configuration sections."""

    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)


class CorpusConfig(ConfigModel):
    include: tuple[str, ...] = ("**/*.md", "**/*.markdown", "**/*.txt")
    exclude: tuple[str, ...] = ()


class ChunkingConfig(ConfigModel):
    min_words: int = Field(ge=1)
    preferred_max_words: int = Field(ge=1)
    hard_max_words: int = Field(ge=1)

    @model_validator(mode="after")
    def validate_word_limits(self) -> Self:
        if not self.min_words <= self.preferred_max_words <= self.hard_max_words:
            raise ValueError("expected min_words <= preferred_max_words <= hard_max_words")
        return self


class EmbeddingConfig(ConfigModel):
    provider: Literal["sentence_transformers"]
    model: str = Field(min_length=1)
    device: str = Field(min_length=1)
    batch_size: int = Field(ge=1)
    normalize: bool = True
    cache_dir: Path


class SemanticConfig(ConfigModel):
    top_k: int = Field(ge=1)
    minimum_similarity: float = Field(ge=0.0, le=1.0)
    mutual_neighbor_bonus: float = Field(ge=0.0, le=1.0)


class ScoringConfig(ConfigModel):
    explicit: float = Field(ge=0.0, le=1.0)
    structural: float = Field(ge=0.0, le=1.0)
    semantic: float = Field(ge=0.0, le=1.0)
    temporal: float = Field(ge=0.0, le=1.0)
    entity: float = Field(ge=0.0, le=1.0)


class PruningConfig(ConfigModel):
    maximum_degree: int = Field(ge=1)
    minimum_score: float = Field(ge=0.0, le=1.0)
    maximum_edges: int = Field(ge=1)
    repair_isolated_nodes: bool = True


class ClusteringConfig(ConfigModel):
    method: Literal["louvain"]
    resolution: float = Field(gt=0.0)
    random_seed: int


class SemanticLayoutConfig(ConfigModel):
    n_neighbors: int = Field(ge=2)
    min_dist: float = Field(ge=0.0, le=1.0)
    metric: Literal["cosine"]


class ClusterLayoutConfig(ConfigModel):
    radius: float = Field(gt=0.0)


class TemporalLayoutConfig(ConfigModel):
    uncertain_date_opacity: float = Field(ge=0.0, le=1.0)
    depth_jitter: float = Field(ge=0.0)


class ForceLayoutConfig(ConfigModel):
    iterations: int = Field(ge=1)
    scale: float = Field(gt=0.0)


class LayoutConfig(ConfigModel):
    random_seed: int
    semantic: SemanticLayoutConfig
    clusters: ClusterLayoutConfig
    temporal: TemporalLayoutConfig
    force: ForceLayoutConfig


class PipelineConfig(ConfigModel):
    corpus: CorpusConfig
    chunking: ChunkingConfig
    embeddings: EmbeddingConfig
    semantic: SemanticConfig
    scoring: ScoringConfig
    pruning: PruningConfig
    clustering: ClusteringConfig
    layouts: LayoutConfig

    def fingerprint(self) -> str:
        """Return a stable SHA-256 fingerprint of validated configuration values."""
        canonical = json.dumps(
            self.model_dump(mode="json"),
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _format_validation_error(error: ValidationError) -> str:
    messages: list[str] = []
    for issue in error.errors(include_url=False):
        location = ".".join(str(part) for part in issue["loc"]) or "configuration"
        messages.append(f"{location}: {issue['msg']}")
    return "; ".join(messages)


def load_config(path: Path) -> PipelineConfig:
    """Load a YAML file and reject malformed or unknown configuration values."""
    try:
        content = path.read_text(encoding="utf-8")
    except FileNotFoundError as error:
        raise ConfigurationError(f"configuration file does not exist: {path}") from error
    except OSError as error:
        raise ConfigurationError(f"could not read configuration file {path}: {error}") from error

    try:
        raw: object = yaml.safe_load(content)
    except yaml.YAMLError as error:
        mark = getattr(error, "problem_mark", None)
        location = ""
        if mark is not None:
            location = f" at line {mark.line + 1}, column {mark.column + 1}"
        raise ConfigurationError(f"invalid YAML in {path}{location}: {error}") from error

    if not isinstance(raw, dict):
        raise ConfigurationError(f"configuration root in {path} must be a mapping")

    try:
        return PipelineConfig.model_validate(raw)
    except ValidationError as error:
        details = _format_validation_error(error)
        raise ConfigurationError(f"invalid configuration in {path}: {details}") from error
