"""Constants for generated output paths and subtitle burn settings."""

from __future__ import annotations

APP_DATA_NAME = "FastSub"
MODEL_CACHE_DIR_NAME = "models"
JOBS_DIR_PARTS = (".fast-sub", "jobs")

BURN_OUTPUT_SUFFIX = ".subtitled.mp4"
PREPARED_SUBTITLE_NAME = "subtitle.srt"
SRT_EXTENSION = ".srt"
BURN_WORK_DIR_NAME = "burn"
FFMPEG_BURN_PRESET_ARGS: dict[str, tuple[str, str]] = {
    "fast": ("veryfast", "26"),
    "balanced": ("medium", "23"),
    "quality": ("slow", "20"),
}

__all__ = [
    "APP_DATA_NAME",
    "BURN_OUTPUT_SUFFIX",
    "BURN_WORK_DIR_NAME",
    "FFMPEG_BURN_PRESET_ARGS",
    "JOBS_DIR_PARTS",
    "MODEL_CACHE_DIR_NAME",
    "PREPARED_SUBTITLE_NAME",
    "SRT_EXTENSION",
]
