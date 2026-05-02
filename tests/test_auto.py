from __future__ import annotations

import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

from fast_sub.auto import AutoOptions, AutoPipelineError, auto_media
from fast_sub.model_manager import ModelStatus
from fast_sub.transcribe import TranscribeResult


def test_auto_dry_run_reports_missing_model_without_install_or_transcribe(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_dir = _make_work_dir()
    input_file = work_dir / "input.wav"
    input_file.write_bytes(b"media")
    calls: list[str] = []
    _patch_common(monkeypatch)
    monkeypatch.setattr("fast_sub.auto.resolve_stt_provider", _missing_model_resolution)
    monkeypatch.setattr("fast_sub.auto.install_model", lambda model: calls.append("install"))
    monkeypatch.setattr("fast_sub.auto.transcribe_media", lambda path, options: calls.append("stt"))

    result = auto_media(input_file, AutoOptions(dry_run=True))

    assert result.ok is True
    assert result.dry_run is True
    assert calls == []
    assert any(step.status == "missing_model" for step in result.steps)
    assert any(
        "fast-sub models install whisper-small" in (step.action_hint or "")
        for step in result.steps
    )


def test_auto_missing_model_without_yes_fails_with_install_hint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_dir = _make_work_dir()
    input_file = work_dir / "input.wav"
    input_file.write_bytes(b"media")
    _patch_common(monkeypatch)
    monkeypatch.setattr("fast_sub.auto.resolve_stt_provider", _missing_model_resolution)

    with pytest.raises(AutoPipelineError) as exc_info:
        auto_media(input_file, AutoOptions())

    result = exc_info.value.result
    assert result.ok is False
    assert "Model is not installed" in (result.error or "")
    assert any("pass --yes" in (step.action_hint or "") for step in result.steps)


def test_auto_yes_installs_model_then_transcribes_and_refines(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_dir = _make_work_dir()
    input_file = work_dir / "input.wav"
    input_file.write_bytes(b"media")
    output = work_dir / "final.srt"
    raw_output = work_dir / "final.raw.srt"
    resolutions = [_missing_model_resolution(), _available_resolution()]
    installed: list[str] = []
    transcribed: list[object] = []
    _patch_common(monkeypatch)
    monkeypatch.setattr(
        "fast_sub.auto.resolve_stt_provider",
        lambda *args, **kwargs: resolutions.pop(0),
    )
    monkeypatch.setattr("fast_sub.auto.get_model", lambda model_id: SimpleNamespace(id=model_id))

    def fake_install(model: object) -> ModelStatus:
        installed.append(model.id)
        return ModelStatus(
            id=model.id,
            path=work_dir / "models" / model.id,
            installed=True,
            status="installed",
            message="ok",
            checked_files=4,
            manifest_type="directory",
        )

    def fake_transcribe(path: Path, options: object) -> TranscribeResult:
        transcribed.append(options)
        raw_output.write_text(
            """1
00:00:00,000 --> 00:00:00,500
Hi

2
00:00:00,400 --> 00:00:01,000
there
""",
            encoding="utf-8",
        )
        return TranscribeResult(
            srt_path=raw_output,
            provider="local-faster-whisper",
            model=options.model,
            device=options.device,
            compute_type=options.compute_type,
            language_detected="en",
            duration_sec=1.0,
            elapsed_sec=0.2,
            worker_elapsed_sec=0.1,
            rtfx=5.0,
            segments_count=2,
            gpu_load=options.gpu_load,
            batch_size=2,
            warnings=[],
        )

    monkeypatch.setattr("fast_sub.auto.install_model", fake_install)
    monkeypatch.setattr("fast_sub.auto.transcribe_media", fake_transcribe)

    result = auto_media(
        input_file,
        AutoOptions(
            output=output,
            yes=True,
            language="en",
            device="cpu",
            compute_type="int8",
            gpu_load="low",
        ),
    )

    assert result.ok is True
    assert installed == ["whisper-small"]
    assert len(transcribed) == 1
    assert transcribed[0].output == raw_output
    assert transcribed[0].device == "cpu"
    assert transcribed[0].compute_type == "int8"
    assert transcribed[0].gpu_load == "low"
    assert output.exists()
    assert "Hi there" in output.read_text(encoding="utf-8")
    assert any(step.name == "transcribe" and step.status == "ok" for step in result.steps)
    assert any(step.name == "refine" and step.status == "ok" for step in result.steps)


def test_auto_yes_wraps_model_install_filesystem_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_dir = _make_work_dir()
    input_file = work_dir / "input.wav"
    input_file.write_bytes(b"media")
    _patch_common(monkeypatch)
    monkeypatch.setattr("fast_sub.auto.resolve_stt_provider", _missing_model_resolution)
    monkeypatch.setattr("fast_sub.auto.get_model", lambda model_id: SimpleNamespace(id=model_id))
    monkeypatch.setattr(
        "fast_sub.auto.install_model",
        lambda model: (_ for _ in ()).throw(PermissionError("cache denied")),
    )

    with pytest.raises(AutoPipelineError) as exc_info:
        auto_media(input_file, AutoOptions(yes=True))

    result = exc_info.value.result
    assert result.ok is False
    assert "Failed to install local model whisper-small" in (result.error or "")
    assert "cache denied" in (result.error or "")
    assert any(step.name == "model" and step.status == "installing" for step in result.steps)


def test_auto_dry_run_reports_missing_dependency_as_blocked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_dir = _make_work_dir()
    input_file = work_dir / "input.wav"
    input_file.write_bytes(b"media")
    _patch_common(monkeypatch)
    monkeypatch.setattr(
        "fast_sub.auto.resolve_stt_provider",
        lambda *args, **kwargs: _missing_dependency_resolution(),
    )

    result = auto_media(input_file, AutoOptions(dry_run=True))

    assert result.ok is True
    assert any(step.status == "missing_dependency" for step in result.steps)
    assert any(step.name == "transcribe" and step.status == "blocked" for step in result.steps)


def test_auto_rejects_invalid_input() -> None:
    work_dir = _make_work_dir()
    with pytest.raises(AutoPipelineError) as exc_info:
        auto_media(work_dir / "missing.wav", AutoOptions(dry_run=True))

    assert "Input file does not exist" in (exc_info.value.result.error or "")


def _patch_common(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("fast_sub.auto.ensure_media_tools", lambda: None)
    monkeypatch.setattr(
        "fast_sub.auto.probe_media",
        lambda path: {
            "duration_sec": 1.0,
            "audio_streams": [{"index": 0}],
            "video_streams": [],
        },
    )
    monkeypatch.setattr(
        "fast_sub.auto.analyze_media",
        lambda path: SimpleNamespace(
            as_dict=lambda: {
                "duration_sec": 1.0,
                "recommended_vad": "off",
                "recommended_mode": "fast",
                "warnings": [],
            }
        ),
    )


def _make_work_dir() -> Path:
    work_dir = Path(".test-work") / "auto" / uuid.uuid4().hex
    work_dir.mkdir(parents=True, exist_ok=True)
    return work_dir


def _available_resolution() -> SimpleNamespace:
    return SimpleNamespace(
        provider_id="local-faster-whisper",
        model_id="whisper-small",
        model_path=Path("models/whisper-small"),
        status="available",
        message="Provider and model are available.",
        action_hint=None,
        local=True,
        provider_location="local",
        model_installed=True,
        privacy_note="Runs locally.",
    )


def _missing_model_resolution(*args: object, **kwargs: object) -> SimpleNamespace:
    return SimpleNamespace(
        provider_id="local-faster-whisper",
        model_id="whisper-small",
        model_path=Path("models/whisper-small"),
        status="missing_model",
        message="Model directory is missing.",
        action_hint="Run `fast-sub models install whisper-small`.",
        local=True,
        provider_location="local",
        model_installed=False,
        privacy_note="Runs locally.",
    )


def _missing_dependency_resolution() -> SimpleNamespace:
    return SimpleNamespace(
        provider_id="local-faster-whisper",
        model_id="whisper-small",
        model_path=Path("models/whisper-small"),
        status="missing_dependency",
        message="Python module 'faster_whisper' is not installed.",
        action_hint="Install Python module 'faster_whisper' in the worker environment.",
        local=True,
        provider_location="local",
        model_installed=True,
        privacy_note="Runs locally.",
    )
