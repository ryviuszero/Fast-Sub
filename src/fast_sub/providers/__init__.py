from __future__ import annotations

from fast_sub.providers.constants import (
    DEFAULT_STT_MODEL,
    DEFAULT_STT_PROVIDER,
    LOCAL_FASTER_WHISPER_PROVIDER,
)
from fast_sub.providers.models import ProviderDefinition, ProviderRegistry
from fast_sub.providers.registry import DEFAULT_PROVIDER_DEFINITIONS, default_registry
from fast_sub.providers.resolution import (
    ProviderResolution,
    resolve_stt_provider,
)

__all__ = [
    "DEFAULT_PROVIDER_DEFINITIONS",
    "DEFAULT_STT_MODEL",
    "DEFAULT_STT_PROVIDER",
    "LOCAL_FASTER_WHISPER_PROVIDER",
    "ProviderDefinition",
    "ProviderRegistry",
    "ProviderResolution",
    "default_registry",
    "resolve_stt_provider",
]
