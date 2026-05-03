from __future__ import annotations

import json
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

from fast_sub.contracts.worker import SttWorkerRequest
from fast_sub_workers import faster_whisper as worker

TEST_WORKDIR_ROOT = Path(".test-work") / "faster-whisper-worker"


@pytest.fixture
def workdir() -> Path:
    path = TEST_WORKDIR_ROOT / uuid.uuid4().hex
    path.mkdir(parents=True, exist_ok=False)
    return path


def make_request(workdir: Path, **overrides: object) -> SttWorkerRequest:
    audio_path = workdir / "audio.wav"
    model_path = workdir / "model"
    audio_path.write_bytes(b"fake wav")
    model_path.mkdir()
    payload = {
        "job_id": "job-1",
        "audio_path": audio_path,
        "model_path": model_path,
        "language": "auto",
        "device": "cpu",
        "compute_type": "int8",
        "batch_size": 1,
        "vad": "normal",
        "mode": "balanced",
    }
    payload.update(overrides)
    return SttWorkerRequest(**payload)


def test_missing_model_path_returns_structured_error(workdir: Path) -> None:
    request_path = workdir / "request.json"
    response_path = workdir / "response.json"
    audio_path = workdir / "audio.wav"
    audio_path.write_bytes(b"fake wav")
    request_path.write_text(
        SttWorkerRequest(
            job_id="job-1",
            audio_path=audio_path,
            model_path=workdir / "missing-model",
        ).model_dump_json(),
        encoding="utf-8",
    )

    exit_code = worker.main(["--request", str(request_path), "--response", str(response_path)])

    payload = json.loads(response_path.read_text(encoding="utf-8"))
    assert exit_code == 1
    assert payload["error"]["code"] == "MODEL_NOT_FOUND"
    assert payload["error"]["details"]["model_path"].endswith("missing-model")


def test_invalid_request_returns_structured_error(workdir: Path) -> None:
    request_path = workdir / "request.json"
    response_path = workdir / "response.json"
    request_path.write_text('{"audio_path": 1}', encoding="utf-8")

    exit_code = worker.main(["--request", str(request_path), "--response", str(response_path)])

    payload = json.loads(response_path.read_text(encoding="utf-8"))
    assert exit_code == 1
    assert payload["error"]["code"] == "INVALID_REQUEST"


def test_missing_faster_whisper_dependency_is_reported(
    workdir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_import(name: str) -> object:
        if name == "faster_whisper":
            raise ImportError("not installed")
        raise AssertionError(name)

    monkeypatch.setattr(worker.importlib, "import_module", fake_import)

    with pytest.raises(worker.WorkerFailure) as exc_info:
        worker.transcribe(make_request(workdir))

    assert exc_info.value.code == "MISSING_DEPENDENCY"


def test_success_consumes_generator_and_writes_response(
    workdir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    consumed = False
    calls: dict[str, object] = {}

    class FakeWhisperModel:
        def __init__(self, model_path: str, *, device: str, compute_type: str) -> None:
            calls["model_path"] = model_path
            calls["device"] = device
            calls["compute_type"] = compute_type

        def transcribe(self, audio_path: str, **kwargs: object) -> tuple[object, object]:
            calls["audio_path"] = audio_path
            calls["kwargs"] = kwargs

            def segments() -> object:
                nonlocal consumed
                consumed = True
                yield SimpleNamespace(
                    start=0.0,
                    end=1.25,
                    text=" hello ",
                    words=[
                        SimpleNamespace(start=0.0, end=0.5, word="hello", probability=0.9),
                    ],
                )

            return segments(), SimpleNamespace(language="en")

    fake_module = SimpleNamespace(WhisperModel=FakeWhisperModel)
    monkeypatch.setattr(worker, "_import_faster_whisper", lambda: fake_module)

    response = worker.transcribe(make_request(workdir, language="en", mode="fast", vad="off"))

    assert consumed is True
    assert response.provider == "local-faster-whisper"
    assert response.language == "en"
    assert response.elapsed_sec is not None
    assert response.segments[0].text == "hello"
    assert response.segments[0].words[0].confidence == 0.9
    assert calls["device"] == "cpu"
    assert calls["compute_type"] == "int8"
    assert calls["kwargs"] == {
        "beam_size": 1,
        "vad_filter": False,
        "language": "en",
    }


def test_batch_size_uses_batched_inference_pipeline(
    workdir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: dict[str, object] = {}

    class FakeWhisperModel:
        def __init__(self, model_path: str, *, device: str, compute_type: str) -> None:
            self.model_path = model_path

    class FakePipeline:
        def __init__(self, *, model: FakeWhisperModel) -> None:
            calls["pipeline_model_path"] = model.model_path

        def transcribe(self, audio_path: str, **kwargs: object) -> tuple[object, object]:
            calls["kwargs"] = kwargs
            return (
                iter([SimpleNamespace(start=0.0, end=1.0, text="batched", words=[])]),
                SimpleNamespace(language="zh"),
            )

    fake_module = SimpleNamespace(
        WhisperModel=FakeWhisperModel,
        BatchedInferencePipeline=FakePipeline,
    )
    monkeypatch.setattr(worker, "_import_faster_whisper", lambda: fake_module)

    response = worker.transcribe(make_request(workdir, batch_size=4, language="zh"))

    assert calls["kwargs"] == {
        "beam_size": 5,
        "vad_filter": True,
        "language": "zh",
        "batch_size": 4,
    }
    assert calls["pipeline_model_path"].endswith("model")
    assert response.segments[0].text == "batched"


def test_batch_size_warning_when_pipeline_is_unavailable(
    workdir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    class FakeWhisperModel:
        def __init__(self, model_path: str, *, device: str, compute_type: str) -> None:
            pass

        def transcribe(self, audio_path: str, **kwargs: object) -> tuple[object, object]:
            return (
                iter([SimpleNamespace(start=0.0, end=1.0, text="single", words=[])]),
                SimpleNamespace(language="en"),
            )

    fake_module = SimpleNamespace(WhisperModel=FakeWhisperModel)
    monkeypatch.setattr(worker, "_import_faster_whisper", lambda: fake_module)

    response = worker.transcribe(make_request(workdir, batch_size=4))

    assert response.warnings == [
        "batch_size was ignored because BatchedInferencePipeline is unavailable."
    ]


def test_vad_and_mode_mapping() -> None:
    aggressive, aggressive_warnings = worker._build_transcribe_kwargs(
        SttWorkerRequest(
            audio_path=Path("audio.wav"),
            model_path=Path("model"),
            vad="aggressive",
            mode="quality",
        )
    )
    normal, _ = worker._build_transcribe_kwargs(
        SttWorkerRequest(audio_path=Path("audio.wav"), model_path=Path("model"), vad="normal")
    )

    assert aggressive == {
        "beam_size": 5,
        "vad_filter": True,
        "vad_parameters": {"min_silence_duration_ms": 300},
    }
    assert aggressive_warnings == ["quality mode currently uses balanced beam settings."]
    assert normal == {"beam_size": 5, "vad_filter": True}


def test_empty_segments_is_worker_failure(workdir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeWhisperModel:
        def __init__(self, model_path: str, *, device: str, compute_type: str) -> None:
            pass

        def transcribe(self, audio_path: str, **kwargs: object) -> tuple[object, object]:
            return iter([]), SimpleNamespace(language="en")

    fake_module = SimpleNamespace(WhisperModel=FakeWhisperModel)
    monkeypatch.setattr(worker, "_import_faster_whisper", lambda: fake_module)

    with pytest.raises(worker.WorkerFailure) as exc_info:
        worker.transcribe(make_request(workdir))

    assert exc_info.value.code == "EMPTY_SEGMENTS"
