from __future__ import annotations

import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import typer
from rich.console import Console

from fast_sub.contracts.errors import SubGenError

console = Console()
err_console = Console(stderr=True)


@dataclass(frozen=True)
class CliContext:
    """Shared CLI rendering and workspace options."""

    json_output: bool = False
    workdir: Path | None = None
    verbose: bool = False


def echo_json(payload: Any, *, pretty: bool = False, indent: int | None = None) -> None:
    """Print a JSON payload using the CLI's UTF-8 friendly formatting."""
    json_indent = indent if indent is not None else (2 if pretty else None)
    text = json.dumps(payload, ensure_ascii=False, indent=json_indent)
    try:
        sys.stdout.buffer.write(text.encode("utf-8", errors="replace") + b"\n")
        sys.stdout.flush()
    except AttributeError:
        typer.echo(text)


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


def validate_positive(value: float | int, option: str) -> None:
    """Raise a CLI error when a numeric option is not positive."""
    if value <= 0:
        raise SubGenError(f"{option} must be greater than 0.")


__all__ = [
    "CliContext",
    "console",
    "echo_json",
    "err_console",
    "redact_secrets",
    "redact_value",
    "validate_positive",
]
