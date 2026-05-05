from __future__ import annotations

import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from fast_sub.contracts.errors import SubGenError
from fast_sub.infrastructure.ffmpeg import process_message
from fast_sub.media.constants import VIDEO_EXTENSIONS
from fast_sub.output.paths import job_dir

PRESET_ARGS: dict[str, tuple[str, str]] = {
    "fast": ("veryfast", "26"),
    "balanced": ("medium", "23"),
    "quality": ("slow", "20"),
}
PREPARED_SUBTITLE_NAME = "subtitle.srt"


@dataclass(frozen=True)
class BurnOptions:
    font: str | None = None
    font_size: int | None = None
    preset: str = "balanced"


def default_burn_output_path(input_file: Path) -> Path:
    stem = input_file.with_suffix("")
    return stem.with_name(f"{stem.name}.subtitled.mp4")


def burn_subtitles(
    input_file: Path,
    subtitle_file: Path,
    output: Path | None = None,
    options: BurnOptions | None = None,
) -> Path:
    options = options or BurnOptions()
    _validate_burn_inputs(input_file, subtitle_file, options)
    output_path = output or default_burn_output_path(input_file)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    work_dir = job_dir(input_file) / "burn"
    work_dir.mkdir(parents=True, exist_ok=True)
    prepared_subtitle = work_dir / PREPARED_SUBTITLE_NAME
    shutil.copyfile(subtitle_file, prepared_subtitle)

    command = build_ffmpeg_burn_command(
        input_file=input_file.resolve(),
        output=output_path.resolve(),
        prepared_subtitle_name=PREPARED_SUBTITLE_NAME,
        options=options,
    )
    try:
        completed = subprocess.run(command, cwd=work_dir, capture_output=True, check=False)
    except OSError as exc:
        raise SubGenError(f"ffmpeg failed to start: {exc}") from exc
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
        _remove_empty_parent(work_dir.parent)
        _remove_empty_parent(work_dir.parent.parent)
        _remove_empty_parent(work_dir.parent.parent.parent)
    if completed.returncode != 0:
        raise SubGenError(_burn_error_message(completed))
    return output_path


def build_ffmpeg_burn_command(
    *,
    input_file: Path,
    output: Path,
    prepared_subtitle_name: str = PREPARED_SUBTITLE_NAME,
    options: BurnOptions | None = None,
) -> list[str]:
    options = options or BurnOptions()
    encoder_preset, crf = _preset_args(options.preset)
    return [
        "ffmpeg",
        "-y",
        "-i",
        str(input_file),
        "-vf",
        _subtitle_filter(prepared_subtitle_name, options),
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        encoder_preset,
        "-crf",
        crf,
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        str(output),
    ]


def _validate_burn_inputs(input_file: Path, subtitle_file: Path, options: BurnOptions) -> None:
    if not input_file.exists():
        raise SubGenError(f"Input video does not exist: {input_file}")
    if not input_file.is_file():
        raise SubGenError(f"Input video path is not a file: {input_file}")
    if input_file.suffix.lower() not in VIDEO_EXTENSIONS:
        raise SubGenError(f"Unsupported input video file type: {input_file}")
    if not subtitle_file.exists():
        raise SubGenError(f"Input subtitle does not exist: {subtitle_file}")
    if not subtitle_file.is_file():
        raise SubGenError(f"Input subtitle path is not a file: {subtitle_file}")
    if subtitle_file.suffix.lower() != ".srt":
        raise SubGenError("burn currently supports .srt subtitles only.")
    if options.preset not in PRESET_ARGS:
        raise SubGenError("--preset must be one of: fast, balanced, quality.")
    if options.font_size is not None and options.font_size <= 0:
        raise SubGenError("--font-size must be greater than 0.")
    if shutil.which("ffmpeg") is None:
        raise SubGenError("Missing required media tool(s): ffmpeg. Please install ffmpeg.")


def _preset_args(preset: str) -> tuple[str, str]:
    try:
        return PRESET_ARGS[preset]
    except KeyError as exc:
        raise SubGenError("--preset must be one of: fast, balanced, quality.") from exc


def _remove_empty_parent(path: Path) -> None:
    try:
        path.rmdir()
    except OSError:
        pass


def _subtitle_filter(prepared_subtitle_name: str, options: BurnOptions) -> str:
    filter_value = f"subtitles={_escape_filter_value(prepared_subtitle_name)}"
    style = _force_style(options)
    if style:
        filter_value += f":force_style={_quote_filter_value(style)}"
    return filter_value


def _force_style(options: BurnOptions) -> str:
    parts = []
    if options.font:
        parts.append(f"FontName={options.font}")
    if options.font_size is not None:
        parts.append(f"FontSize={options.font_size}")
    return ",".join(parts)


def _quote_filter_value(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'"


def _escape_filter_value(value: str) -> str:
    return value.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def _burn_error_message(completed: subprocess.CompletedProcess[bytes]) -> str:
    detail = process_message(completed)
    lowered = detail.lower()
    if "no such filter" in lowered or (
        "subtitles" in lowered and ("libass" in lowered or "error initializing" in lowered)
    ):
        return (
            "ffmpeg failed to burn subtitles. This ffmpeg build may not support the "
            f"subtitles filter/libass. Details: {detail}"
        )
    return f"ffmpeg failed to burn subtitles: {detail}"
