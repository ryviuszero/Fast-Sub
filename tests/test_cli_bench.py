from __future__ import annotations

import json
import uuid
from pathlib import Path

from typer.testing import CliRunner

import fast_sub.cli.runtime as cli
from fast_sub.cli.commands import bench_cmd

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
            "--profile",
            "auto",
            "--model",
            "whisper-small",
            "--language",
            "zh",
            "--markdown-path",
            str(markdown),
            "--json",
        ],
    )

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["measurement_scope"] == "transcribe_media_v1"
    input_file, options = calls[0]
    assert input_file == Path("input.mp4")
    assert options.repeat == 3
    assert options.profile == "auto"
    assert options.language == "zh"
    assert options.sample_id is None
    assert options.markdown == markdown
    assert options.progress is not None
    assert markdown.read_text(encoding="utf-8") == "# mock report\n"


def test_bench_manifest_command_outputs_schema() -> None:
    result = runner.invoke(cli.app, ["bench-manifest"])

    assert result.exit_code == 0
    assert "Fast Sub Bench Sample Manifest" in result.stdout
    assert "samples[].prepared_media_path" in result.stdout
    assert "fast-sub bench matches" in result.stdout


def test_bench_manifest_command_outputs_json_schema() -> None:
    result = runner.invoke(cli.app, ["bench-manifest", "--json"])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["kind"] == "fast_sub_bench_sample_manifest_schema"
    assert "samples[].prepared_media_path" in payload["required_fields"]
    assert payload["example"]["samples"][0]["id"] == "zh-interview-1m"


def test_bench_command_infers_local_sample_defaults(monkeypatch) -> None:
    input_file = Path("local_tests/media/light/zh-interview-1m.wav")
    manifest = Path("local_tests/manifests/benchmark-assets-light.json")
    calls = []

    monkeypatch.setattr(
        bench_cmd,
        "load_sample_metadata",
        lambda *args, **kwargs: {"language": "zh"},
    )

    def fake_run_bench(input_arg, options):  # noqa: ANN001
        calls.append((input_arg, options))
        return {
            "schema_version": 1,
            "generated_at": "2026-05-02T00:00:00Z",
            "measurement_scope": "transcribe_media_v1",
            "input_basename": input_arg.name,
            "sample": {"id": "zh-interview-1m"},
            "hardware": {"os": "test"},
            "profiles": [],
        }

    monkeypatch.setattr(cli, "run_bench", fake_run_bench)

    result = runner.invoke(
        cli.app,
        [
            "bench",
            str(input_file),
            "--model",
            "whisper-small",
            "--repeat",
            "1",
            "--profile",
            "auto",
            "--markdown",
        ],
    )

    assert result.exit_code == 0
    _, options = calls[0]
    assert options.sample_manifest == manifest
    assert options.sample_id is None
    assert options.language == "zh"
    assert options.markdown == Path("local_tests/reports/light/zh-interview-1m.md")


def test_bench_command_preserves_markdown_path_compatibility(monkeypatch) -> None:
    work_dir = TEST_WORKDIR_ROOT / uuid.uuid4().hex
    work_dir.mkdir(parents=True, exist_ok=True)
    markdown = work_dir / "report.md"
    calls = []

    def fake_run_bench(input_arg, options):  # noqa: ANN001
        calls.append((input_arg, options))
        return {
            "schema_version": 1,
            "generated_at": "2026-05-02T00:00:00Z",
            "measurement_scope": "transcribe_media_v1",
            "input_basename": input_arg.name,
            "sample": {"id": "sample"},
            "hardware": {"os": "test"},
            "profiles": [],
        }

    monkeypatch.setattr(cli, "run_bench", fake_run_bench)

    result = runner.invoke(cli.app, ["bench", "input.mp4", "--markdown", str(markdown)])

    assert result.exit_code == 0
    assert calls[0][1].markdown == markdown


def test_bench_command_falls_back_to_auto_for_unknown_manifest_language(monkeypatch) -> None:
    input_file = Path("local_tests/media/noisy-music-5m.wav")
    calls = []

    monkeypatch.setattr(
        bench_cmd,
        "load_sample_metadata",
        lambda *args, **kwargs: {"language": "unknown"},
    )

    def fake_run_bench(input_arg, options):  # noqa: ANN001
        calls.append((input_arg, options))
        return {
            "schema_version": 1,
            "generated_at": "2026-05-02T00:00:00Z",
            "measurement_scope": "transcribe_media_v1",
            "input_basename": input_arg.name,
            "sample": {"id": "noisy-music-5m"},
            "hardware": {"os": "test"},
            "profiles": [],
        }

    monkeypatch.setattr(cli, "run_bench", fake_run_bench)

    result = runner.invoke(cli.app, ["bench", str(input_file), "--profile", "auto"])

    assert result.exit_code == 0
    assert calls[0][1].language == "auto"


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
        raise bench_cmd.BenchError("All benchmark profiles failed.", report=report)

    monkeypatch.setattr(cli, "run_bench", fail)

    result = runner.invoke(cli.app, ["bench", "input.mp4", "--json"])

    assert result.exit_code == 1
    payload = json.loads(result.stdout)
    assert payload["profiles"][0]["runs"][0]["status"] == "failed"


def test_bench_command_rejects_unknown_profile() -> None:
    result = runner.invoke(cli.app, ["bench", "input.mp4", "--profile", "gpu"])

    assert result.exit_code == 1
    assert "--profile must be one of" in result.stderr


def test_bench_command_reports_progress_in_text_mode(monkeypatch) -> None:
    def fake_run_bench(input_file, options):  # noqa: ANN001
        options.progress(
            "profile_start",
            profile=type("Profile", (), {"name": "cpu-int8"})(),
            repeat=1,
        )
        options.progress(
            "run_done",
            profile=type("Profile", (), {"name": "cpu-int8"})(),
            run={
                "status": "ok",
                "elapsed_sec": 2.0,
                "rtfx_e2e": 5.0,
                "quality": {"cer": 0.1, "wer": None},
            },
        )
        options.progress(
            "profile_done",
            profile=type("Profile", (), {"name": "cpu-int8"})(),
            summary={"ok_runs": 1, "runs": 1, "rtfx_e2e_avg": 5.0},
        )
        return {
            "schema_version": 1,
            "generated_at": "2026-05-02T00:00:00Z",
            "measurement_scope": "transcribe_media_v1",
            "input_basename": input_file.name,
            "sample": {"id": "sample"},
            "hardware": {"os": "test"},
            "profiles": [
                {
                    "name": "cpu-int8",
                    "requested_device": "cpu",
                    "requested_compute_type": "int8",
                    "runs": [],
                    "summary": {
                        "runs": 1,
                        "ok_runs": 1,
                        "actual_device": "cpu",
                        "actual_compute_type": "int8",
                        "rtfx_e2e_avg": 5.0,
                    },
                }
            ],
        }

    monkeypatch.setattr(cli, "run_bench", fake_run_bench)

    result = runner.invoke(cli.app, ["bench", "input.mp4"])

    assert result.exit_code == 0
    assert "Benchmark profile cpu-int8" in result.stdout
    assert "elapsed=2.000s" in result.stdout
    assert "cer=0.100" in result.stdout
    assert "Fast Sub Benchmark Summary" in result.stdout


def test_bench_command_progress_omits_missing_quality(monkeypatch) -> None:
    def fake_run_bench(input_file, options):  # noqa: ANN001
        options.progress(
            "run_done",
            profile=type("Profile", (), {"name": "cpu-int8"})(),
            run={
                "status": "ok",
                "elapsed_sec": 2.0,
                "rtfx_e2e": 5.0,
                "quality": {"cer": None, "wer": None},
            },
        )
        return {
            "schema_version": 1,
            "generated_at": "2026-05-02T00:00:00Z",
            "measurement_scope": "transcribe_media_v1",
            "input_basename": input_file.name,
            "sample": {"id": "sample"},
            "hardware": {"os": "test"},
            "profiles": [],
        }

    monkeypatch.setattr(cli, "run_bench", fake_run_bench)

    result = runner.invoke(cli.app, ["bench", "input.mp4"])

    assert result.exit_code == 0
    assert "elapsed=2.000s" in result.stdout
    assert "rtfx=5.000" in result.stdout
    assert "cer=" not in result.stdout
    assert "wer=" not in result.stdout


def test_bench_command_keeps_json_stdout_clean_with_progress(monkeypatch) -> None:
    def fake_run_bench(input_file, options):  # noqa: ANN001
        options.progress(
            "profile_start",
            profile=type("Profile", (), {"name": "cpu-int8"})(),
            repeat=1,
        )
        return {
            "schema_version": 1,
            "measurement_scope": "transcribe_media_v1",
            "input_basename": input_file.name,
            "sample": {"id": "sample"},
            "profiles": [],
        }

    monkeypatch.setattr(cli, "run_bench", fake_run_bench)

    result = runner.invoke(cli.app, ["bench", "input.mp4", "--json"])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["measurement_scope"] == "transcribe_media_v1"
    assert "Benchmark profile" not in result.stdout
