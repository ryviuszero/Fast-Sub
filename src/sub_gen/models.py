from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


class Mode(StrEnum):
    ORIGINAL = "original"
    TRANSLATED = "translated"
    BILINGUAL = "bilingual"


class SubtitleFormat(StrEnum):
    SRT = "srt"


class BilingualOrder(StrEnum):
    ORIGINAL_FIRST = "original-first"
    TRANSLATED_FIRST = "translated-first"


class Segment(BaseModel):
    id: int
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    text: str
    translation: str | None = None


class TranslationError(BaseModel):
    batch_start_id: int
    batch_end_id: int
    message: str
    raw_response: str | None = None


class TranslationResult(BaseModel):
    segments: list[Segment]
    errors: list[TranslationError] = Field(default_factory=list)
