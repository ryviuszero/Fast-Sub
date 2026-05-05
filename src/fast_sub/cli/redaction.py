from __future__ import annotations

import os
import re
from typing import Any


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
