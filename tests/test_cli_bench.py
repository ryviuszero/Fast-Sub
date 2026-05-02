from __future__ import annotations

import json
import uuid
from pathlib import Path

from typer.testing import CliRunner

import fast_sub.cli as cli

runner = CliRunner()
TEST_WORKDIR_ROOT = Path(".test-work") / "cli-bench"


def test_bench_command_outputs_json_and_writes_markdown(monkeypatch) -> None:
    work_dir = TEST_WORKDIR_ROOT / uuid.uuid4().hex
    work_dir.mkdir(parents=True, exist_ok=True)
    markdown = work_dir / "report.md"
    calls = []

    def fake_run_bench(input_file, options):  # noqa: ANN001
        calls.append((input_file, options))
        if options.markdown is not None:
            options.markdown.write_text("# mock report\n", encoding="utf-8")
        return {
            "schema_version": 1,
            "generated_at": "2026-05-02T00:00:00Z",
            "measurement_scope": "transcribe_media_v1",
            "includes_audio_prepare": True,
            "includes_worker_only_metric": True,
            "excludes_refine": True,
            "input": str(input_file),
            "input_basename": input_file.name,
            "input_path_redacted": True,
            "sample": {"id": "sample"},
            "hardware": {"os": "test"},
            "profiles": [
                {
                    "name": "cpu-int8",
                    "requested_device": "cpu",
                    "requested_compute_type": "int8",
                    "runs": [],
                    "summary": {"runs": 0},
                }
            ],
        }

    monkeypatch.setattr(cli, "run_bench", fake_run_bench)

    result = runner.invoke(
        cli.app,
        [
            "bench",
            "input.mp4",
            "--repeat",
            "3",
            "--model",
            "whisper-small",
            "--language",
            "zh",
            "--markdown",
            str(markdown),
            "--sample-id",
            "zh-interview-10m",
            "--json",
        ],
    )

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["measurement_scope"] == "transcribe_media_v1"
    input_file, options = calls[0]
    assert input_file == Path("input.mp4")
    assert options.repeat == 3
    assert options.language == "zh"
    assert options.sample_id == "zh-interview-10m"
    assert options.markdown == markdown
    assert markdown.read_text(encoding="utf-8") == "# mock report\n"


def test_bench_command_outputs_failed_report_as_json(monkeypatch) -> None:
    report = {
        "schema_version": 1,
        "profiles": [
            {
                "name": "cpu-int8",
                "runs": [{"index": 1, "status": "failed", "reason": "missing model"}],
                "summary": {"ok_runs": 0},
            }
        ],
    }

    def fail(input_file, options):  # noqa: ANN001
        raise cli.BenchError("All benchmark profiles failed.", report=report)

    monkeypatch.setattr(cli, "run_bench", fail)

    result = runner.invoke(cli.app, ["bench", "input.mp4", "--json"])

    assert result.exit_code == 1
    payload = json.loads(result.stdout)
    assert payload["profiles"][0]["runs"][0]["status"] == "failed"
