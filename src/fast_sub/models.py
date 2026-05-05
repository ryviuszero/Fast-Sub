from __future__ import annotations

from enum import StrEnum

from fast_sub.subtitles.models import BilingualOrder, Mode, Segment
from fast_sub.translation.models import TranslationError, TranslationResult

__all__ = [
    "BilingualOrder",
    "Mode",
    "Segment",
    "SttProvider",
    "SubtitleFormat",
    "TranslationError",
    "TranslationResult",
    "WhisperXComputeType",
    "WhisperXDevice",
]


class SubtitleFormat(StrEnum):
    SRT = "srt"


class SttProvider(StrEnum):
    OPENAI_COMPATIBLE = "openai-compatible"
    WHISPERX = "whisperx"


class WhisperXDevice(StrEnum):
    AUTO = "auto"
    CPU = "cpu"
    CUDA = "cuda"


class WhisperXComputeType(StrEnum):
    AUTO = "auto"
    FLOAT16 = "float16"
    INT8 = "int8"
    FLOAT32 = "float32"
