from sub_gen.models import Segment
from sub_gen.translate import translate_segments


def test_translate_segments_uses_translators_package(monkeypatch) -> None:
    calls = []

    def fake_translate_text(*, text, translator, from_language, to_language):
        calls.append((text, translator, from_language, to_language))
        return f"{text}-zh"

    monkeypatch.setattr("sub_gen.translate._translate_text", fake_translate_text)

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

    monkeypatch.setattr("sub_gen.translate._translate_text", fake_translate_text)

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
