from __future__ import annotations

import hashlib
from pathlib import Path

from platformdirs import user_data_dir

from fast_sub.models import Mode


def input_hash(path: Path) -> str:
    resolved = path.resolve()
    stat = resolved.stat()
    seed = f"{resolved}|{stat.st_size}|{stat.st_mtime_ns}".encode()
    return hashlib.sha256(seed).hexdigest()[:16]


def job_dir(input_file: Path) -> Path:
    return Path(".fast-sub") / "jobs" / input_hash(input_file)


def model_cache_dir() -> Path:
    return Path(user_data_dir("FastSub", "FastSub")) / "models"


def default_output_path(input_file: Path, mode: Mode, source_lang: str, target_lang: str) -> Path:
    stem = input_file.with_suffix("")
    if mode is Mode.ORIGINAL:
        return stem.with_name(f"{stem.name}.{source_lang}.srt")
    if mode is Mode.TRANSLATED:
        return stem.with_name(f"{stem.name}.{target_lang}.srt")
    return stem.with_name(f"{stem.name}.{source_lang}-{target_lang}.bilingual.srt")

