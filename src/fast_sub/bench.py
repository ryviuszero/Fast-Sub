from __future__ import annotations

import json
import platform
import statistics
import subprocess
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from fast_sub.errors import SubGenError
from fast_sub.transcribe import (
    DEFAULT_GPU_LOAD,
    DEFAULT_LANGUAGE,
    DEFAULT_MODE,
    DEFAULT_MODEL,
    DEFAULT_PROVIDER,
    TranscribeOptions,
    transcribe_media,
)

BENCH_SCHEMA_VERSION = 1
MEASUREMENT_SCOPE = "transcribe_media_v1"


@dataclass(frozen=True)
class BenchProfile:
    name: str
    device: str
    compute_type: str


@dataclass(frozen=True)
class BenchOptions:
    provider: str = DEFAULT_PROVIDER
    model: str = DEFAULT_MODEL
    language: str = DEFAULT_LANGUAGE
    mode: str = DEFAULT_MODE
    repeat: int = 1
    gpu_load: str = DEFAULT_GPU_LOAD
    batch_size: int | None = None
    markdown: Path | None = None
    sample_manifest: Path | None = None
    sample_id: str | None = None
    command: list[str] | None = None


DEFAULT_PROFILES = (
    BenchProfile(name="cpu-int8", device="cpu", compute_type="int8"),
    BenchProfile(name="auto", device="auto", compute_type="auto"),
)


def run_bench(
    input_file: Path,
    options: BenchOptions | None = None,
    *,
    hardware_detector: Any | None = None,
    transcriber: Any | None = None,
    profiles: tuple[BenchProfile, ...] = DEFAULT_PROFILES,
) -> dict[str, Any]:
    options = options or BenchOptions()
    _validate_options(input_file, options)
    detector = hardware_detector or detect_hardware
    run_transcribe = transcriber or transcribe_media
    hardware = detector()
    sample = load_sample_metadata(
        options.sample_manifest,
        sample_id=options.sample_id,
        input_file=input_file,
    )
    report: dict[str, Any] = {
        "schema_version": BENCH_SCHEMA_VERSION,
        "generated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "measurement_scope": MEASUREMENT_SCOPE,
        "includes_audio_prepare": True,
        "includes_worker_only_metric": True,
        "excludes_refine": True,
        "input": str(input_file),
        "input_basename": input_file.name,
        "input_path_redacted": True,
        "input_sha256": sample.get("checksum_sha256"),
        "command": _redacted_command_string(options.command, input_file=input_file),
        "sample": sample,
        "hardware": hardware,
        "profiles": [],
    }

    output_dir = _bench_output_dir(input_file, report["generated_at"])
    for profile in profiles:
        profile_report = _run_profile(input_file, options, profile, run_transcribe, output_dir)
        report["profiles"].append(profile_report)

    if options.markdown is not None:
        options.markdown.parent.mkdir(parents=True, exist_ok=True)
        options.markdown.write_text(render_markdown_report(report), encoding="utf-8")

    if not _has_successful_run(report):
        raise BenchError("All benchmark profiles failed or were skipped.", report=report)
    return report


class BenchError(SubGenError):
    def __init__(self, message: str, *, report: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.report = report


def detect_hardware() -> dict[str, Any]:
    gpu_info = _detect_nvidia_gpu()
    cuda_count = _detect_cuda_device_count()
    return {
        "os": platform.system(),
        "platform": platform.platform(),
        "python": sys.version.split()[0],
        "cpu": platform.processor() or platform.machine() or "unknown",
        "gpu": gpu_info.get("name"),
        "cuda_available": bool(cuda_count) if cuda_count is not None else False,
        "cuda_device_count": cuda_count,
        "driver_version": gpu_info.get("driver_version"),
        "vram_total_mb": gpu_info.get("vram_total_mb"),
    }


def load_sample_metadata(
    manifest_path: Path | None,
    *,
    sample_id: str | None,
    input_file: Path,
) -> dict[str, Any]:
    fallback = {"id": sample_id or input_file.stem}
    if manifest_path is None:
        return fallback
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BenchError(f"Could not read sample manifest: {exc}") from exc
    assets = payload.get("assets")
    if not isinstance(assets, list):
        raise BenchError("Sample manifest must contain an assets array.")
    selected = _select_manifest_asset(assets, sample_id=sample_id, input_file=input_file)
    if selected is None:
        return fallback
    keys = (
        "id",
        "benchmark_family",
        "source_dataset",
        "source_url",
        "source_accessed_at",
        "license",
        "redistributable",
        "domain",
        "speaking_style",
        "noise_profile",
        "language",
        "language_mix",
        "checksum_sha256",
    )
    return {key: selected.get(key) for key in keys if key in selected}


def render_markdown_report(report: dict[str, Any]) -> str:
    sample = report.get("sample", {})
    hardware = report.get("hardware", {})
    lines = [
        "# Fast Sub Benchmark Report",
        "",
        f"- Generated: {report.get('generated_at')}",
        f"- Measurement scope: `{report.get('measurement_scope')}`",
        "- RTFx e2e: `duration_sec / elapsed_sec`, including audio preparation.",
        "- Worker RTFx: `duration_sec / worker_elapsed_sec`, worker metric only.",
        f"- Input: `{report.get('input_basename')}`",
        f"- Sample: `{sample.get('id', 'unknown')}`",
        f"- Source: `{sample.get('source_dataset', 'unknown')}`",
        f"- License: `{sample.get('license', 'unknown')}`",
        f"- Redistributable: `{sample.get('redistributable', 'unknown')}`",
        f"- Command: `{report.get('command') or 'unknown'}`",
        "",
        "## Hardware",
        "",
        f"- OS: `{hardware.get('os', 'unknown')}`",
        f"- Platform: `{hardware.get('platform', 'unknown')}`",
        f"- Python: `{hardware.get('python', 'unknown')}`",
        f"- CPU: `{hardware.get('cpu', 'unknown')}`",
        f"- GPU: `{hardware.get('gpu') or 'unavailable'}`",
        f"- CUDA devices: `{hardware.get('cuda_device_count')}`",
        "",
        "## Profiles",
        "",
        "| profile | requested device | requested compute | actual device | actual compute | "
        "repeat | avg elapsed | avg RTFx e2e | avg worker RTFx | segments | status |",
        "| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for profile in report.get("profiles", []):
        summary = profile.get("summary", {})
        status = _profile_status(summary)
        lines.append(
            "| "
            + " | ".join(
                [
                    str(profile.get("name", "")),
                    str(profile.get("requested_device", "")),
                    str(profile.get("requested_compute_type", "")),
                    str(summary.get("actual_device") or "unknown"),
                    str(summary.get("actual_compute_type") or "unknown"),
                    str(summary.get("runs", 0)),
                    _format_number(summary.get("elapsed_sec_avg")),
                    _format_number(summary.get("rtfx_e2e_avg")),
                    _format_number(summary.get("worker_rtfx_avg")),
                    str(summary.get("segments_count") or ""),
                    status,
                ]
            )
            + " |"
        )

    warnings = _collect_profile_messages(report, "warnings")
    errors = _collect_profile_messages(report, "error")
    lines.extend(["", "## Warnings And Errors", ""])
    if not warnings and not errors:
        lines.append("- None.")
    for warning in warnings:
        lines.append(f"- warning: {warning}")
    for error in errors:
        lines.append(f"- error: {error}")
    lines.extend(
        [
            "",
            "## Follow-up",
            "",
            "- TODO: add RTX 3060 and additional machine baselines before release.",
            "- TODO: expand fixed samples as local licensed media becomes available.",
            "",
        ]
    )
    return "\n".join(lines)


def _run_profile(
    input_file: Path,
    options: BenchOptions,
    profile: BenchProfile,
    run_transcribe: Any,
    output_dir: Path,
) -> dict[str, Any]:
    runs = []
    for index in range(1, options.repeat + 1):
        runs.append(_run_once(input_file, options, profile, run_transcribe, index, output_dir))
    return {
        "name": profile.name,
        "requested_device": profile.device,
        "requested_compute_type": profile.compute_type,
        "runs": runs,
        "summary": summarize_runs(runs),
    }


def _run_once(
    input_file: Path,
    options: BenchOptions,
    profile: BenchProfile,
    run_transcribe: Any,
    index: int,
    output_dir: Path,
) -> dict[str, Any]:
    batch_size_source = "explicit" if options.batch_size is not None else "gpu_load"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{profile.name}-run-{index}.srt"
    try:
        result = run_transcribe(
            input_file,
            TranscribeOptions(
                provider=options.provider,
                model=options.model,
                language=options.language,
                device=profile.device,
                compute_type=profile.compute_type,
                batch_size=options.batch_size,
                gpu_load=options.gpu_load,
                vad="auto",
                mode=options.mode,
                output=output_path,
            ),
        )
    except SubGenError as exc:
        return {
            "index": index,
            "status": "failed",
            "reason": str(exc),
            "error": _error_payload(exc),
        }
    worker_elapsed_sec = result.worker_elapsed_sec
    duration_sec = result.duration_sec
    return {
        "index": index,
        "status": "ok",
        "provider": result.provider,
        "model": result.model,
        "requested_device": profile.device,
        "requested_compute_type": profile.compute_type,
        "actual_device": result.actual_device or "unknown",
        "actual_compute_type": result.actual_compute_type or "unknown",
        "gpu_load": result.gpu_load,
        "batch_size": result.batch_size,
        "batch_size_source": batch_size_source,
        "srt_path": str(result.srt_path),
        "duration_sec": duration_sec,
        "elapsed_sec": result.elapsed_sec,
        "worker_elapsed_sec": worker_elapsed_sec,
        "rtfx_e2e": _rtfx(duration_sec, result.elapsed_sec),
        "worker_rtfx": _rtfx(duration_sec, worker_elapsed_sec),
        "segments_count": result.segments_count,
        "invalid_segments_count": 0,
        "quality": {"reference_available": False, "wer": None, "cer": None},
        "warnings": result.warnings,
    }


def summarize_runs(runs: list[dict[str, Any]]) -> dict[str, Any]:
    ok_runs = [run for run in runs if run.get("status") == "ok"]
    summary: dict[str, Any] = {
        "runs": len(runs),
        "ok_runs": len(ok_runs),
        "failed_runs": sum(1 for run in runs if run.get("status") == "failed"),
        "skipped_runs": sum(1 for run in runs if run.get("status") == "skipped"),
        "first_run_elapsed_sec": None,
        "elapsed_sec_min": None,
        "elapsed_sec_max": None,
        "elapsed_sec_avg": None,
        "steady_state_elapsed_sec_avg": None,
        "rtfx_e2e_best": None,
        "rtfx_e2e_worst": None,
        "rtfx_e2e_avg": None,
        "worker_rtfx_best": None,
        "worker_rtfx_worst": None,
        "worker_rtfx_avg": None,
        "segments_count": None,
        "actual_device": None,
        "actual_compute_type": None,
    }
    if not ok_runs:
        return summary

    elapsed = [_number(run.get("elapsed_sec")) for run in ok_runs]
    elapsed = [value for value in elapsed if value is not None]
    rtfx_e2e = [_number(run.get("rtfx_e2e")) for run in ok_runs]
    rtfx_e2e = [value for value in rtfx_e2e if value is not None]
    worker_rtfx = [_number(run.get("worker_rtfx")) for run in ok_runs]
    worker_rtfx = [value for value in worker_rtfx if value is not None]
    steady_elapsed = [_number(run.get("elapsed_sec")) for run in ok_runs[1:]]
    steady_elapsed = [value for value in steady_elapsed if value is not None]

    summary.update(
        {
            "first_run_elapsed_sec": ok_runs[0].get("elapsed_sec"),
            "elapsed_sec_min": _round(min(elapsed)) if elapsed else None,
            "elapsed_sec_max": _round(max(elapsed)) if elapsed else None,
            "elapsed_sec_avg": _mean(elapsed),
            "steady_state_elapsed_sec_avg": _mean(steady_elapsed),
            "rtfx_e2e_best": _round(max(rtfx_e2e)) if rtfx_e2e else None,
            "rtfx_e2e_worst": _round(min(rtfx_e2e)) if rtfx_e2e else None,
            "rtfx_e2e_avg": _mean(rtfx_e2e),
            "worker_rtfx_best": _round(max(worker_rtfx)) if worker_rtfx else None,
            "worker_rtfx_worst": _round(min(worker_rtfx)) if worker_rtfx else None,
            "worker_rtfx_avg": _mean(worker_rtfx),
            "segments_count": ok_runs[0].get("segments_count"),
            "actual_device": ok_runs[0].get("actual_device"),
            "actual_compute_type": ok_runs[0].get("actual_compute_type"),
        }
    )
    return summary


def _detect_nvidia_gpu() -> dict[str, Any]:
    command = [
        "nvidia-smi",
        "--query-gpu=name,memory.total,driver_version",
        "--format=csv,noheader,nounits",
    ]
    try:
        completed = subprocess.run(command, capture_output=True, text=True, check=False)
    except OSError:
        return {"name": None, "vram_total_mb": None, "driver_version": None}
    if completed.returncode != 0:
        return {"name": None, "vram_total_mb": None, "driver_version": None}
    first_line = completed.stdout.splitlines()[0] if completed.stdout.splitlines() else ""
    parts = [part.strip() for part in first_line.split(",")]
    if len(parts) < 3:
        return {"name": None, "vram_total_mb": None, "driver_version": None}
    return {
        "name": parts[0] or None,
        "vram_total_mb": _optional_int(parts[1]),
        "driver_version": parts[2] or None,
    }


def _detect_cuda_device_count() -> int | None:
    try:
        import ctranslate2  # type: ignore[import-not-found]
    except Exception:
        return None
    try:
        return int(ctranslate2.get_cuda_device_count())
    except Exception:
        return None


def _select_manifest_asset(
    assets: list[Any],
    *,
    sample_id: str | None,
    input_file: Path,
) -> dict[str, Any] | None:
    for asset in assets:
        if not isinstance(asset, dict):
            continue
        if sample_id is not None and asset.get("id") == sample_id:
            return asset
        local_path = asset.get("local_path")
        if sample_id is None and local_path and Path(str(local_path)).name == input_file.name:
            return asset
    return None


def _validate_options(input_file: Path, options: BenchOptions) -> None:
    if options.provider != DEFAULT_PROVIDER:
        raise BenchError("bench round 5 only supports local-faster-whisper.")
    if options.repeat <= 0:
        raise BenchError("--repeat must be greater than 0.")
    if not input_file.exists():
        raise BenchError(f"Input file does not exist: {input_file}")
    if not input_file.is_file():
        raise BenchError(f"Input path is not a file: {input_file}")


def _has_successful_run(report: dict[str, Any]) -> bool:
    return any(
        run.get("status") == "ok"
        for profile in report.get("profiles", [])
        for run in profile.get("runs", [])
    )


def _error_payload(exc: Exception) -> dict[str, Any]:
    if hasattr(exc, "as_dict"):
        return exc.as_dict()
    return {"code": exc.__class__.__name__, "message": str(exc)}


def _collect_profile_messages(report: dict[str, Any], key: str) -> list[str]:
    messages: list[str] = []
    for profile in report.get("profiles", []):
        name = profile.get("name")
        for run in profile.get("runs", []):
            if key == "warnings":
                for warning in run.get("warnings", []) or []:
                    messages.append(f"{name} run {run.get('index')}: {warning}")
            elif run.get("error"):
                messages.append(f"{name} run {run.get('index')}: {run.get('reason')}")
    return messages


def _profile_status(summary: dict[str, Any]) -> str:
    if summary.get("ok_runs"):
        return "ok"
    if summary.get("failed_runs"):
        return "failed"
    return "skipped"


def _redacted_command_string(command: list[str] | None, *, input_file: Path) -> str | None:
    if not command:
        return None
    redacted: list[str] = []
    path_options = {"--markdown", "--sample-manifest"}
    redact_next = False
    for token in command:
        if redact_next:
            redacted.append(Path(token).name)
            redact_next = False
            continue
        if token == str(input_file):
            redacted.append(input_file.name)
        elif token in path_options:
            redacted.append(token)
            redact_next = True
        else:
            redacted.append(token)
    return " ".join(redacted)


def _bench_output_dir(input_file: Path, generated_at: str) -> Path:
    safe_stamp = (
        generated_at.replace(":", "")
        .replace("-", "")
        .replace(".", "")
        .replace("Z", "z")
    )
    return Path(".fast-sub") / "bench" / f"{input_file.stem}-{safe_stamp}"


def _rtfx(duration_sec: float | None, elapsed_sec: float | None) -> float | None:
    if duration_sec is None or elapsed_sec is None or elapsed_sec <= 0:
        return None
    return _round(duration_sec / elapsed_sec)


def _mean(values: list[float]) -> float | None:
    return _round(statistics.fmean(values)) if values else None


def _round(value: float) -> float:
    return round(float(value), 3)


def _number(value: Any) -> float | None:
    try:
        return None if value is None else float(value)
    except (TypeError, ValueError):
        return None


def _optional_int(value: object) -> int | None:
    try:
        return None if value is None else int(value)
    except (TypeError, ValueError):
        return None


def _format_number(value: Any) -> str:
    number = _number(value)
    return "" if number is None else f"{number:.3f}"
