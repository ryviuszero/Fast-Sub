from __future__ import annotations

import json
import locale
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

from fast_sub.contracts.errors import SubGenError

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
VIDEO_EXTENSIONS = {
    ".avi",
    ".flv",
    ".m4v",
    ".mkv",
    ".mov",
    ".mp4",
    ".mpeg",
    ".mpg",
    ".webm",
    ".wmv",
}
MEDIA_EXTENSIONS = AUDIO_EXTENSIONS | VIDEO_EXTENSIONS
NORMALIZED_AUDIO_RATE = 16000
NORMALIZED_AUDIO_CHANNELS = 1
NORMALIZED_AUDIO_CODEC = "pcm_s16le"


def ensure_media_tools() -> None:
    """Ensure ffmpeg and ffprobe are available on the system PATH."""
    missing = [tool for tool in ("ffmpeg", "ffprobe") if shutil.which(tool) is None]
    if missing:
        joined = ", ".join(missing)
        raise SubGenError(f"Missing required media tool(s): {joined}. Please install ffmpeg.")


def doctor_status(cache_dir: Path | None = None, jobs_dir: Path | None = None) -> dict[str, Any]:
    """Return diagnostic status for media tools, Python, and writable directories."""
    cache_path = cache_dir or Path(".fast-sub")
    jobs_path = jobs_dir or cache_path / "jobs"
    return {
        "ffmpeg": _tool_status("ffmpeg"),
        "ffprobe": _tool_status("ffprobe"),
        "python": {
            "ok": sys.version_info >= (3, 11),
            "version": sys.version.split()[0],
            "executable": sys.executable,
        },
        "cache_dir": _directory_status(cache_path),
        "jobs_dir": _directory_status(jobs_path),
    }


def doctor_ok(status: dict[str, Any]) -> bool:
    """Return whether a doctor status payload satisfies all required checks."""
    return all(
        (
            status["ffmpeg"]["available"],
            status["ffprobe"]["available"],
            status["python"]["ok"],
            status["cache_dir"]["writable"],
            status["jobs_dir"]["writable"],
        )
    )


def is_audio_file(path: Path) -> bool:
    """Return whether a path has a supported audio file extension."""
    return path.suffix.lower() in AUDIO_EXTENSIONS


def is_media_file(path: Path) -> bool:
    """Return whether a path is a supported audio or video file."""
    return path.is_file() and path.suffix.lower() in MEDIA_EXTENSIONS


def list_media_files(directory: Path) -> list[Path]:
    """List supported media files directly inside a directory."""
    return sorted(path for path in directory.iterdir() if is_media_file(path))


def probe_media(input_file: Path) -> dict[str, Any]:
    """Probe a media file with ffprobe and return normalized stream metadata."""
    if not input_file.exists():
        raise SubGenError(f"Input file does not exist: {input_file}")
    if not input_file.is_file():
        raise SubGenError(f"Input path is not a file: {input_file}")
    if shutil.which("ffprobe") is None:
        raise SubGenError("Missing required media tool(s): ffprobe. Please install ffmpeg.")

    command = [
        "ffprobe",
        "-v",
        "error",
        "-show_format",
        "-show_streams",
        "-print_format",
        "json",
        str(input_file),
    ]
    completed = subprocess.run(command, capture_output=True, check=False)
    if completed.returncode != 0:
        raise SubGenError(f"ffprobe failed: {_process_message(completed)}")

    try:
        raw = json.loads(_decode_process_output(completed.stdout))
    except json.JSONDecodeError as exc:
        raise SubGenError("ffprobe returned invalid JSON.") from exc

    streams = raw.get("streams", [])
    if not isinstance(streams, list):
        streams = []
    audio_streams = [
        _stream_summary(stream) for stream in streams if stream.get("codec_type") == "audio"
    ]
    video_streams = [
        _stream_summary(stream) for stream in streams if stream.get("codec_type") == "video"
    ]
    if not audio_streams:
        raise SubGenError(f"No audio stream found in: {input_file}")

    file_format = raw.get("format", {})
    if not isinstance(file_format, dict):
        file_format = {}

    return {
        "path": str(input_file),
        "duration_sec": _optional_float(file_format.get("duration")),
        "container": file_format.get("format_name"),
        "audio_streams": audio_streams,
        "video_streams": video_streams,
        "selected_audio_stream": audio_streams[0],
    }


def prepare_audio(input_file: Path, output: Path, audio_stream: int | None = None) -> None:
    """Convert a media file audio stream into normalized WAV output."""
    _convert_to_wav(input_file, output, audio_stream=audio_stream)


def _convert_to_wav(input_file: Path, output: Path, audio_stream: int | None = None) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_file),
        "-map",
        f"0:{audio_stream}" if audio_stream is not None else "0:a:0",
        "-vn",
        "-ac",
        str(NORMALIZED_AUDIO_CHANNELS),
        "-ar",
        str(NORMALIZED_AUDIO_RATE),
        "-c:a",
        NORMALIZED_AUDIO_CODEC,
        "-f",
        "wav",
        str(output),
    ]
    completed = subprocess.run(command, capture_output=True, check=False)
    if completed.returncode != 0:
        raise SubGenError(f"ffmpeg failed to prepare audio: {_process_message(completed)}")


def _tool_status(name: str) -> dict[str, Any]:
    path = shutil.which(name)
    status: dict[str, Any] = {"available": path is not None, "path": path, "version": None}
    if path is None:
        return status
    completed = subprocess.run([name, "-version"], capture_output=True, check=False)
    if completed.returncode == 0:
        lines = _decode_process_output(completed.stdout).splitlines()
        status["version"] = lines[0] if lines else None
    return status


def _directory_status(path: Path) -> dict[str, Any]:
    status: dict[str, Any] = {"path": str(path), "writable": False, "error": None}
    try:
        path.mkdir(parents=True, exist_ok=True)
        test_file = path / ".fast-sub-write-test"
        test_file.write_text("ok", encoding="utf-8")
        test_file.unlink()
        status["writable"] = True
    except OSError as exc:
        status["error"] = str(exc)
    return status


def _stream_summary(stream: dict[str, Any]) -> dict[str, Any]:
    return {
        "index": stream.get("index"),
        "codec": stream.get("codec_name"),
        "codec_type": stream.get("codec_type"),
        "duration_sec": _optional_float(stream.get("duration")),
        "channels": stream.get("channels"),
        "sample_rate": _optional_int(stream.get("sample_rate")),
        "width": stream.get("width"),
        "height": stream.get("height"),
        "language": _stream_language(stream),
    }


def _stream_language(stream: dict[str, Any]) -> str | None:
    tags = stream.get("tags")
    if not isinstance(tags, dict):
        return None
    language = tags.get("language")
    return language if isinstance(language, str) else None


def _optional_float(value: object) -> float | None:
    try:
        return None if value is None else float(value)
    except (TypeError, ValueError):
        return None


def _optional_int(value: object) -> int | None:
    try:
        return None if value is None else int(value)
    except (TypeError, ValueError):
        return None


def _process_message(completed: subprocess.CompletedProcess[bytes]) -> str:
    message = (
        _decode_process_output(completed.stderr).strip()
        or _decode_process_output(completed.stdout).strip()
    )
    return message or f"process exited with code {completed.returncode}"


def _decode_process_output(output: bytes) -> str:
    encodings = ("utf-8", locale.getpreferredencoding(False), "gbk")
    for encoding in encodings:
        try:
            return output.decode(encoding)
        except UnicodeDecodeError:
            pass
    return output.decode("utf-8", errors="replace")
