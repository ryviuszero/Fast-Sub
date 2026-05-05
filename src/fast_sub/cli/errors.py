from __future__ import annotations

from typing import Any

from fast_sub.cli.redaction import redact_value

EXIT_CODE_BY_ERROR_CODE = {
    "invalid_input": 2,
    "missing_dependency": 3,
    "missing_model": 4,
    "download_failed": 5,
    "gpu_oom": 6,
    "ffmpeg_failed": 7,
    "invalid_provider": 8,
    "provider_failed": 9,
}


def error_payload(
    *,
    code: str,
    stage: str,
    message: str,
    action_hint: str | None = None,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the structured error payload emitted by JSON CLI commands."""
    payload: dict[str, Any] = {
        "ok": False,
        "error": {
            "code": code,
            "stage": stage,
            "message": message,
        },
    }
    if action_hint:
        payload["error"]["action_hint"] = action_hint
    if details:
        payload["error"]["details"] = redact_value(details)
    return redact_value(payload)


def json_error_for_exception(exc: BaseException, *, stage: str, code: str) -> dict[str, Any]:
    """Convert an exception into the standard JSON CLI error shape."""
    return error_payload(
        code=classify_error_code(str(exc), fallback=code),
        stage=stage,
        message=str(exc),
        action_hint=action_hint_for_message(str(exc)),
    )


def exit_code_for_payload(payload: dict[str, Any]) -> int:
    """Map a structured error payload to a process exit code."""
    error = payload.get("error", {})
    code = str(error.get("code", "")).lower()
    stage = str(error.get("stage", "")).lower()
    if (
        code in {"invalid_input", "invalid_options", "invalid_usage", "invalid_provider"}
        or stage == "input"
    ):
        return 2
    if code in {"missing_dependency", "ffmpeg_failed", "ffprobe_failed"}:
        return 3
    if code in {"missing_model", "model_not_found"}:
        return 4
    if code in {"download_failed", "checksum_failed", "cache_failed"}:
        return 5
    return 1


def classify_error_code(message: str, *, fallback: str) -> str:
    """Infer a stable CLI error code from a human-readable message."""
    lower = message.lower()
    if "input file does not exist" in lower or "unsupported input file type" in lower:
        return "invalid_input"
    if "input path is not a file" in lower or "no audio stream" in lower:
        return "invalid_input"
    if "missing_model" in lower or "model is not installed" in lower:
        return "missing_model"
    if "models install" in lower or "model directory is missing" in lower:
        return "missing_model"
    if "ffmpeg" in lower or "ffprobe" in lower:
        return "missing_dependency"
    if "local-asr" in lower or "faster_whisper" in lower or "not installed" in lower:
        return "missing_dependency"
    if "checksum" in lower:
        return "checksum_failed"
    if "download" in lower:
        return "download_failed"
    return fallback.lower()


def action_hint_for_message(message: str) -> str | None:
    """Return a remediation hint for common CLI error messages."""
    lower = message.lower()
    if "faster_whisper" in lower:
        return (
            "Install local ASR dependencies with `uv sync --extra local-asr` "
            "or `pip install fast-sub[local-asr]`."
        )
    if "missing_model" in lower or "model is not installed" in lower or "models install" in lower:
        import re

        match = re.search(r"whisper-[A-Za-z0-9_.-]+", message)
        model_id = match.group(0) if match else "whisper-small"
        return f"Run `fast-sub models install {model_id}` or `fast-sub auto --yes`."
    return None
