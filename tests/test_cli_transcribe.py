from __future__ import annotations

import json
from pathlib import Path

from typer.testing import CliRunner

import fast_sub.cli.runtime as cli
from fast_sub.stt.service import TranscribeResult

runner = CliRunner()


def test_transcribe_command_outputs_json(monkeypatch) -> None:
    calls = []

    def fake_transcribe_media(input_file, options):  # noqa: ANN001
        calls.append((input_file, options))
        return TranscribeResult(
            srt_path=Path("out.srt"),
            provider="local-faster-whisper",
            model=options.model,
            device=options.device,
            compute_type=options.compute_type,
            language_detected="zh",
            duration_sec=10.0,
            elapsed_sec=2.0,
            worker_elapsed_sec=1.5,
            rtfx=5.0,
            segments_count=2,
            gpu_load=options.gpu_load,
            batch_size=options.batch_size or 4,
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
            "--gpu-load",
            "low",
            "--json",
            "--keep-temp",
        ],
    )

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["srt_path"] == "out.srt"
    assert payload["provider"] == "local-faster-whisper"
    assert payload["device"] == "auto"
    assert payload["compute_type"] == "auto"
    assert payload["compute"] == "auto"
    assert payload["duration"] == 10.0
    assert payload["elapsed"] == 2.0
    assert payload["language_detected"] == "zh"
    assert "Wrote subtitle" not in result.stdout
    input_file, options = calls[0]
    assert input_file == Path("input.mp4")
    assert options.language == "zh"
    assert options.output == Path("out.srt")
    assert options.gpu_load == "low"
    assert options.batch_size is None
    assert options.keep_temp is True


def test_transcribe_command_returns_json_error(monkeypatch) -> None:
    def fail(input_file, options):  # noqa: ANN001
        raise cli.SubGenError("Worker returned no usable subtitle segments.")

    monkeypatch.setattr(cli, "transcribe_media", fail)

    result = runner.invoke(cli.app, ["transcribe", "input.mp4", "--json"])

    assert result.exit_code == 1
    payload = json.loads(result.stdout)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "EMPTY_SEGMENTS"
    assert payload["error"]["stage"] == "transcribe"
    assert "no usable subtitle segments" in payload["error"]["message"]
