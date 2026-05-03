from __future__ import annotations

import os
import tomllib
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from fast_sub.models import (
    BilingualOrder,
    Mode,
    SttProvider,
    SubtitleFormat,
    WhisperXComputeType,
    WhisperXDevice,
)


def load_dotenv(path: Path | None = None) -> dict[str, str]:
    dotenv_path = path or Path.cwd() / ".env"
    try:
        lines = dotenv_path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return {}

    loaded: dict[str, str] = {}
    for line in lines:
        parsed = _parse_dotenv_line(line)
        if parsed is None:
            continue
        key, value = parsed
        if key in os.environ:
            continue
        os.environ[key] = value
        loaded[key] = value
    return loaded


def _parse_dotenv_line(line: str) -> tuple[str, str] | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return None
    if stripped.startswith("export "):
        stripped = stripped[len("export ") :].lstrip()
    if "=" not in stripped:
        return None

    key, value = stripped.split("=", 1)
    key = key.strip()
    if not key or not key.replace("_", "").isalnum() or key[0].isdigit():
        return None
    value = _strip_dotenv_value(value.strip())
    return key, value


def _strip_dotenv_value(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    if "#" in value:
        value = value.split("#", 1)[0].rstrip()
    return value


class SttConfig(BaseModel):
    provider: SttProvider = SttProvider.OPENAI_COMPATIBLE
    base_url: str | None = Field(default_factory=lambda: os.getenv("OPENAI_BASE_URL"))
    api_key: str | None = Field(default_factory=lambda: os.getenv("OPENAI_API_KEY"))
    model: str | None = None
    temperature: float = 0
    max_audio_mb: float | None = None
    whisperx_device: WhisperXDevice = WhisperXDevice.AUTO
    whisperx_compute_type: WhisperXComputeType = WhisperXComputeType.AUTO
    whisperx_batch_size: int = 16


class TranslatorConfig(BaseModel):
    provider: str | None = None
    service: str = "bing"
    model: str | None = None
    base_url: str | None = Field(default_factory=lambda: os.getenv("OPENAI_BASE_URL"))
    api_key_env: str = "OPENAI_API_KEY"
    model_path: str | None = None
    batch_size: int = 8
    timeout: float = 60
    sleep_seconds: float = 0


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

