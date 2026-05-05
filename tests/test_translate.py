import shutil
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

from fast_sub.models import Segment
from fast_sub.translation.errors import TranslationProviderError
from fast_sub.translation.service import (
    detect_subtitle_language,
    flores_code,
    parse_chat_translations,
    resolve_nllb_model_path,
    translate_segments,
)


def test_translate_segments_uses_translators_package(monkeypatch) -> None:
    calls = []

    def fake_translate_text(*, text, translator, from_language, to_language):
        calls.append((text, translator, from_language, to_language))
        return f"{text}-zh"

    monkeypatch.setattr("fast_sub.translation.service._translate_text", fake_translate_text)

    result = translate_segments(
        segments=[Segment(id=1, start=0, end=1, text="hello")],
        translator="bing",
        source_lang="en",
        target_lang="zh",
    )

    assert result.errors == []
    assert result.segments[0].translation == "hello-zh"
    assert calls == [("hello", "bing", "en", "zh")]


def test_translate_segments_records_failed_segment(monkeypatch) -> None:
    def fake_translate_text(*, text, translator, from_language, to_language):
        raise RuntimeError("service down")

    monkeypatch.setattr("fast_sub.translation.service._translate_text", fake_translate_text)

    result = translate_segments(
        segments=[Segment(id=1, start=0, end=1, text="hello")],
        translator="bing",
        source_lang="en",
        target_lang="zh",
        retries=0,
    )

    assert result.segments[0].translation is None
    assert len(result.errors) == 1
    assert result.errors[0].batch_start_id == 1


def test_chat_parser_accepts_fenced_json_think_and_prefix() -> None:
    content = """<think>draft</think>
    Here is the result:
    ```json
    {"translations":[{"id":1,"text":"你好"},{"id":2,"text":"世界"}]}
    ```
    """

    assert parse_chat_translations(content, expected_ids=[1, 2]) == {1: "你好", 2: "世界"}


def test_chat_parser_rejects_malformed_json_and_id_mismatch() -> None:
    with pytest.raises(ValueError, match="parse"):
        parse_chat_translations("not json", expected_ids=[1])
    with pytest.raises(ValueError, match="mismatch"):
        parse_chat_translations(
            '{"translations":[{"id":2,"text":"你好"}]}',
            expected_ids=[1],
        )


def test_chat_provider_splits_batch_then_falls_back_to_single(monkeypatch) -> None:
    calls = []

    def fake_request(batch, **kwargs):  # noqa: ANN001
        calls.append([segment.id for segment in batch])
        if len(batch) > 1:
            raise ValueError("bad json")
        return {batch[0].id: f"{batch[0].text}-ok"}

    monkeypatch.setattr(
        "fast_sub.translation.service._request_openai_chat_translation", fake_request
    )

    result = translate_segments(
        segments=[
            Segment(id=1, start=0, end=1, text="a"),
            Segment(id=2, start=1, end=2, text="b"),
        ],
        provider="api-openai-chat",
        source_lang="en",
        target_lang="zh",
        model="explicit-model",
        api_key="sk-test-secret",
        batch_size=2,
    )

    assert result.errors == []
    assert [segment.translation for segment in result.segments] == ["a-ok", "b-ok"]
    assert calls == [[1, 2], [1], [2]]


def test_nllb_language_mapping_and_auto_rejection() -> None:
    assert flores_code("en") == "eng_Latn"
    assert flores_code("zh") == "zho_Hans"
    assert flores_code("ja") == "jpn_Jpan"
    assert flores_code("ko") == "kor_Hang"

    with pytest.raises(TranslationProviderError, match="--from auto"):
        translate_segments(
            segments=[Segment(id=1, start=0, end=1, text="hello")],
            provider="local-nllb-ct2",
            source_lang="auto",
            target_lang="zh",
            model_path=Path("missing"),
        )


def test_resolve_nllb_missing_model_points_to_install(monkeypatch) -> None:
    monkeypatch.setattr(
        "fast_sub.translation.service.verify_model",
        lambda model: type(
            "Status",
            (),
            {"installed": False, "message": "Model directory is missing."},
        )(),
    )

    with pytest.raises(TranslationProviderError, match="models install nllb-200"):
        resolve_nllb_model_path(model=None, explicit_model_path=None)


def test_local_nllb_disables_unknown_token_generation(monkeypatch) -> None:
    root = (Path(".test-work") / uuid.uuid4().hex).resolve()
    model_path = root / "model"
    model_path.mkdir(parents=True)
    (model_path / "sentencepiece.bpe.model").write_text("fake", encoding="utf-8")
    calls = []

    class FakeSentencePieceProcessor:
        def __init__(self, *, model_file: str) -> None:
            assert model_file == str(model_path / "sentencepiece.bpe.model")

        def encode(self, text: str, *, out_type: type[str]) -> list[str]:
            assert out_type is str
            return [f"_{text}"]

        def decode(self, tokens: list[str]) -> str:
            return "".join(tokens)

    class FakeTranslator:
        def __init__(self, path: str, *, device: str) -> None:
            assert path == str(model_path)
            assert device == "auto"

        def translate_batch(self, source_tokens, **kwargs):  # noqa: ANN001, ANN003
            calls.append((source_tokens, kwargs))
            return [SimpleNamespace(hypotheses=[["zho_Hans", "汤姆"]])]

    monkeypatch.setitem(
        sys.modules,
        "sentencepiece",
        SimpleNamespace(SentencePieceProcessor=FakeSentencePieceProcessor),
    )
    monkeypatch.setitem(
        sys.modules,
        "ctranslate2",
        SimpleNamespace(Translator=FakeTranslator),
    )

    try:
        result = translate_segments(
            segments=[Segment(id=1, start=0, end=1, text="Tom")],
            provider="local-nllb-ct2",
            source_lang="en",
            target_lang="zh",
            model_path=model_path,
        )

        assert result.errors == []
        assert result.segments[0].translation == "汤姆"
        assert calls == [
            (
                [["eng_Latn", "_Tom", "</s>"]],
                {"target_prefix": [["zho_Hans"]], "disable_unk": True},
            )
        ]
    finally:
        shutil.rmtree(root)


def test_detect_subtitle_language_handles_supported_languages() -> None:
    assert (
        detect_subtitle_language(
            [Segment(id=1, start=0, end=1, text="Hello and welcome to this podcast.")]
        )
        == "en"
    )
    assert (
        detect_subtitle_language(
            [Segment(id=1, start=0, end=1, text="\u4f60\u597d\uff0c\u6b22\u8fce\u3002")]
        )
        == "zh"
    )
    assert (
        detect_subtitle_language(
            [Segment(id=1, start=0, end=1, text="\u3053\u3093\u306b\u3061\u306f\u3002")]
        )
        == "ja"
    )
    assert (
        detect_subtitle_language(
            [Segment(id=1, start=0, end=1, text="\uc548\ub155\ud558\uc138\uc694")]
        )
        == "ko"
    )
    assert (
        detect_subtitle_language(
            [Segment(id=1, start=0, end=1, text="\u6771\u4eac\u5927\u5b66\u5165\u5b66\u5f0f")]
        )
        is None
    )
    assert detect_subtitle_language([Segment(id=1, start=0, end=1, text="12345")]) is None
