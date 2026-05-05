from __future__ import annotations

import json
import sys
from pathlib import Path

from typer.testing import CliRunner

import fast_sub.cli.runtime as cli
from fast_sub.pipeline.errors import AutoPipelineError
from fast_sub.pipeline.models import AutoOptions, AutoResult, AutoStep
from fast_sub.stt.errors import TranscribeError

runner = CliRunner()


def test_run_command_routes_to_auto_v0(monkeypatch) -> None:
    calls: list[tuple[Path, AutoOptions]] = []

    def fake_auto_media(input_file: Path, options: AutoOptions) -> AutoResult:
        calls.append((input_file, options))
        return _auto_success(input_file, options)

    monkeypatch.setattr(cli, "auto_media", fake_auto_media)

    result = runner.invoke(cli.app, ["run", "input.mp4", "--dry-run", "--json"])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["ok"] is True
    assert payload["dry_run"] is True
    assert calls == [(Path("input.mp4"), calls[0][1])]
    assert calls[0][1].provider == "local-faster-whisper"


def test_bare_command_uses_run_auto_alias(monkeypatch) -> None:
    called: dict[str, object] = {}

    def fake_typer_run(func):  # noqa: ANN001
        called["func"] = func

    monkeypatch.setattr(sys, "argv", ["fast-sub", "input.mp4", "--dry-run", "--json"])
    monkeypatch.setattr(cli.typer, "run", fake_typer_run)

    cli.main()

    assert called["func"] is cli.run
    assert cli._should_use_command_app(["input.mp4"]) is False


def test_auto_missing_model_json_is_parseable_and_exits_4(monkeypatch) -> None:
    failed = AutoResult(
        ok=False,
        input=Path("input.mp4"),
        output=Path("input.srt"),
        provider="local-faster-whisper",
        model="whisper-small",
        language="auto",
        dry_run=False,
        steps=[
            AutoStep(
                "model",
                "missing_model",
                "Model is not installed: whisper-small.",
                action_hint=(
                    "Run `fast-sub models install whisper-small` or `fast-sub auto --yes`."
                ),
            )
        ],
        elapsed_sec=0.1,
        error="Model is not installed: whisper-small.",
    )

    def fail(input_file: Path, options: AutoOptions) -> AutoResult:
        raise AutoPipelineError(failed)

    monkeypatch.setattr(cli, "auto_media", fail)

    result = runner.invoke(cli.app, ["auto", "input.mp4", "--json"])

    assert result.exit_code == 4
    payload = json.loads(result.stdout)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "missing_model"
    assert "fast-sub auto --yes" in payload["error"]["action_hint"]


def test_auto_missing_input_json_uses_invalid_input_error() -> None:
    result = runner.invoke(cli.app, ["auto", "missing.mp4", "--json"])

    assert result.exit_code == 2
    payload = json.loads(result.stdout)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "invalid_input"
    assert payload["error"]["stage"] == "input"
    assert "Input file does not exist" in payload["error"]["message"]


def test_transcribe_missing_local_asr_json_is_parseable_and_exits_3(monkeypatch) -> None:
    def fail(input_file, options):  # noqa: ANN001
        raise TranscribeError(
            "Python module 'faster_whisper' is not installed.",
            stage="provider",
            code="missing_dependency",
            action_hint=(
                "Install local ASR dependencies with `uv sync --extra local-asr` "
                "or `pip install fast-sub[local-asr]`."
            ),
        )

    monkeypatch.setattr(cli, "transcribe_media", fail)

    result = runner.invoke(cli.app, ["transcribe", "input.mp4", "--json"])

    assert result.exit_code == 3
    payload = json.loads(result.stdout)
    assert payload["error"]["code"] == "missing_dependency"
    assert "uv sync --extra local-asr" in payload["error"]["action_hint"]


def test_translate_missing_provider_json_is_parseable() -> None:
    result = runner.invoke(cli.app, ["translate", "input.srt", "--json"])

    assert result.exit_code == 2
    payload = json.loads(result.stdout)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "invalid_options"
    assert "provider" in payload["error"]["message"]


def test_json_error_redacts_api_keys(monkeypatch) -> None:
    secret = "sk-testsecret123456"
    monkeypatch.setenv("OPENAI_API_KEY", secret)

    def fail(input_file, options):  # noqa: ANN001
        raise cli.SubGenError(f"provider token={secret} failed")

    monkeypatch.setattr(cli, "transcribe_media", fail)

    result = runner.invoke(cli.app, ["transcribe", "input.mp4", "--json"])

    payload = json.loads(result.stdout)
    assert secret not in result.stdout
    assert secret not in result.stderr
    assert "[redacted]" in payload["error"]["message"]


def _auto_success(input_file: Path, options: AutoOptions) -> AutoResult:
    return AutoResult(
        ok=True,
        input=input_file,
        output=options.output or input_file.with_suffix(".srt"),
        provider=options.provider,
        model=options.model,
        language=options.language,
        dry_run=options.dry_run,
        steps=[AutoStep("transcribe", "planned", "Would transcribe.")],
        elapsed_sec=0.1,
    )
