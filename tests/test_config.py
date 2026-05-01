from pathlib import Path

import pytest

from fast_sub.cli import _resolve_options, _validate_input
from fast_sub.errors import SubGenError
from fast_sub.models import Mode, SttProvider, SubtitleFormat


def _resolve_minimal(**overrides):
    params = {
        "config_path": None,
        "mode": None,
        "original_only": False,
        "source_lang": None,
        "target_lang": None,
        "stt_base_url": None,
        "stt_api_key": "dummy",
        "stt_provider": None,
        "stt_model": None,
        "stt_temperature": None,
        "whisperx_device": None,
        "whisperx_compute_type": None,
        "whisperx_batch_size": None,
        "max_audio_mb": None,
        "translator": None,
        "subtitle_format": SubtitleFormat.SRT,
        "max_line_chars": None,
        "bilingual_order": None,
    }
    params.update(overrides)
    return _resolve_options(**params)


def test_cli_values_override_config() -> None:
    options = _resolve_minimal(
        config_path=Path("tests/fixtures/config.toml"),
        mode=Mode.BILINGUAL,
        target_lang="zh",
        stt_model="new-model",
        translator="google",
    )

    assert options.subtitle.mode is Mode.BILINGUAL
    assert options.subtitle.source_lang == "en"
    assert options.subtitle.target_lang == "zh"
    assert options.stt.model == "new-model"
    assert options.translator.service == "google"


def test_original_only_overrides_config_mode() -> None:
    options = _resolve_minimal(
        config_path=Path("tests/fixtures/config.toml"),
        original_only=True,
    )

    assert options.subtitle.mode is Mode.ORIGINAL


def test_defaults_follow_openai_api_shape(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    options = _resolve_minimal()

    assert options.subtitle.mode is Mode.ORIGINAL
    assert options.subtitle.source_lang == "auto"
    assert options.subtitle.target_lang == "en"
    assert options.stt.provider is SttProvider.OPENAI_COMPATIBLE
    assert options.stt.base_url == "https://api.openai.com/v1"
    assert options.stt.model == "whisper-1"
    assert options.stt.temperature == 0
    assert options.stt.max_audio_mb == 25
    assert options.translator.service == "bing"


def test_local_stt_endpoint_requires_explicit_model(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    input_file = Path("tests/fixtures/sample.wav")
    options = _resolve_minimal(stt_base_url="http://localhost:8000/v1", stt_model=None)

    assert options.stt.model is None
    assert options.stt.max_audio_mb is None
    with pytest.raises(SubGenError, match="--stt-model"):
        _validate_input(input_file, options)


def test_config_format_is_preserved_when_cli_format_is_omitted() -> None:
    options = _resolve_minimal(config_path=Path("tests/fixtures/config.toml"), subtitle_format=None)

    assert options.subtitle.format is SubtitleFormat.SRT


def test_rejects_openai_json_only_transcription_model() -> None:
    input_file = Path("tests/fixtures/sample.wav")
    options = _resolve_minimal(stt_model="gpt-4o-mini-transcribe")

    with pytest.raises(SubGenError, match="response_format=json"):
        _validate_input(input_file, options)


def test_rejects_invalid_temperature() -> None:
    input_file = Path("tests/fixtures/sample.wav")
    options = _resolve_minimal(stt_temperature=2)

    with pytest.raises(SubGenError, match="--stt-temperature"):
        _validate_input(input_file, options)


def test_whisperx_defaults_to_small_model() -> None:
    options = _resolve_minimal(stt_provider=SttProvider.WHISPERX, stt_api_key=None)

    assert options.stt.provider is SttProvider.WHISPERX
    assert options.stt.model == "small"
    assert options.stt.base_url is None
    assert options.stt.api_key is None


def test_whisperx_original_mode_does_not_require_http_credentials() -> None:
    input_file = Path("tests/fixtures/sample.wav")
    options = _resolve_minimal(
        stt_provider=SttProvider.WHISPERX,
        stt_api_key=None,
        mode=Mode.ORIGINAL,
    )

    _validate_input(input_file, options)


def test_whisperx_rejects_translated_mode() -> None:
    input_file = Path("tests/fixtures/sample.wav")
    options = _resolve_minimal(
        stt_provider=SttProvider.WHISPERX,
        stt_api_key=None,
        mode=Mode.TRANSLATED,
    )

    with pytest.raises(SubGenError, match="only supports original subtitles"):
        _validate_input(input_file, options)


def test_whisperx_rejects_invalid_batch_size() -> None:
    input_file = Path("tests/fixtures/sample.wav")
    options = _resolve_minimal(
        stt_provider=SttProvider.WHISPERX,
        stt_api_key=None,
        whisperx_batch_size=0,
    )

    with pytest.raises(SubGenError, match="--whisperx-batch-size"):
        _validate_input(input_file, options)
