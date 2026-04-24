from pathlib import Path

from sub_gen.models import Mode
from sub_gen.paths import default_output_path


def test_default_output_path_for_bilingual() -> None:
    path = default_output_path(Path("video.mp4"), Mode.BILINGUAL, "en", "zh")

    assert path == Path("video.en-zh.bilingual.srt")


def test_default_output_path_for_translated() -> None:
    path = default_output_path(Path("video.mp4"), Mode.TRANSLATED, "en", "zh")

    assert path == Path("video.zh.srt")


def test_default_output_path_for_audio_input() -> None:
    path = default_output_path(Path("speech.wav"), Mode.ORIGINAL, "en", "zh")

    assert path == Path("speech.en.srt")

