from __future__ import annotations

import importlib.util
import os
from dataclasses import dataclass
from pathlib import Path

from fast_sub.contracts.provider import (
    ProviderInfo,
    ProviderMetadata,
    ProviderStatus,
    ProviderStatusCode,
)


@dataclass(frozen=True)
class ProviderDefinition:
    metadata: ProviderMetadata
    api_key_env: str | None = None
    dependency_module: str | tuple[str, ...] | None = None
    model_path: Path | None = None
    install_hint: str | None = None


class ProviderRegistry:
    def __init__(self, definitions: tuple[ProviderDefinition, ...]) -> None:
        self._definitions = {definition.metadata.id: definition for definition in definitions}

    def list(self) -> list[ProviderInfo]:
        return [self.inspect(provider_id) for provider_id in sorted(self._definitions)]

    def get(self, provider_id: str) -> ProviderDefinition | None:
        return self._definitions.get(provider_id)

    def inspect(self, provider_id: str) -> ProviderInfo:
        definition = self._definitions[provider_id]
        return ProviderInfo(
            metadata=definition.metadata,
            status=self._provider_status(definition),
        )

    def _provider_status(self, definition: ProviderDefinition) -> ProviderStatus:
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


__all__ = ["ProviderDefinition", "ProviderRegistry"]
