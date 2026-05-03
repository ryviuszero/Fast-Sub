from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx


class TranscriptionRequestError(RuntimeError):
    """Raised when an OpenAI-compatible transcription request fails."""


@dataclass(frozen=True)
class OpenAITranscriptionClient:
    """HTTP client for OpenAI-compatible audio transcription requests."""

    base_url: str
    api_key: str
    timeout_seconds: float

    def transcribe(
        self,
        *,
        audio: Path,
        model: str,
        source_lang: str,
        temperature: float,
        response_format: str,
    ) -> httpx.Response:
        """Upload audio and return the provider response."""
        data: dict[str, Any] = {
            "model": model,
            "response_format": response_format,
            "temperature": str(temperature),
        }
        if source_lang != "auto":
            data["language"] = source_lang
        headers = {"Authorization": f"Bearer {self.api_key}"}
        with audio.open("rb") as file:
            files = {"file": (audio.name, file, "audio/wav")}
            try:
                return httpx.post(
                    self._transcriptions_url,
                    data=data,
                    files=files,
                    headers=headers,
                    timeout=self.timeout_seconds,
                )
            except httpx.HTTPError as exc:
                raise TranscriptionRequestError(str(exc)) from exc

    @property
    def _transcriptions_url(self) -> str:
        return f"{self.base_url.rstrip('/')}/audio/transcriptions"


__all__ = ["OpenAITranscriptionClient", "TranscriptionRequestError"]
