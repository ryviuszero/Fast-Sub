from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from fast_sub.subtitles.models import BilingualOrder, Mode, Segment


class TranslationProviderError(RuntimeError):
    def __init__(self, code: str, message: str, *, hint: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.hint = hint


@dataclass(frozen=True)
class TranslateOptions:
    provider: str
    source_language: str
    target_language: str
    mode: Mode = Mode.TRANSLATED
    bilingual_order: BilingualOrder = BilingualOrder.ORIGINAL_FIRST
    output: Path | None = None
    model: str | None = None
    model_path: Path | None = None
    batch_size: int = 8
    timeout: float = 60.0
    sleep_seconds: float = 0.0
    resume: bool = True
    api_key: str | None = None
    base_url: str = "https://api.openai.com/v1"


@dataclass(frozen=True)
class TranslateSrtResult:
    srt_path: Path
    provider: str
    source_language: str
    target_language: str
    mode: str
    cues_count: int
    translated_count: int
    failed_count: int
    errors_path: Path | None = None
    checkpoint_path: Path | None = None
    warnings: list[str] | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "srt_path": str(self.srt_path),
            "provider": self.provider,
            "source_language": self.source_language,
            "target_language": self.target_language,
            "mode": self.mode,
            "cues_count": self.cues_count,
            "translated_count": self.translated_count,
            "failed_count": self.failed_count,
            "errors_path": str(self.errors_path) if self.errors_path else None,
            "checkpoint_path": str(self.checkpoint_path) if self.checkpoint_path else None,
            "warnings": self.warnings or [],
        }


class TranslationError(BaseModel):
    batch_start_id: int
    batch_end_id: int
    message: str
    raw_response: str | None = None


class TranslationResult(BaseModel):
    segments: list[Segment]
    errors: list[TranslationError] = Field(default_factory=list)


__all__ = [
    "TranslateOptions",
    "TranslateSrtResult",
    "TranslationError",
    "TranslationProviderError",
    "TranslationResult",
]
