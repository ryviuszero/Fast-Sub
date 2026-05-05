from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from pydantic import BaseModel, Field


class Mode(StrEnum):
    ORIGINAL = "original"
    TRANSLATED = "translated"
    BILINGUAL = "bilingual"


@dataclass(frozen=True)
class RefineOptions:
    lang: str = "auto"
    max_chars: int | None = None
    min_duration: float = 1.0
    max_duration: float = 6.0


@dataclass
class SubtitleCue:
    start: int
    end: int
    text: str


class BilingualOrder(StrEnum):
    ORIGINAL_FIRST = "original-first"
    TRANSLATED_FIRST = "translated-first"


class Segment(BaseModel):
    id: int
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    text: str
    translation: str | None = None


__all__ = ["BilingualOrder", "Mode", "RefineOptions", "Segment", "SubtitleCue"]
