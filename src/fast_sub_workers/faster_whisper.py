from __future__ import annotations

import argparse
import importlib
import json
import sys
import time
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from fast_sub.contracts.provider import ProviderWord, SttProviderSegment
from fast_sub.contracts.worker import SttWorkerRequest, SttWorkerResponse, WorkerErrorResponse

PROVIDER_ID = "local-faster-whisper"
SUPPORTED_DEVICES = {"auto", "cuda", "cpu"}
SUPPORTED_COMPUTE_TYPES = {"auto", "float16", "int8_float16", "int8"}
SUPPORTED_VAD = {"off", "normal", "aggressive"}
SUPPORTED_MODES = {"fast", "balanced", "quality"}


class WorkerFailure(RuntimeError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        retryable: bool = False,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.details = details or {}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="fast-sub-worker-faster-whisper")
    parser.add_argument("--request", required=True)
    parser.add_argument("--response", required=True)
    args = parser.parse_args(argv)

    response_path = Path(args.response)
    try:
        request = _read_request(Path(args.request))
        response = transcribe(request)
        _write_json(response_path, response.model_dump(mode="json"))
        return 0
    except WorkerFailure as exc:
        _log_error(exc.code, str(exc))
        _write_error_response(
            response_path,
            code=exc.code,
            message=str(exc),
            retryable=exc.retryable,
            details=exc.details,
        )
        return 1
    except Exception as exc:  # pragma: no cover - final safety net for worker process isolation
        _log_error("TRANSCRIBE_FAILED", str(exc))
        _write_error_response(
            response_path,
            code="TRANSCRIBE_FAILED",
            message=str(exc),
            retryable=False,
            details={"exception": exc.__class__.__name__},
        )
        return 1


def transcribe(request: SttWorkerRequest) -> SttWorkerResponse:
    _validate_request_options(request)
    if not request.model_path.exists():
        raise WorkerFailure(
            "MODEL_NOT_FOUND",
            "Model path does not exist.",
            details={"model_path": str(request.model_path)},
        )
    if not request.model_path.is_dir():
        raise WorkerFailure(
            "MODEL_NOT_FOUND",
            "Model path must be a faster-whisper model directory.",
            details={"model_path": str(request.model_path)},
        )
    if not request.audio_path.exists():
        raise WorkerFailure(
            "INVALID_REQUEST",
            "Audio path does not exist.",
            details={"audio_path": str(request.audio_path)},
        )

    faster_whisper = _import_faster_whisper()
    device = _resolve_device(request.device)
    compute_type = _resolve_compute_type(request.compute_type, device)
    transcribe_kwargs, warnings = _build_transcribe_kwargs(request)

    start = time.perf_counter()
    try:
        model = faster_whisper.WhisperModel(
            str(request.model_path),
            device=device,
            compute_type=compute_type,
        )
        transcriber = model
        if request.batch_size > 1:
            pipeline_cls = getattr(faster_whisper, "BatchedInferencePipeline", None)
            if pipeline_cls is None:
                warnings.append(
                    "batch_size was ignored because BatchedInferencePipeline is unavailable."
                )
            else:
                transcriber = pipeline_cls(model=model)
                transcribe_kwargs["batch_size"] = request.batch_size

        segments_iter, info = transcriber.transcribe(str(request.audio_path), **transcribe_kwargs)
        segments = list(segments_iter)
    except WorkerFailure:
        raise
    except Exception as exc:
        raise WorkerFailure(
            "TRANSCRIBE_FAILED",
            f"faster-whisper transcription failed: {exc}",
            details={"exception": exc.__class__.__name__},
        ) from exc

    elapsed_sec = time.perf_counter() - start
    provider_segments = [_convert_segment(segment) for segment in segments]
    if not provider_segments:
        raise WorkerFailure("EMPTY_SEGMENTS", "faster-whisper returned no segments.")

    language = getattr(info, "language", None) or (
        request.language if request.language != "auto" else "unknown"
    )
    return SttWorkerResponse(
        provider=PROVIDER_ID,
        language=language,
        elapsed_sec=elapsed_sec,
        actual_device=device,
        actual_compute_type=compute_type,
        segments=provider_segments,
        warnings=warnings,
    )


def _read_request(request_path: Path) -> SttWorkerRequest:
    try:
        payload = json.loads(request_path.read_text(encoding="utf-8"))
        return SttWorkerRequest.model_validate(payload)
    except (OSError, json.JSONDecodeError, ValidationError) as exc:
        raise WorkerFailure(
            "INVALID_REQUEST",
            f"Worker request is invalid: {exc}",
            details={"request_path": str(request_path)},
        ) from exc


def _validate_request_options(request: SttWorkerRequest) -> None:
    if request.device not in SUPPORTED_DEVICES:
        raise WorkerFailure(
            "UNSUPPORTED_DEVICE",
            f"Unsupported device: {request.device}",
            details={"supported": sorted(SUPPORTED_DEVICES)},
        )
    if request.compute_type not in SUPPORTED_COMPUTE_TYPES:
        raise WorkerFailure(
            "INVALID_REQUEST",
            f"Unsupported compute_type: {request.compute_type}",
            details={"supported": sorted(SUPPORTED_COMPUTE_TYPES)},
        )
    if request.vad not in SUPPORTED_VAD:
        raise WorkerFailure(
            "INVALID_REQUEST",
            f"Unsupported vad setting: {request.vad}",
            details={"supported": sorted(SUPPORTED_VAD)},
        )
    if request.mode not in SUPPORTED_MODES:
        raise WorkerFailure(
            "INVALID_REQUEST",
            f"Unsupported mode: {request.mode}",
            details={"supported": sorted(SUPPORTED_MODES)},
        )


def _import_faster_whisper() -> Any:
    try:
        return importlib.import_module("faster_whisper")
    except ImportError as exc:
        raise WorkerFailure(
            "MISSING_DEPENDENCY",
            "Python package 'faster-whisper' is not installed.",
            details={"package": "faster-whisper"},
        ) from exc


def _resolve_device(device: str) -> str:
    if device != "auto":
        return device

    try:
        ctranslate2 = importlib.import_module("ctranslate2")
        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda"
    except Exception:
        pass
    return "cpu"


def _resolve_compute_type(compute_type: str, device: str) -> str:
    if compute_type != "auto":
        return compute_type
    if device == "cuda":
        return "float16"
    return "int8"


def _build_transcribe_kwargs(request: SttWorkerRequest) -> tuple[dict[str, Any], list[str]]:
    warnings: list[str] = []
    kwargs: dict[str, Any] = {
        "beam_size": 1 if request.mode == "fast" else 5,
        "vad_filter": request.vad != "off",
    }
    if request.language != "auto":
        kwargs["language"] = request.language
    if request.vad == "aggressive":
        kwargs["vad_parameters"] = {"min_silence_duration_ms": 300}
    if request.mode == "quality":
        warnings.append("quality mode currently uses balanced beam settings.")
    return kwargs, warnings


def _convert_segment(segment: Any) -> SttProviderSegment:
    words = [
        ProviderWord(
            start_sec=float(word.start),
            end_sec=float(word.end),
            text=str(getattr(word, "word", "")),
            confidence=getattr(word, "probability", None),
        )
        for word in (getattr(segment, "words", None) or [])
    ]
    return SttProviderSegment(
        start_sec=float(segment.start),
        end_sec=float(segment.end),
        text=str(getattr(segment, "text", "")).strip(),
        confidence=None,
        words=words,
    )


def _write_error_response(
    response_path: Path,
    *,
    code: str,
    message: str,
    retryable: bool,
    details: dict[str, Any],
) -> None:
    error = WorkerErrorResponse(
        error={
            "code": code,
            "message": message,
            "retryable": retryable,
            "details": details,
            "stderr_tail": "",
        }
    )
    _write_json(response_path, error.model_dump(mode="json"))


def _write_json(response_path: Path, payload: dict[str, Any]) -> None:
    response_path.parent.mkdir(parents=True, exist_ok=True)
    response_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _log_error(code: str, message: str) -> None:
    print(f"{code}: {message}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
