from __future__ import annotations

import json
import os
import shlex
import shutil
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from fast_sub.analyze import analyze_media
from fast_sub.errors import SubGenError
from fast_sub.media import ensure_media_tools, is_media_file, prepare_audio, probe_media
from fast_sub.model_manager import model_path, verify_model
from fast_sub.model_manifest import get_model
from fast_sub.models import Mode, Segment
from fast_sub.paths import job_dir
from fast_sub.providers import default_registry
from fast_sub.subtitle import render_srt
from fast_sub.worker_models import SttWorkerRequest
from fast_sub.worker_runner import run_stt_worker

DEFAULT_PROVIDER = "local-faster-whisper"
DEFAULT_MODEL = "whisper-small"
DEFAULT_LANGUAGE = "auto"
DEFAULT_DEVICE = "auto"
DEFAULT_COMPUTE_TYPE = "auto"
DEFAULT_BATCH_SIZE = 8
DEFAULT_VAD = "auto"
DEFAULT_MODE = "balanced"
VALID_LANGUAGES = {"auto", "zh", "en", "ja", "ko"}
VALID_DEVICES = {"auto", "cuda", "cpu"}
VALID_COMPUTE_TYPES = {"auto", "float16", "int8_float16", "int8"}
VALID_VAD = {"auto", "off", "normal", "aggressive"}
VALID_MODES = {"fast", "balanced", "quality"}
WORKER_COMMAND_ENV = "FAST_SUB_STT_WORKER_COMMAND"


@dataclass(frozen=True)
class TranscribeOptions:
    provider: str = DEFAULT_PROVIDER
    model: str = DEFAULT_MODEL
    language: str = DEFAULT_LANGUAGE
    device: str = DEFAULT_DEVICE
    compute_type: str = DEFAULT_COMPUTE_TYPE
    batch_size: int = DEFAULT_BATCH_SIZE
    vad: str = DEFAULT_VAD
    mode: str = DEFAULT_MODE
    output: Path | None = None
    keep_temp: bool = False
    worker_command: list[str | Path] | None = None


@dataclass(frozen=True)
class TranscribeResult:
    srt_path: Path
    provider: str
    model: str
    language_detected: str
    duration_sec: float | None
    elapsed_sec: float
    worker_elapsed_sec: float | None
    rtfx: float | None
    segments_count: int
    warnings: list[str] = field(default_factory=list)
    metadata_path: Path | None = None
    work_dir: Path | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "srt_path": str(self.srt_path),
            "provider": self.provider,
            "model": self.model,
            "language_detected": self.language_detected,
            "duration_sec": self.duration_sec,
            "elapsed_sec": self.elapsed_sec,
            "worker_elapsed_sec": self.worker_elapsed_sec,
            "rtfx": self.rtfx,
            "segments_count": self.segments_count,
            "warnings": self.warnings,
        }


def transcribe_media(
    input_file: Path,
    options: TranscribeOptions | None = None,
) -> TranscribeResult:
    options = options or TranscribeOptions()
    started = time.perf_counter()
    _validate_options(options)
    _validate_input_file(input_file)
    ensure_media_tools()

    info = probe_media(input_file)
    duration_sec = _optional_float(info.get("duration_sec"))
    out_path = options.output or input_file.with_suffix(".srt")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    work_dir = job_dir(input_file)
    work_dir.mkdir(parents=True, exist_ok=True)
    audio_path = work_dir / "audio.16k.mono.wav"
    request_copy_path = work_dir / "worker.request.json"
    response_copy_path = work_dir / "worker.response.json"
    metadata_path = work_dir / "metadata.json"

    try:
        prepare_audio(input_file, audio_path)
        resolved_vad, analysis_warnings = _resolve_vad(input_file, options.vad)
        model_dir = _resolve_model_path(options.provider, options.model)
        request = SttWorkerRequest(
            job_id=work_dir.name,
            audio_path=audio_path,
            language=options.language,
            model_path=model_dir,
            device=options.device,
            compute_type=options.compute_type,
            batch_size=options.batch_size,
            vad=resolved_vad,
            mode=options.mode,
        )

        response = run_stt_worker(
            _resolve_worker_command(options),
            request,
            workdir=work_dir if options.keep_temp else None,
            request_path=request_copy_path if options.keep_temp else None,
            response_path=response_copy_path if options.keep_temp else None,
        )
        segments, validation_warnings = normalize_worker_segments(response.segments)
        warnings = [*analysis_warnings, *response.warnings, *validation_warnings]

        out_path.write_text(render_srt(segments, mode=Mode.ORIGINAL), encoding="utf-8")
        elapsed_sec = time.perf_counter() - started
        result = TranscribeResult(
            srt_path=out_path,
            provider=response.provider or options.provider,
            model=options.model,
            language_detected=response.language,
            duration_sec=duration_sec,
            elapsed_sec=round(elapsed_sec, 3),
            worker_elapsed_sec=response.elapsed_sec,
            rtfx=_rtfx(duration_sec, elapsed_sec),
            segments_count=len(segments),
            warnings=warnings,
            metadata_path=metadata_path if options.keep_temp else None,
            work_dir=work_dir if options.keep_temp else None,
        )
        if options.keep_temp:
            metadata_path.write_text(
                json.dumps(result.as_dict(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        return result
    finally:
        if not options.keep_temp and work_dir.exists():
            shutil.rmtree(work_dir, ignore_errors=True)


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
                warnings.append(
                    f"Dropped segment {raw_index} after overlap repair made it empty."
                )
                continue

        normalized.append(Segment(id=len(normalized) + 1, start=start, end=end, text=text))
        previous_end = end

    if not normalized:
        raise SubGenError("Worker returned no usable subtitle segments.")
    return normalized, warnings


def _resolve_vad(input_file: Path, vad: str) -> tuple[str, list[str]]:
    if vad != "auto":
        return vad, []
    try:
        analysis = analyze_media(input_file)
    except SubGenError as exc:
        return "normal", [f"VAD auto analysis failed; using normal: {exc}"]
    return analysis.recommended_vad, analysis.warnings


def _resolve_model_path(provider_id: str, model_id: str) -> Path:
    registry = default_registry()
    provider = registry.get(provider_id)
    if provider is None:
        raise SubGenError(f"Unknown STT provider: {provider_id}")
    if provider.metadata.type.value != "stt":
        raise SubGenError(f"Provider is not an STT provider: {provider_id}")
    if provider.metadata.location.value != "local":
        raise SubGenError("transcribe v0 only supports local STT providers.")
    if provider_id != DEFAULT_PROVIDER:
        raise SubGenError(f"Unsupported local STT provider for transcribe v0: {provider_id}")

    try:
        model = get_model(model_id)
    except KeyError as exc:
        raise SubGenError(str(exc)) from exc
    if model.type != "asr":
        raise SubGenError(f"Model is not an ASR model: {model_id}")
    if model.backend != "faster-whisper":
        raise SubGenError(
            f"Model backend '{model.backend}' is incompatible with provider {provider_id}."
        )

    status = verify_model(model)
    if not status.installed:
        raise SubGenError(
            f"Model is not installed: {model_id}. "
            f"Run `fast-sub models install {model_id}`. {status.message}"
        )
    return model_path(model)


def _resolve_worker_command(options: TranscribeOptions) -> list[str | Path]:
    if options.worker_command:
        return options.worker_command
    env_command = os.getenv(WORKER_COMMAND_ENV)
    if env_command:
        return shlex.split(env_command)
    return [sys.executable, "-m", "fast_sub_workers.faster_whisper"]


def _validate_input_file(input_file: Path) -> None:
    if not input_file.exists():
        raise SubGenError(f"Input file does not exist: {input_file}")
    if not input_file.is_file():
        raise SubGenError(f"Input path is not a file: {input_file}")
    if not is_media_file(input_file):
        raise SubGenError(f"Unsupported input file type: {input_file}")


def _validate_options(options: TranscribeOptions) -> None:
    _require_choice(options.language, VALID_LANGUAGES, "--language")
    _require_choice(options.device, VALID_DEVICES, "--device")
    _require_choice(options.compute_type, VALID_COMPUTE_TYPES, "--compute")
    _require_choice(options.vad, VALID_VAD, "--vad")
    _require_choice(options.mode, VALID_MODES, "--mode")
    if options.batch_size <= 0:
        raise SubGenError("--batch-size must be greater than 0.")


def _require_choice(value: str, valid: set[str], option: str) -> None:
    if value not in valid:
        joined = ", ".join(sorted(valid))
        raise SubGenError(f"{option} must be one of: {joined}.")


def _optional_float(value: object) -> float | None:
    try:
        return None if value is None else float(value)
    except (TypeError, ValueError):
        return None


def _rtfx(duration_sec: float | None, elapsed_sec: float) -> float | None:
    if duration_sec is None or elapsed_sec <= 0:
        return None
    return round(duration_sec / elapsed_sec, 3)
