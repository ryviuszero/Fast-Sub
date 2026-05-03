from __future__ import annotations

import sys
import uuid
from pathlib import Path

import pytest

from fast_sub.contracts.errors import WorkerRunnerError
from fast_sub.contracts.worker import SttWorkerRequest
from fast_sub.infrastructure.workers import run_stt_worker

FAKE_WORKER = Path(__file__).parent / "fixtures" / "workers" / "fake_stt_worker.py"
TEST_WORKDIR_ROOT = Path(".test-work") / "worker-runner"


def worker_command(mode: str) -> list[str]:
    return [sys.executable, str(FAKE_WORKER), "--mode", mode]


def stt_request() -> SttWorkerRequest:
    return SttWorkerRequest(
        job_id="job-1",
        audio_path=Path("tests/fixtures/sample.wav"),
        model_path=Path("models/whisper-small"),
    )


def make_workdir() -> Path:
    path = TEST_WORKDIR_ROOT / uuid.uuid4().hex
    path.mkdir(parents=True, exist_ok=False)
    return path


def test_runner_returns_fake_worker_response() -> None:
    response = run_stt_worker(worker_command("success"), stt_request(), workdir=make_workdir())

    assert response.provider == "fake-stt"
    assert response.language == "en"
    assert response.segments[0].text == "job job-1"


def test_runner_maps_structured_worker_error() -> None:
    with pytest.raises(WorkerRunnerError, match="MODEL_NOT_FOUND"):
        run_stt_worker(worker_command("error-response"), stt_request(), workdir=make_workdir())


def test_runner_maps_nonzero_exit_without_structured_error() -> None:
    with pytest.raises(WorkerRunnerError, match="Worker exited with code 3"):
        run_stt_worker(worker_command("exit-only"), stt_request(), workdir=make_workdir())


def test_runner_rejects_missing_response_file() -> None:
    with pytest.raises(WorkerRunnerError, match="response file was not created"):
        run_stt_worker(worker_command("missing-response"), stt_request(), workdir=make_workdir())


def test_runner_rejects_invalid_json_response() -> None:
    with pytest.raises(WorkerRunnerError, match="response JSON is invalid"):
        run_stt_worker(worker_command("invalid-json"), stt_request(), workdir=make_workdir())


def test_runner_rejects_invalid_response_schema() -> None:
    with pytest.raises(WorkerRunnerError, match="response schema is invalid"):
        run_stt_worker(worker_command("invalid-schema"), stt_request(), workdir=make_workdir())


def test_runner_timeout_is_clear() -> None:
    with pytest.raises(WorkerRunnerError, match="timed out"):
        run_stt_worker(
            worker_command("timeout"),
            stt_request(),
            timeout_sec=0.1,
            workdir=make_workdir(),
        )
