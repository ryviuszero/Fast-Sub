"""Network clients for external services and downloads."""

from __future__ import annotations

from fast_sub.clients.errors import (
    ClientError,
    DownloadClientError,
    HttpDownloadError,
    OpenAIChatClientError,
    TranscriptionRequestError,
    WebTranslationClientError,
)

__all__ = [
    "ClientError",
    "DownloadClientError",
    "HttpDownloadError",
    "OpenAIChatClientError",
    "TranscriptionRequestError",
    "WebTranslationClientError",
]
