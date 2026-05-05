"""Data models for the automatic subtitle pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

from fast_sub.pipeline.constants import DEFAULT_REFINE_MAX_DURATION
from fast_sub.stt.constants import (
    DEFAULT_COMPUTE_TYPE,
    DEFAULT_DEVICE,
    DEFAULT_GPU_LOAD,
    DEFAULT_LANGUAGE,
    DEFAULT_MODE,
    DEFAULT_MODEL,
    DEFAULT_PROVIDER,
    DEFAULT_VAD,
)

if TYPE_CHECKING:
    from fast_sub.stt.service import TranscribeResult


@dataclass(frozen=True)
class AutoOptions:
    """User-selected options for the local auto pipeline."""

    provider: str = DEFAULT_PROVIDER
    model: str = DEFAULT_MODEL
    language: str = DEFAULT_LANGUAGE
    device: str = DEFAULT_DEVICE
    compute_type: str = DEFAULT_COMPUTE_TYPE
    batch_size: int | None = None
    gpu_load: str = DEFAULT_GPU_LOAD
    vad: str = DEFAULT_VAD
    mode: str = DEFAULT_MODE
    output: Path | None = None
    dry_run: bool = False
    yes: bool = False
    keep_temp: bool = False
    refine_max_chars: int | None = None
    refine_max_duration: float = DEFAULT_REFINE_MAX_DURATION
    worker_command: list[str | Path] | None = None


@dataclass(frozen=True)
class AutoStep:
    """One status entry emitted by the auto pipeline."""

    name: str
    status: str
    message: str
    action_hint: str | None = None
    details: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        """Return a JSON-friendly representation of the pipeline step."""
        data: dict[str, Any] = {
            "name": self.name,
            "status": self.status,
            "message": self.message,
        }
        if self.action_hint:
            data["action_hint"] = self.action_hint
        if self.details:
            data["details"] = self.details
        return data


@dataclass(frozen=True)
class AutoResult:
    """Final result and step history for an auto pipeline run."""

    ok: bool
    input: Path
    output: Path
    provider: str
    model: str
    language: str
    dry_run: bool
    steps: list[AutoStep]
    elapsed_sec: float
    error: str | None = None
    transcribe_result: TranscribeResult | None = None

    def as_dict(self) -> dict[str, Any]:
        """Return a JSON-friendly auto pipeline result."""
        data: dict[str, Any] = {
            "ok": self.ok,
            "input": str(self.input),
            "output": str(self.output),
            "provider": self.provider,
            "model": self.model,
            "language": self.language,
            "dry_run": self.dry_run,
            "elapsed_sec": self.elapsed_sec,
            "steps": [step.as_dict() for step in self.steps],
        }
        if self.error:
            error_step = next((step for step in reversed(self.steps) if step.status != "ok"), None)
            error_info = _auto_error_info(self.error, error_step)
            data["error"] = {
                "code": error_info["code"],
                "stage": error_info["stage"],
                "message": self.error,
                "action_hint": error_info["action_hint"],
                "details": error_step.details if error_step else {},
            }
        if self.transcribe_result is not None:
            data["transcribe"] = self.transcribe_result.as_dict()
        return data


def _auto_error_code(status: str) -> str:
    if status in {"missing_model", "missing_dependency"}:
        return status
    if status in {"unknown_model", "unsupported_api_provider"}:
        return status
    if status == "error":
        return "command_failed"
    return status or "command_failed"


def _auto_error_info(message: str, step: AutoStep | None) -> dict[str, str | None]:
    if step is None:
        return {"code": "command_failed", "stage": "auto", "action_hint": None}
    if step.status != "error":
        return {
            "code": _auto_error_code(step.status),
            "stage": step.name,
            "action_hint": step.action_hint,
        }

    code = _classify_auto_error_message(message)
    return {
        "code": code,
        "stage": _auto_error_stage(code, step.name),
        "action_hint": step.action_hint or _auto_action_hint(message, code),
    }


def _classify_auto_error_message(message: str) -> str:
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
    return "command_failed"


def _auto_error_stage(code: str, fallback: str) -> str:
    if code == "invalid_input":
        return "input"
    if code == "missing_dependency":
        return "doctor"
    if code == "missing_model":
        return "model"
    return fallback or "auto"


def _auto_action_hint(message: str, code: str) -> str | None:
    lower = message.lower()
    if code == "missing_dependency" and ("local-asr" in lower or "faster_whisper" in lower):
        return (
            "Install local ASR dependencies with `uv sync --extra local-asr` "
            "or `pip install fast-sub[local-asr]`."
        )
    if code == "missing_model":
        return "Run `fast-sub models install whisper-small` or `fast-sub auto --yes`."
    return None


__all__ = ["AutoOptions", "AutoResult", "AutoStep"]
