from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Annotated, Any

import typer

from fast_sub.cli.errors import exit_code_for_payload
from fast_sub.cli.helpers import err_console, redact_secrets, redact_value
from fast_sub.contracts.errors import SubGenError, WorkerRunnerError
from fast_sub.stt.service import TranscribeOptions, transcribe_error_payload, transcribe_media

TranscribeRunner = Callable[[Path, TranscribeOptions], Any]


def register_transcribe_command(
    app: typer.Typer,
    *,
    transcribe_runner: TranscribeRunner = transcribe_media,
) -> None:
    """Register the media transcription command."""

    @app.command("transcribe")
    def transcribe_command(
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
            typer.Option("--output", "-o", help="Output .srt path."),
        ] = None,
        json_output: Annotated[
            bool,
            typer.Option("--json", help="Print machine-readable result metadata."),
        ] = False,
        keep_temp: Annotated[
            bool,
            typer.Option("--keep-temp", help="Keep prepared audio and worker JSON files."),
        ] = False,
    ) -> None:
        """Transcribe media into source-language subtitles."""
        run_transcribe_command(
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
            json_output=json_output,
            keep_temp=keep_temp,
            transcribe_runner=transcribe_runner,
        )


def run_transcribe_command(
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
    json_output: bool,
    keep_temp: bool,
    transcribe_runner: TranscribeRunner = transcribe_media,
) -> None:
    """Transcribe media and render CLI output."""
    try:
        result = transcribe_runner(
            input_file,
            TranscribeOptions(
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
                keep_temp=keep_temp,
            ),
        )
    except (SubGenError, WorkerRunnerError) as exc:
        payload = transcribe_error_payload(exc)
        if json_output:
            typer.echo(json.dumps(redact_value(payload), ensure_ascii=False))
        else:
            err_console.print(f"[red]Error:[/red] {redact_secrets(str(exc))}")
        raise typer.Exit(exit_code_for_payload(payload)) from exc

    if json_output:
        typer.echo(json.dumps(result.as_dict(), ensure_ascii=False, indent=2))
        return
    err_console.print(f"[green]Wrote subtitle:[/green] {result.srt_path}")
    if result.warnings:
        err_console.print(f"[yellow]warnings:[/yellow] {len(result.warnings)}")
