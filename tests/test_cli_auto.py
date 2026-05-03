from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

import fast_sub.cli.runtime as cli
from fast_sub.pipeline.orchestrator import AutoOptions, AutoPipelineError, AutoResult, AutoStep

runner = CliRunner()


def test_auto_command_outputs_json(monkeypatch) -> None:
    calls = []

    def fake_auto_media(input_file: Path, options: AutoOptions) -> AutoResult:
        calls.append((input_file, options))
        return AutoResult(
            ok=True,
            input=input_file,
            output=options.output or Path("input.srt"),
            provider=options.provider,
            model=options.model,
            language=options.language,
            dry_run=options.dry_run,
            steps=[AutoStep("transcribe", "planned", "Would transcribe.")],
            elapsed_sec=0.1,
        )

    monkeypatch.setattr(cli, "auto_media", fake_auto_media)

    result = runner.invoke(
        cli.app,
        [
            "auto",
            "input.mp4",
            "--dry-run",
            "--json",
            "--provider",
            "local-faster-whisper",
            "--model",
            "whisper-base",
            "--language",
            "en",
            "--device",
            "cpu",
            "--compute",
            "int8",
            "--gpu-load",
            "low",
            "--mode",
            "fast",
            "--yes",
            "--output",
            "out.srt",
            "--keep-temp",
        ],
    )

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["ok"] is True
    assert payload["dry_run"] is True
    input_file, options = calls[0]
    assert input_file == Path("input.mp4")
    assert options.model == "whisper-base"
    assert options.language == "en"
    assert options.device == "cpu"
    assert options.compute_type == "int8"
    assert options.gpu_load == "low"
    assert options.mode == "fast"
    assert options.yes is True
    assert options.output == Path("out.srt")
    assert options.keep_temp is True


def test_auto_command_outputs_json_error(monkeypatch) -> None:
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
                action_hint="Run `fast-sub models install whisper-small` or pass --yes.",
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
    assert payload["steps"][0]["status"] == "missing_model"
    assert "models install whisper-small" in payload["steps"][0]["action_hint"]
