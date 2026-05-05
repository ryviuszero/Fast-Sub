from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import typer
from rich.console import Console


console = Console()
err_console = Console(stderr=True)


@dataclass(frozen=True)
class CliContext:
    """Shared CLI rendering and workspace options."""

    json_output: bool = False
    workdir: Path | None = None
    verbose: bool = False


def echo_json(payload: Any, *, pretty: bool = False) -> None:
    """Print a JSON payload using the CLI's UTF-8 friendly formatting."""
    indent = 2 if pretty else None
    typer.echo(json.dumps(payload, ensure_ascii=False, indent=indent))


def redact_value(value: Any) -> Any:
    """Redact secrets recursively from strings, lists, and dictionaries."""
    if isinstance(value, str):
        return redact_secrets(value)
    if isinstance(value, list):
        return [redact_value(item) for item in value]
    if isinstance(value, dict):
        return {key: redact_value(item) for key, item in value.items()}
    return value


def redact_secrets(message: str) -> str:
    """Replace API keys and token-like values in a CLI message."""
    redacted = message
    for key, value in os.environ.items():
        if not value:
            continue
        key_lower = key.lower()
        looks_secret = any(marker in key_lower for marker in ("key", "token", "secret"))
        if looks_secret and len(value) >= 8:
            redacted = redacted.replace(value, "[redacted]")
    redacted = re.sub(r"(?i)(authorization:\s*bearer\s+)([^\s]+)", r"\1[redacted]", redacted)
    redacted = re.sub(r"sk-[A-Za-z0-9_-]{8,}", "sk-[redacted]", redacted)
    redacted = re.sub(r"(?i)(api[_-]?key|token)=([^&\s]+)", r"\1=[redacted]", redacted)
    return redacted


__all__ = [
    "CliContext",
    "console",
    "echo_json",
    "err_console",
    "redact_secrets",
    "redact_value",
]
