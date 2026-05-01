from __future__ import annotations

from pydantic import BaseModel, Field, HttpUrl


class ModelManifestEntry(BaseModel):
    id: str
    name: str
    type: str
    backend: str
    size_bytes: int = Field(ge=0)
    license: str
    url: HttpUrl
    mirrors: list[HttpUrl] = Field(default_factory=list)
    sha256: str
    recommended_for: str
    filename: str | None = None


MODELS: tuple[ModelManifestEntry, ...] = (
    ModelManifestEntry(
        id="whisper-base",
        name="Whisper Base",
        type="asr",
        backend="faster-whisper",
        size_bytes=145 * 1024 * 1024,
        license="MIT",
        url="https://huggingface.co/Systran/faster-whisper-base/resolve/main/model.bin",
        mirrors=[],
        sha256="d01c3014881c9c6f3133c182f3d2887eb6ca1c789a7538c5c007196857a0a6a9",
        recommended_for="Fast CPU/GPU transcription tests and short videos.",
        filename="model.bin",
    ),
    ModelManifestEntry(
        id="whisper-small",
        name="Whisper Small",
        type="asr",
        backend="faster-whisper",
        size_bytes=484 * 1024 * 1024,
        license="MIT",
        url="https://huggingface.co/Systran/faster-whisper-small/resolve/main/model.bin",
        mirrors=[],
        sha256="3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671",
        recommended_for="Balanced local transcription quality and speed.",
        filename="model.bin",
    ),
    ModelManifestEntry(
        id="whisper-large-v3-turbo",
        name="Whisper Large v3 Turbo",
        type="asr",
        backend="faster-whisper",
        size_bytes=1_620_000_000,
        license="MIT",
        url="https://huggingface.co/h2oai/faster-whisper-large-v3-turbo/resolve/main/model.bin",
        mirrors=[],
        sha256="e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da",
        recommended_for="Higher-quality local transcription on capable machines.",
        filename="model.bin",
    ),
)


def list_models() -> tuple[ModelManifestEntry, ...]:
    return MODELS


def get_model(model_id: str) -> ModelManifestEntry:
    for model in MODELS:
        if model.id == model_id:
            return model
    valid = ", ".join(model.id for model in MODELS)
    raise KeyError(f"Unknown model id: {model_id}. Available models: {valid}")
