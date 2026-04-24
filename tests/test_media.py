import shutil
import uuid
from pathlib import Path

from sub_gen.media import _decode_process_output, is_audio_file, is_media_file, list_media_files


def test_is_audio_file_accepts_common_audio_extensions() -> None:
    assert is_audio_file(Path("sample.wav"))
    assert is_audio_file(Path("sample.mp3"))
    assert is_audio_file(Path("sample.m4a"))


def test_is_audio_file_rejects_common_video_extension() -> None:
    assert not is_audio_file(Path("sample.mp4"))


def test_is_media_file_accepts_common_video_and_audio_files() -> None:
    work_dir = _make_work_dir()
    try:
        video = work_dir / "sample.mp4"
        audio = work_dir / "sample.wav"
        video.write_bytes(b"")
        audio.write_bytes(b"")

        assert is_media_file(video)
        assert is_media_file(audio)
    finally:
        shutil.rmtree(work_dir)


def test_list_media_files_filters_unsupported_files() -> None:
    work_dir = _make_work_dir()
    try:
        video = work_dir / "a.mp4"
        audio = work_dir / "b.mp3"
        note = work_dir / "note.txt"
        nested = work_dir / "nested"
        video.write_bytes(b"")
        audio.write_bytes(b"")
        note.write_text("skip", encoding="utf-8")
        nested.mkdir()
        (nested / "c.mp4").write_bytes(b"")

        assert list_media_files(work_dir) == [video, audio]
    finally:
        shutil.rmtree(work_dir)


def test_decode_process_output_tolerates_invalid_utf8_bytes() -> None:
    assert "abc" in _decode_process_output(b"abc\xba")


def _make_work_dir() -> Path:
    work_dir = Path(".test-work") / uuid.uuid4().hex
    work_dir.mkdir(parents=True)
    return work_dir
