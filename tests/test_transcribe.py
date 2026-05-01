from __future__ import annotations

import json
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

from fast_sub.analyze import AnalysisResult
from fast_sub.errors import SubGenError
from fast_sub.provider_models import SttProviderSegment
from fast_sub.transcribe import (
    TranscribeOptions,
    _resolve_model_path,
    normalize_worker_segments,
    transcribe_media,
)

FAKE_WORKER = Path(__file__).parent / "fixtures" / "workers" / "fake_stt_worker.py"
TEST_WORKDIR_ROOT = Path(".test-work") / "transcribe"


def test_transcribe_media_writes_srt_and_keeps_worker_files(monkeypatch) -> None:
    work_root = TEST_WORKDIR_ROOT / uuid.uuid4().hex
    work_root.mkdir(parents=True)
    input_file = work_root / "sample.wav"
    input_file.write_bytes(b"fake media")
    output = work_root / "out.srt"
    model_dir = work_root / "models" / "whisper-small"
    model_dir.mkdir(parents=True)

    monkeypatch.setattr("fast_sub.transcribe.ensure_media_tools", lambda: None)
    monkeypatch.setattr(
        "fast_sub.transcribe.probe_media",
        lambda path: {
            "duration_sec": 10.0,
            "audio_streams": [{"index": 0}],
            "selected_audio_stream": {"index": 0},
        },
    )

    def fake_prepare_audio(input_path: Path, audio_path: Path) -> None:
        audio_path.parent.mkdir(parents=True, exist_ok=True)
        audio_path.write_bytes(b"wav")

    monkeypatch.setattr("fast_sub.transcribe.prepare_audio", fake_prepare_audio)
    monkeypatch.setattr(
        "fast_sub.transcribe._resolve_model_path",
        lambda provider, model: model_dir,
    )
    monkeypatch.setattr(
        "fast_sub.transcribe.analyze_media",
        lambda path: AnalysisResult(
            duration_sec=10.0,
            speech_ratio=0.8,
            silence_ratio=0.2,
            mean_volume_db=-20.0,
            peak_volume_db=-3.0,
            estimated_segments=1,
            avg_segment_sec=1.0,
            recommended_vad="normal",
            recommended_mode="balanced",
            warnings=[],
        ),
    )

    result = transcribe_media(
        input_file,
        TranscribeOptions(
            output=output,
            keep_temp=True,
            worker_command=[sys.executable, str(FAKE_WORKER), "--mode", "success"],
        ),
    )

    assert result.srt_path == output
    assert result.provider == "fake-stt"
    assert result.model == "whisper-small"
    assert result.language_detected == "en"
    assert result.segments_count == 1
    assert result.gpu_load == "balanced"
    assert result.batch_size == 4
    assert result.rtfx is not None
    assert "job " in output.read_text(encoding="utf-8")
    assert result.work_dir is not None
    assert (result.work_dir / "audio.16k.mono.wav").exists()
    assert (result.work_dir / "worker.request.json").exists()
    assert (result.work_dir / "worker.response.json").exists()
    assert (result.work_dir / "metadata.json").exists()
    request_payload = json.loads((result.work_dir / "worker.request.json").read_text())
    assert request_payload["batch_size"] == 4


def test_transcribe_media_gpu_load_low_reduces_default_batch_size(monkeypatch) -> None:
    work_root = TEST_WORKDIR_ROOT / uuid.uuid4().hex
    work_root.mkdir(parents=True)
    input_file = work_root / "sample.wav"
    input_file.write_bytes(b"fake media")
    output = work_root / "out.srt"
    model_dir = work_root / "models" / "whisper-small"
    model_dir.mkdir(parents=True)

    monkeypatch.setattr("fast_sub.transcribe.ensure_media_tools", lambda: None)
    monkeypatch.setattr("fast_sub.transcribe.probe_media", lambda path: {"duration_sec": 10.0})

    def fake_prepare_audio(input_path: Path, audio_path: Path) -> None:
        audio_path.parent.mkdir(parents=True, exist_ok=True)
        audio_path.write_bytes(b"wav")

    monkeypatch.setattr("fast_sub.transcribe.prepare_audio", fake_prepare_audio)
    monkeypatch.setattr("fast_sub.transcribe._resolve_model_path", lambda provider, model: model_dir)

    result = transcribe_media(
        input_file,
        TranscribeOptions(
            output=output,
            keep_temp=True,
            gpu_load="low",
            worker_command=[sys.executable, str(FAKE_WORKER), "--mode", "success"],
        ),
    )

    assert result.gpu_load == "low"
    assert result.batch_size == 2
    assert result.work_dir is not None
    request_payload = json.loads((result.work_dir / "worker.request.json").read_text())
    assert request_payload["batch_size"] == 2


def test_transcribe_media_explicit_batch_size_overrides_gpu_load(monkeypatch) -> None:
    work_root = TEST_WORKDIR_ROOT / uuid.uuid4().hex
    work_root.mkdir(parents=True)
    input_file = work_root / "sample.wav"
    input_file.write_bytes(b"fake media")
    output = work_root / "out.srt"
    model_dir = work_root / "models" / "whisper-small"
    model_dir.mkdir(parents=True)

    monkeypatch.setattr("fast_sub.transcribe.ensure_media_tools", lambda: None)
    monkeypatch.setattr("fast_sub.transcribe.probe_media", lambda path: {"duration_sec": 10.0})

    def fake_prepare_audio(input_path: Path, audio_path: Path) -> None:
        audio_path.parent.mkdir(parents=True, exist_ok=True)
        audio_path.write_bytes(b"wav")

    monkeypatch.setattr("fast_sub.transcribe.prepare_audio", fake_prepare_audio)
    monkeypatch.setattr("fast_sub.transcribe._resolve_model_path", lambda provider, model: model_dir)

    result = transcribe_media(
        input_file,
        TranscribeOptions(
            output=output,
            keep_temp=True,
            gpu_load="low",
            batch_size=7,
            worker_command=[sys.executable, str(FAKE_WORKER), "--mode", "success"],
        ),
    )

    assert result.gpu_load == "low"
    assert result.batch_size == 7
    assert result.work_dir is not None
    request_payload = json.loads((result.work_dir / "worker.request.json").read_text())
    assert request_payload["batch_size"] == 7


def test_normalize_worker_segments_drops_blank_and_repairs_overlap() -> None:
    segments, warnings = normalize_worker_segments(
        [
            SttProviderSegment(start_sec=0.0, end_sec=2.0, text=" first "),
            SttProviderSegment(start_sec=1.5, end_sec=3.0, text="second"),
            SttProviderSegment(start_sec=3.0, end_sec=4.0, text="  "),
        ]
    )

    assert [(segment.start, segment.end, segment.text) for segment in segments] == [
        (0.0, 2.0, "first"),
        (2.0, 3.0, "second"),
    ]
    assert any("Repaired overlapping segment" in warning for warning in warnings)
    assert any("Dropped empty-text segment" in warning for warning in warnings)


def test_normalize_worker_segments_rejects_empty_result() -> None:
    with pytest.raises(SubGenError, match="no usable subtitle segments"):
        normalize_worker_segments([])


def test_normalize_worker_segments_rejects_invalid_timeline() -> None:
    with pytest.raises(SubGenError, match="non-positive duration"):
        normalize_worker_segments(
            [SttProviderSegment(start_sec=2.0, end_sec=2.0, text="bad")]
        )


def test_transcribe_rejects_api_provider() -> None:
    with pytest.raises(SubGenError, match="only supports local"):
        _resolve_model_path("api-openai-transcription", "whisper-small")


def test_resolve_model_path_uses_provider_resolution(monkeypatch) -> None:
    model_dir = TEST_WORKDIR_ROOT / "provider-resolution" / "whisper-small"

    def fake_resolve(provider_id: str, model_id: str) -> object:
        assert provider_id == "local-faster-whisper"
        assert model_id == "whisper-small"
        return SimpleNamespace(
            provider_location="local",
            status="available",
            message="Provider and model are available.",
            action_hint=None,
            model_path=model_dir,
        )

    monkeypatch.setattr("fast_sub.transcribe.resolve_stt_provider", fake_resolve)

    assert _resolve_model_path("local-faster-whisper", "whisper-small") == model_dir


def test_resolve_model_path_reports_provider_resolution_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_resolve(provider_id: str, model_id: str) -> object:
        return SimpleNamespace(
            provider_location="local",
            status="missing_dependency",
            message="Python module 'faster_whisper' is not installed.",
            action_hint="Install Python module 'faster_whisper' in the worker environment.",
            model_path=Path("models/whisper-small"),
        )

    monkeypatch.setattr("fast_sub.transcribe.resolve_stt_provider", fake_resolve)

    with pytest.raises(SubGenError, match="missing_dependency"):
        _resolve_model_path("local-faster-whisper", "whisper-small")
