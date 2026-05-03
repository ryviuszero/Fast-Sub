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
    dependency_module: str | tuple[str, ...] | None = None
    model_path: Path | None = None
    install_hint: str | None = None


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
        install_hint=(
            "Install local ASR dependencies with `uv sync --extra local-asr` "
            "or `pip install fast-sub[local-asr]`."
        ),
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
        dependency_module=("ctranslate2", "sentencepiece"),
        install_hint="Install local translation dependencies with the local translate extra.",
    ),
    ProviderDefinition(
        metadata=ProviderMetadata(
            id="web-bing",
            type=ProviderType.TRANSLATE,
            location=ProviderLocation.REMOTE_WEB,
            supported_languages=["auto", "zh", "en", "ja", "ko"],
            supports_word_timestamps=False,
            supports_batch=False,
            requires_gpu=False,
            offline=False,
            license="GPL-3.0 dependency: translators",
            privacy_note=(
                "Uploads subtitle text to a third-party web translation service; "
                "rate limits and terms are controlled by that service."
            ),
        ),
        dependency_module="translators",
        install_hint="Install web translation support with `uv sync --extra web-translate`.",
    ),
    ProviderDefinition(
        metadata=ProviderMetadata(
            id="web-google",
            type=ProviderType.TRANSLATE,
            location=ProviderLocation.REMOTE_WEB,
            supported_languages=["auto", "zh", "en", "ja", "ko"],
            supports_word_timestamps=False,
            supports_batch=False,
            requires_gpu=False,
            offline=False,
            license="GPL-3.0 dependency: translators",
            privacy_note=(
                "Uploads subtitle text to Google web translation through translators; "
                "mainland China access may fail, try web-bing if needed."
            ),
        ),
        dependency_module="translators",
        install_hint="Install web translation support with `uv sync --extra web-translate`.",
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
    missing_dependency = _missing_dependency_module(definition)
    if missing_dependency:
        return ProviderStatus(
            id=metadata.id,
            status=ProviderStatusCode.MISSING_DEPENDENCY,
            message=_missing_dependency_message(definition, missing_dependency),
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


def _missing_dependency_module(definition: ProviderDefinition) -> str | None:
    modules = definition.dependency_module
    if modules is None:
        return None
    if isinstance(modules, str):
        modules = (modules,)
    for module in modules:
        if importlib.util.find_spec(module) is None:
            return module
    return None


def _missing_dependency_message(definition: ProviderDefinition, module: str) -> str:
    message = f"Python module '{module}' is not installed."
    if definition.install_hint:
        return f"{message} {definition.install_hint}"
    return message
