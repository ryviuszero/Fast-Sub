import json
import tomllib
from pathlib import Path

from typer.testing import CliRunner

from fast_sub.cli import app
from fast_sub.provider_models import (
    SttProviderRequest,
    SttProviderResponse,
    SttProviderSegment,
    TranslationProviderRequest,
    TranslationProviderResponse,
)
from fast_sub.providers import default_registry


def test_provider_contracts_are_json_serializable() -> None:
    stt_request = SttProviderRequest(
        job_id="job-1",
        audio_path=Path("audio.wav"),
        language="auto",
    )
    stt_response = SttProviderResponse(
        provider="local-faster-whisper",
        language="en",
        segments=[SttProviderSegment(start_sec=0, end_sec=1.2, text="hello")],
    )
    translate_request = TranslationProviderRequest(
        job_id="job-1",
        texts=["hello"],
        source_language="en",
        target_language="zh",
    )
    translate_response = TranslationProviderResponse(
        provider="api-openai-chat",
        translations=["你好"],
    )

    payload = {
        "stt_request": stt_request.model_dump(mode="json"),
        "stt_response": stt_response.model_dump(mode="json"),
        "translate_request": translate_request.model_dump(mode="json"),
        "translate_response": translate_response.model_dump(mode="json"),
    }

    encoded = json.dumps(payload, ensure_ascii=False)
    assert "audio.wav" in encoded
    assert "你好" in encoded


def test_default_registry_lists_required_providers(monkeypatch) -> None:
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    providers = {provider.metadata.id: provider for provider in default_registry().list()}

    assert set(providers) == {
        "local-faster-whisper",
        "api-openai-transcription",
        "local-nllb-ct2",
        "api-openai-chat",
    }
    assert providers["api-openai-transcription"].status.status == "missing_api_key"
    assert providers["api-openai-chat"].status.status == "missing_api_key"


def test_local_faster_whisper_missing_dependency_mentions_local_asr(monkeypatch) -> None:
    original_find_spec = __import__("importlib").util.find_spec

    def fake_find_spec(name: str):
        if name == "faster_whisper":
            return None
        return original_find_spec(name)

    monkeypatch.setattr("fast_sub.providers.importlib.util.find_spec", fake_find_spec)

    provider = default_registry().inspect("local-faster-whisper")

    assert provider.status.status == "missing_dependency"
    assert "faster_whisper" in provider.status.message
    assert "local-asr" in provider.status.message
    assert "uv sync --extra local-asr" in provider.status.message


def test_pyproject_declares_local_asr_extra() -> None:
    pyproject = tomllib.loads(Path("pyproject.toml").read_text(encoding="utf-8"))

    local_asr = pyproject["project"]["optional-dependencies"]["local-asr"]

    assert any(dependency.startswith("faster-whisper>=") for dependency in local_asr)


def test_api_provider_status_does_not_expose_key(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-secret-value")

    provider = default_registry().inspect("api-openai-transcription")
    encoded = provider.model_dump_json()

    assert provider.status.status == "available"
    assert "sk-secret-value" not in encoded


def test_providers_cli_outputs_json_without_api_key(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-secret-value")
    runner = CliRunner()

    result = runner.invoke(app, ["providers", "test", "api-openai-chat", "--json"])

    assert result.exit_code == 0
    assert "sk-secret-value" not in result.output
    payload = json.loads(result.output)
    assert payload["metadata"]["id"] == "api-openai-chat"
    assert payload["status"]["status"] == "available"
