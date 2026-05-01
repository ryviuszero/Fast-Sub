from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

import fast_sub.cli as cli
from fast_sub.transcribe import TranscribeResult

runner = CliRunner()


def test_transcribe_command_outputs_json(monkeypatch) -> None:
    calls = []

    def fake_transcribe_media(input_file, options):  # noqa: ANN001
        calls.append((input_file, options))
        return TranscribeResult(
            srt_path=Path("out.srt"),
            provider="local-faster-whisper",
            model=options.model,
            language_detected="zh",
            duration_sec=10.0,
            elapsed_sec=2.0,
            worker_elapsed_sec=1.5,
            rtfx=5.0,
            segments_count=2,
            warnings=[],
        )

    monkeypatch.setattr(cli, "transcribe_media", fake_transcribe_media)

    result = runner.invoke(
        cli.app,
        [
            "transcribe",
            "input.mp4",
            "--provider",
            "local-faster-whisper",
            "--model",
            "whisper-small",
            "--language",
            "zh",
            "--output",
            "out.srt",
            "--json",
            "--keep-temp",
        ],
    )

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["srt_path"] == "out.srt"
    assert payload["provider"] == "local-faster-whisper"
    assert payload["language_detected"] == "zh"
    assert "Wrote subtitle" not in result.stdout
    input_file, options = calls[0]
    assert input_file == Path("input.mp4")
    assert options.language == "zh"
    assert options.output == Path("out.srt")
    assert options.keep_temp is True


def test_transcribe_command_returns_json_error(monkeypatch) -> None:
    def fail(input_file, options):  # noqa: ANN001
        raise cli.SubGenError("Worker returned no usable subtitle segments.")

    monkeypatch.setattr(cli, "transcribe_media", fail)

    result = runner.invoke(cli.app, ["transcribe", "input.mp4", "--json"])

    assert result.exit_code == 1
    payload = json.loads(result.stdout)
    assert payload["ok"] is False
    assert "no usable subtitle segments" in payload["error"]
