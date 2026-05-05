from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Annotated, Any

import typer

from fast_sub.cli.context import console, err_console
from fast_sub.cli.errors import exit_code_for_payload, json_error_for_exception
from fast_sub.cli.redaction import redact_secrets
from fast_sub.contracts.errors import SubGenError
from fast_sub.pipeline.orchestrator import AutoOptions, AutoPipelineError, auto_media

AutoMediaRunner = Callable[[Path, AutoOptions], Any]


def register_auto_command(
    app: typer.Typer,
    *,
    auto_runner: AutoMediaRunner = auto_media,
) -> None:
    """Register the local auto-pipeline command."""

    @app.command("auto")
    def auto_command(
        input_file: Annotated[Path, typer.Argument(help="Input video/audio file.")],
        provider: Annotated[
            str,
            typer.Option("--provider", help="STT provider id."),
        ] = "local-faster-whisper",
        model: Annotated[
            str,
            typer.Option("--model", help="ASR model id."),
        ] = "whisper-small",
        language: Annotated[
            str,
            typer.Option("--language", help="Language: auto, zh, en, ja, or ko."),
        ] = "auto",
        device: Annotated[
            str,
            typer.Option("--device", help="Worker device: auto, cuda, or cpu."),
        ] = "auto",
        compute: Annotated[
            str,
            typer.Option("--compute", help="Worker compute type."),
        ] = "auto",
        batch_size: Annotated[
            int | None,
            typer.Option("--batch-size", help="Worker batch size. Overrides --gpu-load."),
        ] = None,
        gpu_load: Annotated[
            str,
            typer.Option("--gpu-load", help="GPU load profile: low, balanced, or max."),
        ] = "balanced",
        vad: Annotated[
            str,
            typer.Option("--vad", help="VAD mode: auto, off, normal, or aggressive."),
        ] = "auto",
        mode: Annotated[
            str,
            typer.Option("--mode", help="Transcription mode: fast, balanced, or quality."),
        ] = "balanced",
        output: Annotated[
            Path | None,
            typer.Option("--output", "-o", help="Final output .srt path."),
        ] = None,
        dry_run: Annotated[
            bool,
            typer.Option(
                "--dry-run",
                help="Print the auto plan without downloading or transcribing.",
            ),
        ] = False,
        yes: Annotated[
            bool,
            typer.Option("--yes", "-y", help="Allow automatic local model installation."),
        ] = False,
        json_output: Annotated[
            bool,
            typer.Option("--json", help="Print machine-readable result metadata."),
        ] = False,
        keep_temp: Annotated[
            bool,
            typer.Option("--keep-temp", help="Keep prepared audio and worker JSON files."),
        ] = False,
    ) -> None:
        """Plan and run the local subtitle pipeline."""
        run_auto_entry(
            input_file=input_file,
            provider=provider,
            model=model,
            language=language,
            device=device,
            compute=compute,
            batch_size=batch_size,
            gpu_load=gpu_load,
            vad=vad,
            mode=mode,
            output=output,
            dry_run=dry_run,
            yes=yes,
            json_output=json_output,
            keep_temp=keep_temp,
            auto_runner=auto_runner,
        )


def run_auto_entry(
    *,
    input_file: Path,
    provider: str,
    model: str,
    language: str,
    device: str,
    compute: str,
    batch_size: int | None,
    gpu_load: str,
    vad: str,
    mode: str,
    output: Path | None,
    dry_run: bool,
    yes: bool,
    json_output: bool,
    keep_temp: bool,
    auto_runner: AutoMediaRunner = auto_media,
) -> None:
    """Run the auto pipeline and render CLI output."""
    try:
        result = auto_runner(
            input_file,
            AutoOptions(
                provider=provider,
                model=model,
                language=language,
                device=device,
                compute_type=compute,
                batch_size=batch_size,
                gpu_load=gpu_load,
                vad=vad,
                mode=mode,
                output=output,
                dry_run=dry_run,
                yes=yes,
                keep_temp=keep_temp,
            ),
        )
    except AutoPipelineError as exc:
        if json_output:
            typer.echo(json.dumps(exc.result.as_dict(), ensure_ascii=False, indent=2))
        else:
            _print_auto_result(exc.result)
            err_console.print(f"[red]Error:[/red] {redact_secrets(str(exc))}")
        raise typer.Exit(_auto_exit_code(exc.result)) from exc

    if json_output:
        typer.echo(json.dumps(result.as_dict(), ensure_ascii=False, indent=2))
        return
    _print_auto_result(result)


def _auto_exit_code(result: Any) -> int:
    statuses = {getattr(step, "status", "") for step in result.steps}
    names = {getattr(step, "name", "") for step in result.steps}
    if "missing_model" in statuses:
        return 4
    if "missing_dependency" in statuses:
        return 3
    if "input" in names:
        input_step = next((step for step in result.steps if step.name == "input"), None)
        if input_step is not None and input_step.status != "ok":
            return 2
    error = result.error or ""
    payload = json_error_for_exception(SubGenError(error), stage="auto", code="command_failed")
    return exit_code_for_payload(payload)


def _print_auto_result(result: Any) -> None:
    console.print("[bold]Fast Sub auto[/bold]")
    for step in result.steps:
        color = _auto_step_color(step.status)
        console.print(f"[{color}]{step.name}:[/{color}] {step.status} - {step.message}")
        if step.action_hint:
            console.print(f"  hint: {step.action_hint}")
    if result.ok and not result.dry_run:
        console.print(f"[green]Wrote subtitle:[/green] {result.output}")
    elif result.ok:
        console.print(f"[cyan]Dry run only:[/cyan] planned output {result.output}")


def _auto_step_color(status: str) -> str:
    if status in {"ok", "installed", "planned"}:
        return "green"
    if status in {"missing_model", "blocked", "installing"}:
        return "yellow"
    return "red"
