import json
import sys
import uuid
from pathlib import Path

import pytest

from fast_sub.clients.errors import WebTranslationClientError
from fast_sub.clients.web_translation import translate_text
from fast_sub.models import Segment
from fast_sub.translation.errors import TranslationProviderError
from fast_sub.translation.service import TranslateOptions, translate_segments, translate_srt


def test_web_translation_adapter_calls_fake_helper(monkeypatch, tmp_path: Path) -> None:
    helper = _write_fake_web_helper(tmp_path)
    monkeypatch.setenv("FAST_SUB_WEB_TRANSLATE_HELPER_COMMAND", sys.executable)
    monkeypatch.setenv("FAST_SUB_WEB_TRANSLATE_HELPER_ARGS", json.dumps([str(helper)]))

    result = translate_segments(
        segments=[Segment(id=1, start=0, end=1, text="hello")],
        provider="web-bing",
        source_lang="en",
        target_lang="zh",
    )

    assert result.errors == []
    assert result.segments[0].translation == "web-bing:hello:en:zh"


def test_web_translation_adapter_supports_google_fake_helper(monkeypatch, tmp_path: Path) -> None:
    helper = _write_fake_web_helper(tmp_path)
    monkeypatch.setenv("FAST_SUB_WEB_TRANSLATE_HELPER_COMMAND", sys.executable)
    monkeypatch.setenv("FAST_SUB_WEB_TRANSLATE_HELPER_ARGS", json.dumps([str(helper)]))

    result = translate_segments(
        segments=[Segment(id=1, start=0, end=1, text="hello")],
        provider="web-google",
        source_lang="en",
        target_lang="zh",
    )

    assert result.errors == []
    assert result.segments[0].translation == "web-google:hello:en:zh"


def test_web_translation_missing_helper_is_missing_dependency(monkeypatch) -> None:
    monkeypatch.delenv("FAST_SUB_WEB_TRANSLATE_HELPER_COMMAND", raising=False)
    monkeypatch.delenv("FAST_SUB_WEB_TRANSLATE_HELPER_ARGS", raising=False)

    result = translate_segments(
        segments=[Segment(id=1, start=0, end=1, text="hello")],
        provider="web-bing",
        source_lang="en",
        target_lang="zh",
        retries=0,
    )

    assert result.errors
    assert "helper is not configured" in result.errors[0].message


def test_web_translation_missing_helper_args_is_missing_dependency(monkeypatch) -> None:
    monkeypatch.setenv("FAST_SUB_WEB_TRANSLATE_HELPER_COMMAND", sys.executable)
    monkeypatch.delenv("FAST_SUB_WEB_TRANSLATE_HELPER_ARGS", raising=False)

    result = translate_segments(
        segments=[Segment(id=1, start=0, end=1, text="hello")],
        provider="web-bing",
        source_lang="en",
        target_lang="zh",
        retries=0,
    )

    assert result.errors
    assert "helper args are missing" in result.errors[0].message


def test_web_translation_empty_helper_args_is_missing_dependency(monkeypatch) -> None:
    monkeypatch.setenv("FAST_SUB_WEB_TRANSLATE_HELPER_COMMAND", sys.executable)
    monkeypatch.setenv("FAST_SUB_WEB_TRANSLATE_HELPER_ARGS", "[]")

    result = translate_segments(
        segments=[Segment(id=1, start=0, end=1, text="hello")],
        provider="web-bing",
        source_lang="en",
        target_lang="zh",
        retries=0,
    )

    assert result.errors
    assert "helper args are empty" in result.errors[0].message


def test_web_translation_missing_helper_file_is_missing_dependency(
    monkeypatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("FAST_SUB_WEB_TRANSLATE_HELPER_COMMAND", sys.executable)
    monkeypatch.setenv(
        "FAST_SUB_WEB_TRANSLATE_HELPER_ARGS",
        json.dumps([str(tmp_path / "missing-helper.mjs")]),
    )

    result = translate_segments(
        segments=[Segment(id=1, start=0, end=1, text="hello")],
        provider="web-bing",
        source_lang="en",
        target_lang="zh",
        retries=0,
    )

    assert result.errors
    assert "helper file is missing" in result.errors[0].message


def test_web_translation_timeout_maps_to_provider_error(monkeypatch, tmp_path: Path) -> None:
    helper = tmp_path / "slow_helper.py"
    helper.write_text(
        "import time\ntime.sleep(2)\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("FAST_SUB_WEB_TRANSLATE_HELPER_COMMAND", sys.executable)
    monkeypatch.setenv("FAST_SUB_WEB_TRANSLATE_HELPER_ARGS", json.dumps([str(helper)]))

    result = translate_segments(
        segments=[Segment(id=1, start=0, end=1, text="hello")],
        provider="web-bing",
        source_lang="en",
        target_lang="zh",
        timeout=0.01,
        retries=0,
    )

    assert result.errors
    assert "timed out" in result.errors[0].message


def test_web_translation_invalid_helper_stdout_does_not_leak_raw_output(
    monkeypatch, tmp_path: Path
) -> None:
    helper = tmp_path / "invalid_stdout_helper.py"
    helper.write_text(
        "print('RAW_PROVIDER_RESPONSE cli.mjs user subtitle text')\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("FAST_SUB_WEB_TRANSLATE_HELPER_COMMAND", sys.executable)
    monkeypatch.setenv("FAST_SUB_WEB_TRANSLATE_HELPER_ARGS", json.dumps([str(helper)]))

    with pytest.raises(WebTranslationClientError) as exc_info:
        translate_text(
            text="hello",
            translator="bing",
            from_language="en",
            to_language="zh",
        )

    message = str(exc_info.value)
    assert message == "Web translation helper returned invalid JSON output."
    assert "RAW_PROVIDER_RESPONSE" not in message
    assert "cli.mjs" not in message
    assert "subtitle text" not in message


def test_web_translation_structured_error_does_not_leak_helper_message(
    monkeypatch, tmp_path: Path
) -> None:
    helper = tmp_path / "raw_error_helper.py"
    helper.write_text(
        "\n".join(
            [
                "import json",
                "raw = 'RAW_PROVIDER_HTML cli.mjs user subtitle text'",
                "error = {'code': 'provider_failed', 'message': raw}",
                "print(json.dumps({'schema_version': 1, 'ok': False, 'error': error}))",
            ]
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("FAST_SUB_WEB_TRANSLATE_HELPER_COMMAND", sys.executable)
    monkeypatch.setenv("FAST_SUB_WEB_TRANSLATE_HELPER_ARGS", json.dumps([str(helper)]))

    with pytest.raises(WebTranslationClientError) as exc_info:
        translate_text(
            text="hello",
            translator="bing",
            from_language="en",
            to_language="zh",
        )

    message = str(exc_info.value)
    assert message == "Web translation provider failed."
    assert "RAW_PROVIDER_HTML" not in message
    assert "cli.mjs" not in message
    assert "subtitle text" not in message


def test_translate_srt_web_partial_failure_keeps_cue_count_and_writes_errors(
    monkeypatch, tmp_path: Path
) -> None:
    helper = _write_fake_web_helper(tmp_path, fail_text="bad")
    monkeypatch.setenv("FAST_SUB_WEB_TRANSLATE_HELPER_COMMAND", sys.executable)
    monkeypatch.setenv("FAST_SUB_WEB_TRANSLATE_HELPER_ARGS", json.dumps([str(helper)]))
    input_file = tmp_path / "input.srt"
    output = tmp_path / "out.srt"
    input_file.write_text(
        "1\n00:00:00,000 --> 00:00:01,000\nhello\n\n2\n00:00:02,000 --> 00:00:03,000\nbad\n",
        encoding="utf-8",
    )

    result = translate_srt(
        input_file,
        TranslateOptions(
            provider="web-bing",
            source_language="en",
            target_language="zh",
            batch_size=1,
            output=output,
            resume=False,
        ),
    )

    assert result.cues_count == 2
    assert result.translated_count == 1
    assert result.failed_count == 1
    assert output.read_text(encoding="utf-8").count("-->") == 2
    assert output.with_suffix(".errors.json").exists()


def test_translate_srt_web_all_failed_does_not_write_final_output(
    monkeypatch, tmp_path: Path
) -> None:
    helper = _write_fake_web_helper(tmp_path, fail_all=True)
    monkeypatch.setenv("FAST_SUB_WEB_TRANSLATE_HELPER_COMMAND", sys.executable)
    monkeypatch.setenv("FAST_SUB_WEB_TRANSLATE_HELPER_ARGS", json.dumps([str(helper)]))
    input_file = tmp_path / "input.srt"
    output = tmp_path / "out.srt"
    input_file.write_text("1\n00:00:00,000 --> 00:00:01,000\nhello\n", encoding="utf-8")

    with pytest.raises(TranslationProviderError, match="All translation cues failed"):
        translate_srt(
            input_file,
            TranslateOptions(
                provider="web-bing",
                source_language="en",
                target_language="zh",
                batch_size=1,
                output=output,
                resume=False,
            ),
        )

    assert not output.exists()
    assert output.with_suffix(".errors.json").exists()


def _write_fake_web_helper(
    tmp_path: Path,
    *,
    fail_text: str | None = None,
    fail_all: bool = False,
) -> Path:
    helper = tmp_path / f"fake_web_helper_{uuid.uuid4().hex}.py"
    helper.write_text(
        "\n".join(
            [
                "import json",
                "import sys",
                "payload = json.loads(sys.stdin.read())",
                f"fail_text = {fail_text!r}",
                f"fail_all = {fail_all!r}",
                "if fail_all or payload.get('text') == fail_text:",
                "    error = {",
                "        'code': 'provider_failed',",
                "        'message': 'fake helper failed',",
                "        'action_hint': 'retry',",
                "    }",
                "    print(json.dumps({'schema_version': 1, 'ok': False, 'error': error}))",
                "else:",
                "    parts = [",
                "        payload.get('provider'),",
                "        payload.get('text'),",
                "        payload.get('from_language'),",
                "        payload.get('to_language'),",
                "    ]",
                "    text = ':'.join(parts)",
                "    result = {'schema_version': 1, 'ok': True, 'text': text}",
                "    print(json.dumps(result, ensure_ascii=False))",
            ]
        ),
        encoding="utf-8",
    )
    return helper
