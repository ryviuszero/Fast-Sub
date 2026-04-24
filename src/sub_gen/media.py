from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from sub_gen.errors import SubGenError

AUDIO_EXTENSIONS = {
    ".aac",
    ".aiff",
    ".flac",
    ".m4a",
    ".mp3",
    ".ogg",
    ".opus",
    ".wav",
    ".webm",
    ".wma",
}


def ensure_media_tools() -> None:
    missing = [tool for tool in ("ffmpeg", "ffprobe") if shutil.which(tool) is None]
    if missing:
        joined = ", ".join(missing)
        raise SubGenError(f"Missing required media tool(s): {joined}. Please install ffmpeg.")


def is_audio_file(path: Path) -> bool:
    return path.suffix.lower() in AUDIO_EXTENSIONS


def prepare_audio(input_file: Path, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    if input_file.suffix.lower() == ".wav":
        shutil.copyfile(input_file, output)
        return
    _convert_to_wav(input_file, output)


def _convert_to_wav(input_file: Path, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_file),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        str(output),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        message = completed.stderr.strip() or completed.stdout.strip()
        raise SubGenError(f"ffmpeg failed to prepare audio: {message}")

