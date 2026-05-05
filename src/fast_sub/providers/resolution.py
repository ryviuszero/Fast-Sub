from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path

from pydantic import BaseModel

from fast_sub.contracts.provider import ProviderLocation, ProviderStatusCode, ProviderType
from fast_sub.model_store.manager import model_path, verify_model
from fast_sub.model_store.manifest import ModelManifestEntry, list_models
from fast_sub.providers.constants import (
    DEFAULT_STT_MODEL,
    DEFAULT_STT_PROVIDER,
    LOCAL_FASTER_WHISPER_PROVIDER,
)
from fast_sub.providers.models import ProviderDefinition, ProviderRegistry
from fast_sub.providers.registry import default_registry

_COMPATIBLE_STT_MODEL_BACKENDS: dict[str, set[str] | None] = {
    LOCAL_FASTER_WHISPER_PROVIDER: {"faster-whisper"},
    "api-openai-transcription": None,
}


class ProviderResolution(BaseModel):
    provider_id: str
    model_id: str
    model_path: Path | None
    provider_type: str
    provider_location: str
    model_backend: str | None
    model_installed: bool
    status: str
    message: str
    local: bool
    privacy_note: str
    action_hint: str | None = None


def resolve_stt_provider(
    provider_id: str = DEFAULT_STT_PROVIDER,
    model_id: str = DEFAULT_STT_MODEL,
    *,
    language: str = "auto",
    device: str = "auto",
    compute_type: str = "auto",
    cache_dir: Path | None = None,
    registry: ProviderRegistry | None = None,
    models: Iterable[ModelManifestEntry] | None = None,
) -> ProviderResolution:
    """Resolve the STT provider/model pair without invoking workers or downloads."""

    del language, device, compute_type
    registry = registry or default_registry()
    definition = registry.get(provider_id)
    if definition is None:
        return _unknown_provider(provider_id, model_id)

    metadata = definition.metadata
    if metadata.type is not ProviderType.STT:
        return ProviderResolution(
            provider_id=provider_id,
            model_id=model_id,
            model_path=None,
            provider_type=metadata.type.value,
            provider_location=metadata.location.value,
            model_backend=None,
            model_installed=False,
            status="incompatible_provider",
            message=(
                f"Provider '{provider_id}' is a {metadata.type.value} provider, "
                "not an STT provider."
            ),
            local=metadata.location is ProviderLocation.LOCAL,
            privacy_note=metadata.privacy_note,
            action_hint="Choose an STT provider from `fast-sub providers list`.",
        )

    if metadata.location is ProviderLocation.API:
        return _resolve_api_stt_provider(registry, definition, model_id)

    model = _find_model(model_id, models if models is not None else list_models())
    if model is None:
        return ProviderResolution(
            provider_id=provider_id,
            model_id=model_id,
            model_path=None,
            provider_type=metadata.type.value,
            provider_location=metadata.location.value,
            model_backend=None,
            model_installed=False,
            status="unknown_model",
            message=f"Unknown model id: {model_id}.",
            local=True,
            privacy_note=metadata.privacy_note,
            action_hint="Run `fast-sub models list` to see available models.",
        )

    path = model_path(model, cache_dir)
    if model.type != "asr":
        return _incompatible_model(
            definition,
            model,
            path,
            f"Model '{model_id}' has type '{model.type}', but STT requires type 'asr'.",
        )

    compatible_backends = _COMPATIBLE_STT_MODEL_BACKENDS.get(provider_id)
    if compatible_backends is not None and model.backend not in compatible_backends:
        expected = ", ".join(sorted(compatible_backends))
        return _incompatible_model(
            definition,
            model,
            path,
            (
                f"Model '{model_id}' uses backend '{model.backend}', but provider "
                f"'{provider_id}' requires backend: {expected}."
            ),
        )

    model_status = verify_model(model, cache_dir)
    if not model_status.installed:
        return ProviderResolution(
            provider_id=provider_id,
            model_id=model_id,
            model_path=path,
            provider_type=metadata.type.value,
            provider_location=metadata.location.value,
            model_backend=model.backend,
            model_installed=False,
            status=ProviderStatusCode.MISSING_MODEL.value,
            message=model_status.message,
            local=True,
            privacy_note=metadata.privacy_note,
            action_hint=f"Run `fast-sub models install {model_id}`.",
        )

    provider_status = registry.inspect(provider_id).status
    if provider_status.status is not ProviderStatusCode.AVAILABLE:
        return ProviderResolution(
            provider_id=provider_id,
            model_id=model_id,
            model_path=path,
            provider_type=metadata.type.value,
            provider_location=metadata.location.value,
            model_backend=model.backend,
            model_installed=True,
            status=provider_status.status.value,
            message=provider_status.message,
            local=True,
            privacy_note=metadata.privacy_note,
            action_hint=_provider_action_hint(definition),
        )

    return ProviderResolution(
        provider_id=provider_id,
        model_id=model_id,
        model_path=path,
        provider_type=metadata.type.value,
        provider_location=metadata.location.value,
        model_backend=model.backend,
        model_installed=True,
        status=ProviderStatusCode.AVAILABLE.value,
        message="Provider and model are available.",
        local=True,
        privacy_note=metadata.privacy_note,
        action_hint=None,
    )


def _resolve_api_stt_provider(
    registry: ProviderRegistry,
    definition: ProviderDefinition,
    model_id: str,
) -> ProviderResolution:
    metadata = definition.metadata
    provider_status = registry.inspect(metadata.id).status
    status = provider_status.status.value
    return ProviderResolution(
        provider_id=metadata.id,
        model_id=model_id,
        model_path=None,
        provider_type=metadata.type.value,
        provider_location=metadata.location.value,
        model_backend=None,
        model_installed=False,
        status=status,
        message=provider_status.message,
        local=False,
        privacy_note=metadata.privacy_note,
        action_hint=None
        if provider_status.status is ProviderStatusCode.AVAILABLE
        else _provider_action_hint(definition),
    )


def _unknown_provider(provider_id: str, model_id: str) -> ProviderResolution:
    return ProviderResolution(
        provider_id=provider_id,
        model_id=model_id,
        model_path=None,
        provider_type="",
        provider_location="",
        model_backend=None,
        model_installed=False,
        status="unknown_provider",
        message=f"Unknown provider id: {provider_id}.",
        local=False,
        privacy_note="",
        action_hint="Run `fast-sub providers list` to see available providers.",
    )


def _incompatible_model(
    definition: ProviderDefinition,
    model: ModelManifestEntry,
    path: Path,
    message: str,
) -> ProviderResolution:
    metadata = definition.metadata
    return ProviderResolution(
        provider_id=metadata.id,
        model_id=model.id,
        model_path=path,
        provider_type=metadata.type.value,
        provider_location=metadata.location.value,
        model_backend=model.backend,
        model_installed=False,
        status="incompatible_model",
        message=message,
        local=metadata.location is ProviderLocation.LOCAL,
        privacy_note=metadata.privacy_note,
        action_hint="Choose an ASR model with a backend compatible with this provider.",
    )


def _provider_action_hint(definition: ProviderDefinition) -> str | None:
    if definition.api_key_env:
        return f"Set {definition.api_key_env} or choose a local provider."
    if definition.dependency_module:
        if definition.install_hint:
            return definition.install_hint
        return f"Install Python module '{definition.dependency_module}' in the worker environment."
    return None


def _find_model(
    model_id: str,
    models: Iterable[ModelManifestEntry],
) -> ModelManifestEntry | None:
    for model in models:
        if model.id == model_id:
            return model
    return None


__all__ = [
    "DEFAULT_STT_MODEL",
    "DEFAULT_STT_PROVIDER",
    "LOCAL_FASTER_WHISPER_PROVIDER",
    "ProviderResolution",
    "resolve_stt_provider",
]
