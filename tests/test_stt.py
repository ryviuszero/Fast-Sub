import httpx

from sub_gen import stt


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
