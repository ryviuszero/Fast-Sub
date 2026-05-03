import json
from pathlib import Path

from typer.testing import CliRunner

import fast_sub.cli as cli
from fast_sub.analyze import AnalysisResult

runner = CliRunner()


def test_analyze_command_outputs_json(monkeypatch):
    sample = Path("tests/fixtures/sample.wav")
    monkeypatch.setattr(
        cli,
        "analyze_media",
        lambda path: AnalysisResult(
            duration_sec=10.0,
            speech_ratio=0.8,
            silence_ratio=0.2,
            mean_volume_db=-22.5,
            peak_volume_db=-2.1,
            estimated_segments=2,
            avg_segment_sec=4.0,
            recommended_vad="normal",
            recommended_mode="balanced",
            warnings=[],
        ),
    )

    result = runner.invoke(cli.app, ["analyze", str(sample), "--json"])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload == {
        "duration_sec": 10.0,
        "speech_ratio": 0.8,
        "silence_ratio": 0.2,
        "mean_volume_db": -22.5,
        "peak_volume_db": -2.1,
        "estimated_segments": 2,
        "avg_segment_sec": 4.0,
        "recommended_vad": "normal",
        "recommended_mode": "balanced",
        "warnings": [],
    }


def test_analyze_command_prints_human_readable_result(monkeypatch):
    monkeypatch.setattr(
        cli,
        "analyze_media",
        lambda path: AnalysisResult(
            duration_sec=10.0,
            speech_ratio=0.8,
            silence_ratio=0.2,
            mean_volume_db=-22.5,
            peak_volume_db=-2.1,
            estimated_segments=2,
            avg_segment_sec=4.0,
            recommended_vad="normal",
            recommended_mode="balanced",
            warnings=["LOW_VOLUME"],
        ),
    )

    result = runner.invoke(cli.app, ["analyze", "tests/fixtures/sample.wav"])

    assert result.exit_code == 0
    assert "recommended_vad: normal" in result.stdout
    assert "warnings: LOW_VOLUME" in result.stdout


def test_analyze_command_returns_json_error(monkeypatch):
    def fail(path):
        raise cli.SubGenError(f"No audio stream found in: {path}")

    monkeypatch.setattr(cli, "analyze_media", fail)

    result = runner.invoke(cli.app, ["analyze", "tests/fixtures/sample.wav", "--json"])

    assert result.exit_code == 2
    payload = json.loads(result.stdout)
    assert payload["ok"] is False
    assert payload["error"]["code"] == "invalid_input"
    assert "No audio stream" in payload["error"]["message"]
