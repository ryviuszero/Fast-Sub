"""Data models for benchmark command options and profile selection."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fast_sub.benchmark.constants import DEFAULT_PROFILE_SPECS
from fast_sub.stt.constants import (
    DEFAULT_GPU_LOAD,
    DEFAULT_LANGUAGE,
    DEFAULT_MODE,
    DEFAULT_MODEL,
    DEFAULT_PROVIDER,
)


@dataclass(frozen=True)
class BenchProfile:
    """A device and compute-type combination to benchmark."""

    name: str
    device: str
    compute_type: str


@dataclass(frozen=True)
class BenchOptions:
    """Options for transcription benchmark runs."""

    provider: str = DEFAULT_PROVIDER
    model: str = DEFAULT_MODEL
    language: str = DEFAULT_LANGUAGE
    mode: str = DEFAULT_MODE
    repeat: int = 1
    gpu_load: str = DEFAULT_GPU_LOAD
    batch_size: int | None = None
    markdown: Path | None = None
    sample_manifest: Path | None = None
    sample_id: str | None = None
    command: list[str] | None = None
    progress: Any | None = None
    profile: str = "all"


DEFAULT_PROFILES = (
    *(
        BenchProfile(name=name, device=device, compute_type=compute_type)
        for name, device, compute_type in DEFAULT_PROFILE_SPECS
    ),
)


@dataclass(frozen=True)
class BenchTranslateOptions:
    """Options for translation benchmark runs."""

    reference: Path
    provider: str
    source_language: str = "auto"
    target_language: str = "zh"
    output_dir: Path | None = None
    markdown: bool = False
    markdown_path: Path | None = None
    repeat: int = 1
    model: str | None = None
    model_path: Path | None = None
    batch_size: int = 8
    timeout: float = 60.0
    sleep_seconds: float = 0.0
    api_key: str | None = None
    base_url: str = "https://api.openai.com/v1"
    command: list[str] | None = None


__all__ = ["BenchOptions", "BenchProfile", "BenchTranslateOptions", "DEFAULT_PROFILES"]
