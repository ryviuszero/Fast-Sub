from __future__ import annotations

from pydantic import BaseModel, Field, HttpUrl


class ModelManifestFile(BaseModel):
    path: str
    size_bytes: int = Field(ge=0)
    sha256: str
    url: HttpUrl | None = None
    mirrors: list[HttpUrl] = Field(default_factory=list)


class ModelManifestEntry(BaseModel):
    id: str
    name: str
    type: str
    backend: str
    size_bytes: int = Field(ge=0)
    license: str
    url: HttpUrl | None = None
    mirrors: list[HttpUrl] = Field(default_factory=list)
    sha256: str | None = None
    recommended_for: str
    filename: str | None = None
    files: list[ModelManifestFile] = Field(default_factory=list)

    @property
    def manifest_type(self) -> str:
        return "directory" if self.files else "file"

    @property
    def required_file_count(self) -> int:
        return len(self.files) if self.files else 1


def _hf_file(path: str, size_bytes: int, sha256: str) -> ModelManifestFile:
    return ModelManifestFile(path=path, size_bytes=size_bytes, sha256=sha256)


MODELS: tuple[ModelManifestEntry, ...] = (
    ModelManifestEntry(
        id="whisper-base",
        name="Whisper Base",
        type="asr",
        backend="faster-whisper",
        size_bytes=145 * 1024 * 1024,
        license="MIT",
        url="https://huggingface.co/Systran/faster-whisper-base/resolve/main/",
        mirrors=[],
        recommended_for="Fast CPU/GPU transcription tests and short videos.",
        files=[
            _hf_file(
                "config.json",
                2_310,
                "91ed5c5600597d52c329b9de2358941562702d469ad90ef500b6a5eb4e09ed35",
            ),
            _hf_file(
                "model.bin",
                145 * 1024 * 1024,
                "d01c3014881c9c6f3133c182f3d2887eb6ca1c789a7538c5c007196857a0a6a9",
            ),
            _hf_file(
                "tokenizer.json",
                2_200_000,
                "ae3f02f058bd3b1c3a8a2bc7e4b9f5f6d0c910f53dceefa747b322e34895de6f",
            ),
            _hf_file(
                "vocabulary.txt",
                460_000,
                "56a601756d89eb05793e4e58d0e1634d81a29e023cc77de7bb405ed388abbd30",
            ),
        ],
    ),
    ModelManifestEntry(
        id="whisper-small",
        name="Whisper Small",
        type="asr",
        backend="faster-whisper",
        size_bytes=484 * 1024 * 1024,
        license="MIT",
        url="https://huggingface.co/Systran/faster-whisper-small/resolve/main/",
        mirrors=[],
        recommended_for="Balanced local transcription quality and speed.",
        files=[
            _hf_file(
                "config.json",
                2_310,
                "b8d99602f5f1295e178f6f09af8a7b895c0c141d0b7425a4b20ff6ae36832be4",
            ),
            _hf_file(
                "model.bin",
                484 * 1024 * 1024,
                "3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671",
            ),
            _hf_file(
                "tokenizer.json",
                2_200_000,
                "ae3f02f058bd3b1c3a8a2bc7e4b9f5f6d0c910f53dceefa747b322e34895de6f",
            ),
            _hf_file(
                "vocabulary.txt",
                460_000,
                "56a601756d89eb05793e4e58d0e1634d81a29e023cc77de7bb405ed388abbd30",
            ),
        ],
    ),
    ModelManifestEntry(
        id="whisper-large-v3-turbo",
        name="Whisper Large v3 Turbo",
        type="asr",
        backend="faster-whisper",
        size_bytes=1_620_000_000,
        license="MIT",
        url="https://huggingface.co/h2oai/faster-whisper-large-v3-turbo/resolve/main/",
        mirrors=[],
        recommended_for="Higher-quality local transcription on capable machines.",
        files=[
            _hf_file(
                "config.json",
                2_350,
                "1dba7c39e6d84e77ac40c691396d6c981f2089f51f571ece58c31237c65d6d4f",
            ),
            _hf_file(
                "model.bin",
                1_620_000_000,
                "e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da",
            ),
            _hf_file(
                "tokenizer.json",
                2_200_000,
                "ae3f02f058bd3b1c3a8a2bc7e4b9f5f6d0c910f53dceefa747b322e34895de6f",
            ),
            _hf_file(
                "vocabulary.txt",
                460_000,
                "56a601756d89eb05793e4e58d0e1634d81a29e023cc77de7bb405ed388abbd30",
            ),
        ],
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
