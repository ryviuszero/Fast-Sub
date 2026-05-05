import json
import shutil
import uuid
from pathlib import Path

import pytest

from fast_sub.cli import legacy_pipeline
from fast_sub.config import AppConfig
from fast_sub.contracts.errors import SubGenError


def _options():
    return legacy_pipeline.resolve_legacy_options(
        config_path=None,
        mode=None,
        original_only=False,
        source_lang=None,
        target_lang=None,
        stt_base_url=None,
        stt_api_key="dummy",
        stt_provider=None,
        stt_model=None,
        stt_temperature=None,
        whisperx_device=None,
        whisperx_compute_type=None,
        whisperx_batch_size=None,
        max_audio_mb=None,
        translator=None,
        subtitle_format=None,
        max_line_chars=None,
        bilingual_order=None,
    )


def test_run_directory_processes_supported_media_files(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_dir = _make_work_dir()
    try:
        input_dir = work_dir / "input"
        output_dir = work_dir / "subtitles"
        input_dir.mkdir()
        video = input_dir / "a.mp4"
        audio = input_dir / "b.wav"
        note = input_dir / "note.txt"
        video.write_bytes(b"")
        audio.write_bytes(b"")
        note.write_text("skip", encoding="utf-8")

        calls: list[tuple[Path, Path | None, bool]] = []

        def fake_run_pipeline(
            input_file: Path,
            output: Path | None,
            options: AppConfig,
            keep_temp: bool,
        ) -> None:
            calls.append((input_file, output, keep_temp))

        monkeypatch.setattr(legacy_pipeline, "_run_pipeline", fake_run_pipeline)

        legacy_pipeline._run_directory(input_dir, output_dir, _options(), keep_temp=False)

        assert calls == [
            (video, output_dir / "a.auto.srt", False),
            (audio, output_dir / "b.auto.srt", False),
        ]
        progress = json.loads((output_dir / ".fast-sub-progress.json").read_text())
        assert len(progress["completed"]) == 2
    finally:
        shutil.rmtree(work_dir)


def test_run_directory_rejects_file_output_path() -> None:
    work_dir = _make_work_dir()
    try:
        input_dir = work_dir / "input"
        output_file = work_dir / "out.srt"
        input_dir.mkdir()
        (input_dir / "a.mp4").write_bytes(b"")
        output_file.write_text("", encoding="utf-8")

        with pytest.raises(SubGenError, match="--output must be a directory"):
            legacy_pipeline._run_directory(input_dir, output_file, _options(), keep_temp=False)
    finally:
        shutil.rmtree(work_dir)


def test_directory_progress_path_supports_windows_unc_path() -> None:
    input_dir = Path(r"\\NAS\data\others\资料\others\sample-user\1")

    assert legacy_pipeline._directory_progress_path(input_dir, None) == (
        input_dir / ".fast-sub-progress.json"
    )


def test_run_directory_skips_completed_files(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_dir = _make_work_dir()
    try:
        input_dir = work_dir / "input"
        output_dir = work_dir / "subtitles"
        input_dir.mkdir()
        output_dir.mkdir()
        completed = input_dir / "a.mp4"
        pending = input_dir / "b.wav"
        completed.write_bytes(b"done")
        pending.write_bytes(b"pending")
        completed_output = output_dir / "a.auto.srt"
        completed_output.write_text("existing", encoding="utf-8")

        progress = {"version": 1, "completed": {}}
        legacy_pipeline._mark_directory_item_complete(completed, completed_output, progress)
        legacy_pipeline._write_directory_progress(output_dir / ".fast-sub-progress.json", progress)

        calls: list[Path] = []

        def fake_run_pipeline(
            input_file: Path,
            output: Path | None,
            options: AppConfig,
            keep_temp: bool,
        ) -> None:
            calls.append(input_file)

        monkeypatch.setattr(legacy_pipeline, "_run_pipeline", fake_run_pipeline)

        legacy_pipeline._run_directory(input_dir, output_dir, _options(), keep_temp=False)

        assert calls == [pending]
    finally:
        shutil.rmtree(work_dir)


def _make_work_dir() -> Path:
    work_dir = Path(".test-work") / uuid.uuid4().hex
    work_dir.mkdir(parents=True)
    return work_dir
