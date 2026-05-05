from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated

import typer

from fast_sub.cli.errors import exit_code_for_payload, json_error_for_exception
from fast_sub.cli.helpers import console, err_console, redact_secrets
from fast_sub.cli.legacy_pipeline import validate_positive
from fast_sub.contracts.errors import SubGenError
from fast_sub.subtitles.srt import RefineOptions, refine_srt_text


def register_refine_command(app: typer.Typer) -> None:
    """Register the subtitle refinement command."""

    @app.command("refine")
    def refine_command(
        input_file: Annotated[Path, typer.Argument(help="Input subtitle file.")],
        output: Annotated[
            Path | None,
            typer.Option("--output", "-o", help="Output subtitle path."),
        ] = None,
        lang: Annotated[
            str,
            typer.Option(help="Subtitle language: auto, zh, en, ja, or ko."),
        ] = "auto",
        max_chars: Annotated[
            int | None,
            typer.Option(help="Soft maximum characters per subtitle line."),
        ] = None,
        max_duration: Annotated[
            float,
            typer.Option(help="Suggested maximum subtitle duration in seconds."),
        ] = 6.0,
        json_output: Annotated[
            bool,
            typer.Option("--json", help="Print machine-readable result metadata."),
        ] = False,
    ) -> None:
        """Clean and normalize subtitle timing/text."""
        run_refine_command(
            input_file=input_file,
            output=output,
            lang=lang,
            max_chars=max_chars,
            max_duration=max_duration,
            json_output=json_output,
        )


def run_refine_command(
    *,
    input_file: Path,
    output: Path | None,
    lang: str,
    max_chars: int | None,
    max_duration: float,
    json_output: bool,
) -> None:
    """Refine an SRT file and render CLI output."""
    try:
        out_path = refine_subtitle_file(
            input_file=input_file,
            output=output,
            lang=lang,
            max_chars=max_chars,
            max_duration=max_duration,
        )
    except SubGenError as exc:
        payload = json_error_for_exception(exc, stage="refine", code="invalid_input")
        if json_output:
            typer.echo(json.dumps(payload, ensure_ascii=False))
        else:
            err_console.print(f"[red]Error:[/red] {redact_secrets(str(exc))}")
        raise typer.Exit(exit_code_for_payload(payload)) from exc

    if json_output:
        typer.echo(
            json.dumps(
                {
                    "ok": True,
                    "input": str(input_file),
                    "output": str(out_path),
                },
                ensure_ascii=False,
            )
        )
    else:
        console.print(f"[green]Wrote refined subtitle:[/green] {out_path}")


def refine_subtitle_file(
    *,
    input_file: Path,
    output: Path | None,
    lang: str,
    max_chars: int | None,
    max_duration: float,
) -> Path:
    """Refine one SRT file and return the written output path."""
    _validate_refine_input(input_file, lang, max_chars, max_duration)
    out_path = output or input_file.with_name(f"{input_file.stem}.refined.srt")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    refined = refine_srt_text(
        input_file.read_text(encoding="utf-8-sig"),
        RefineOptions(lang=lang, max_chars=max_chars, max_duration=max_duration),
    )
    out_path.write_text(refined, encoding="utf-8")
    return out_path


def _validate_refine_input(
    input_file: Path,
    lang: str,
    max_chars: int | None,
    max_duration: float,
) -> None:
    if not input_file.exists():
        raise SubGenError(f"Input file does not exist: {input_file}")
    if not input_file.is_file():
        raise SubGenError(f"Input path is not a file: {input_file}")
    if input_file.suffix.lower() != ".srt":
        raise SubGenError("refine currently supports .srt input only.")
    if lang not in {"auto", "zh", "en", "ja", "ko"}:
        raise SubGenError("--lang must be one of: auto, zh, en, ja, ko.")
    if max_chars is not None:
        validate_positive(max_chars, "--max-chars")
    validate_positive(max_duration, "--max-duration")
