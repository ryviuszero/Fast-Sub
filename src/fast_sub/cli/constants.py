"""Constants shared by the CLI entry point and command modules."""

from __future__ import annotations

import re

COMMAND_NAMES = {
    "analyze",
    "auto",
    "bench",
    "bench-translate",
    "bench-translate-manifest",
    "bench-manifest",
    "burn",
    "doctor",
    "extract",
    "probe",
    "providers",
    "refine",
    "run",
    "models",
    "transcribe",
    "translate",
}
OPENAI_BASE_URL = "https://api.openai.com/v1"
OPENAI_DEFAULT_STT_MODEL = "whisper-1"
OPENAI_DEFAULT_MAX_AUDIO_MB = 25.0
WHISPERX_DEFAULT_STT_MODEL = "small"
OPENAI_TRANSCRIBE_JSON_ONLY_MODELS = {
    "gpt-4o-transcribe",
    "gpt-4o-mini-transcribe",
    "gpt-4o-transcribe-diarize",
}
LANGUAGE_CODE_PATTERN = re.compile(r"^[a-z]{2,3}(?:-[A-Za-z0-9]+)?$")
DIRECTORY_PROGRESS_FILE = ".fast-sub-progress.json"

__all__ = [
    "COMMAND_NAMES",
    "DIRECTORY_PROGRESS_FILE",
    "LANGUAGE_CODE_PATTERN",
    "OPENAI_BASE_URL",
    "OPENAI_DEFAULT_MAX_AUDIO_MB",
    "OPENAI_DEFAULT_STT_MODEL",
    "OPENAI_TRANSCRIBE_JSON_ONLY_MODELS",
    "WHISPERX_DEFAULT_STT_MODEL",
]
