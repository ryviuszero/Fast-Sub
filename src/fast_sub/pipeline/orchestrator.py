"""Orchestration for the local automatic subtitle pipeline."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

from fast_sub.contracts.errors import SubGenError, WorkerRunnerError
from fast_sub.infrastructure.ffmpeg import ensure_media_tools, is_media_file, probe_media
from fast_sub.media.service import analyze_media
from fast_sub.model_store.errors import ModelManagerError
from fast_sub.model_store.manager import install_model
from fast_sub.model_store.manifest import get_model
from fast_sub.pipeline.constants import RAW_TRANSCRIBE_SUFFIX
from fast_sub.pipeline.errors import AutoPipelineError
from fast_sub.pipeline.models import AutoOptions, AutoResult, AutoStep
from fast_sub.providers.resolution import resolve_stt_provider
from fast_sub.stt.service import (
    TranscribeOptions,
    TranscribeResult,
    transcribe_media,
)
from fast_sub.subtitles.srt import RefineOptions, refine_srt_text


def auto_media(input_file: Path, options: AutoOptions | None = None) -> AutoResult:
    """Run the local auto pipeline from media inspection through refined SRT output."""
    options = options or AutoOptions()
    started = time.perf_counter()
    steps: list[AutoStep] = []
    output = options.output or input_file.with_suffix(".srt")

    def finish(
        *,
        ok: bool,
        error: str | None = None,
        transcribe_result: TranscribeResult | None = None,
    ) -> AutoResult:
        return AutoResult(
            ok=ok,
            input=input_file,
            output=output,
            provider=options.provider,
            model=options.model,
            language=options.language,
            dry_run=options.dry_run,
            steps=list(steps),
            elapsed_sec=round(time.perf_counter() - started, 3),
            error=error,
            transcribe_result=transcribe_result,
        )

    def fail(step: AutoStep) -> AutoPipelineError:
        steps.append(step)
        return AutoPipelineError(finish(ok=False, error=step.message))

    try:
        _validate_auto_input(input_file)
        steps.append(AutoStep("input", "ok", "Input media file is usable."))

        ensure_media_tools()
        steps.append(AutoStep("doctor", "ok", "Required media tools are available."))

        probe = probe_media(input_file)
        steps.append(
            AutoStep(
                "probe",
                "ok",
                "Media probe completed.",
                details={
                    "duration_sec": probe.get("duration_sec"),
                    "audio_streams": len(probe.get("audio_streams", [])),
                    "video_streams": len(probe.get("video_streams", [])),
                },
            )
        )

        analysis = analyze_media(input_file)
        steps.append(
            AutoStep(
                "analyze",
                "ok",
                "Audio analysis completed.",
                details=analysis.as_dict(),
            )
        )

        resolution = resolve_stt_provider(
            options.provider,
            options.model,
            language=options.language,
            device=options.device,
            compute_type=options.compute_type,
        )
        steps.append(_resolution_step(resolution))

        if resolution.provider_location == "api":
            steps.append(
                AutoStep(
                    "provider",
                    "unsupported_api_provider",
                    "fast-sub auto v0 only supports local STT providers.",
                    action_hint=(
                        "Choose --provider local-faster-whisper. --yes never authorizes API upload."
                    ),
                )
            )
            if options.dry_run:
                steps.append(AutoStep("transcribe", "blocked", "API STT is not used by auto v0."))
                steps.append(AutoStep("refine", "blocked", "Refine requires local transcription."))
                return finish(ok=True)
            raise AutoPipelineError(
                finish(ok=False, error="fast-sub auto v0 only supports local STT providers.")
            )

        if resolution.status == "missing_model":
            if options.dry_run:
                steps.append(
                    AutoStep(
                        "model",
                        "missing_model",
                        f"Model is not installed: {options.model}.",
                        action_hint=(
                            f"Run `fast-sub models install {options.model}` "
                            "or `fast-sub auto --yes`."
                        ),
                    )
                )
                steps.append(
                    AutoStep(
                        "transcribe",
                        "planned",
                        "Would transcribe after model install.",
                    )
                )
                steps.append(AutoStep("refine", "planned", "Would refine the generated subtitle."))
                return finish(ok=True)
            if not options.yes:
                raise fail(
                    AutoStep(
                        "model",
                        "missing_model",
                        f"Model is not installed: {options.model}.",
                        action_hint=(
                            f"Run `fast-sub models install {options.model}` "
                            "or `fast-sub auto --yes`."
                        ),
                    )
                )
            _install_local_model(options.model, steps)
            resolution = resolve_stt_provider(
                options.provider,
                options.model,
                language=options.language,
                device=options.device,
                compute_type=options.compute_type,
            )
            steps.append(_resolution_step(resolution, name="provider_after_install"))

        if options.dry_run:
            if resolution.status == "available":
                steps.append(AutoStep("model", "installed", "Model is already installed."))
                steps.append(
                    AutoStep("transcribe", "planned", "Would transcribe source subtitles.")
                )
                steps.append(AutoStep("refine", "planned", "Would refine the generated subtitle."))
            else:
                steps.append(
                    AutoStep(
                        "transcribe",
                        "blocked",
                        f"Provider/model is not ready: {resolution.status}.",
                        action_hint=resolution.action_hint,
                    )
                )
                steps.append(AutoStep("refine", "blocked", "Refine requires transcription output."))
            return finish(ok=True)

        if resolution.status != "available":
            raise fail(
                AutoStep(
                    "provider",
                    resolution.status,
                    resolution.message,
                    action_hint=resolution.action_hint,
                )
            )

        raw_output = _raw_transcribe_output(output)
        transcribe_result = transcribe_media(
            input_file,
            TranscribeOptions(
                provider=options.provider,
                model=options.model,
                language=options.language,
                device=options.device,
                compute_type=options.compute_type,
                batch_size=options.batch_size,
                gpu_load=options.gpu_load,
                vad=options.vad,
                mode=options.mode,
                output=raw_output,
                keep_temp=options.keep_temp,
                worker_command=options.worker_command,
            ),
        )
        steps.append(
            AutoStep(
                "transcribe",
                "ok",
                "Source subtitle transcription completed.",
                details={"output": str(transcribe_result.srt_path)},
            )
        )

        _refine_subtitle(transcribe_result.srt_path, output, options)
        steps.append(
            AutoStep(
                "refine",
                "ok",
                "Final subtitle refinement completed.",
                details={"output": str(output)},
            )
        )
        return finish(ok=True, transcribe_result=transcribe_result)
    except AutoPipelineError:
        raise
    except (SubGenError, WorkerRunnerError, ModelManagerError, KeyError, OSError) as exc:
        step = AutoStep("auto", "error", str(exc))
        steps.append(step)
        raise AutoPipelineError(finish(ok=False, error=str(exc))) from exc


def _validate_auto_input(input_file: Path) -> None:
    if not input_file.exists():
        raise SubGenError(f"Input file does not exist: {input_file}")
    if not input_file.is_file():
        raise SubGenError(f"Input path is not a file: {input_file}")
    if not is_media_file(input_file):
        raise SubGenError(f"Unsupported input file type: {input_file}")


def _resolution_step(resolution: Any, *, name: str = "provider") -> AutoStep:
    status = "ok" if resolution.status == "available" else resolution.status
    return AutoStep(
        name,
        status,
        resolution.message,
        action_hint=resolution.action_hint,
        details={
            "provider": resolution.provider_id,
            "model": resolution.model_id,
            "local": resolution.local,
            "model_installed": resolution.model_installed,
            "model_path": str(resolution.model_path) if resolution.model_path else None,
            "privacy_note": resolution.privacy_note,
        },
    )


def _install_local_model(model_id: str, steps: list[AutoStep]) -> None:
    steps.append(
        AutoStep(
            "model",
            "installing",
            f"Installing local model: {model_id}.",
        )
    )
    try:
        status = install_model(get_model(model_id))
    except (KeyError, ModelManagerError, OSError) as exc:
        raise ModelManagerError(f"Failed to install local model {model_id}: {exc}") from exc
    steps.append(
        AutoStep(
            "model",
            "installed",
            f"Installed and verified local model: {model_id}.",
            details=status.as_dict(),
        )
    )


def _raw_transcribe_output(output: Path) -> Path:
    return output.with_name(f"{output.stem}{RAW_TRANSCRIBE_SUFFIX}")


def _refine_subtitle(input_srt: Path, output: Path, options: AutoOptions) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    refined = refine_srt_text(
        input_srt.read_text(encoding="utf-8-sig"),
        RefineOptions(
            lang=options.language,
            max_chars=options.refine_max_chars,
            max_duration=options.refine_max_duration,
        ),
    )
    output.write_text(refined, encoding="utf-8")
