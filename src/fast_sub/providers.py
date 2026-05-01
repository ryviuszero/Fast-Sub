from __future__ import annotations

import importlib.util
import os
from dataclasses import dataclass
from pathlib import Path

from fast_sub.provider_models import (
    ProviderInfo,
    ProviderLocation,
    ProviderMetadata,
    ProviderStatus,
    ProviderStatusCode,
    ProviderType,
)


@dataclass(frozen=True)
class ProviderDefinition:
    metadata: ProviderMetadata
    api_key_env: str | None = None
    dependency_module: str | None = None
    model_path: Path | None = None


DEFAULT_PROVIDER_DEFINITIONS: tuple[ProviderDefinition, ...] = (
    ProviderDefinition(
        metadata=ProviderMetadata(
            id="local-faster-whisper",
            type=ProviderType.STT,
            location=ProviderLocation.LOCAL,
            supported_languages=["auto", "zh", "en", "ja", "ko"],
            supports_word_timestamps=True,
            supports_batch=True,
            requires_gpu=False,
            offline=True,
            license="MIT (faster-whisper), model-dependent",
            privacy_note="Runs locally; audio is not uploaded by this provider.",
        ),
        dependency_module="faster_whisper",
    ),
    ProviderDefinition(
        metadata=ProviderMetadata(
            id="api-openai-transcription",
            type=ProviderType.STT,
            location=ProviderLocation.API,
            supported_languages=["auto", "zh", "en", "ja", "ko"],
            supports_word_timestamps=True,
            supports_batch=False,
            requires_gpu=False,
            offline=False,
            license="OpenAI API terms",
            privacy_note="Uploads prepared audio to the configured OpenAI-compatible API.",
        ),
        api_key_env="OPENAI_API_KEY",
    ),
    ProviderDefinition(
        metadata=ProviderMetadata(
            id="local-nllb-ct2",
            type=ProviderType.TRANSLATE,
            location=ProviderLocation.LOCAL,
            supported_languages=["zh", "en", "ja", "ko"],
            supports_word_timestamps=False,
            supports_batch=True,
            requires_gpu=False,
            offline=True,
            license="Model-dependent",
            privacy_note="Runs locally; subtitle text is not uploaded by this provider.",
        ),
        dependency_module="ctranslate2",
    ),
    ProviderDefinition(
        metadata=ProviderMetadata(
            id="api-openai-chat",
            type=ProviderType.TRANSLATE,
            location=ProviderLocation.API,
            supported_languages=["zh", "en", "ja", "ko"],
            supports_word_timestamps=False,
            supports_batch=True,
            requires_gpu=False,
            offline=False,
            license="OpenAI API terms",
            privacy_note="Uploads subtitle text to the configured OpenAI-compatible API.",
        ),
        api_key_env="OPENAI_API_KEY",
    ),
)


class ProviderRegistry:
    def __init__(
        self,
        definitions: tuple[ProviderDefinition, ...] = DEFAULT_PROVIDER_DEFINITIONS,
    ) -> None:
        self._definitions = {definition.metadata.id: definition for definition in definitions}

    def list(self) -> list[ProviderInfo]:
        return [self.inspect(provider_id) for provider_id in sorted(self._definitions)]

    def get(self, provider_id: str) -> ProviderDefinition | None:
        return self._definitions.get(provider_id)

    def inspect(self, provider_id: str) -> ProviderInfo:
        definition = self._definitions[provider_id]
        return ProviderInfo(
            metadata=definition.metadata,
            status=_provider_status(definition),
        )


def default_registry() -> ProviderRegistry:
    return ProviderRegistry()


def _provider_status(definition: ProviderDefinition) -> ProviderStatus:
    metadata = definition.metadata
    if definition.api_key_env and not os.getenv(definition.api_key_env):
        return ProviderStatus(
            id=metadata.id,
            status=ProviderStatusCode.MISSING_API_KEY,
            message=f"Missing {definition.api_key_env}.",
        )
    dependency_missing = (
        definition.dependency_module
        and importlib.util.find_spec(definition.dependency_module) is None
    )
    if dependency_missing:
        return ProviderStatus(
            id=metadata.id,
            status=ProviderStatusCode.MISSING_DEPENDENCY,
            message=f"Python module '{definition.dependency_module}' is not installed.",
        )
    if definition.model_path and not definition.model_path.exists():
        return ProviderStatus(
            id=metadata.id,
            status=ProviderStatusCode.MISSING_MODEL,
            message=f"Model path does not exist: {definition.model_path}",
        )
    return ProviderStatus(
        id=metadata.id,
        status=ProviderStatusCode.AVAILABLE,
        message="Provider contract is configured.",
    )
