"""Transcription benchmark execution and report rendering."""

from __future__ import annotations

import json
import platform
import statistics
import subprocess
import sys
from collections.abc import Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pysubs2

from fast_sub.benchmark.constants import BENCH_OUTPUT_DIR_PARTS, BENCH_PROFILE_CHOICES
from fast_sub.benchmark.errors import BenchError
from fast_sub.benchmark.manifests import (
    BENCH_MEASUREMENT_SCOPE,
    BENCH_SCHEMA_VERSION,
)
from fast_sub.benchmark.models import (
    DEFAULT_PROFILES,
    BenchOptions,
    BenchProfile,
)
from fast_sub.benchmark.text_metrics import (
    error_rate,
    normalize_for_cer,
    normalize_for_wer,
    normalize_subtitle_text,
)
from fast_sub.contracts.errors import SubGenError
from fast_sub.stt.constants import DEFAULT_MODE, DEFAULT_MODEL, DEFAULT_PROVIDER
from fast_sub.stt.service import (
    TranscribeOptions,
    transcribe_media,
)

MEASUREMENT_SCOPE = BENCH_MEASUREMENT_SCOPE


def run_bench(
    input_file: Path,
    options: BenchOptions | None = None,
    *,
    hardware_detector: Any | None = None,
    transcriber: Any | None = None,
    profiles: tuple[BenchProfile, ...] | None = None,
) -> dict[str, Any]:
    """Run transcription benchmarks for selected local provider profiles."""
    options = options or BenchOptions()
    _validate_options(input_file, options)
    selected_profiles = profiles or _profiles_for_choice(options.profile)
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
    for profile in selected_profiles:
        _emit_progress(
            options.progress,
            "profile_start",
            profile=profile,
            repeat=options.repeat,
        )
        profile_report = _run_profile(
            input_file,
            options,
            profile,
            run_transcribe,
            output_dir,
            sample,
        )
        report["profiles"].append(profile_report)
        _emit_progress(
            options.progress,
            "profile_done",
            profile=profile,
            summary=profile_report["summary"],
        )

    if options.markdown is not None:
        options.markdown.parent.mkdir(parents=True, exist_ok=True)
        options.markdown.write_text(render_markdown_report(report), encoding="utf-8")

    if not _has_successful_run(report):
        raise BenchError("All benchmark profiles failed or were skipped.", report=report)
    return report


def detect_hardware() -> dict[str, Any]:
    """Return best-effort local CPU, memory, GPU, and CUDA metadata."""
    gpu_info = _detect_nvidia_gpu()
    cuda_count = _detect_cuda_device_count()
    memory_info = _detect_system_memory()
    return {
        "os": platform.system(),
        "platform": platform.platform(),
        "python": sys.version.split()[0],
        "cpu": platform.processor() or platform.machine() or "unknown",
        "ram_total_mb": memory_info.get("total_mb"),
        "ram_available_mb": memory_info.get("available_mb"),
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
    """Load sample metadata from a benchmark manifest, falling back to input metadata."""
    fallback = {"id": sample_id or input_file.stem}
    if manifest_path is None:
        return fallback
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BenchError(f"Could not read sample manifest: {exc}") from exc
    samples = payload.get("samples", [])
    if not isinstance(samples, list):
        raise BenchError("Sample manifest samples must be an array.")
    selected = _select_manifest_sample(samples, sample_id=sample_id, input_file=input_file)
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
        "prepared_media_checksum_sha256",
        "reference_transcript_path",
        "reference_transcript_checksum_sha256",
        "target_metrics",
    )
    metadata = {key: selected.get(key) for key in keys if key in selected}
    if "checksum_sha256" not in metadata and selected.get("prepared_media_checksum_sha256"):
        metadata["checksum_sha256"] = selected.get("prepared_media_checksum_sha256")
    return metadata


def render_markdown_report(report: dict[str, Any]) -> str:
    """Render a full Markdown report for a transcription benchmark result."""
    lines = _render_report_overview(report)
    lines.extend(_render_metric_guide())
    lines.extend(_render_run_details(report))
    lines.extend(_render_warnings_and_errors(report))
    lines.extend(_render_follow_up())
    return "\n".join(lines)


def _render_report_overview(report: dict[str, Any]) -> list[str]:
    sample = report.get("sample", {})
    hardware = report.get("hardware", {})
    fastest = _fastest_profile(report)
    has_quality = _report_has_quality(report)
    lines = [
        "# Fast Sub Benchmark Report",
        "",
        "## Summary",
        "",
        f"- Generated: {report.get('generated_at')}",
        f"- Input: `{report.get('input_basename')}`",
        f"- Sample: `{sample.get('id', 'unknown')}`",
        f"- Fastest profile: `{fastest}`",
        f"- Quality scoring: `{'available' if has_quality else 'not available'}`",
        f"- Subtitle health: `{_overall_subtitle_health(report)}`",
        f"- Source: `{sample.get('source_dataset', 'unknown')}`",
        f"- License: `{sample.get('license', 'unknown')}`",
        f"- Redistributable: `{sample.get('redistributable', 'unknown')}`",
        f"- Command: `{report.get('command') or 'unknown'}`",
        "",
        "## Machine",
        "",
        f"- OS: `{hardware.get('os', 'unknown')}`",
        f"- Platform: `{hardware.get('platform', 'unknown')}`",
        f"- Python: `{hardware.get('python', 'unknown')}`",
        f"- CPU: `{hardware.get('cpu', 'unknown')}`",
        f"- RAM: `{_format_memory_pair(hardware)}`",
        f"- GPU: `{hardware.get('gpu') or 'unavailable'}`",
        f"- VRAM: `{_format_mb(hardware.get('vram_total_mb'))}`",
        f"- CUDA available: `{_format_bool(hardware.get('cuda_available')) or 'unknown'}`",
        f"- CUDA devices: `{hardware.get('cuda_device_count')}`",
        "",
        "## Model",
        "",
        f"- Model: `{_first_run_value(report, 'model') or DEFAULT_MODEL}`",
        (
            f"- Language: "
            f"`{sample.get('language') or _first_run_value(report, 'language') or 'auto'}`"
        ),
        f"- Mode: `{_first_run_value(report, 'mode') or DEFAULT_MODE}`",
        f"- Repeat: `{_first_summary_value(report, 'runs') or 0}`",
        f"- Batch size: `{_first_run_value(report, 'batch_size') or 'unknown'}`",
        "",
        "## Results",
        "",
    ]
    lines.extend(_render_profile_table(report, include_requested=True))
    return lines


def _render_metric_guide() -> list[str]:
    return [
        "",
        "## Metric Guide",
        "",
        (
            "- RTFx: higher is faster. `1.0` is roughly real time; `10.0` "
            "means about 10 minutes of audio per minute of processing."
        ),
        (
            "- CER: character error rate. Lower is better, and it is usually "
            "more useful for Chinese and Japanese samples."
        ),
        (
            "- WER: word error rate. Lower is better, and it is usually more "
            "useful for English and Korean samples."
        ),
        (
            "- CER/WER rough guide: `< 0.05` excellent, `0.05-0.10` good, "
            "`0.10-0.20` usable with review, `> 0.20` higher quality risk."
        ),
        (
            "- CER/WER thresholds depend on language, noise, accents, "
            "segmentation, and reference transcript quality."
        ),
        "- End-to-end elapsed includes audio preparation and worker orchestration.",
        (
            "- Worker elapsed is measured inside the transcription worker; "
            "the difference is a rough proxy for preparation, process startup, "
            "model load, and dispatch overhead."
        ),
    ]


def _render_run_details(report: dict[str, Any]) -> list[str]:
    lines = ["", "## Run Details", ""]
    has_quality = _report_has_quality(report)
    for profile in report.get("profiles", []):
        lines.append(f"### {profile.get('name', 'unknown')}")
        lines.append("")
        lines.extend(_render_run_table(profile, has_quality=has_quality))
        for run in profile.get("runs", []):
            quality = run.get("quality", {})
            row = [
                str(run.get("index", "")),
                str(run.get("status", "")),
                _format_seconds(run.get("elapsed_sec")),
                _format_seconds(run.get("worker_elapsed_sec")),
                _format_seconds(run.get("overhead_sec")),
                _format_number(run.get("rtfx_e2e")),
                _format_number(run.get("worker_rtfx")),
            ]
            if has_quality:
                row.extend(
                    [
                        _format_number(quality.get("cer")),
                        _format_number(quality.get("wer")),
                    ]
                )
            row.extend(
                [
                    str(run.get("prediction_chars") or ""),
                    str(run.get("reference_chars") or ""),
                    _subtitle_health(run),
                ]
            )
            lines.append("| " + " | ".join(row) + " |")
        lines.append("")
    return lines


def _render_warnings_and_errors(report: dict[str, Any]) -> list[str]:
    warnings = _collect_profile_messages(report, "warnings")
    errors = _collect_profile_messages(report, "error")
    lines = ["", "## Warnings And Errors", ""]
    if not warnings and not errors:
        lines.append("- None.")
    for warning in warnings:
        lines.append(f"- warning: {warning}")
    for error in errors:
        lines.append(f"- error: {error}")
    return lines


def _render_follow_up() -> list[str]:
    return [
        "",
        "## Follow-up",
        "",
        "- TODO: add RTX 3060 and additional machine baselines before release.",
        "- TODO: expand fixed samples as local licensed media becomes available.",
        "",
    ]


def render_brief_report(report: dict[str, Any]) -> str:
    """Render a compact plain-text summary for CLI output."""
    sample = report.get("sample", {})
    hardware = report.get("hardware", {})
    has_quality = _report_has_quality(report)
    lines = [
        "Fast Sub Benchmark Summary",
        f"Input: {report.get('input_basename')}",
        f"Sample: {sample.get('id', 'unknown')}",
        f"Model: {_first_run_value(report, 'model') or DEFAULT_MODEL}",
        f"Machine: {_format_machine_summary(hardware)}",
        "",
    ]
    lines.extend(_render_profile_table(report, include_requested=False))
    lines.extend(["", _rtfx_interpretation(report)])
    if has_quality:
        lines.append("Quality: CER/WER are error rates; lower is better.")
    else:
        lines.append("Quality: CER/WER not shown because no reference transcript was matched.")
    return "\n".join(lines)


def _run_profile(
    input_file: Path,
    options: BenchOptions,
    profile: BenchProfile,
    run_transcribe: Any,
    output_dir: Path,
    sample: dict[str, Any],
) -> dict[str, Any]:
    runs = []
    for index in range(1, options.repeat + 1):
        _emit_progress(
            options.progress,
            "run_start",
            profile=profile,
            index=index,
            repeat=options.repeat,
        )
        runs.append(
            _run_once(input_file, options, profile, run_transcribe, index, output_dir, sample)
        )
        _emit_progress(
            options.progress,
            "run_done",
            profile=profile,
            index=index,
            run=runs[-1],
        )
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
    sample: dict[str, Any],
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
    overhead_sec = _overhead_sec(result.elapsed_sec, worker_elapsed_sec)
    subtitle_metrics = _analyze_srt_output(result.srt_path)
    quality = _score_quality(sample, subtitle_metrics["text"])
    return {
        "index": index,
        "status": "ok",
        "provider": result.provider,
        "model": result.model,
        "language": options.language,
        "mode": options.mode,
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
        "overhead_sec": overhead_sec,
        "rtfx_e2e": _rtfx(duration_sec, result.elapsed_sec),
        "worker_rtfx": _rtfx(duration_sec, worker_elapsed_sec),
        "segments_count": result.segments_count,
        "invalid_segments_count": subtitle_metrics["invalid_segments_count"],
        "empty_output": subtitle_metrics["empty_output"],
        "prediction_chars": subtitle_metrics["prediction_chars"],
        "reference_chars": quality["reference_chars"],
        "quality": quality,
        "warnings": result.warnings,
    }


def summarize_runs(runs: list[dict[str, Any]]) -> dict[str, Any]:
    """Summarize repeated benchmark runs for one profile."""
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
        "worker_elapsed_sec_avg": None,
        "overhead_sec_avg": None,
        "steady_state_elapsed_sec_avg": None,
        "rtfx_e2e_best": None,
        "rtfx_e2e_worst": None,
        "rtfx_e2e_avg": None,
        "worker_rtfx_best": None,
        "worker_rtfx_worst": None,
        "worker_rtfx_avg": None,
        "segments_count": None,
        "invalid_segments_count_avg": None,
        "empty_output_any": None,
        "prediction_chars_avg": None,
        "reference_chars_avg": None,
        "cer_avg": None,
        "wer_avg": None,
        "actual_device": None,
        "actual_compute_type": None,
    }
    if not ok_runs:
        return summary

    elapsed = _numbers(run.get("elapsed_sec") for run in ok_runs)
    rtfx_e2e = _numbers(run.get("rtfx_e2e") for run in ok_runs)
    worker_rtfx = _numbers(run.get("worker_rtfx") for run in ok_runs)
    worker_elapsed = _numbers(run.get("worker_elapsed_sec") for run in ok_runs)
    overhead = _numbers(run.get("overhead_sec") for run in ok_runs)
    steady_elapsed = _numbers(run.get("elapsed_sec") for run in ok_runs[1:])
    invalid_segments = _numbers(run.get("invalid_segments_count") for run in ok_runs)
    prediction_chars = _numbers(run.get("prediction_chars") for run in ok_runs)
    reference_chars = _numbers(run.get("reference_chars") for run in ok_runs)
    cer_values = _numbers(
        (run.get("quality") or {}).get("cer")
        for run in ok_runs
        if isinstance(run.get("quality"), dict)
    )
    wer_values = _numbers(
        (run.get("quality") or {}).get("wer")
        for run in ok_runs
        if isinstance(run.get("quality"), dict)
    )

    summary.update(
        {
            "first_run_elapsed_sec": ok_runs[0].get("elapsed_sec"),
            "elapsed_sec_min": _round(min(elapsed)) if elapsed else None,
            "elapsed_sec_max": _round(max(elapsed)) if elapsed else None,
            "elapsed_sec_avg": _mean(elapsed),
            "worker_elapsed_sec_avg": _mean(worker_elapsed),
            "overhead_sec_avg": _mean(overhead),
            "steady_state_elapsed_sec_avg": _mean(steady_elapsed),
            "rtfx_e2e_best": _round(max(rtfx_e2e)) if rtfx_e2e else None,
            "rtfx_e2e_worst": _round(min(rtfx_e2e)) if rtfx_e2e else None,
            "rtfx_e2e_avg": _mean(rtfx_e2e),
            "worker_rtfx_best": _round(max(worker_rtfx)) if worker_rtfx else None,
            "worker_rtfx_worst": _round(min(worker_rtfx)) if worker_rtfx else None,
            "worker_rtfx_avg": _mean(worker_rtfx),
            "segments_count": ok_runs[0].get("segments_count"),
            "invalid_segments_count_avg": _mean(invalid_segments),
            "empty_output_any": any(run.get("empty_output") for run in ok_runs),
            "prediction_chars_avg": _mean(prediction_chars),
            "reference_chars_avg": _mean(reference_chars),
            "cer_avg": _mean(cer_values),
            "wer_avg": _mean(wer_values),
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


def _detect_system_memory() -> dict[str, int | None]:
    try:
        import psutil  # type: ignore[import-not-found]
    except Exception:
        return {"total_mb": None, "available_mb": None}
    try:
        memory = psutil.virtual_memory()
    except Exception:
        return {"total_mb": None, "available_mb": None}
    return {
        "total_mb": int(memory.total / 1024 / 1024),
        "available_mb": int(memory.available / 1024 / 1024),
    }


def _select_manifest_sample(
    samples: list[Any],
    *,
    sample_id: str | None,
    input_file: Path,
) -> dict[str, Any] | None:
    for sample in samples:
        if not isinstance(sample, dict):
            continue
        if sample_id is not None and sample.get("id") == sample_id:
            return sample
        media_path = sample.get("prepared_media_path")
        if sample_id is None and media_path and Path(str(media_path)).name == input_file.name:
            return sample
    return None


def _validate_options(input_file: Path, options: BenchOptions) -> None:
    if options.provider != DEFAULT_PROVIDER:
        raise BenchError("bench round 5 only supports local-faster-whisper.")
    if options.profile not in BENCH_PROFILE_CHOICES:
        supported = ", ".join(sorted(BENCH_PROFILE_CHOICES))
        raise BenchError(f"--profile must be one of: {supported}.")
    if options.repeat <= 0:
        raise BenchError("--repeat must be greater than 0.")
    if not input_file.exists():
        raise BenchError(f"Input file does not exist: {input_file}")
    if not input_file.is_file():
        raise BenchError(f"Input path is not a file: {input_file}")


def _profiles_for_choice(choice: str) -> tuple[BenchProfile, ...]:
    if choice == "all":
        return DEFAULT_PROFILES
    for profile in DEFAULT_PROFILES:
        if profile.name == choice:
            return (profile,)
    supported = ", ".join(sorted(BENCH_PROFILE_CHOICES))
    raise BenchError(f"--profile must be one of: {supported}.")


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


def _report_has_quality(report: dict[str, Any]) -> bool:
    return any(
        (run.get("quality") or {}).get("cer") is not None
        or (run.get("quality") or {}).get("wer") is not None
        for profile in report.get("profiles", [])
        for run in profile.get("runs", [])
        if isinstance(run.get("quality"), dict)
    )


def _render_profile_table(report: dict[str, Any], *, include_requested: bool) -> list[str]:
    has_quality = _report_has_quality(report)
    headers = ["profile"]
    aligns = ["---"]
    if include_requested:
        headers.extend(["requested", "actual"])
        aligns.extend(["---", "---"])
    else:
        headers.append("actual")
        aligns.append("---")
    headers.extend(["elapsed", "overhead approx", "avg RTFx"])
    aligns.extend(["---:", "---:", "---:"])
    if has_quality:
        headers.extend(["CER", "WER", "quality"])
        aligns.extend(["---:", "---:", "---"])
    headers.extend(["subtitle health", "status"])
    aligns.extend(["---", "---"])
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(aligns) + " |",
    ]
    for profile in report.get("profiles", []):
        summary = profile.get("summary", {})
        requested = (
            f"{profile.get('requested_device') or 'unknown'}/"
            f"{profile.get('requested_compute_type') or 'unknown'}"
        )
        actual = (
            f"{summary.get('actual_device') or 'unknown'}/"
            f"{summary.get('actual_compute_type') or 'unknown'}"
        )
        row = [str(profile.get("name", ""))]
        if include_requested:
            row.extend([requested, actual])
        else:
            row.append(actual)
        row.extend(
            [
                _format_seconds(summary.get("elapsed_sec_avg")),
                _format_seconds(summary.get("overhead_sec_avg")),
                _format_number(summary.get("rtfx_e2e_avg")),
            ]
        )
        if has_quality:
            row.extend(
                [
                    _format_number(summary.get("cer_avg")),
                    _format_number(summary.get("wer_avg")),
                    _quality_label(summary),
                ]
            )
        row.extend([_summary_subtitle_health(summary), _profile_status(summary)])
        lines.append("| " + " | ".join(row) + " |")
    return lines


def _render_run_table(profile: dict[str, Any], *, has_quality: bool) -> list[str]:
    headers = [
        "run",
        "status",
        "elapsed",
        "worker elapsed",
        "overhead approx",
        "RTFx e2e",
        "worker RTFx",
    ]
    aligns = ["---:", "---", "---:", "---:", "---:", "---:", "---:"]
    if has_quality:
        headers.extend(["CER", "WER"])
        aligns.extend(["---:", "---:"])
    headers.extend(["prediction chars", "reference chars", "subtitle health"])
    aligns.extend(["---:", "---:", "---"])
    return [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(aligns) + " |",
    ]


def _summary_subtitle_health(summary: dict[str, Any]) -> str:
    invalid = _number(summary.get("invalid_segments_count_avg"))
    empty = summary.get("empty_output_any")
    if invalid == 0 and empty is False:
        return "ok"
    problems = []
    if empty is True:
        problems.append("empty output")
    if invalid and invalid > 0:
        problems.append(f"invalid segments {_format_number(invalid)}")
    return ", ".join(problems) if problems else "unknown"


def _subtitle_health(run: dict[str, Any]) -> str:
    invalid = _number(run.get("invalid_segments_count"))
    empty = run.get("empty_output")
    if invalid == 0 and empty is False:
        return "ok"
    problems = []
    if empty is True:
        problems.append("empty output")
    if invalid and invalid > 0:
        problems.append(f"invalid segments {int(invalid)}")
    return ", ".join(problems) if problems else "unknown"


def _quality_label(summary: dict[str, Any]) -> str:
    values = [
        value
        for value in (_number(summary.get("cer_avg")), _number(summary.get("wer_avg")))
        if value is not None
    ]
    if not values:
        return "unscored"
    score = max(values)
    if score < 0.05:
        return "excellent"
    if score < 0.10:
        return "good"
    if score < 0.20:
        return "review"
    return "risk"


def _overall_subtitle_health(report: dict[str, Any]) -> str:
    health = [
        _summary_subtitle_health(profile.get("summary", {}))
        for profile in report.get("profiles", [])
    ]
    if health and all(value == "ok" for value in health):
        return "ok"
    problems = [value for value in health if value and value != "ok"]
    return ", ".join(problems) if problems else "unknown"


def _fastest_profile(report: dict[str, Any]) -> str:
    candidates: list[tuple[float, str]] = []
    for profile in report.get("profiles", []):
        rtfx = _number((profile.get("summary") or {}).get("rtfx_e2e_avg"))
        name = str(profile.get("name") or "unknown")
        if rtfx is not None:
            candidates.append((rtfx, name))
    if not candidates:
        return "unknown"
    return max(candidates)[1]


def _first_run_value(report: dict[str, Any], key: str) -> Any:
    for profile in report.get("profiles", []):
        for run in profile.get("runs", []):
            if run.get(key) is not None:
                return run.get(key)
    return None


def _first_summary_value(report: dict[str, Any], key: str) -> Any:
    for profile in report.get("profiles", []):
        summary = profile.get("summary", {})
        if summary.get(key) is not None:
            return summary.get(key)
    return None


def _format_machine_summary(hardware: dict[str, Any]) -> str:
    gpu = hardware.get("gpu") or "GPU unavailable"
    ram = _format_mb(hardware.get("ram_total_mb"))
    cpu = hardware.get("cpu") or "CPU unknown"
    return f"{gpu}, RAM {ram}, CPU {cpu}"


def _format_memory_pair(hardware: dict[str, Any]) -> str:
    total = _format_mb(hardware.get("ram_total_mb"))
    available = _format_mb(hardware.get("ram_available_mb"))
    return f"{total} total, {available} available"


def _rtfx_interpretation(report: dict[str, Any]) -> str:
    values = _numbers(
        (profile.get("summary") or {}).get("rtfx_e2e_avg") for profile in report.get("profiles", [])
    )
    if not values:
        return "RTFx: higher is faster. 1.0 is roughly real time."
    best = max(values)
    return (
        f"RTFx: higher is faster. {_format_number(best)} means about "
        f"{_format_number(best)} minutes of audio per minute of processing."
    )


def _analyze_srt_output(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {
            "text": "",
            "prediction_chars": 0,
            "empty_output": True,
            "invalid_segments_count": 0,
        }
    try:
        subs = pysubs2.SSAFile.from_string(path.read_text(encoding="utf-8"), format_="srt")
    except Exception:
        return {
            "text": "",
            "prediction_chars": 0,
            "empty_output": True,
            "invalid_segments_count": 1,
        }
    texts = []
    invalid = 0
    previous_end = 0
    for event in subs.events:
        text = normalize_subtitle_text(event.text)
        if not text:
            invalid += 1
            continue
        if event.end <= event.start or event.start < previous_end:
            invalid += 1
        previous_end = max(previous_end, event.end)
        texts.append(text)
    joined = "\n".join(texts).strip()
    return {
        "text": joined,
        "prediction_chars": len(normalize_for_cer(joined)),
        "empty_output": not bool(joined),
        "invalid_segments_count": invalid,
    }


def _emit_progress(progress: Any | None, event: str, **payload: Any) -> None:
    if progress is None:
        return
    progress(event, **payload)


def _score_quality(sample: dict[str, Any], prediction: str) -> dict[str, Any]:
    reference_path = sample.get("reference_transcript_path")
    if not reference_path:
        return {
            "reference_available": False,
            "wer": None,
            "cer": None,
            "reference_chars": None,
            "prediction_chars": len(normalize_for_cer(prediction)),
        }
    path = Path(str(reference_path))
    if not path.is_absolute():
        path = Path.cwd() / path
    if not path.exists():
        return {
            "reference_available": False,
            "wer": None,
            "cer": None,
            "reference_chars": None,
            "prediction_chars": len(normalize_for_cer(prediction)),
        }
    reference = path.read_text(encoding="utf-8")
    reference_cer_text = normalize_for_cer(reference)
    prediction_cer_text = normalize_for_cer(prediction)
    reference_words = normalize_for_wer(reference)
    prediction_words = normalize_for_wer(prediction)
    return {
        "reference_available": True,
        "wer": error_rate(reference_words, prediction_words),
        "cer": error_rate(list(reference_cer_text), list(prediction_cer_text)),
        "reference_chars": len(reference_cer_text),
        "prediction_chars": len(prediction_cer_text),
    }


def _redacted_command_string(command: list[str] | None, *, input_file: Path) -> str | None:
    if not command:
        return None
    redacted: list[str] = []
    path_options = {"--markdown-path", "--sample-manifest"}
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
    safe_stamp = generated_at.replace(":", "").replace("-", "").replace(".", "").replace("Z", "z")
    return Path(*BENCH_OUTPUT_DIR_PARTS) / f"{input_file.stem}-{safe_stamp}"


def _rtfx(duration_sec: float | None, elapsed_sec: float | None) -> float | None:
    if duration_sec is None or elapsed_sec is None or elapsed_sec <= 0:
        return None
    return _round(duration_sec / elapsed_sec)


def _overhead_sec(elapsed_sec: float | None, worker_elapsed_sec: float | None) -> float | None:
    if elapsed_sec is None or worker_elapsed_sec is None:
        return None
    return _round(max(0.0, elapsed_sec - worker_elapsed_sec))


def _mean(values: list[float]) -> float | None:
    return _round(statistics.fmean(values)) if values else None


def _round(value: float) -> float:
    return round(float(value), 3)


def _number(value: Any) -> float | None:
    try:
        return None if value is None else float(value)
    except (TypeError, ValueError):
        return None


def _numbers(values: Iterable[Any]) -> list[float]:
    return [number for value in values if (number := _number(value)) is not None]


def _optional_int(value: Any) -> int | None:
    try:
        return None if value is None else int(value)
    except (TypeError, ValueError):
        return None


def _format_number(value: Any) -> str:
    number = _number(value)
    return "" if number is None else f"{number:.3f}"


def _format_seconds(value: Any) -> str:
    number = _number(value)
    return "" if number is None else f"{number:.3f}s"


def _format_mb(value: Any) -> str:
    number = _number(value)
    if number is None:
        return "unknown"
    if number >= 1024:
        return f"{number / 1024:.1f} GB"
    return f"{number:.0f} MB"


def _format_bool(value: Any) -> str:
    if value is True:
        return "yes"
    if value is False:
        return "no"
    return ""
