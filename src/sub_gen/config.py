from __future__ import annotations

import os
import tomllib
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from sub_gen.models import BilingualOrder, Mode, SubtitleFormat


class SttConfig(BaseModel):
    base_url: str | None = Field(default_factory=lambda: os.getenv("OPENAI_BASE_URL"))
    api_key: str | None = Field(default_factory=lambda: os.getenv("OPENAI_API_KEY"))
    model: str | None = None
    temperature: float = 0
    max_audio_mb: float | None = None


class TranslatorConfig(BaseModel):
    service: str = "bing"


class SubtitleConfig(BaseModel):
    mode: Mode | None = Mode.ORIGINAL
    source_lang: str | None = "auto"
    target_lang: str = "en"
    format: SubtitleFormat = SubtitleFormat.SRT
    bilingual_order: BilingualOrder = BilingualOrder.ORIGINAL_FIRST
    max_line_chars: int | None = None


class AppConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")

    stt: SttConfig = SttConfig()
    translator: TranslatorConfig = TranslatorConfig()
    subtitle: SubtitleConfig = SubtitleConfig()


def load_config(path: Path | None) -> AppConfig:
    if path is None:
        return AppConfig()
    with path.open("rb") as file:
        data = tomllib.load(file)
    return AppConfig.model_validate(data)

