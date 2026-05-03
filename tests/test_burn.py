import shutil
import subprocess
import uuid
from pathlib import Path

import pytest

from fast_sub.contracts.errors import SubGenError
from fast_sub.output.burn import (
    BurnOptions,
    build_ffmpeg_burn_command,
    burn_subtitles,
    default_burn_output_path,
)


def test_default_burn_output_path_uses_subtitled_suffix() -> None:
    assert default_burn_output_path(Path("video.mp4")) == Path("video.subtitled.mp4")


def test_build_ffmpeg_burn_command_maps_presets_and_copies_audio() -> None:
    command = build_ffmpeg_burn_command(
        input_file=Path("C:/media/input.mp4"),
        output=Path("C:/media/output.mp4"),
        options=BurnOptions(preset="fast"),
    )

    assert command[0] == "ffmpeg"
    assert command[command.index("-vf") + 1] == "subtitles=subtitle.srt"
    assert command[command.index("-preset") + 1] == "veryfast"
    assert command[command.index("-crf") + 1] == "26"
    assert command[command.index("-c:a") + 1] == "copy"
    assert "0:a?" in command


def test_build_ffmpeg_burn_command_applies_force_style() -> None:
    command = build_ffmpeg_burn_command(
        input_file=Path("input.mp4"),
        output=Path("output.mp4"),
        options=BurnOptions(font="Noto Sans CJK SC", font_size=28, preset="quality"),
    )

    vf = command[command.index("-vf") + 1]
    assert vf == "subtitles=subtitle.srt:force_style='FontName=Noto Sans CJK SC,FontSize=28'"
    assert command[command.index("-preset") + 1] == "slow"
    assert command[command.index("-crf") + 1] == "20"


def test_build_ffmpeg_burn_command_uses_prepared_subtitle_name_for_complex_paths() -> None:
    command = build_ffmpeg_burn_command(
        input_file=Path("//server/share/中文 input with spaces.mp4"),
        output=Path("C:/输出/output with spaces.mp4"),
        prepared_subtitle_name="subtitle.srt",
        options=BurnOptions(preset="balanced"),
    )

    vf = command[command.index("-vf") + 1]
    assert vf == "subtitles=subtitle.srt"
    assert "中文 input with spaces" not in vf
    assert command[command.index("-preset") + 1] == "medium"
    assert command[command.index("-crf") + 1] == "23"


def test_build_ffmpeg_burn_command_rejects_unknown_preset() -> None:
    with pytest.raises(SubGenError, match="--preset must be one of"):
        build_ffmpeg_burn_command(
            input_file=Path("input.mp4"),
            output=Path("output.mp4"),
            options=BurnOptions(preset="turbo"),
        )


def test_burn_subtitles_rejects_missing_video() -> None:
    with pytest.raises(SubGenError, match="Input video does not exist"):
        burn_subtitles(Path("missing.mp4"), Path("missing.srt"))


def test_burn_subtitles_rejects_missing_subtitle(monkeypatch: pytest.MonkeyPatch) -> None:
    work_dir = _make_work_dir()
    try:
        video = work_dir / "input.mp4"
        video.write_bytes(b"fake")
        monkeypatch.setattr(shutil, "which", lambda name: name)

        with pytest.raises(SubGenError, match="Input subtitle does not exist"):
            burn_subtitles(video, work_dir / "missing.srt")
    finally:
        shutil.rmtree(work_dir)


def test_burn_subtitles_rejects_non_video_input(monkeypatch: pytest.MonkeyPatch) -> None:
    work_dir = _make_work_dir()
    try:
        audio = work_dir / "input.wav"
        subtitle = work_dir / "input.srt"
        audio.write_bytes(b"fake")
        subtitle.write_text("1\n00:00:00,000 --> 00:00:01,000\nhello\n", encoding="utf-8")
        monkeypatch.setattr(shutil, "which", lambda name: name)

        with pytest.raises(SubGenError, match="Unsupported input video file type"):
            burn_subtitles(audio, subtitle)
    finally:
        shutil.rmtree(work_dir)


def test_burn_subtitles_rejects_missing_ffmpeg(monkeypatch: pytest.MonkeyPatch) -> None:
    work_dir = _make_work_dir()
    try:
        video = work_dir / "input.mp4"
        subtitle = work_dir / "input.srt"
        video.write_bytes(b"fake")
        subtitle.write_text("1\n00:00:00,000 --> 00:00:01,000\nhello\n", encoding="utf-8")
        monkeypatch.setattr(shutil, "which", lambda name: None)

        with pytest.raises(SubGenError, match="Missing required media tool"):
            burn_subtitles(video, subtitle)
    finally:
        shutil.rmtree(work_dir)


def test_burn_subtitles_copies_subtitle_and_runs_in_job_dir(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_dir = _make_work_dir()
    try:
        video = work_dir / "中文 input with spaces.mp4"
        subtitle = work_dir / "字幕 with spaces.srt"
        output = work_dir / "输出.mp4"
        video.write_bytes(b"fake")
        subtitle.write_text("1\n00:00:00,000 --> 00:00:01,000\n你好\n", encoding="utf-8")
        calls = []

        def fake_run(command, cwd, capture_output, check):  # noqa: ANN001
            cwd_path = Path(cwd)
            assert (cwd_path / "subtitle.srt").read_text(encoding="utf-8") == subtitle.read_text(
                encoding="utf-8"
            )
            calls.append((command, cwd_path))
            output.write_bytes(b"mp4")
            return subprocess.CompletedProcess(command, 0, stdout=b"", stderr=b"")

        monkeypatch.setattr(shutil, "which", lambda name: name)
        monkeypatch.setattr(subprocess, "run", fake_run)

        result = burn_subtitles(video, subtitle, output=output)

        assert result == output
        assert output.exists()
        command, cwd = calls[0]
        assert command[command.index("-vf") + 1] == "subtitles=subtitle.srt"
        assert not cwd.exists()
    finally:
        shutil.rmtree(work_dir)


def test_burn_subtitles_reports_subtitles_filter_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_dir = _make_work_dir()
    try:
        video = work_dir / "input.mp4"
        subtitle = work_dir / "input.srt"
        video.write_bytes(b"fake")
        subtitle.write_text("1\n00:00:00,000 --> 00:00:01,000\nhello\n", encoding="utf-8")

        def fake_run(command, cwd, capture_output, check):  # noqa: ANN001
            return subprocess.CompletedProcess(
                command,
                1,
                stdout=b"",
                stderr=b"No such filter: 'subtitles'",
            )

        monkeypatch.setattr(shutil, "which", lambda name: name)
        monkeypatch.setattr(subprocess, "run", fake_run)

        with pytest.raises(SubGenError, match="subtitles filter/libass"):
            burn_subtitles(video, subtitle)
    finally:
        shutil.rmtree(work_dir)


def _make_work_dir() -> Path:
    work_dir = Path(".test-work") / uuid.uuid4().hex
    work_dir.mkdir(parents=True)
    return work_dir
