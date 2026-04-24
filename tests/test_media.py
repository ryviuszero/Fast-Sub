from pathlib import Path

from sub_gen.media import is_audio_file


def test_is_audio_file_accepts_common_audio_extensions() -> None:
    assert is_audio_file(Path("sample.wav"))
    assert is_audio_file(Path("sample.mp3"))
    assert is_audio_file(Path("sample.m4a"))


def test_is_audio_file_rejects_common_video_extension() -> None:
    assert not is_audio_file(Path("sample.mp4"))
