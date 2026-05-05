from __future__ import annotations


class ClientError(RuntimeError):
    """Base class for external client failures."""


class DownloadClientError(ClientError):
    """Raised when a network download client fails."""


class HttpDownloadError(DownloadClientError):
    """Raised when an HTTP model download fails."""


class OpenAIChatClientError(ClientError):
    """Raised when an OpenAI-compatible chat request cannot be completed."""


class TranscriptionRequestError(ClientError):
    """Raised when an OpenAI-compatible transcription request fails."""


class WebTranslationClientError(ClientError):
    """Raised when a web translation request cannot be completed."""


__all__ = [
    "ClientError",
    "DownloadClientError",
    "HttpDownloadError",
    "OpenAIChatClientError",
    "TranscriptionRequestError",
    "WebTranslationClientError",
]
