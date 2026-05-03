from __future__ import annotations

import json
import uuid
from pathlib import Path

from typer.testing import CliRunner

import fast_sub.cli as cli

runner = CliRunner()
TEST_WORKDIR_ROOT = Path(".test-work") / "cli-bench-translate"


def test_bench_translate_command_outputs_json_and_passes_options(monkeypatch) -> None:
    work_dir = TEST_WORKDIR_ROOT / uuid.uuid4().hex
    work_dir.mkdir(parents=True, exist_ok=True)
    input_file = work_dir / "input.srt"
    reference = work_dir / "ref.zh.srt"
    input_file.write_text("1\n00:00:00,000 --> 00:00:01,000\nHello\n", encoding="utf-8")
    reference.write_text("1\n00:00:00,000 --> 00:00:01,000\n你好\n", encoding="utf-8")
    calls = []

    def fake_run_bench_translate(input_arg, options):  # noqa: ANN001
        calls.append((input_arg, options))
        return {
            "schema_version": 1,
            "measurement_scope": "translate_srt_v1",
            "input_basename": input_arg.name,
            "reference_basename": options.reference.name,
            "provider": options.provider,
            "runs": [],
            "summary": {"ok_runs": 1, "runs": 1},
        }

    monkeypatch.setattr(cli, "run_bench_translate", fake_run_bench_translate)

    result = runner.invoke(
        cli.app,
        [
            "bench-translate",
            str(input_file),
            "--reference",
            str(reference),
            "--from",
            "en",
            "--to",
            "zh",
            "--provider",
            "local-nllb-ct2",
            "--model",
            "nllb",
            "--model-path",
            str(work_dir / "model"),
            "--batch-size",
            "4",
            "--timeout",
            "12",
            "--sleep-seconds",
            "0.1",
            "--repeat",
            "2",
            "--output-dir",
            str(work_dir / "out"),
            "--json",
        ],
    )

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["measurement_scope"] == "translate_srt_v1"
    assert "Privacy" not in result.stdout
    input_arg, options = calls[0]
    assert input_arg == input_file
    assert options.reference == reference
    assert options.source_language == "en"
    assert options.target_language == "zh"
    assert options.provider == "local-nllb-ct2"
    assert options.model == "nllb"
    assert options.model_path == work_dir / "model"
    assert options.batch_size == 4
    assert options.timeout == 12
    assert options.sleep_seconds == 0.1
    assert options.repeat == 2
    assert options.output_dir == work_dir / "out"


def test_bench_translate_requires_provider_to_reference() -> None:
    missing_provider = runner.invoke(
        cli.app,
        ["bench-translate", "input.srt", "--reference", "ref.srt", "--to", "zh", "--json"],
    )
    missing_to = runner.invoke(
        cli.app,
        [
            "bench-translate",
            "input.srt",
            "--reference",
            "ref.srt",
            "--provider",
            "web-bing",
            "--json",
        ],
    )
    missing_reference = runner.invoke(
        cli.app,
        ["bench-translate", "input.srt", "--provider", "web-bing", "--to", "zh", "--json"],
    )

    assert missing_provider.exit_code == 2
    assert missing_to.exit_code == 2
    assert missing_reference.exit_code == 2
    assert json.loads(missing_provider.stdout)["error"]["code"] == "invalid_options"


def test_bench_translate_manifest_command_outputs_schema() -> None:
    result = runner.invoke(cli.app, ["bench-translate-manifest"])

    assert result.exit_code == 0
    assert "Fast Sub Translation Benchmark Manifest" in result.stdout
    assert "providers[].id" in result.stdout
    assert "en-zh" in result.stdout


def test_bench_translate_manifest_command_outputs_json_schema() -> None:
    result = runner.invoke(cli.app, ["bench-translate-manifest", "--json"])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["kind"] == "fast_sub_bench_translate_manifest_schema"
    assert "providers[].id" in payload["required_fields"]
    assert payload["example"]["providers"][0]["id"] == "web-bing"


def test_bench_translate_remote_privacy_warning_stays_off_json(monkeypatch) -> None:
    def fake_run_bench_translate(input_arg, options):  # noqa: ANN001
        return {
            "schema_version": 1,
            "measurement_scope": "translate_srt_v1",
            "input_basename": input_arg.name,
            "reference_basename": options.reference.name,
            "provider": options.provider,
            "runs": [],
            "summary": {"ok_runs": 1, "runs": 1},
        }

    monkeypatch.setattr(cli, "run_bench_translate", fake_run_bench_translate)

    result = runner.invoke(
        cli.app,
        [
            "bench-translate",
            "input.srt",
            "--reference",
            "ref.srt",
            "--provider",
            "web-bing",
            "--to",
            "zh",
            "--json",
        ],
    )

    assert result.exit_code == 0
    json.loads(result.stdout)
    assert "Privacy" not in result.stdout


def test_bench_translate_remote_privacy_warning_in_text_mode(monkeypatch) -> None:
    def fake_run_bench_translate(input_arg, options):  # noqa: ANN001
        return {
            "schema_version": 1,
            "measurement_scope": "translate_srt_v1",
            "input_basename": input_arg.name,
            "reference_basename": options.reference.name,
            "provider": options.provider,
            "runs": [],
            "summary": {"ok_runs": 1, "runs": 1},
        }

    monkeypatch.setattr(cli, "run_bench_translate", fake_run_bench_translate)

    result = runner.invoke(
        cli.app,
        [
            "bench-translate",
            "input.srt",
            "--reference",
            "ref.srt",
            "--provider",
            "web-bing",
            "--to",
            "zh",
        ],
    )

    assert result.exit_code == 0
    assert "Privacy" in result.stderr
    assert "Fast Sub Translation Benchmark Report" in result.stdout


def test_bench_translate_api_openai_chat_reads_model_env(monkeypatch) -> None:
    calls = []
    monkeypatch.setenv("OPENAI_MODEL", "qwen3-4b")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-secret123456")

    def fake_run_bench_translate(input_arg, options):  # noqa: ANN001
        calls.append(options)
        return {
            "schema_version": 1,
            "measurement_scope": "translate_srt_v1",
            "input_basename": input_arg.name,
            "reference_basename": options.reference.name,
            "provider": options.provider,
            "model": options.model,
            "runs": [],
            "summary": {"ok_runs": 1, "runs": 1},
        }

    monkeypatch.setattr(cli, "run_bench_translate", fake_run_bench_translate)

    result = runner.invoke(
        cli.app,
        [
            "bench-translate",
            "input.srt",
            "--reference",
            "ref.srt",
            "--provider",
            "api-openai-chat",
            "--to",
            "zh",
            "--json",
        ],
    )

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["model"] == "qwen3-4b"
    assert calls[0].model == "qwen3-4b"
    assert calls[0].api_key == "sk-test-secret123456"
    assert "sk-test-secret123456" not in result.stdout


def test_bench_translate_reads_translator_config(monkeypatch) -> None:
    work_dir = TEST_WORKDIR_ROOT / uuid.uuid4().hex
    work_dir.mkdir(parents=True, exist_ok=True)
    config_file = work_dir / "fast-sub.toml"
    model_dir = work_dir / "model-dir"
    config_file.write_text(
        '[translator]\n'
        'provider = "api-openai-chat"\n'
        'model = "configured-model"\n'
        'base_url = "http://localhost:1234/v1"\n'
        f'model_path = "{model_dir.as_posix()}"\n'
        'batch_size = 3\n'
        'timeout = 9\n'
        'sleep_seconds = 0.25\n',
        encoding="utf-8",
    )
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-secret123456")
    calls = []

    def fake_run_bench_translate(input_arg, options):  # noqa: ANN001
        calls.append(options)
        return {
            "schema_version": 1,
            "measurement_scope": "translate_srt_v1",
            "input_basename": input_arg.name,
            "reference_basename": options.reference.name,
            "provider": options.provider,
            "model": options.model,
            "runs": [],
            "summary": {"ok_runs": 1, "runs": 1},
        }

    monkeypatch.setattr(cli, "run_bench_translate", fake_run_bench_translate)

    result = runner.invoke(
        cli.app,
        [
            "bench-translate",
            "input.srt",
            "--reference",
            "ref.srt",
            "--to",
            "zh",
            "--config",
            str(config_file),
            "--json",
        ],
    )

    assert result.exit_code == 0
    options = calls[0]
    assert options.provider == "api-openai-chat"
    assert options.model == "configured-model"
    assert options.model_path == model_dir
    assert options.base_url == "http://localhost:1234/v1"
    assert options.batch_size == 3
    assert options.timeout == 9
    assert options.sleep_seconds == 0.25


def test_bench_translate_invalid_config_is_structured_error() -> None:
    result = runner.invoke(
        cli.app,
        [
            "bench-translate",
            "input.srt",
            "--reference",
            "ref.srt",
            "--to",
            "zh",
            "--config",
            "missing-fast-sub.toml",
            "--json",
        ],
    )

    assert result.exit_code == 2
    payload = json.loads(result.stdout)
    assert payload["error"]["code"] == "invalid_input"
    assert payload["error"]["stage"] == "bench-translate"
    assert "Could not read config" in payload["error"]["message"]
    assert "runs" not in payload


def test_bench_translate_api_openai_chat_rejects_missing_model(monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_MODEL", "")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-secret123456")

    result = runner.invoke(
        cli.app,
        [
            "bench-translate",
            "input.srt",
            "--reference",
            "ref.srt",
            "--provider",
            "api-openai-chat",
            "--to",
            "zh",
            "--json",
        ],
    )

    assert result.exit_code == 2
    payload = json.loads(result.stdout)
    assert payload["error"]["code"] == "invalid_options"
    assert "OPENAI_MODEL" in payload["error"]["message"]
    assert "runs" not in payload


def test_bench_translate_failed_report_exits_nonzero(monkeypatch) -> None:
    report = {
        "schema_version": 1,
        "measurement_scope": "translate_srt_v1",
        "runs": [{"index": 1, "status": "failed"}],
        "summary": {"ok_runs": 0, "runs": 1},
    }

    def fail(_input, _options):  # noqa: ANN001
        raise cli.BenchTranslateError("all failed", report=report)

    monkeypatch.setattr(cli, "run_bench_translate", fail)

    result = runner.invoke(
        cli.app,
        [
            "bench-translate",
            "input.srt",
            "--reference",
            "ref.srt",
            "--provider",
            "web-bing",
            "--to",
            "zh",
            "--json",
        ],
    )

    assert result.exit_code == 1
    assert json.loads(result.stdout)["runs"][0]["status"] == "failed"
