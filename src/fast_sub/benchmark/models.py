from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fast_sub.stt.constants import (
    DEFAULT_GPU_LOAD,
    DEFAULT_LANGUAGE,
    DEFAULT_MODE,
    DEFAULT_MODEL,
    DEFAULT_PROVIDER,
)

BENCH_PROFILE_CHOICES = {"all", "cpu-int8", "auto"}


@dataclass(frozen=True)
class BenchProfile:
    name: str
    device: str
    compute_type: str


@dataclass(frozen=True)
class BenchOptions:
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
    BenchProfile(name="cpu-int8", device="cpu", compute_type="int8"),
    BenchProfile(name="auto", device="auto", compute_type="auto"),
)


@dataclass(frozen=True)
class BenchTranslateOptions:
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
