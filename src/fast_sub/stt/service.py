from __future__ import annotations

import json
import os
import shlex
import shutil
import sys
import time
from dataclasses import dataclass, field
from hashlib import sha256
from pathlib import Path
from typing import Any, cast

from fast_sub.contracts.errors import SubGenError
from fast_sub.contracts.worker import SttWorkerRequest
from fast_sub.infrastructure.ffmpeg import (
    ensure_media_tools,
    is_media_file,
    prepare_audio,
    probe_media,
)
from fast_sub.infrastructure.workers import run_stt_worker
from fast_sub.media.service import analyze_media
from fast_sub.models import Mode, Segment
from fast_sub.output.paths import job_dir
from fast_sub.providers.resolution import resolve_stt_provider
from fast_sub.stt import constants as stt_constants
from fast_sub.stt.errors import TranscribeError as _TranscribeError
from fast_sub.subtitles.srt import render_srt


@dataclass(frozen=True)
class TranscribeOptions:
    provider: str = stt_constants.DEFAULT_PROVIDER
    model: str = stt_constants.DEFAULT_MODEL
    language: str = stt_constants.DEFAULT_LANGUAGE
    device: str = stt_constants.DEFAULT_DEVICE
    compute_type: str = stt_constants.DEFAULT_COMPUTE_TYPE
    batch_size: int | None = None
    gpu_load: str = stt_constants.DEFAULT_GPU_LOAD
    vad: str = stt_constants.DEFAULT_VAD
    mode: str = stt_constants.DEFAULT_MODE
    output: Path | None = None
    keep_temp: bool = False
    worker_command: list[str | Path] | None = None


@dataclass(frozen=True)
class TranscribeResult:
    srt_path: Path
    provider: str
    model: str
    device: str
    compute_type: str
    language_detected: str
    duration_sec: float | None
    elapsed_sec: float
    worker_elapsed_sec: float | None
    rtfx: float | None
    segments_count: int
    gpu_load: str
    batch_size: int
    warnings: list[str] = field(default_factory=list)
    metadata_path: Path | None = None
    work_dir: Path | None = None
    actual_device: str | None = None
    actual_compute_type: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "srt_path": str(self.srt_path),
            "provider": self.provider,
            "model": self.model,
            "device": self.device,
            "compute_type": self.compute_type,
            "compute": self.compute_type,
            "actual_device": self.actual_device,
            "actual_compute_type": self.actual_compute_type,
            "language_detected": self.language_detected,
            "duration_sec": self.duration_sec,
            "duration": self.duration_sec,
            "elapsed_sec": self.elapsed_sec,
            "elapsed": self.elapsed_sec,
            "worker_elapsed_sec": self.worker_elapsed_sec,
            "rtfx": self.rtfx,
            "segments_count": self.segments_count,
            "gpu_load": self.gpu_load,
            "batch_size": self.batch_size,
            "warnings": self.warnings,
        }


@dataclass(frozen=True)
class _TranscribePaths:
    work_dir: Path
    audio: Path
    request_copy: Path
    response_copy: Path
    metadata: Path
    output: Path


def transcribe_media(
    input_file: Path,
    options: TranscribeOptions | None = None,
) -> TranscribeResult:
    options = options or TranscribeOptions()
    started = time.perf_counter()
    metadata_context = _metadata_context(input_file, options)
    paths = _transcribe_paths(input_file, options)

    try:
        result = _run_transcribe_job(input_file, options, paths, metadata_context, started)
        if options.keep_temp:
            _write_metadata(paths.metadata, {"ok": True, **result.as_dict()})
        return result
    except _TranscribeError as exc:
        _write_failure_metadata(options, paths, metadata_context, started, exc)
        raise
    except SubGenError as exc:
        transcribe_error = _as_transcribe_error(exc, stage="transcribe", code="TRANSCRIBE_FAILED")
        _write_failure_metadata(options, paths, metadata_context, started, transcribe_error)
        raise transcribe_error from exc
    finally:
        if not options.keep_temp and paths.work_dir.exists():
            shutil.rmtree(paths.work_dir, ignore_errors=True)


def _run_transcribe_job(
    input_file: Path,
    options: TranscribeOptions,
    paths: _TranscribePaths,
    metadata_context: dict[str, Any],
    started: float,
) -> TranscribeResult:
    duration_sec = _run_transcribe_preflight(input_file, options, paths, metadata_context)
    resolved_vad, analysis_warnings = _resolve_vad(input_file, options.vad)
    model_dir = _resolve_model_path(options.provider, options.model)
    batch_size = _resolve_batch_size(options)
    metadata_context["batch_size"] = batch_size
    request = _worker_request(
        paths,
        options,
        model_dir=model_dir,
        batch_size=batch_size,
        vad=resolved_vad,
    )
    response = _run_transcribe_worker(options, paths, request)
    segments, validation_warnings = _run_stage(
        "transcribe",
        "TRANSCRIBE_FAILED",
        lambda: normalize_worker_segments(response.segments),
    )
    warnings = [*analysis_warnings, *response.warnings, *validation_warnings]

    paths.output.write_text(render_srt(segments, mode=Mode.ORIGINAL), encoding="utf-8")
    elapsed_sec = time.perf_counter() - started
    return _transcribe_result(
        options,
        paths,
        response=response,
        duration_sec=duration_sec,
        elapsed_sec=elapsed_sec,
        segments_count=len(segments),
        batch_size=batch_size,
        warnings=warnings,
    )


def _transcribe_paths(input_file: Path, options: TranscribeOptions) -> _TranscribePaths:
    work_dir = _transcribe_work_dir(input_file)
    return _TranscribePaths(
        work_dir=work_dir,
        audio=work_dir / "audio.16k.mono.wav",
        request_copy=work_dir / "worker.request.json",
        response_copy=work_dir / "worker.response.json",
        metadata=work_dir / "metadata.json",
        output=options.output or input_file.with_suffix(".srt"),
    )


def _run_transcribe_preflight(
    input_file: Path,
    options: TranscribeOptions,
    paths: _TranscribePaths,
    metadata_context: dict[str, Any],
) -> float | None:
    _run_stage("options", "INVALID_OPTIONS", lambda: _validate_options(options))
    _run_stage("input", "INVALID_INPUT", lambda: _validate_input_file(input_file))
    _run_stage("doctor", "MISSING_DEPENDENCY", ensure_media_tools)

    info = _run_stage("probe", "FFPROBE_FAILED", lambda: probe_media(input_file))
    duration_sec = _optional_float(info.get("duration_sec"))
    metadata_context["duration_sec"] = duration_sec
    metadata_context["duration"] = duration_sec
    paths.output.parent.mkdir(parents=True, exist_ok=True)

    paths.work_dir.mkdir(parents=True, exist_ok=True)
    _run_stage("prepare", "FFMPEG_FAILED", lambda: prepare_audio(input_file, paths.audio))
    return duration_sec


def _worker_request(
    paths: _TranscribePaths,
    options: TranscribeOptions,
    *,
    model_dir: Path,
    batch_size: int,
    vad: str,
) -> SttWorkerRequest:
    return SttWorkerRequest(
        job_id=paths.work_dir.name,
        audio_path=paths.audio,
        language=options.language,
        model_path=model_dir,
        device=options.device,
        compute_type=options.compute_type,
        batch_size=batch_size,
        vad=vad,
        mode=options.mode,
    )


def _run_transcribe_worker(
    options: TranscribeOptions,
    paths: _TranscribePaths,
    request: SttWorkerRequest,
) -> Any:
    return _run_worker_stage(
        lambda: run_stt_worker(
            _resolve_worker_command(options),
            request,
            workdir=paths.work_dir if options.keep_temp else None,
            request_path=paths.request_copy if options.keep_temp else None,
            response_path=paths.response_copy if options.keep_temp else None,
        )
    )


def _transcribe_result(
    options: TranscribeOptions,
    paths: _TranscribePaths,
    *,
    response: Any,
    duration_sec: float | None,
    elapsed_sec: float,
    segments_count: int,
    batch_size: int,
    warnings: list[str],
) -> TranscribeResult:
    return TranscribeResult(
        srt_path=paths.output,
        provider=response.provider or options.provider,
        model=options.model,
        device=options.device,
        compute_type=options.compute_type,
        actual_device=response.actual_device,
        actual_compute_type=response.actual_compute_type,
        language_detected=response.language,
        duration_sec=duration_sec,
        elapsed_sec=round(elapsed_sec, 3),
        worker_elapsed_sec=response.elapsed_sec,
        rtfx=_rtfx(duration_sec, elapsed_sec),
        segments_count=segments_count,
        gpu_load=options.gpu_load,
        batch_size=batch_size,
        warnings=warnings,
        metadata_path=paths.metadata if options.keep_temp else None,
        work_dir=paths.work_dir if options.keep_temp else None,
    )


def _write_failure_metadata(
    options: TranscribeOptions,
    paths: _TranscribePaths,
    metadata_context: dict[str, Any],
    started: float,
    error: _TranscribeError,
) -> None:
    if not options.keep_temp:
        return
    elapsed_sec = round(time.perf_counter() - started, 3)
    _write_metadata(
        paths.metadata,
        {
            "ok": False,
            **metadata_context,
            "elapsed_sec": elapsed_sec,
            "elapsed": elapsed_sec,
            "error": error.as_dict(),
        },
    )


def normalize_worker_segments(raw_segments: list[Any]) -> tuple[list[Segment], list[str]]:
    warnings: list[str] = []
    normalized: list[Segment] = []
    previous_end = 0.0

    for raw_index, raw in enumerate(raw_segments, start=1):
        start = float(raw.start_sec)
        end = float(raw.end_sec)
        text = raw.text.strip()

        if not text:
            warnings.append(f"Dropped empty-text segment at worker index {raw_index}.")
            continue
        if start < 0 or end < 0:
            raise SubGenError(f"Worker returned a negative timestamp at segment {raw_index}.")
        if end <= start:
            raise SubGenError(f"Worker returned a non-positive duration at segment {raw_index}.")
        if start < previous_end:
            warnings.append(f"Repaired overlapping segment at worker index {raw_index}.")
            start = previous_end
            if end <= start:
                warnings.append(f"Dropped segment {raw_index} after overlap repair made it empty.")
                continue

        normalized.append(Segment(id=len(normalized) + 1, start=start, end=end, text=text))
        previous_end = end

    if not normalized:
        raise _TranscribeError(
            "Worker returned no usable subtitle segments.",
            stage="transcribe",
            code="EMPTY_SEGMENTS",
        )
    return normalized, warnings


def _resolve_vad(input_file: Path, vad: str) -> tuple[str, list[str]]:
    if vad != "auto":
        return vad, []
    try:
        analysis = analyze_media(input_file)
    except SubGenError as exc:
        return "normal", [f"VAD auto analysis failed; using normal: {exc}"]
    return str(analysis.recommended_vad), list(analysis.warnings)


def _resolve_model_path(provider_id: str, model_id: str) -> Path:
    resolution = resolve_stt_provider(provider_id, model_id)
    if resolution.provider_location == "api":
        raise _TranscribeError(
            "transcribe v0 only supports local STT providers.",
            stage="provider",
            code="UNSUPPORTED_PROVIDER",
        )
    if provider_id != stt_constants.DEFAULT_PROVIDER:
        raise _TranscribeError(
            f"Unsupported local STT provider for transcribe v0: {provider_id}",
            stage="provider",
            code="UNSUPPORTED_PROVIDER",
        )
    if resolution.status != "available":
        raise _TranscribeError(
            _format_resolution_error(resolution),
            stage=_resolution_stage(resolution.status),
            code=_resolution_code(resolution.status),
            action_hint=resolution.action_hint,
        )
    if resolution.model_path is None:
        raise _TranscribeError(
            f"Provider resolution did not return a local model path for {provider_id}.",
            stage="model",
            code="MODEL_NOT_FOUND",
        )
    return resolution.model_path


def _format_resolution_error(resolution: Any) -> str:
    message = f"{resolution.status}: {resolution.message}"
    if resolution.action_hint:
        message = f"{message} {resolution.action_hint}"
    return message


def _resolve_worker_command(options: TranscribeOptions) -> list[str | Path]:
    if options.worker_command:
        return options.worker_command
    env_command = os.getenv(stt_constants.WORKER_COMMAND_ENV)
    if env_command:
        return list(shlex.split(env_command))
    return [sys.executable, "-m", "fast_sub_workers.faster_whisper"]


def _validate_input_file(input_file: Path) -> None:
    if not input_file.exists():
        raise SubGenError(f"Input file does not exist: {input_file}")
    if not input_file.is_file():
        raise SubGenError(f"Input path is not a file: {input_file}")
    if not is_media_file(input_file):
        raise SubGenError(f"Unsupported input file type: {input_file}")


def _validate_options(options: TranscribeOptions) -> None:
    _require_choice(options.language, stt_constants.VALID_LANGUAGES, "--language")
    _require_choice(options.device, stt_constants.VALID_DEVICES, "--device")
    _require_choice(options.compute_type, stt_constants.VALID_COMPUTE_TYPES, "--compute")
    _require_choice(options.vad, stt_constants.VALID_VAD, "--vad")
    _require_choice(options.mode, stt_constants.VALID_MODES, "--mode")
    _require_choice(options.gpu_load, stt_constants.VALID_GPU_LOADS, "--gpu-load")
    if options.batch_size is not None and options.batch_size <= 0:
        raise SubGenError("--batch-size must be greater than 0.")


def _resolve_batch_size(options: TranscribeOptions) -> int:
    if options.batch_size is not None:
        return options.batch_size
    return stt_constants.GPU_LOAD_BATCH_SIZES[options.gpu_load]


def transcribe_error_payload(exc: SubGenError) -> dict[str, Any]:
    error = (
        exc
        if isinstance(exc, _TranscribeError)
        else _as_transcribe_error(
            exc,
            stage="transcribe",
            code="TRANSCRIBE_FAILED",
        )
    )
    return {"ok": False, "error": error.as_dict()}


def _metadata_context(input_file: Path, options: TranscribeOptions) -> dict[str, Any]:
    batch_size = options.batch_size or stt_constants.GPU_LOAD_BATCH_SIZES.get(options.gpu_load)
    return {
        "input": str(input_file),
        "provider": options.provider,
        "model": options.model,
        "device": options.device,
        "compute_type": options.compute_type,
        "compute": options.compute_type,
        "gpu_load": options.gpu_load,
        "batch_size": batch_size,
    }


def _transcribe_work_dir(input_file: Path) -> Path:
    try:
        return job_dir(input_file)
    except OSError:
        digest = sha256(str(input_file.resolve()).encode("utf-8")).hexdigest()[:16]
        return Path(".fast-sub") / "jobs" / f"invalid-input-{digest}"


def _write_metadata(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _run_stage(stage: str, code: str, func: Any) -> Any:
    try:
        return func()
    except _TranscribeError:
        raise
    except SubGenError as exc:
        raise _as_transcribe_error(exc, stage=stage, code=code) from exc


def _run_worker_stage(func: Any) -> Any:
    try:
        return func()
    except _TranscribeError:
        raise
    except SubGenError as exc:
        raise _classify_worker_error(exc) from exc


def _as_transcribe_error(
    exc: SubGenError,
    *,
    stage: str,
    code: str,
) -> _TranscribeError:
    message = str(exc)
    return _TranscribeError(
        _clean_error_message(message),
        stage=stage,
        code=_classify_code(message, code),
        action_hint=_action_hint(message),
    )


def _classify_worker_error(exc: SubGenError) -> _TranscribeError:
    message = _clean_error_message(str(exc))
    code = _worker_error_code(message)
    return _TranscribeError(
        message,
        stage="transcribe",
        code=code,
        action_hint=_action_hint(message),
    )


def _worker_error_code(message: str) -> str:
    marker = "Worker failed with "
    if marker in message:
        tail = message.split(marker, 1)[1]
        code = tail.split(":", 1)[0].strip()
        if code:
            return code
    return _classify_code(message, "TRANSCRIBE_FAILED")


def _classify_code(message: str, fallback: str) -> str:
    lower = message.lower()
    if "no usable subtitle segments" in lower:
        return "EMPTY_SEGMENTS"
    if "missing_model" in lower or "models install" in lower:
        return "missing_model"
    if "missing_dependency" in lower or "local-asr" in lower or "not installed" in lower:
        return "missing_dependency"
    if "ffprobe" in lower:
        return "FFPROBE_FAILED"
    if "ffmpeg" in lower:
        return "FFMPEG_FAILED"
    if "model_not_found" in lower or "model path" in lower:
        return "MODEL_NOT_FOUND"
    return fallback


def _resolution_stage(status: str) -> str:
    if status == "missing_model":
        return "model"
    if status == "missing_dependency":
        return "provider"
    return "provider"


def _resolution_code(status: str) -> str:
    if status in {"missing_model", "missing_dependency"}:
        return status
    if status == "unknown_model":
        return "MODEL_NOT_FOUND"
    return "TRANSCRIBE_FAILED"


def _action_hint(message: str) -> str | None:
    if "fast-sub models install" in message:
        return _extract_backtick_hint(message, "fast-sub models install")
    if "local-asr" in message:
        return _extract_backtick_hint(message, "local-asr")
    return None


def _extract_backtick_hint(message: str, needle: str) -> str | None:
    parts = message.split("`")
    for part in parts:
        if needle in part:
            return part
    return None


def _clean_error_message(message: str) -> str:
    if "\n" in message:
        return message.splitlines()[0].strip()
    return message.strip()


def _require_choice(value: str, valid: set[str], option: str) -> None:
    if value not in valid:
        joined = ", ".join(sorted(valid))
        raise SubGenError(f"{option} must be one of: {joined}.")


def _optional_float(value: object) -> float | None:
    try:
        return None if value is None else float(cast(Any, value))
    except (TypeError, ValueError):
        return None


def _rtfx(duration_sec: float | None, elapsed_sec: float) -> float | None:
    if duration_sec is None or elapsed_sec <= 0:
        return None
    return round(duration_sec / elapsed_sec, 3)
