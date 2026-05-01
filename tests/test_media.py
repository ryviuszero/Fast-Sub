import shutil
import subprocess
import uuid
from pathlib import Path

import pytest

from fast_sub.errors import SubGenError
from fast_sub.media import (
    _decode_process_output,
    doctor_ok,
    doctor_status,
    is_audio_file,
    is_media_file,
    list_media_files,
    prepare_audio,
    probe_media,
)


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


def test_doctor_status_reports_missing_tools_without_crashing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(shutil, "which", lambda name: None)
    work_dir = _make_work_dir()
    try:
        status = doctor_status(cache_dir=work_dir / "cache", jobs_dir=work_dir / "jobs")
    finally:
        shutil.rmtree(work_dir)

    assert not status["ffmpeg"]["available"]
    assert not status["ffprobe"]["available"]
    assert not doctor_ok(status)


def test_probe_media_parses_ffprobe_json(monkeypatch: pytest.MonkeyPatch) -> None:
    work_dir = _make_work_dir()
    try:
        media = work_dir / "中文 sample.wav"
        media.write_bytes(b"fake")

        def fake_run(command, capture_output, check):  # noqa: ANN001
            assert command[-1] == str(media)
            return subprocess.CompletedProcess(
                command,
                0,
                stdout=b"""
                {
                  "streams": [
                    {
                      "index": 0,
                      "codec_name": "pcm_s16le",
                      "codec_type": "audio",
                      "duration": "1.250000",
                      "channels": 1,
                      "sample_rate": "16000",
                      "tags": {"language": "eng"}
                    },
                    {
                      "index": 1,
                      "codec_name": "h264",
                      "codec_type": "video",
                      "width": 1920,
                      "height": 1080
                    }
                  ],
                  "format": {"duration": "1.250000", "format_name": "wav"}
                }
                """,
                stderr=b"",
            )

        monkeypatch.setattr(shutil, "which", lambda name: name)
        monkeypatch.setattr(subprocess, "run", fake_run)

        info = probe_media(media)

        assert info["path"] == str(media)
        assert info["duration_sec"] == 1.25
        assert info["container"] == "wav"
        assert info["audio_streams"][0]["sample_rate"] == 16000
        assert info["video_streams"][0]["width"] == 1920
        assert info["selected_audio_stream"]["index"] == 0
    finally:
        shutil.rmtree(work_dir)


def test_probe_media_rejects_files_without_audio(monkeypatch: pytest.MonkeyPatch) -> None:
    work_dir = _make_work_dir()
    try:
        media = work_dir / "sample.mp4"
        media.write_bytes(b"fake")

        def fake_run(command, capture_output, check):  # noqa: ANN001
            return subprocess.CompletedProcess(
                command,
                0,
                stdout=b'{"streams":[{"index":0,"codec_type":"video"}],"format":{}}',
                stderr=b"",
            )

        monkeypatch.setattr(shutil, "which", lambda name: name)
        monkeypatch.setattr(subprocess, "run", fake_run)

        with pytest.raises(SubGenError, match="No audio stream"):
            probe_media(media)
    finally:
        shutil.rmtree(work_dir)


def test_prepare_audio_uses_normalized_ffmpeg_arguments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_dir = _make_work_dir()
    try:
        media = work_dir / "input.wav"
        output = work_dir / "audio.wav"
        media.write_bytes(b"fake")
        calls: list[list[str]] = []

        def fake_run(command, capture_output, check):  # noqa: ANN001
            calls.append(command)
            output.write_bytes(b"wav")
            return subprocess.CompletedProcess(command, 0, stdout=b"", stderr=b"")

        monkeypatch.setattr(subprocess, "run", fake_run)

        prepare_audio(media, output, audio_stream=2)

        assert output.exists()
        command = calls[0]
        assert command[command.index("-map") + 1] == "0:2"
        assert command[command.index("-ac") + 1] == "1"
        assert command[command.index("-ar") + 1] == "16000"
        assert command[command.index("-c:a") + 1] == "pcm_s16le"
    finally:
        shutil.rmtree(work_dir)


def _make_work_dir() -> Path:
    work_dir = Path(".test-work") / uuid.uuid4().hex
    work_dir.mkdir(parents=True)
    return work_dir
