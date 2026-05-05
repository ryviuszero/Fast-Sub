"""Media analysis services built on ffprobe and ffmpeg output."""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, cast

from fast_sub.contracts.errors import SubGenError
from fast_sub.infrastructure.ffmpeg import (
    decode_process_output,
    is_media_file,
    probe_media,
    process_message,
)
from fast_sub.media.constants import (
    AGGRESSIVE_VAD_SILENCE_RATIO,
    CLIPPING_RISK_DB,
    CLIPPING_RISK_WARNING,
    DENSE_SEGMENTS_PER_MINUTE,
    FRAGMENTED_SPEECH_WARNING,
    HIGH_SILENCE_RATIO_WARNING,
    LOW_VOLUME_DB,
    LOW_VOLUME_WARNING,
    MEAN_VOLUME_PATTERN,
    MIN_FRAGMENTED_SEGMENTS,
    NORMAL_VAD_SILENCE_RATIO,
    PEAK_VOLUME_PATTERN,
    SHORT_AVG_SEGMENT_SEC,
    SHORT_MEDIA_DURATION_SEC,
    SILENCE_END_PATTERN,
    SILENCE_START_PATTERN,
    UNKNOWN_DURATION_WARNING,
    AnalysisWarning,
    RecommendedMode,
    RecommendedVad,
)
from fast_sub.media.models import AnalysisResult, FfmpegAnalysis, TimeInterval

_SILENCE_START_RE = re.compile(SILENCE_START_PATTERN)
_SILENCE_END_RE = re.compile(SILENCE_END_PATTERN)
_MEAN_VOLUME_RE = re.compile(MEAN_VOLUME_PATTERN)
_PEAK_VOLUME_RE = re.compile(PEAK_VOLUME_PATTERN)


def analyze_media(input_file: Path) -> AnalysisResult:
    """Inspect a media file and return speech, silence, volume, and recommendation data."""
    _validate_analyze_input(input_file)
    info = probe_media(input_file)
    ffmpeg_analysis = _run_ffmpeg_analysis(input_file, duration_sec=info.get("duration_sec"))
    return build_analysis_result(
        duration_sec=info.get("duration_sec"),
        mean_volume_db=ffmpeg_analysis.mean_volume_db,
        peak_volume_db=ffmpeg_analysis.peak_volume_db,
        silence_segments=ffmpeg_analysis.silence_segments,
    )


def build_analysis_result(
    *,
    duration_sec: object,
    mean_volume_db: float | None,
    peak_volume_db: float | None,
    silence_segments: list[TimeInterval],
) -> AnalysisResult:
    """Build an analysis result from probed duration and parsed ffmpeg audio metrics."""
    duration = _positive_float(duration_sec)
    bounded_silence = _bound_intervals(silence_segments, duration)
    speech_segments = _speech_segments(duration, bounded_silence)

    silence_sec = sum(segment.duration_sec for segment in bounded_silence)
    speech_sec = sum(segment.duration_sec for segment in speech_segments)
    if duration is None:
        silence_ratio = 0.0
        speech_ratio = 0.0
    else:
        silence_ratio = _ratio(silence_sec, duration)
        speech_ratio = max(0.0, round(1.0 - silence_ratio, 4))

    estimated_segments = len(speech_segments)
    avg_segment_sec = round(speech_sec / estimated_segments, 3) if estimated_segments else 0.0
    warnings = _analysis_warnings(
        duration_sec=duration,
        silence_ratio=silence_ratio,
        mean_volume_db=mean_volume_db,
        peak_volume_db=peak_volume_db,
        estimated_segments=estimated_segments,
        avg_segment_sec=avg_segment_sec,
    )
    recommended_vad = recommend_vad(duration, silence_ratio)
    recommended_mode = recommend_mode(duration, warnings)

    return AnalysisResult(
        duration_sec=round(duration, 3) if duration is not None else None,
        speech_ratio=speech_ratio,
        silence_ratio=silence_ratio,
        mean_volume_db=mean_volume_db,
        peak_volume_db=peak_volume_db,
        estimated_segments=estimated_segments,
        avg_segment_sec=avg_segment_sec,
        recommended_vad=recommended_vad,
        recommended_mode=recommended_mode,
        warnings=warnings,
        silence_segments=bounded_silence,
        speech_segments=speech_segments,
    )


def recommend_vad(duration_sec: float | None, silence_ratio: float) -> RecommendedVad:
    """Recommend a VAD level from media duration and silence ratio."""
    if silence_ratio > AGGRESSIVE_VAD_SILENCE_RATIO:
        return "aggressive"
    if silence_ratio > NORMAL_VAD_SILENCE_RATIO:
        return "normal"
    if duration_sec is not None and duration_sec < SHORT_MEDIA_DURATION_SEC:
        return "off"
    return "normal"


def recommend_mode(
    duration_sec: float | None,
    warnings: list[AnalysisWarning],
) -> RecommendedMode:
    """Recommend a transcription mode from duration and analysis warnings."""
    quality_warnings = {
        LOW_VOLUME_WARNING,
        FRAGMENTED_SPEECH_WARNING,
        HIGH_SILENCE_RATIO_WARNING,
    }
    if any(warning in quality_warnings for warning in warnings):
        return "quality"
    if duration_sec is not None and duration_sec < SHORT_MEDIA_DURATION_SEC and not warnings:
        return "fast"
    return "balanced"


def parse_ffmpeg_analysis(stderr: str, duration_sec: float | None = None) -> FfmpegAnalysis:
    """Parse ffmpeg silencedetect and volumedetect stderr output."""
    open_silence_start: float | None = None
    silence_segments: list[TimeInterval] = []
    mean_volume_db: float | None = None
    peak_volume_db: float | None = None

    for line in stderr.splitlines():
        if match := _SILENCE_START_RE.search(line):
            open_silence_start = _float(match.group("value"))
            continue
        if match := _SILENCE_END_RE.search(line):
            end = _float(match.group("end"))
            duration = _float(match.group("duration"))
            start = open_silence_start
            if start is None and end is not None and duration is not None:
                start = end - duration
            if start is not None and end is not None:
                silence_segments.append(TimeInterval(start, end))
            open_silence_start = None
            continue
        if match := _MEAN_VOLUME_RE.search(line):
            mean_volume_db = _float(match.group("value"))
            continue
        if match := _PEAK_VOLUME_RE.search(line):
            peak_volume_db = _float(match.group("value"))

    if open_silence_start is not None and duration_sec is not None:
        silence_segments.append(TimeInterval(open_silence_start, duration_sec))

    return FfmpegAnalysis(
        mean_volume_db=mean_volume_db,
        peak_volume_db=peak_volume_db,
        silence_segments=silence_segments,
    )


def _validate_analyze_input(input_file: Path) -> None:
    if not input_file.exists():
        raise SubGenError(f"Input file does not exist: {input_file}")
    if not input_file.is_file():
        raise SubGenError(f"Input path is not a file: {input_file}")
    if not is_media_file(input_file):
        raise SubGenError(f"Unsupported input file type: {input_file}")
    missing = [tool for tool in ("ffmpeg", "ffprobe") if shutil.which(tool) is None]
    if missing:
        joined = ", ".join(missing)
        raise SubGenError(f"Missing required media tool(s): {joined}. Please install ffmpeg.")


def _run_ffmpeg_analysis(input_file: Path, *, duration_sec: object) -> FfmpegAnalysis:
    command = [
        "ffmpeg",
        "-hide_banner",
        "-nostats",
        "-i",
        str(input_file),
        "-map",
        "0:a:0",
        "-vn",
        "-af",
        "silencedetect=noise=-35dB:d=0.4,volumedetect",
        "-f",
        "null",
        "-",
    ]
    completed = subprocess.run(command, capture_output=True, check=False)
    stderr = decode_process_output(completed.stderr)
    if completed.returncode != 0:
        raise SubGenError(f"ffmpeg failed to analyze audio: {process_message(completed)}")
    return parse_ffmpeg_analysis(stderr, duration_sec=_positive_float(duration_sec))


def _analysis_warnings(
    *,
    duration_sec: float | None,
    silence_ratio: float,
    mean_volume_db: float | None,
    peak_volume_db: float | None,
    estimated_segments: int,
    avg_segment_sec: float,
) -> list[AnalysisWarning]:
    warnings: list[AnalysisWarning] = []
    if duration_sec is None:
        warnings.append(UNKNOWN_DURATION_WARNING)
    if mean_volume_db is not None and mean_volume_db < LOW_VOLUME_DB:
        warnings.append(LOW_VOLUME_WARNING)
    if peak_volume_db is not None and peak_volume_db > CLIPPING_RISK_DB:
        warnings.append(CLIPPING_RISK_WARNING)
    if silence_ratio > AGGRESSIVE_VAD_SILENCE_RATIO:
        warnings.append(HIGH_SILENCE_RATIO_WARNING)
    very_short_segments = avg_segment_sec < SHORT_AVG_SEGMENT_SEC
    dense_segments = (
        _segments_per_minute(duration_sec, estimated_segments) > DENSE_SEGMENTS_PER_MINUTE
    )
    if estimated_segments >= MIN_FRAGMENTED_SEGMENTS and (very_short_segments or dense_segments):
        warnings.append(FRAGMENTED_SPEECH_WARNING)
    return warnings


def _segments_per_minute(duration_sec: float | None, estimated_segments: int) -> float:
    if duration_sec is None or duration_sec <= 0:
        return 0.0
    return estimated_segments / (duration_sec / 60.0)


def _bound_intervals(
    intervals: list[TimeInterval],
    duration_sec: float | None,
) -> list[TimeInterval]:
    bounded: list[TimeInterval] = []
    for interval in sorted(intervals, key=lambda item: item.start_sec):
        start = max(0.0, interval.start_sec)
        end = max(start, interval.end_sec)
        if duration_sec is not None:
            start = min(start, duration_sec)
            end = min(end, duration_sec)
        if end <= start:
            continue
        if bounded and start <= bounded[-1].end_sec:
            previous = bounded.pop()
            bounded.append(TimeInterval(previous.start_sec, max(previous.end_sec, end)))
        else:
            bounded.append(TimeInterval(start, end))
    return bounded


def _speech_segments(
    duration_sec: float | None,
    silence_segments: list[TimeInterval],
) -> list[TimeInterval]:
    if duration_sec is None:
        return []
    cursor = 0.0
    speech: list[TimeInterval] = []
    for silence in silence_segments:
        if silence.start_sec > cursor:
            speech.append(TimeInterval(cursor, silence.start_sec))
        cursor = max(cursor, silence.end_sec)
    if cursor < duration_sec:
        speech.append(TimeInterval(cursor, duration_sec))
    return speech


def _ratio(value: float, total: float) -> float:
    if total <= 0:
        return 0.0
    return max(0.0, min(1.0, round(value / total, 4)))


def _positive_float(value: object) -> float | None:
    parsed = _float(value)
    if parsed is None or parsed <= 0:
        return None
    return parsed


def _float(value: object) -> float | None:
    try:
        return None if value is None else float(cast(Any, value))
    except (TypeError, ValueError):
        return None
