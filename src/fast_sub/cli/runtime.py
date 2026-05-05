from __future__ import annotations

import sys
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Annotated

import typer

from fast_sub.benchmark.transcription import run_bench
from fast_sub.benchmark.translation import run_bench_translate
from fast_sub.cli.commands.auto_cmd import register_auto_command
from fast_sub.cli.commands.auto_cmd import run_auto_entry as _run_auto_entry
from fast_sub.cli.commands.bench_cmd import register_bench_commands
from fast_sub.cli.commands.media_cmd import register_media_commands
from fast_sub.cli.commands.models_cmd import models_app
from fast_sub.cli.commands.providers_cmd import providers_app
from fast_sub.cli.commands.refine_cmd import (
    refine_subtitle_file,  # noqa: F401
    register_refine_command,
)
from fast_sub.cli.commands.transcribe_cmd import register_transcribe_command
from fast_sub.cli.commands.translate_cmd import register_translate_command
from fast_sub.cli.constants import COMMAND_NAMES
from fast_sub.cli.legacy_pipeline import legacy_run  # noqa: F401
from fast_sub.config import load_dotenv
from fast_sub.contracts.errors import SubGenError  # noqa: F401
from fast_sub.pipeline.orchestrator import auto_media
from fast_sub.stt.service import (
    transcribe_media,
)
from fast_sub.translation.service import (
    translate_srt,
)

app = typer.Typer(help="Fast local subtitles for video.", no_args_is_help=True)
app.add_typer(providers_app, name="providers")


def _package_version() -> str:
    try:
        return version("fast-sub")
    except PackageNotFoundError:
        return "0.0.0+local"


def _version_callback(value: bool) -> None:
    if not value:
        return
    typer.echo(_package_version())
    raise typer.Exit()


@app.callback()
def root_callback(
    version_flag: Annotated[
        bool,
        typer.Option(
            "--version",
            callback=_version_callback,
            is_eager=True,
            help="Print the fast-sub version.",
        ),
    ] = False,
) -> None:
    """Fast local subtitles for video."""
    del version_flag
    load_dotenv()


def main() -> None:
    load_dotenv()
    if _should_use_command_app(sys.argv[1:]):
        app()
        return
    typer.run(run)


def _should_use_command_app(args: list[str]) -> bool:
    if not args:
        return True
    first = args[0]
    return first in COMMAND_NAMES or first in {"--help", "-h", "--version"}


app.add_typer(models_app, name="models")
register_bench_commands(
    app,
    bench_runner=lambda input_file, options: run_bench(input_file, options),
    bench_translate_runner=lambda input_file, options: run_bench_translate(input_file, options),
)
register_auto_command(app, auto_runner=lambda input_file, options: auto_media(input_file, options))
register_media_commands(app)
register_refine_command(app)
register_translate_command(
    app,
    translate_runner=lambda input_file, options: translate_srt(input_file, options),
)
register_transcribe_command(
    app,
    transcribe_runner=lambda input_file, options: transcribe_media(input_file, options),
)


@app.command("run")
def run(
    input_file: Annotated[Path, typer.Argument(help="Input video/audio file.")],
    provider: Annotated[
        str,
        typer.Option("--provider", help="STT provider id. v0 defaults to local-faster-whisper."),
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
        typer.Option("--dry-run", help="Print the auto plan without downloading or transcribing."),
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
    """Compatibility alias for `fast-sub auto` using the v0 local pipeline."""
    _run_auto_entry(
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
        auto_runner=lambda input_file, options: auto_media(input_file, options),
    )
