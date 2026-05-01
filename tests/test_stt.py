import sys
from types import SimpleNamespace

import httpx
import pytest

from fast_sub import stt
from fast_sub.errors import ProviderResponseError
from fast_sub.models import WhisperXComputeType, WhisperXDevice


def test_transcription_request_omits_language_for_auto(
    monkeypatch: object,
    capsys: object,
) -> None:
    audio = stt.Path("tests/fixtures/sample.wav")
    captured: dict[str, object] = {}

    def fake_post(*args: object, **kwargs: object) -> httpx.Response:
        captured.update(kwargs)
        request = httpx.Request("POST", "http://localhost:8000/v1/audio/transcriptions")
        return httpx.Response(200, text="ok", request=request)

    monkeypatch.setattr(stt.httpx, "post", fake_post)

    stt.transcribe_srt(
        audio=audio,
        base_url="http://localhost:8000/v1",
        api_key="dummy",
        model="whisper-1",
        source_lang="auto",
        temperature=0,
    )

    data = captured["data"]
    assert isinstance(data, dict)
    assert "language" not in data
    captured_output = capsys.readouterr()
    assert "STT request:" in captured_output.err
    assert "Bearer ***" in captured_output.err
    assert "dummy" not in captured_output.err


def test_transcription_request_sends_explicit_language(
    monkeypatch: object,
    capsys: object,
) -> None:
    audio = stt.Path("tests/fixtures/sample.wav")
    captured: dict[str, object] = {}

    def fake_post(*args: object, **kwargs: object) -> httpx.Response:
        captured.update(kwargs)
        request = httpx.Request("POST", "http://localhost:8000/v1/audio/transcriptions")
        return httpx.Response(200, text="ok", request=request)

    monkeypatch.setattr(stt.httpx, "post", fake_post)

    stt.transcribe_srt(
        audio=audio,
        base_url="http://localhost:8000/v1",
        api_key="dummy",
        model="whisper-1",
        source_lang="en",
        temperature=0,
    )

    data = captured["data"]
    assert isinstance(data, dict)
    assert data["language"] == "en"
    captured_output = capsys.readouterr()
    assert '"language": "en"' in captured_output.err


def test_whisperx_transcription_converts_aligned_segments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: dict[str, object] = {}

    class FakeModel:
        def transcribe(self, audio_data: object, **kwargs: object) -> dict[str, object]:
            calls["transcribe_kwargs"] = kwargs
            return {
                "language": "en",
                "segments": [{"start": 0, "end": 1, "text": "hello"}],
            }

    fake_whisperx = SimpleNamespace(
        load_model=lambda *args, **kwargs: FakeModel(),
        load_audio=lambda path: f"audio:{path}",
        load_align_model=lambda language_code, device: ("align-model", {"language": language_code}),
        align=lambda segments, *args, **kwargs: {
            "segments": [{"start": 0.1, "end": 1.2, "text": "hello world"}]
        },
    )
    monkeypatch.setitem(sys.modules, "whisperx", fake_whisperx)

    segments = stt.transcribe_segments_whisperx(
        audio=stt.Path("tests/fixtures/sample.wav"),
        model="small",
        source_lang="auto",
        device=WhisperXDevice.CPU,
        compute_type=WhisperXComputeType.INT8,
        batch_size=4,
    )

    assert segments[0].start == 0.1
    assert segments[0].end == 1.2
    assert segments[0].text == "hello world"
    assert calls["transcribe_kwargs"] == {"batch_size": 4}


def test_whisperx_empty_segments_raise_provider_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeModel:
        def transcribe(self, audio_data: object, **kwargs: object) -> dict[str, object]:
            return {"language": "en", "segments": []}

    fake_whisperx = SimpleNamespace(
        load_model=lambda *args, **kwargs: FakeModel(),
        load_audio=lambda path: "audio",
        load_align_model=lambda language_code, device: ("align-model", {}),
        align=lambda segments, *args, **kwargs: {"segments": []},
    )
    monkeypatch.setitem(sys.modules, "whisperx", fake_whisperx)

    with pytest.raises(ProviderResponseError, match="no usable subtitle segments"):
        stt.transcribe_segments_whisperx(
            audio=stt.Path("tests/fixtures/sample.wav"),
            model="small",
            source_lang="auto",
            device=WhisperXDevice.CPU,
            compute_type=WhisperXComputeType.INT8,
            batch_size=4,
        )
