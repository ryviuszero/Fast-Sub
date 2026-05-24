from __future__ import annotations

import importlib.util

from fast_sub.contracts.provider import (
    ProviderLocation,
    ProviderMetadata,
    ProviderStatus,
    ProviderStatusCode,
    ProviderType,
)
from fast_sub.providers.models import ProviderDefinition, ProviderRegistry

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
            license="Packaged JS helper dependency: bing-translate-api (MIT)",
            privacy_note=(
                "Uploads subtitle text to Bing web translation through a no-key "
                "packaged helper; experimental and best-effort, with rate limits, "
                "regional access, and upstream page changes controlled by the service."
            ),
        ),
        install_hint=(
            "Run web translation through the packaged desktop helper or set "
            "FAST_SUB_WEB_TRANSLATE_HELPER_COMMAND and FAST_SUB_WEB_TRANSLATE_HELPER_ARGS."
        ),
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
            license="Packaged JS helper dependency: @vitalets/google-translate-api (MIT)",
            privacy_note=(
                "Uploads subtitle text to Google web translation through a no-key "
                "packaged helper; experimental and best-effort, with rate limits, "
                "regional access, and upstream page changes controlled by the service."
            ),
        ),
        install_hint=(
            "Run web translation through the packaged desktop helper or set "
            "FAST_SUB_WEB_TRANSLATE_HELPER_COMMAND and FAST_SUB_WEB_TRANSLATE_HELPER_ARGS."
        ),
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
    ),
)


class DefaultProviderRegistry(ProviderRegistry):
    def __init__(
        self,
        definitions: tuple[ProviderDefinition, ...] = DEFAULT_PROVIDER_DEFINITIONS,
    ) -> None:
        super().__init__(definitions)

    def _provider_status(self, definition: ProviderDefinition) -> ProviderStatus:
        return _provider_status(definition)


def default_registry() -> ProviderRegistry:
    return DefaultProviderRegistry()


def _provider_status(definition: ProviderDefinition) -> ProviderStatus:
    metadata = definition.metadata
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


__all__ = [
    "DEFAULT_PROVIDER_DEFINITIONS",
    "DefaultProviderRegistry",
    "default_registry",
]
