from __future__ import annotations

import hashlib
import shutil
import uuid
from collections.abc import Iterator
from pathlib import Path

import pytest

from fast_sub.contracts.provider import ProviderLocation, ProviderMetadata, ProviderType
from fast_sub.managers.providers import resolve_stt_provider
from fast_sub.model_store.manifest import ModelManifestEntry
from fast_sub.providers import ProviderDefinition, ProviderRegistry


@pytest.fixture
def work_dir() -> Iterator[Path]:
    path = Path(".test-work") / uuid.uuid4().hex
    path.mkdir(parents=True)
    try:
        yield path
    finally:
        shutil.rmtree(path)


def test_resolves_local_faster_whisper_model(work_dir: Path) -> None:
    payload = b"tiny model"
    model = _model(payload)
    path = work_dir / model.id / "tiny.bin"
    path.parent.mkdir(parents=True)
    path.write_bytes(payload)

    result = resolve_stt_provider(
        "local-faster-whisper",
        "tiny",
        cache_dir=work_dir,
        registry=_registry(_local_stt_provider()),
        models=[model],
    )

    assert result.status == "available"
    assert result.provider_id == "local-faster-whisper"
    assert result.model_id == "tiny"
    assert result.model_path == path
    assert result.provider_type == "stt"
    assert result.provider_location == "local"
    assert result.model_backend == "faster-whisper"
    assert result.model_installed
    assert result.local


def test_missing_local_model_returns_actionable_result(work_dir: Path) -> None:
    result = resolve_stt_provider(
        "local-faster-whisper",
        "tiny",
        cache_dir=work_dir,
        registry=_registry(_local_stt_provider()),
        models=[_model(b"tiny model")],
    )

    assert result.status == "missing_model"
    assert not result.model_installed
    assert result.model_path == work_dir / "tiny" / "tiny.bin"
    assert result.action_hint == "Run `fast-sub models install tiny`."


def test_incompatible_model_backend_is_clear(work_dir: Path) -> None:
    model = _model(b"tiny model", backend="other-backend")

    result = resolve_stt_provider(
        "local-faster-whisper",
        "tiny",
        cache_dir=work_dir,
        registry=_registry(_local_stt_provider()),
        models=[model],
    )

    assert result.status == "incompatible_model"
    assert result.model_backend == "other-backend"
    assert "requires backend: faster-whisper" in result.message


def test_non_asr_model_is_incompatible(work_dir: Path) -> None:
    model = _model(b"tiny model", model_type="translate")

    result = resolve_stt_provider(
        "local-faster-whisper",
        "tiny",
        cache_dir=work_dir,
        registry=_registry(_local_stt_provider()),
        models=[model],
    )

    assert result.status == "incompatible_model"
    assert "type 'translate'" in result.message


def test_translate_provider_is_not_valid_for_stt(work_dir: Path) -> None:
    result = resolve_stt_provider(
        "local-nllb-ct2",
        "tiny",
        cache_dir=work_dir,
        registry=_registry(_translate_provider()),
        models=[_model(b"tiny model")],
    )

    assert result.status == "incompatible_provider"
    assert result.provider_type == "translate"
    assert "not an STT provider" in result.message


def test_unknown_provider_is_clear(work_dir: Path) -> None:
    result = resolve_stt_provider(
        "missing-provider",
        "tiny",
        cache_dir=work_dir,
        registry=_registry(_local_stt_provider()),
        models=[_model(b"tiny model")],
    )

    assert result.status == "unknown_provider"
    assert "missing-provider" in result.message
    assert result.action_hint == "Run `fast-sub providers list` to see available providers."


def test_unknown_model_is_clear(work_dir: Path) -> None:
    result = resolve_stt_provider(
        "local-faster-whisper",
        "missing-model",
        cache_dir=work_dir,
        registry=_registry(_local_stt_provider()),
        models=[_model(b"tiny model")],
    )

    assert result.status == "unknown_model"
    assert "missing-model" in result.message
    assert result.action_hint == "Run `fast-sub models list` to see available models."


def test_dependency_missing_is_reported_after_model_is_installed(work_dir: Path) -> None:
    payload = b"tiny model"
    model = _model(payload)
    path = work_dir / model.id / "tiny.bin"
    path.parent.mkdir(parents=True)
    path.write_bytes(payload)

    result = resolve_stt_provider(
        "local-faster-whisper",
        "tiny",
        cache_dir=work_dir,
        registry=_registry(
            _local_stt_provider(dependency_module="fast_sub_test_missing_dependency")
        ),
        models=[model],
    )

    assert result.status == "missing_dependency"
    assert result.model_installed
    assert "fast_sub_test_missing_dependency" in result.message
    assert "fast_sub_test_missing_dependency" in (result.action_hint or "")


def test_local_asr_missing_dependency_hint_uses_extra(work_dir: Path) -> None:
    payload = b"tiny model"
    model = _model(payload)
    path = work_dir / model.id / "tiny.bin"
    path.parent.mkdir(parents=True)
    path.write_bytes(payload)

    result = resolve_stt_provider(
        "local-faster-whisper",
        "tiny",
        cache_dir=work_dir,
        registry=_registry(
            _local_stt_provider(
                dependency_module="fast_sub_test_missing_dependency",
                install_hint=(
                    "Install local ASR dependencies with `uv sync --extra local-asr` "
                    "or `pip install fast-sub[local-asr]`."
                ),
            )
        ),
        models=[model],
    )

    assert result.status == "missing_dependency"
    assert "local-asr" in (result.action_hint or "")
    assert "uv sync --extra local-asr" in (result.action_hint or "")


def test_api_stt_provider_without_key_is_unavailable_and_does_not_leak_key(
    monkeypatch,
    work_dir: Path,
) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    result = resolve_stt_provider(
        "api-openai-transcription",
        "whisper-small",
        cache_dir=work_dir,
        registry=_registry(_api_stt_provider()),
        models=[],
    )

    encoded = result.model_dump_json()
    assert result.status == "missing_api_key"
    assert result.provider_location == "api"
    assert not result.local
    assert result.model_path is None
    assert "OPENAI_API_KEY" in (result.action_hint or "")
    assert "sk-" not in encoded


def _registry(*definitions: ProviderDefinition) -> ProviderRegistry:
    return ProviderRegistry(tuple(definitions))


def _local_stt_provider(
    dependency_module: str | None = None,
    install_hint: str | None = None,
) -> ProviderDefinition:
    return ProviderDefinition(
        metadata=_metadata(
            "local-faster-whisper",
            ProviderType.STT,
            ProviderLocation.LOCAL,
            "Runs locally; audio is not uploaded by this provider.",
        ),
        dependency_module=dependency_module,
        install_hint=install_hint,
    )


def _api_stt_provider() -> ProviderDefinition:
    return ProviderDefinition(
        metadata=_metadata(
            "api-openai-transcription",
            ProviderType.STT,
            ProviderLocation.API,
            "Uploads prepared audio to the configured OpenAI-compatible API.",
        ),
        api_key_env="OPENAI_API_KEY",
    )


def _translate_provider() -> ProviderDefinition:
    return ProviderDefinition(
        metadata=_metadata(
            "local-nllb-ct2",
            ProviderType.TRANSLATE,
            ProviderLocation.LOCAL,
            "Runs locally; subtitle text is not uploaded by this provider.",
        )
    )


def _metadata(
    provider_id: str,
    provider_type: ProviderType,
    location: ProviderLocation,
    privacy_note: str,
) -> ProviderMetadata:
    return ProviderMetadata(
        id=provider_id,
        type=provider_type,
        location=location,
        supported_languages=["auto", "zh", "en", "ja", "ko"],
        supports_word_timestamps=True,
        supports_batch=True,
        requires_gpu=False,
        offline=location is ProviderLocation.LOCAL,
        license="test",
        privacy_note=privacy_note,
    )


def _model(
    payload: bytes,
    *,
    backend: str = "faster-whisper",
    model_type: str = "asr",
) -> ModelManifestEntry:
    return ModelManifestEntry(
        id="tiny",
        name="Tiny",
        type=model_type,
        backend=backend,
        size_bytes=len(payload),
        license="MIT",
        sha256=hashlib.sha256(payload).hexdigest(),
        recommended_for="tests",
        filename="tiny.bin",
    )
