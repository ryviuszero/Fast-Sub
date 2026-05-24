from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from fast_sub.clients.errors import WebTranslationClientError

HELPER_COMMAND_ENV = "FAST_SUB_WEB_TRANSLATE_HELPER_COMMAND"
HELPER_ARGS_ENV = "FAST_SUB_WEB_TRANSLATE_HELPER_ARGS"

_PUBLIC_ERROR_MESSAGES = {
    "invalid_input": "Web translation request is invalid.",
    "missing_dependency": "Web translation helper is unavailable.",
    "missing_helper": "Web translation helper is unavailable.",
    "missing_node_runtime": "Web translation helper runtime is unavailable.",
    "helper_start_failed": "Web translation helper could not start.",
    "provider_timeout": "Web translation provider timed out.",
    "rate_limited": "Web translation provider rate-limited the request.",
    "region_blocked": "Web translation provider is unavailable from this network region.",
    "provider_response_changed": "Web translation provider response format changed.",
    "provider_failed": "Web translation provider failed.",
}


def translate_text(
    *,
    text: str,
    translator: str,
    from_language: str,
    to_language: str,
    timeout: float | None = None,
) -> str:
    """Translate text through the packaged desktop JS helper."""
    provider = _provider_id(translator)
    command, args = _helper_command()
    payload = json.dumps(
        {
            "schema_version": 1,
            "provider": provider,
            "text": text,
            "from_language": from_language,
            "to_language": to_language,
            "timeout_seconds": _timeout_seconds(timeout),
        },
        ensure_ascii=False,
    )
    try:
        completed = subprocess.run(
            [command, *args],
            input=payload,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=_subprocess_timeout(timeout),
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise WebTranslationClientError(
            f"{provider} helper timed out after {_timeout_seconds(timeout):.1f}s.",
            code="provider_timeout",
        ) from exc
    except OSError as exc:
        raise WebTranslationClientError(
            _public_error_message("helper_start_failed"),
            code="helper_start_failed",
        ) from exc

    stdout = completed.stdout.strip()
    if not stdout:
        raise WebTranslationClientError(
            "Web translation helper returned no JSON output.",
            code="provider_failed",
        )
    try:
        response = json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise WebTranslationClientError(
            "Web translation helper returned invalid JSON output.",
            code="provider_failed",
        ) from exc
    if completed.returncode != 0 and response.get("ok") is not False:
        raise WebTranslationClientError(
            "Web translation helper exited before returning a structured error.",
            code="provider_failed",
        )
    if response.get("ok") is not True:
        error = response.get("error") if isinstance(response.get("error"), dict) else {}
        code = str(error.get("code") or "provider_failed")
        raise WebTranslationClientError(_public_error_message(code), code=code)
    translated = response.get("text")
    if not isinstance(translated, str):
        raise WebTranslationClientError(
            "Web translation helper returned invalid success payload.",
            code="provider_failed",
        )
    return translated


def _helper_command() -> tuple[str, list[str]]:
    command = os.getenv(HELPER_COMMAND_ENV, "").strip()
    if not command:
        raise WebTranslationClientError(
            "Packaged web translation helper is not configured.",
            code="missing_helper",
        )
    command_path = Path(command)
    if command_path.is_absolute() and not command_path.exists():
        raise WebTranslationClientError(
            "Packaged Node/Electron helper runtime is missing.",
            code="missing_node_runtime",
        )
    args = _helper_args()
    for arg in args:
        arg_path = Path(arg)
        if arg_path.is_absolute() and arg_path.suffix.lower() in {".js", ".mjs", ".cjs"}:
            if not arg_path.exists():
                raise WebTranslationClientError(
                    "Packaged web translation helper file is missing.",
                    code="missing_helper",
                )
    return command, args


def _helper_args() -> list[str]:
    raw = os.getenv(HELPER_ARGS_ENV, "").strip()
    if not raw:
        raise WebTranslationClientError(
            "Web translation helper args are missing.",
            code="missing_dependency",
        )
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise WebTranslationClientError(
            "Web translation helper args are not valid JSON.",
            code="missing_dependency",
        ) from exc
    if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
        raise WebTranslationClientError(
            "Web translation helper args must be a JSON string array.",
            code="missing_dependency",
        )
    if not parsed:
        raise WebTranslationClientError(
            "Web translation helper args are empty.",
            code="missing_dependency",
        )
    return parsed


def _provider_id(translator: str) -> str:
    if translator in {"bing", "web-bing"}:
        return "web-bing"
    if translator in {"google", "web-google"}:
        return "web-google"
    raise WebTranslationClientError(
        f"Unsupported web translation provider: {translator}",
        code="invalid_input",
    )


def _timeout_seconds(timeout: float | None) -> float:
    if timeout is None or timeout <= 0:
        return 60.0
    return float(timeout)


def _subprocess_timeout(timeout: float | None) -> float:
    seconds = _timeout_seconds(timeout)
    return seconds + max(0.1, min(5.0, seconds * 0.1))


def _public_error_message(code: str) -> str:
    return _PUBLIC_ERROR_MESSAGES.get(code, _PUBLIC_ERROR_MESSAGES["provider_failed"])


__all__ = [
    "HELPER_ARGS_ENV",
    "HELPER_COMMAND_ENV",
    "translate_text",
]
