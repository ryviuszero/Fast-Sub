"""Media constants exposed by the media package.

The media package owns media file classification, audio analysis models,
and ffmpeg-backed analysis services used by CLI and pipeline flows.
"""

from __future__ import annotations

from fast_sub.media.constants import (
    AUDIO_EXTENSIONS,
    MEDIA_EXTENSIONS,
    NORMALIZED_AUDIO_CHANNELS,
    NORMALIZED_AUDIO_CODEC,
    NORMALIZED_AUDIO_RATE,
    VIDEO_EXTENSIONS,
)

__all__ = [
    "AUDIO_EXTENSIONS",
    "MEDIA_EXTENSIONS",
    "NORMALIZED_AUDIO_CHANNELS",
    "NORMALIZED_AUDIO_CODEC",
    "NORMALIZED_AUDIO_RATE",
    "VIDEO_EXTENSIONS",
]
