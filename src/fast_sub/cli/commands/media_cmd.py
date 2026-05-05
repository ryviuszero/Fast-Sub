from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Any

import typer

from fast_sub.cli.errors import exit_code_for_payload, json_error_for_exception
from fast_sub.cli.helpers import console, err_console, redact_secrets
from fast_sub.contracts.errors import SubGenError
from fast_sub.infrastructure.ffmpeg import (
    doctor_ok,
    doctor_status,
    ensure_media_tools,
    is_media_file,
    prepare_audio,
    probe_media,
)
from fast_sub.media.service import AnalysisResult, analyze_media
from fast_sub.output.burn import BurnOptions, burn_subtitles
from fast_sub.output.paths import job_dir


def register_media_commands(app: typer.Typer) -> None:
    """Register media inspection, extraction, analysis, and burn commands."""
    app.command("doctor")(doctor_command)
    app.command("probe")(probe_command)
    app.command("extract")(extract_command)
    app.command("analyze")(analyze_command)
    app.command("burn")(burn_command)


def doctor_command(
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Print machine-readable JSON."),
    ] = False,
) -> None:
    """Check local dependencies and runtime readiness."""
    status = doctor_status()
    if json_output:
        typer.echo(json.dumps(status, ensure_ascii=False, indent=2))
    else:
        _print_doctor_status(status)
    if not doctor_ok(status):
        raise typer.Exit(3)


def probe_command(
    input_file: Annotated[Path, typer.Argument(help="Input video/audio file.")],
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Print machine-readable JSON."),
    ] = False,
) -> None:
    """Inspect media metadata."""
    try:
        info = probe_media(input_file)
    except SubGenError as exc:
        if json_output:
            typer.echo(
                json.dumps(
                    json_error_for_exception(exc, stage="input", code="invalid_input"),
                    ensure_ascii=False,
                )
            )
        else:
            err_console.print(f"[red]Error:[/red] {redact_secrets(str(exc))}")
        raise typer.Exit(2) from exc
    if json_output:
        typer.echo(json.dumps(info, ensure_ascii=False, indent=2))
        return
    _print_probe_info(info)


def extract_command(
    input_file: Annotated[Path, typer.Argument(help="Input video/audio file.")],
    output: Annotated[
        Path | None,
        typer.Option("--output", "-o", help="Output wav path."),
    ] = None,
    audio_stream: Annotated[
        int | None,
        typer.Option("--audio-stream", help="Input ffprobe stream index to extract."),
    ] = None,
) -> None:
    """Extract normalized 16kHz mono wav audio."""
    try:
        _validate_extract_input(input_file)
        out_path = output or (job_dir(input_file) / "audio.16k.mono.wav")
        prepare_audio(input_file, out_path, audio_stream=audio_stream)
    except SubGenError as exc:
        payload = json_error_for_exception(exc, stage="extract", code="command_failed")
        err_console.print(f"[red]Error:[/red] {redact_secrets(str(exc))}")
        raise typer.Exit(exit_code_for_payload(payload)) from exc
    console.print(f"[green]Wrote audio:[/green] {out_path}")


def analyze_command(
    input_file: Annotated[Path, typer.Argument(help="Input video/audio file.")],
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Print machine-readable JSON."),
    ] = False,
) -> None:
    """Analyze audio characteristics for automatic scheduling."""
    try:
        result = analyze_media(input_file)
    except SubGenError as exc:
        payload = json_error_for_exception(exc, stage="analyze", code="command_failed")
        if json_output:
            typer.echo(json.dumps(payload, ensure_ascii=False))
        else:
            err_console.print(f"[red]Error:[/red] {redact_secrets(str(exc))}")
        raise typer.Exit(exit_code_for_payload(payload)) from exc

    if json_output:
        typer.echo(json.dumps(result.as_dict(), ensure_ascii=False, indent=2))
        return
    _print_analysis_result(result)


def burn_command(
    input_file: Annotated[Path, typer.Argument(help="Input video file.")],
    subtitle_file: Annotated[Path, typer.Argument(help="Input .srt subtitle file.")],
    output: Annotated[
        Path | None,
        typer.Option("--output", "-o", help="Output video path."),
    ] = None,
    font: Annotated[
        str | None,
        typer.Option("--font", help="Subtitle font family passed to ffmpeg force_style."),
    ] = None,
    font_size: Annotated[
        int | None,
        typer.Option("--font-size", help="Subtitle font size passed to ffmpeg force_style."),
    ] = None,
    preset: Annotated[
        str,
        typer.Option("--preset", help="Encoding preset: fast, balanced, or quality."),
    ] = "balanced",
) -> None:
    """Burn SRT subtitles into a video with ffmpeg."""
    try:
        out_path = burn_subtitles(
            input_file=input_file,
            subtitle_file=subtitle_file,
            output=output,
            options=BurnOptions(font=font, font_size=font_size, preset=preset),
        )
    except SubGenError as exc:
        console.print(f"[red]Error:[/red] {exc}")
        raise typer.Exit(1) from exc
    console.print(f"[green]Wrote subtitled video:[/green] {out_path}")


def _print_doctor_status(status: dict[str, Any]) -> None:
    console.print("[bold]Fast Sub doctor[/bold]")
    for tool in ("ffmpeg", "ffprobe"):
        item = status[tool]
        label = "[green]ok[/green]" if item["available"] else "[red]missing[/red]"
        detail = item["path"] or "not found on PATH"
        console.print(f"{tool}: {label} ({detail})")
    python = status["python"]
    py_label = "[green]ok[/green]" if python["ok"] else "[red]unsupported[/red]"
    console.print(f"python: {py_label} ({python['version']})")
    for key in ("cache_dir", "jobs_dir"):
        item = status[key]
        label = "[green]writable[/green]" if item["writable"] else "[red]not writable[/red]"
        console.print(f"{key}: {label} ({item['path']})")
        if item["error"]:
            console.print(f"  [red]{item['error']}[/red]")


def _print_probe_info(info: dict[str, Any]) -> None:
    console.print(f"path: {info['path']}")
    console.print(f"duration_sec: {info['duration_sec']}")
    console.print(f"container: {info['container']}")
    console.print(f"audio_streams: {len(info['audio_streams'])}")
    console.print(f"video_streams: {len(info['video_streams'])}")
    selected = info["selected_audio_stream"]
    console.print(
        "selected_audio_stream: "
        f"index={selected.get('index')} codec={selected.get('codec')} "
        f"channels={selected.get('channels')} sample_rate={selected.get('sample_rate')}"
    )


def _validate_extract_input(input_file: Path) -> None:
    if not input_file.exists():
        raise SubGenError(f"Input file does not exist: {input_file}")
    if not input_file.is_file():
        raise SubGenError(f"Input path is not a file: {input_file}")
    if not is_media_file(input_file):
        raise SubGenError(f"Unsupported input file type: {input_file}")
    ensure_media_tools()


def _print_analysis_result(result: AnalysisResult) -> None:
    console.print("[bold]Fast Sub analyze[/bold]")
    console.print(f"duration_sec: {result.duration_sec}")
    console.print(f"speech_ratio: {result.speech_ratio:.4f}")
    console.print(f"silence_ratio: {result.silence_ratio:.4f}")
    console.print(f"mean_volume_db: {result.mean_volume_db}")
    console.print(f"peak_volume_db: {result.peak_volume_db}")
    console.print(f"estimated_segments: {result.estimated_segments}")
    console.print(f"avg_segment_sec: {result.avg_segment_sec}")
    console.print(f"recommended_vad: {result.recommended_vad}")
    console.print(f"recommended_mode: {result.recommended_mode}")
    if result.warnings:
        console.print(f"warnings: {', '.join(result.warnings)}")
    else:
        console.print("warnings: none")
