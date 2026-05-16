from __future__ import annotations

import json
import shutil
import uuid
from collections.abc import Iterator
from pathlib import Path

import pysubs2
import pytest
from typer.testing import CliRunner

import fast_sub.cli.runtime as cli
from fast_sub.models import TranslationResult

runner = CliRunner()


@pytest.fixture
def work_dir() -> Iterator[Path]:
    path = (Path(".test-work") / uuid.uuid4().hex).resolve()
    path.mkdir(parents=True)
    try:
        yield path
    finally:
        shutil.rmtree(path)


def test_translate_requires_provider_and_to(work_dir: Path) -> None:
    tmp_path = work_dir
    input_file = _write_srt(tmp_path)

    missing_provider = runner.invoke(
        cli.app,
        ["translate", str(input_file), "--to", "zh", "--json"],
    )
    missing_to = runner.invoke(
        cli.app,
        ["translate", str(input_file), "--provider", "web-bing", "--json"],
    )

    assert missing_provider.exit_code == 2
    assert json.loads(missing_provider.stdout)["error"]["code"] == "invalid_options"
    assert missing_to.exit_code == 2
    assert json.loads(missing_to.stdout)["error"]["code"] == "invalid_options"


def test_translate_rejects_unknown_provider_and_bad_batch(work_dir: Path) -> None:
    tmp_path = work_dir
    input_file = _write_srt(tmp_path)

    unknown = runner.invoke(
        cli.app,
        ["translate", str(input_file), "--provider", "nope", "--to", "zh", "--json"],
    )
    bad_batch = runner.invoke(
        cli.app,
        [
            "translate",
            str(input_file),
            "--provider",
            "web-bing",
            "--to",
            "zh",
            "--batch-size",
            "0",
            "--json",
        ],
    )

    assert unknown.exit_code == 2
    assert json.loads(unknown.stdout)["error"]["code"] == "invalid_provider"
    assert bad_batch.exit_code == 2
    assert json.loads(bad_batch.stdout)["error"]["code"] == "invalid_options"


def test_translate_replace_success_json_pure(monkeypatch, work_dir: Path) -> None:
    tmp_path = work_dir
    input_file = _write_srt(tmp_path)
    output = tmp_path / "out.srt"
    calls = []

    def fake_translate_text(*, text, translator, from_language, to_language, timeout=None):  # noqa: ANN001
        calls.append((text, translator, from_language, to_language))
        return f"{text}-zh"

    monkeypatch.setattr("fast_sub.translation.service._translate_text", fake_translate_text)

    result = runner.invoke(
        cli.app,
        [
            "translate",
            str(input_file),
            "--provider",
            "web-bing",
            "--from",
            "en",
            "--to",
            "zh",
            "--output",
            str(output),
            "--json",
        ],
    )

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["srt_path"] == str(output)
    assert "Privacy" not in result.stdout
    assert calls == [("Hello", "bing", "en", "zh"), ("World", "bing", "en", "zh")]
    assert [event.text for event in pysubs2.load(str(output)).events] == ["Hello-zh", "World-zh"]


def test_translate_bilingual_success(monkeypatch, work_dir: Path) -> None:
    tmp_path = work_dir
    input_file = _write_srt(tmp_path)
    output = tmp_path / "out.srt"

    monkeypatch.setattr(
        "fast_sub.translation.service._translate_text",
        lambda *, text, translator, from_language, to_language, timeout=None: f"{text}-zh",
    )

    result = runner.invoke(
        cli.app,
        [
            "translate",
            str(input_file),
            "--provider",
            "web-bing",
            "--from",
            "en",
            "--to",
            "zh",
            "--mode",
            "bilingual",
            "--bilingual-order",
            "translated-first",
            "--output",
            str(output),
        ],
    )

    assert result.exit_code == 0
    assert pysubs2.load(str(output)).events[0].text == "Hello-zh\\NHello"


def test_translate_partial_failure_writes_errors_and_keeps_original(
    monkeypatch,
    work_dir: Path,
) -> None:
    tmp_path = work_dir
    input_file = _write_srt(tmp_path)
    output = tmp_path / "out.srt"

    def fake_translate_text(*, text, translator, from_language, to_language, timeout=None):  # noqa: ANN001
        if text == "World":
            raise RuntimeError("service down sk-secret123456")
        return "你好"

    monkeypatch.setattr("fast_sub.translation.service._translate_text", fake_translate_text)

    result = runner.invoke(
        cli.app,
        [
            "translate",
            str(input_file),
            "--provider",
            "web-bing",
            "--from",
            "en",
            "--to",
            "zh",
            "--output",
            str(output),
            "--json",
        ],
    )

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    errors_path = Path(payload["errors_path"])
    assert errors_path.exists()
    assert "sk-secret123456" not in errors_path.read_text(encoding="utf-8")
    assert [event.text for event in pysubs2.load(str(output)).events] == ["你好", "World"]


def test_translate_all_failure_exits_nonzero_without_final_srt(
    monkeypatch,
    work_dir: Path,
) -> None:
    tmp_path = work_dir
    input_file = _write_srt(tmp_path)
    output = tmp_path / "out.srt"
    monkeypatch.setattr(
        "fast_sub.translation.service._translate_text",
        lambda **kwargs: (_ for _ in ()).throw(RuntimeError("service down")),
    )

    result = runner.invoke(
        cli.app,
        [
            "translate",
            str(input_file),
            "--provider",
            "web-google",
            "--from",
            "en",
            "--to",
            "zh",
            "--output",
            str(output),
            "--json",
        ],
    )

    assert result.exit_code == 1
    payload = json.loads(result.stdout)
    assert payload["error"]["details"]["errors_path"] == str(output.with_suffix(".errors.json"))
    assert output.exists() is False
    assert output.with_suffix(".errors.json").exists()
    assert "web-bing" in output.with_suffix(".errors.json").read_text(encoding="utf-8")


def test_translate_checkpoint_resume_and_no_resume(monkeypatch, work_dir: Path) -> None:
    tmp_path = work_dir
    input_file = _write_srt(tmp_path)
    output = tmp_path / "out.srt"
    calls = []

    def fake_translate_text(*, text, translator, from_language, to_language, timeout=None):  # noqa: ANN001
        calls.append(text)
        return f"{text}-zh"

    monkeypatch.setattr("fast_sub.translation.service._translate_text", fake_translate_text)
    args = [
        "translate",
        str(input_file),
        "--provider",
        "web-bing",
        "--from",
        "en",
        "--to",
        "zh",
        "--output",
        str(output),
        "--json",
    ]

    first = runner.invoke(cli.app, args)
    assert Path(str(output) + ".translate-progress.json").exists()
    second = runner.invoke(cli.app, args)
    third = runner.invoke(cli.app, [*args, "--no-resume"])

    assert first.exit_code == second.exit_code == third.exit_code == 0
    assert calls == ["Hello", "World", "Hello", "World"]
    assert Path(str(output) + ".translate-progress.json").exists() is False


def test_translate_api_openai_chat_reads_dotenv(monkeypatch, work_dir: Path) -> None:
    tmp_path = work_dir
    input_file = _write_srt(tmp_path).resolve()
    output = (tmp_path / "out.srt").resolve()
    calls = []
    original_cwd = Path.cwd()
    monkeypatch.chdir(work_dir)
    Path(".env").write_text(
        "OPENAI_API_KEY=sk-dotenv-secret123456\nOPENAI_BASE_URL=https://api.example.test/v1\n",
        encoding="utf-8",
    )
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)

    def fake_request(batch, **kwargs):  # noqa: ANN001
        calls.append((kwargs["api_key"], kwargs["base_url"], [segment.id for segment in batch]))
        return {segment.id: f"{segment.text}-zh" for segment in batch}

    monkeypatch.setattr(
        "fast_sub.translation.service._request_openai_chat_translation", fake_request
    )

    try:
        result = runner.invoke(
            cli.app,
            [
                "translate",
                str(input_file),
                "--provider",
                "api-openai-chat",
                "--model",
                "explicit-model",
                "--from",
                "en",
                "--to",
                "zh",
                "--output",
                str(output),
                "--json",
            ],
        )
    finally:
        monkeypatch.chdir(original_cwd)

    assert result.exit_code == 0
    assert calls == [("sk-dotenv-secret123456", "https://api.example.test/v1", [1, 2])]
    assert "sk-dotenv-secret123456" not in result.stdout


def test_translate_api_openai_chat_reads_model_from_dotenv(monkeypatch, work_dir: Path) -> None:
    tmp_path = work_dir
    input_file = _write_srt(tmp_path).resolve()
    output = (tmp_path / "out.srt").resolve()
    calls = []
    original_cwd = Path.cwd()
    monkeypatch.chdir(work_dir)
    Path(".env").write_text(
        "OPENAI_API_KEY=sk-dotenv-secret123456\nOPENAI_MODEL=qwen3-4b\n",
        encoding="utf-8",
    )
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_MODEL", raising=False)

    def fake_request(batch, **kwargs):  # noqa: ANN001
        calls.append(kwargs["model"])
        return {segment.id: f"{segment.text}-zh" for segment in batch}

    monkeypatch.setattr(
        "fast_sub.translation.service._request_openai_chat_translation", fake_request
    )

    try:
        result = runner.invoke(
            cli.app,
            [
                "translate",
                str(input_file),
                "--provider",
                "api-openai-chat",
                "--from",
                "en",
                "--to",
                "zh",
                "--output",
                str(output),
                "--json",
            ],
        )
    finally:
        monkeypatch.chdir(original_cwd)

    assert result.exit_code == 0
    assert calls == ["qwen3-4b"]


def test_translate_local_nllb_auto_detects_english_source(monkeypatch, work_dir: Path) -> None:
    tmp_path = work_dir
    input_file = _write_srt(tmp_path)
    output = tmp_path / "nllb.srt"
    seen_source_languages = []

    def fake_translate_segments(**kwargs):  # noqa: ANN003
        seen_source_languages.append(kwargs["source_lang"])
        segments = [segment.model_copy() for segment in kwargs["segments"]]
        for segment in segments:
            segment.translation = f"{segment.text}-zh"
        return TranslationResult(segments=segments)

    monkeypatch.setattr("fast_sub.translation.service.translate_segments", fake_translate_segments)

    result = runner.invoke(
        cli.app,
        [
            "translate",
            str(input_file),
            "--provider",
            "local-nllb-ct2",
            "--to",
            "zh",
            "--output",
            str(output),
            "--json",
        ],
    )

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["source_language"] == "en"
    assert seen_source_languages == ["en"]
    assert output.exists()


def test_translate_local_nllb_ignores_openai_model_env(monkeypatch, work_dir: Path) -> None:
    tmp_path = work_dir
    input_file = _write_srt(tmp_path)
    output = tmp_path / "nllb.srt"
    seen_models = []
    monkeypatch.setenv("OPENAI_MODEL", "qwen3-4b-2507")

    def fake_translate_segments(**kwargs):  # noqa: ANN003
        seen_models.append(kwargs["model"])
        segments = [segment.model_copy() for segment in kwargs["segments"]]
        for segment in segments:
            segment.translation = f"{segment.text}-zh"
        return TranslationResult(segments=segments)

    monkeypatch.setattr("fast_sub.translation.service.translate_segments", fake_translate_segments)

    result = runner.invoke(
        cli.app,
        [
            "translate",
            str(input_file),
            "--provider",
            "local-nllb-ct2",
            "--to",
            "zh",
            "--output",
            str(output),
            "--json",
        ],
    )

    assert result.exit_code == 0
    assert seen_models == [None]


def test_translate_local_nllb_ignores_chat_model_config(monkeypatch, work_dir: Path) -> None:
    tmp_path = work_dir
    input_file = _write_srt(tmp_path)
    output = tmp_path / "nllb.srt"
    config_file = tmp_path / "fast-sub.toml"
    config_file.write_text(
        '[translator]\nprovider = "api-openai-chat"\nmodel = "qwen3-4b-2507"\n',
        encoding="utf-8",
    )
    seen_models = []

    def fake_translate_segments(**kwargs):  # noqa: ANN003
        seen_models.append(kwargs["model"])
        segments = [segment.model_copy() for segment in kwargs["segments"]]
        for segment in segments:
            segment.translation = f"{segment.text}-zh"
        return TranslationResult(segments=segments)

    monkeypatch.setattr("fast_sub.translation.service.translate_segments", fake_translate_segments)

    result = runner.invoke(
        cli.app,
        [
            "translate",
            str(input_file),
            "--config",
            str(config_file),
            "--provider",
            "local-nllb-ct2",
            "--to",
            "zh",
            "--output",
            str(output),
            "--json",
        ],
    )

    assert result.exit_code == 0
    assert seen_models == [None]


def _write_srt(tmp_path: Path) -> Path:
    path = tmp_path / "input.srt"
    path.write_text(
        "1\n00:00:00,000 --> 00:00:01,000\nHello\n\n2\n00:00:01,000 --> 00:00:02,000\nWorld\n",
        encoding="utf-8",
    )
    return path
