"""Orchestration for the local automatic subtitle pipeline."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
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


@dataclass
class _AutoRunState:
    input_file: Path
    options: AutoOptions
    started: float = field(default_factory=time.perf_counter)
    steps: list[AutoStep] = field(default_factory=list)

    @property
    def output(self) -> Path:
        return self.options.output or self.input_file.with_suffix(".srt")

    def finish(
        self,
        *,
        ok: bool,
        error: str | None = None,
        transcribe_result: TranscribeResult | None = None,
    ) -> AutoResult:
        return AutoResult(
            ok=ok,
            input=self.input_file,
            output=self.output,
            provider=self.options.provider,
            model=self.options.model,
            language=self.options.language,
            dry_run=self.options.dry_run,
            steps=list(self.steps),
            elapsed_sec=round(time.perf_counter() - self.started, 3),
            error=error,
            transcribe_result=transcribe_result,
        )

    def fail(self, step: AutoStep) -> AutoPipelineError:
        self.steps.append(step)
        return AutoPipelineError(self.finish(ok=False, error=step.message))


def auto_media(input_file: Path, options: AutoOptions | None = None) -> AutoResult:
    """Run the local auto pipeline from media inspection through refined SRT output."""
    state = _AutoRunState(input_file=input_file, options=options or AutoOptions())

    try:
        _run_preflight_steps(state)
        resolution = _resolve_provider(state)

        if resolution.provider_location == "api":
            return _handle_api_provider(state)

        if resolution.status == "missing_model":
            resolution = _handle_missing_model(state)

        if state.options.dry_run:
            return _finish_dry_run(state, resolution)

        if resolution.status != "available":
            raise state.fail(
                AutoStep(
                    "provider",
                    resolution.status,
                    resolution.message,
                    action_hint=resolution.action_hint,
                )
            )

        return _run_transcribe_and_refine(state)
    except AutoPipelineError:
        raise
    except (SubGenError, WorkerRunnerError, ModelManagerError, KeyError, OSError) as exc:
        step = AutoStep("auto", "error", str(exc))
        state.steps.append(step)
        raise AutoPipelineError(state.finish(ok=False, error=str(exc))) from exc


def _run_preflight_steps(state: _AutoRunState) -> None:
    _validate_auto_input(state.input_file)
    state.steps.append(AutoStep("input", "ok", "Input media file is usable."))

    ensure_media_tools()
    state.steps.append(AutoStep("doctor", "ok", "Required media tools are available."))

    probe = probe_media(state.input_file)
    state.steps.append(
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

    analysis = analyze_media(state.input_file)
    state.steps.append(
        AutoStep(
            "analyze",
            "ok",
            "Audio analysis completed.",
            details=analysis.as_dict(),
        )
    )


def _resolve_provider(state: _AutoRunState, *, step_name: str = "provider") -> Any:
    options = state.options
    resolution = resolve_stt_provider(
        options.provider,
        options.model,
        language=options.language,
        device=options.device,
        compute_type=options.compute_type,
    )
    state.steps.append(_resolution_step(resolution, name=step_name))
    return resolution


def _handle_api_provider(state: _AutoRunState) -> AutoResult:
    state.steps.append(
        AutoStep(
            "provider",
            "unsupported_api_provider",
            "fast-sub auto v0 only supports local STT providers.",
            action_hint=(
                "Choose --provider local-faster-whisper. --yes never authorizes API upload."
            ),
        )
    )
    if state.options.dry_run:
        state.steps.append(AutoStep("transcribe", "blocked", "API STT is not used by auto v0."))
        state.steps.append(AutoStep("refine", "blocked", "Refine requires local transcription."))
        return state.finish(ok=True)
    raise AutoPipelineError(
        state.finish(ok=False, error="fast-sub auto v0 only supports local STT providers.")
    )


def _handle_missing_model(state: _AutoRunState) -> Any:
    options = state.options
    if options.dry_run:
        state.steps.append(_missing_model_step(options.model))
        state.steps.append(
            AutoStep("transcribe", "planned", "Would transcribe after model install.")
        )
        state.steps.append(AutoStep("refine", "planned", "Would refine the generated subtitle."))
        return None
    if not options.yes:
        raise state.fail(_missing_model_step(options.model))

    _install_local_model(options.model, state.steps)
    return _resolve_provider(state, step_name="provider_after_install")


def _finish_dry_run(state: _AutoRunState, resolution: Any) -> AutoResult:
    if resolution is not None and resolution.status == "available":
        state.steps.append(AutoStep("model", "installed", "Model is already installed."))
        state.steps.append(AutoStep("transcribe", "planned", "Would transcribe source subtitles."))
        state.steps.append(AutoStep("refine", "planned", "Would refine the generated subtitle."))
    elif resolution is not None:
        state.steps.append(
            AutoStep(
                "transcribe",
                "blocked",
                f"Provider/model is not ready: {resolution.status}.",
                action_hint=resolution.action_hint,
            )
        )
        state.steps.append(AutoStep("refine", "blocked", "Refine requires transcription output."))
    return state.finish(ok=True)


def _run_transcribe_and_refine(state: _AutoRunState) -> AutoResult:
    raw_output = _raw_transcribe_output(state.output)
    transcribe_result = transcribe_media(
        state.input_file,
        _transcribe_options(state.options, raw_output),
    )
    state.steps.append(
        AutoStep(
            "transcribe",
            "ok",
            "Source subtitle transcription completed.",
            details={"output": str(transcribe_result.srt_path)},
        )
    )

    _refine_subtitle(transcribe_result.srt_path, state.output, state.options)
    state.steps.append(
        AutoStep(
            "refine",
            "ok",
            "Final subtitle refinement completed.",
            details={"output": str(state.output)},
        )
    )
    return state.finish(ok=True, transcribe_result=transcribe_result)


def _transcribe_options(options: AutoOptions, output: Path) -> TranscribeOptions:
    return TranscribeOptions(
        provider=options.provider,
        model=options.model,
        language=options.language,
        device=options.device,
        compute_type=options.compute_type,
        batch_size=options.batch_size,
        gpu_load=options.gpu_load,
        vad=options.vad,
        mode=options.mode,
        output=output,
        keep_temp=options.keep_temp,
        worker_command=options.worker_command,
    )


def _missing_model_step(model: str) -> AutoStep:
    return AutoStep(
        "model",
        "missing_model",
        f"Model is not installed: {model}.",
        action_hint=f"Run `fast-sub models install {model}` or `fast-sub auto --yes`.",
    )


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
