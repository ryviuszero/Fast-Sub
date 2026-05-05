from __future__ import annotations

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

__all__ = [
    "AUDIO_EXTENSIONS",
    "MEDIA_EXTENSIONS",
    "NORMALIZED_AUDIO_CHANNELS",
    "NORMALIZED_AUDIO_CODEC",
    "NORMALIZED_AUDIO_RATE",
    "VIDEO_EXTENSIONS",
]
