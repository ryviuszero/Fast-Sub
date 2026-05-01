from __future__ import annotations

from enum import StrEnum
from pathlib import Path

from pydantic import BaseModel, Field


class ProviderType(StrEnum):
    STT = "stt"
    TRANSLATE = "translate"


class ProviderLocation(StrEnum):
    LOCAL = "local"
    API = "api"


class ProviderStatusCode(StrEnum):
    AVAILABLE = "available"
    MISSING_API_KEY = "missing_api_key"
    MISSING_DEPENDENCY = "missing_dependency"
    MISSING_MODEL = "missing_model"
    NOT_IMPLEMENTED = "not_implemented"


class ProviderMetadata(BaseModel):
    id: str
    type: ProviderType
    location: ProviderLocation
    supported_languages: list[str] = Field(default_factory=list)
    supports_word_timestamps: bool = False
    supports_batch: bool = False
    requires_gpu: bool = False
    offline: bool = False
    license: str
    privacy_note: str


class ProviderStatus(BaseModel):
    id: str
    status: ProviderStatusCode
    message: str


class ProviderInfo(BaseModel):
    metadata: ProviderMetadata
    status: ProviderStatus


class ProviderWord(BaseModel):
    start_sec: float = Field(ge=0)
    end_sec: float = Field(ge=0)
    text: str
    confidence: float | None = Field(default=None, ge=0, le=1)


class SttProviderRequest(BaseModel):
    job_id: str
    audio_path: Path
    language: str = "auto"
    model_path: Path | None = None
    model: str | None = None
    device: str = "auto"
    compute_type: str = "auto"
    batch_size: int = Field(default=8, gt=0)
    vad: str = "normal"
    mode: str = "balanced"


class SttProviderSegment(BaseModel):
    start_sec: float = Field(ge=0)
    end_sec: float = Field(ge=0)
    text: str
    confidence: float | None = Field(default=None, ge=0, le=1)
    words: list[ProviderWord] = Field(default_factory=list)


class SttProviderResponse(BaseModel):
    provider: str
    language: str
    elapsed_sec: float | None = Field(default=None, ge=0)
    segments: list[SttProviderSegment]
    warnings: list[str] = Field(default_factory=list)


class TranslationProviderRequest(BaseModel):
    job_id: str
    texts: list[str]
    source_language: str
    target_language: str
    mode: str = "replace"
    model: str | None = None


class TranslationProviderResponse(BaseModel):
    provider: str
    translations: list[str]
    warnings: list[str] = Field(default_factory=list)
