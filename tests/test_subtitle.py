from sub_gen.models import BilingualOrder, Mode, Segment
from sub_gen.subtitle import render_srt


def test_render_bilingual_srt_original_first() -> None:
    srt = render_srt(
        [
            Segment(
                id=1,
                start=1.2,
                end=4.5,
                text="Hello everyone.",
                translation="大家好。",
            )
        ],
        mode=Mode.BILINGUAL,
        bilingual_order=BilingualOrder.ORIGINAL_FIRST,
    )

    assert "00:00:01,200 --> 00:00:04,500" in srt
    assert "Hello everyone." in srt
    assert "大家好。" in srt


def test_render_translated_skips_untranslated_segment() -> None:
    srt = render_srt(
        [Segment(id=1, start=0, end=1, text="Hello", translation=None)],
        mode=Mode.TRANSLATED,
    )

    assert srt.strip() == ""

