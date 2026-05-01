import json
from pathlib import Path

from fast_sub.provider_models import SttProviderSegment
from fast_sub.worker_models import SttWorkerRequest, SttWorkerResponse, WorkerErrorResponse


def test_worker_contracts_round_trip_json() -> None:
    request = SttWorkerRequest(
        job_id="job-1",
        audio_path=Path("audio.16k.mono.wav"),
        model_path=Path("models/whisper-small"),
    )
    response = SttWorkerResponse(
        provider="local-faster-whisper",
        language="zh",
        elapsed_sec=12.4,
        segments=[SttProviderSegment(start_sec=0, end_sec=2.8, text="hello")],
    )
    error = WorkerErrorResponse(
        error={
            "code": "MODEL_NOT_FOUND",
            "message": "Model path does not exist.",
            "retryable": False,
            "details": {},
            "stderr_tail": "",
        }
    )

    payload = json.loads(
        json.dumps(
            {
                "request": request.model_dump(mode="json"),
                "response": response.model_dump(mode="json"),
                "error": error.model_dump(mode="json"),
            }
        )
    )

    assert SttWorkerRequest.model_validate(payload["request"]) == request
    assert SttWorkerResponse.model_validate(payload["response"]) == response
    assert WorkerErrorResponse.model_validate(payload["error"]) == error
    assert payload["request"]["schema_version"] == 1


def test_worker_request_generates_readable_job_id() -> None:
    request = SttWorkerRequest(
        audio_path=Path("audio.wav"),
        model_path=Path("models/whisper-small"),
    )

    assert request.job_id.startswith("worker-")
    assert request.schema_version == 1
