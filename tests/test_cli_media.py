import json
import shutil
import uuid
import wave
from pathlib import Path

from typer.testing import CliRunner

import fast_sub.cli as cli

runner = CliRunner()


def test_doctor_command_json_reports_missing_tools(monkeypatch):
    monkeypatch.setattr(cli, "doctor_status", lambda: _doctor_status(False))

    result = runner.invoke(cli.app, ["doctor", "--json"])

    assert result.exit_code == 3
    payload = json.loads(result.stdout)
    assert not payload["ffmpeg"]["available"]


def test_probe_command_outputs_json(monkeypatch):
    sample = Path("tests/fixtures/sample.wav")
    monkeypatch.setattr(
        cli,
        "probe_media",
        lambda path: {
            "path": str(path),
            "duration_sec": 1.0,
            "container": "wav",
            "audio_streams": [{"index": 0, "codec": "pcm_s16le"}],
            "video_streams": [],
            "selected_audio_stream": {"index": 0, "codec": "pcm_s16le"},
        },
    )

    result = runner.invoke(cli.app, ["probe", str(sample), "--json"])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["path"] == str(sample)
    assert payload["selected_audio_stream"]["index"] == 0


def test_extract_command_writes_16k_mono_wav():
    if shutil.which("ffmpeg") is None:
        return
    work_dir = _make_work_dir()
    input_file = work_dir / "输入 sample.wav"
    output = work_dir / "含 空格" / "audio.wav"

    try:
        _write_test_wav(input_file)
        result = runner.invoke(
            cli.app,
            ["extract", str(input_file), "--output", str(output)],
        )

        assert result.exit_code == 0, result.stdout
        with wave.open(str(output), "rb") as wav:
            assert wav.getframerate() == 16000
            assert wav.getnchannels() == 1
            assert wav.getsampwidth() == 2
    finally:
        shutil.rmtree(work_dir)


def test_extract_command_passes_audio_stream(monkeypatch):
    input_file = Path("tests/fixtures/sample.wav")
    work_dir = _make_work_dir()
    output = work_dir / "audio.wav"
    calls = []

    try:
        monkeypatch.setattr(cli, "ensure_media_tools", lambda: None)
        monkeypatch.setattr(
            cli,
            "prepare_audio",
            lambda input_file, output, audio_stream=None: calls.append(
                (input_file, output, audio_stream)
            ),
        )

        result = runner.invoke(
            cli.app,
            ["extract", str(input_file), "--output", str(output), "--audio-stream", "0"],
        )

        assert result.exit_code == 0
        assert calls == [(input_file, output, 0)]
    finally:
        shutil.rmtree(work_dir)


def test_probe_command_returns_input_error_code(monkeypatch):
    def fail(path):
        raise cli.SubGenError(f"No audio stream found in: {path}")

    monkeypatch.setattr(cli, "probe_media", fail)

    result = runner.invoke(cli.app, ["probe", "tests/fixtures/sample.wav", "--json"])

    assert result.exit_code == 2
    assert "No audio stream" in result.stdout


def _doctor_status(ok):
    return {
        "ffmpeg": {"available": ok, "path": None, "version": None},
        "ffprobe": {"available": ok, "path": None, "version": None},
        "python": {"ok": True, "version": "3.13.0", "executable": "python"},
        "cache_dir": {"path": ".fast-sub", "writable": True, "error": None},
        "jobs_dir": {"path": ".fast-sub/jobs", "writable": True, "error": None},
    }


def _make_work_dir():
    work_dir = Path(".test-work") / uuid.uuid4().hex
    work_dir.mkdir(parents=True)
    return work_dir


def _write_test_wav(path):
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(2)
        wav.setsampwidth(2)
        wav.setframerate(8000)
        wav.writeframes(b"\x00\x00\x00\x00" * 800)
