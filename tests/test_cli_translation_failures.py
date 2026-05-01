from fast_sub.cli import _all_translation_batches_failed
from fast_sub.models import Segment, TranslationError, TranslationResult


def test_all_translation_batches_failed_when_no_segment_has_translation() -> None:
    result = TranslationResult(
        segments=[Segment(id=1, start=0, end=1, text="Hello")],
        errors=[TranslationError(batch_start_id=1, batch_end_id=1, message="bad json")],
    )

    assert _all_translation_batches_failed(result)


def test_all_translation_batches_failed_false_for_partial_success() -> None:
    result = TranslationResult(
        segments=[
            Segment(id=1, start=0, end=1, text="Hello", translation="你好"),
            Segment(id=2, start=1, end=2, text="World"),
        ],
        errors=[TranslationError(batch_start_id=2, batch_end_id=2, message="bad json")],
    )

    assert not _all_translation_batches_failed(result)
