"""Path helpers for generated subtitles, jobs, and model cache directories."""

from __future__ import annotations

import hashlib
from pathlib import Path

from platformdirs import user_data_dir

from fast_sub.models import Mode
from fast_sub.output.constants import APP_DATA_NAME, JOBS_DIR_PARTS, MODEL_CACHE_DIR_NAME


def input_hash(path: Path) -> str:
    """Return a stable short hash for the current input path metadata."""
    resolved = path.resolve()
    stat = resolved.stat()
    seed = f"{resolved}|{stat.st_size}|{stat.st_mtime_ns}".encode()
    return hashlib.sha256(seed).hexdigest()[:16]


def job_dir(input_file: Path) -> Path:
    """Return the per-input working directory for temporary job files."""
    return Path(*JOBS_DIR_PARTS) / input_hash(input_file)


def model_cache_dir() -> Path:
    """Return the local user data directory used for downloaded models."""
    return Path(user_data_dir(APP_DATA_NAME, appauthor=False)) / MODEL_CACHE_DIR_NAME


def default_output_path(input_file: Path, mode: Mode, source_lang: str, target_lang: str) -> Path:
    """Return the default subtitle output path for the selected output mode."""
    stem = input_file.with_suffix("")
    if mode is Mode.ORIGINAL:
        return stem.with_name(f"{stem.name}.{source_lang}.srt")
    if mode is Mode.TRANSLATED:
        return stem.with_name(f"{stem.name}.{target_lang}.srt")
    return stem.with_name(f"{stem.name}.{source_lang}-{target_lang}.bilingual.srt")
