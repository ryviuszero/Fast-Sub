from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import httpx

from sub_gen.errors import ProviderLimitError, ProviderResponseError
from sub_gen.models import Segment

LIMIT_STATUS_CODES = {413, 422}


def transcribe_srt(
    *,
    audio: Path,
    base_url: str,
    api_key: str,
    model: str,
    source_lang: str,
    temperature: float,
    timeout_seconds: float = 600,
) -> str:
    response = _post_transcription(
        audio=audio,
        base_url=base_url,
        api_key=api_key,
        model=model,
        source_lang=source_lang,
        temperature=temperature,
        response_format="srt",
        timeout_seconds=timeout_seconds,
    )
    return response.text


def transcribe_segments(
    *,
    audio: Path,
    base_url: str,
    api_key: str,
    model: str,
    source_lang: str,
    temperature: float,
    timeout_seconds: float = 600,
) -> list[Segment]:
    response = _post_transcription(
        audio=audio,
        base_url=base_url,
        api_key=api_key,
        model=model,
        source_lang=source_lang,
        temperature=temperature,
        response_format="verbose_json",
        timeout_seconds=timeout_seconds,
    )
    data = response.json()
    raw_segments = data.get("segments")
    if not isinstance(raw_segments, list):
        raise ProviderResponseError(
            "The STT provider did not return timestamped segments. "
            "Use a provider/model that supports response_format=verbose_json."
        )

    segments: list[Segment] = []
    for index, item in enumerate(raw_segments, start=1):
        if not isinstance(item, dict):
            continue
        try:
            segments.append(
                Segment(
                    id=index,
                    start=float(item["start"]),
                    end=float(item["end"]),
                    text=str(item["text"]).strip(),
                )
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ProviderResponseError(f"Invalid STT segment at index {index}: {item}") from exc
    if not segments:
        raise ProviderResponseError("The STT provider returned no usable subtitle segments.")
    return segments


def _post_transcription(
    *,
    audio: Path,
    base_url: str,
    api_key: str,
    model: str,
    source_lang: str,
    temperature: float,
    response_format: str,
    timeout_seconds: float,
) -> httpx.Response:
    url = f"{base_url.rstrip('/')}/audio/transcriptions"
    data: dict[str, Any] = {
        "model": model,
        "response_format": response_format,
        "temperature": str(temperature),
    }
    if source_lang != "auto":
        data["language"] = source_lang
    headers = {"Authorization": f"Bearer {api_key}"}
    _log_transcription_request(url=url, audio=audio, data=data, has_api_key=bool(api_key))
    with audio.open("rb") as file:
        files = {"file": (audio.name, file, "audio/wav")}
        try:
            response = httpx.post(
                url,
                data=data,
                files=files,
                headers=headers,
                timeout=timeout_seconds,
            )
        except httpx.HTTPError as exc:
            raise ProviderResponseError(f"STT request failed: {exc}") from exc

    if response.status_code in LIMIT_STATUS_CODES:
        raise ProviderLimitError(
            "The STT provider rejected the audio, likely because it exceeds the upload limit. "
            "v0.1 does not split long videos yet; try a shorter video or a provider "
            "with a higher limit."
        )
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise ProviderResponseError(
            f"STT provider returned HTTP {response.status_code}: {response.text}"
        ) from exc
    return response


def _log_transcription_request(
    *,
    url: str,
    audio: Path,
    data: dict[str, Any],
    has_api_key: bool,
) -> None:
    payload = {
        "method": "POST",
        "url": url,
        "headers": {"Authorization": "Bearer ***" if has_api_key else None},
        "data": data,
        "file": {
            "name": audio.name,
            "content_type": "audio/wav",
            "size_bytes": audio.stat().st_size,
        },
    }
    print(f"STT request: {json.dumps(payload, ensure_ascii=False)}", file=sys.stderr)

