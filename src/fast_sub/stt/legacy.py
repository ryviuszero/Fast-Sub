from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from fast_sub.clients.openai_transcription import (
    OpenAITranscriptionClient,
    TranscriptionRequestError,
)
from fast_sub.contracts.errors import ProviderLimitError, ProviderResponseError
from fast_sub.models import Segment, WhisperXComputeType, WhisperXDevice

LIMIT_STATUS_CODES = {413, 422}
WHISPERX_INSTALL_HINT = (
    "Install it in a Python 3.11 or 3.12 environment: uv pip install 'whisperx>=3.8.5,<4'"
)


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


def transcribe_segments_whisperx(
    *,
    audio: Path,
    model: str,
    source_lang: str,
    device: WhisperXDevice,
    compute_type: WhisperXComputeType,
    batch_size: int,
) -> list[Segment]:
    whisperx = _import_whisperx()
    resolved_device = _resolve_whisperx_device(device)
    resolved_compute_type = _resolve_whisperx_compute_type(compute_type, resolved_device)

    try:
        model_obj = whisperx.load_model(
            model,
            resolved_device,
            compute_type=resolved_compute_type,
        )
        audio_data = whisperx.load_audio(str(audio))
        transcribe_kwargs: dict[str, Any] = {"batch_size": batch_size}
        if source_lang != "auto":
            transcribe_kwargs["language"] = source_lang
        result = model_obj.transcribe(audio_data, **transcribe_kwargs)
        language = source_lang if source_lang != "auto" else str(result.get("language", ""))
        if not language:
            raise ProviderResponseError("WhisperX did not return a detected language.")
        align_model, metadata = whisperx.load_align_model(
            language_code=language,
            device=resolved_device,
        )
        aligned = whisperx.align(
            result.get("segments", []),
            align_model,
            metadata,
            audio_data,
            resolved_device,
            return_char_alignments=False,
        )
    except ProviderResponseError:
        raise
    except Exception as exc:
        raise ProviderResponseError(f"WhisperX transcription failed: {exc}") from exc

    raw_segments = aligned.get("segments")
    if not isinstance(raw_segments, list):
        raise ProviderResponseError("WhisperX did not return timestamped segments.")
    return _segments_from_items(raw_segments, provider_name="WhisperX")


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
) -> Any:
    url = f"{base_url.rstrip('/')}/audio/transcriptions"
    data: dict[str, Any] = {
        "model": model,
        "response_format": response_format,
        "temperature": str(temperature),
    }
    if source_lang != "auto":
        data["language"] = source_lang
    _log_transcription_request(url=url, audio=audio, data=data, has_api_key=bool(api_key))
    client = OpenAITranscriptionClient(
        base_url=base_url,
        api_key=api_key,
        timeout_seconds=timeout_seconds,
    )
    try:
        response = client.transcribe(
            audio=audio,
            model=model,
            source_lang=source_lang,
            temperature=temperature,
            response_format=response_format,
        )
    except TranscriptionRequestError as exc:
        raise ProviderResponseError(f"STT request failed: {exc}") from exc

    if response.status_code in LIMIT_STATUS_CODES:
        raise ProviderLimitError(
            "The STT provider rejected the audio, likely because it exceeds the upload limit. "
            "v0.1 does not split long videos yet; try a shorter video or a provider "
            "with a higher limit."
        )
    try:
        response.raise_for_status()
    except Exception as exc:
        raise ProviderResponseError(
            f"STT provider returned HTTP {response.status_code}: {response.text}"
        ) from exc
    return response


def _segments_from_items(items: list[object], *, provider_name: str) -> list[Segment]:
    segments: list[Segment] = []
    for index, item in enumerate(items, start=1):
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
            raise ProviderResponseError(
                f"Invalid {provider_name} segment at index {index}: {item}"
            ) from exc
    if not segments:
        raise ProviderResponseError(f"{provider_name} returned no usable subtitle segments.")
    return segments


def _import_whisperx() -> Any:
    try:
        import whisperx
    except ImportError as exc:
        raise ProviderResponseError(f"WhisperX is not installed. {WHISPERX_INSTALL_HINT}") from exc
    return whisperx


def _resolve_whisperx_device(device: WhisperXDevice) -> str:
    if device is not WhisperXDevice.AUTO:
        return device.value
    try:
        import torch
    except ImportError:
        return "cpu"
    return "cuda" if torch.cuda.is_available() else "cpu"


def _resolve_whisperx_compute_type(
    compute_type: WhisperXComputeType,
    resolved_device: str,
) -> str:
    if compute_type is not WhisperXComputeType.AUTO:
        return compute_type.value
    return "float16" if resolved_device == "cuda" else "int8"


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
