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


def _hf_revision_url(repo: str, revision: str) -> str:
    return f"https://huggingface.co/{repo}/resolve/{revision}/"


MODELS: tuple[ModelManifestEntry, ...] = (
    ModelManifestEntry(
        id="whisper-base",
        name="Whisper Base",
        type="asr",
        backend="faster-whisper",
        size_bytes=147_882_941,
        license="MIT",
        url=_hf_revision_url(
            "Systran/faster-whisper-base",
            "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66",
        ),
        mirrors=[],
        recommended_for="Fast CPU/GPU transcription tests and short videos.",
        files=[
            _hf_file(
                "config.json",
                2_309,
                "56a6d8110d311f19c8f0471e562832c7527f146b567275bfca59fcf7c184da9a",
            ),
            _hf_file(
                "model.bin",
                145_217_532,
                "d01c3014881c9c6f3133c182f3d2887eb6ca1c789a7538c5c007196857a0a6a9",
            ),
            _hf_file(
                "tokenizer.json",
                2_203_239,
                "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab",
            ),
            _hf_file(
                "vocabulary.txt",
                459_861,
                "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913",
            ),
        ],
    ),
    ModelManifestEntry(
        id="whisper-small",
        name="Whisper Small",
        type="asr",
        backend="faster-whisper",
        size_bytes=486_212_372,
        license="MIT",
        url=_hf_revision_url(
            "Systran/faster-whisper-small",
            "536b0662742c02347bc0e980a01041f333bce120",
        ),
        mirrors=[],
        recommended_for="Balanced local transcription quality and speed.",
        files=[
            _hf_file(
                "config.json",
                2_370,
                "b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828",
            ),
            _hf_file(
                "model.bin",
                483_546_902,
                "3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671",
            ),
            _hf_file(
                "tokenizer.json",
                2_203_239,
                "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab",
            ),
            _hf_file(
                "vocabulary.txt",
                459_861,
                "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913",
            ),
        ],
    ),
    ModelManifestEntry(
        id="whisper-large-v3-turbo",
        name="Whisper Large v3 Turbo",
        type="asr",
        backend="faster-whisper",
        size_bytes=1_621_665_983,
        license="MIT",
        url=_hf_revision_url(
            "h2oai/faster-whisper-large-v3-turbo",
            "0d50161d23807098c6b7ed53bbb70c7ce02702b9",
        ),
        mirrors=[],
        recommended_for="Higher-quality local transcription on capable machines.",
        files=[
            _hf_file(
                "config.json",
                2_263,
                "b0253ea6c0d3bea6b1e19e91a02acfd3b53f4467362efcb5a3e6b16c9b3a9b7e",
            ),
            _hf_file(
                "model.bin",
                1_617_884_929,
                "e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da",
            ),
            _hf_file(
                "preprocessor_config.json",
                340,
                "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711",
            ),
            _hf_file(
                "tokenizer.json",
                2_710_337,
                "297b13372ac43916285644fb9687add3cc62ee2a1adb60da3dc25cc94c1871fd",
            ),
            _hf_file(
                "vocabulary.json",
                1_068_114,
                "c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1",
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
