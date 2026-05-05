"""Constants and typed value sets for media file handling and analysis."""

from __future__ import annotations

from typing import Literal

RecommendedVad = Literal["off", "normal", "aggressive"]
RecommendedMode = Literal["fast", "balanced", "quality"]
AnalysisWarning = Literal[
    "LOW_VOLUME",
    "CLIPPING_RISK",
    "FRAGMENTED_SPEECH",
    "HIGH_SILENCE_RATIO",
    "UNKNOWN_DURATION",
]

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

LOW_VOLUME_WARNING: AnalysisWarning = "LOW_VOLUME"
CLIPPING_RISK_WARNING: AnalysisWarning = "CLIPPING_RISK"
FRAGMENTED_SPEECH_WARNING: AnalysisWarning = "FRAGMENTED_SPEECH"
HIGH_SILENCE_RATIO_WARNING: AnalysisWarning = "HIGH_SILENCE_RATIO"
UNKNOWN_DURATION_WARNING: AnalysisWarning = "UNKNOWN_DURATION"

AGGRESSIVE_VAD_SILENCE_RATIO = 0.35
NORMAL_VAD_SILENCE_RATIO = 0.15
SHORT_MEDIA_DURATION_SEC = 120.0
LOW_VOLUME_DB = -35.0
CLIPPING_RISK_DB = -1.0
MIN_FRAGMENTED_SEGMENTS = 10
SHORT_AVG_SEGMENT_SEC = 1.5
DENSE_SEGMENTS_PER_MINUTE = 20.0

SILENCE_START_PATTERN = r"silence_start:\s*(?P<value>-?\d+(?:\.\d+)?)"
SILENCE_END_PATTERN = (
    r"silence_end:\s*(?P<end>-?\d+(?:\.\d+)?)\s*\|\s*silence_duration:\s*"
    r"(?P<duration>-?\d+(?:\.\d+)?)"
)
MEAN_VOLUME_PATTERN = r"mean_volume:\s*(?P<value>-?\d+(?:\.\d+)?)\s*dB"
PEAK_VOLUME_PATTERN = r"max_volume:\s*(?P<value>-?\d+(?:\.\d+)?)\s*dB"

__all__ = [
    "AGGRESSIVE_VAD_SILENCE_RATIO",
    "AnalysisWarning",
    "AUDIO_EXTENSIONS",
    "CLIPPING_RISK_DB",
    "CLIPPING_RISK_WARNING",
    "DENSE_SEGMENTS_PER_MINUTE",
    "FRAGMENTED_SPEECH_WARNING",
    "HIGH_SILENCE_RATIO_WARNING",
    "LOW_VOLUME_DB",
    "LOW_VOLUME_WARNING",
    "MEDIA_EXTENSIONS",
    "MEAN_VOLUME_PATTERN",
    "MIN_FRAGMENTED_SEGMENTS",
    "NORMAL_VAD_SILENCE_RATIO",
    "NORMALIZED_AUDIO_CHANNELS",
    "NORMALIZED_AUDIO_CODEC",
    "NORMALIZED_AUDIO_RATE",
    "PEAK_VOLUME_PATTERN",
    "RecommendedMode",
    "RecommendedVad",
    "SHORT_AVG_SEGMENT_SEC",
    "SHORT_MEDIA_DURATION_SEC",
    "SILENCE_END_PATTERN",
    "SILENCE_START_PATTERN",
    "UNKNOWN_DURATION_WARNING",
    "VIDEO_EXTENSIONS",
]
