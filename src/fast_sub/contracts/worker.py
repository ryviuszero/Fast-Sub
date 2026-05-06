from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from fast_sub.contracts.provider import SttProviderResponse, SttProviderSegment

WORKER_SCHEMA_VERSION = 1


def default_worker_job_id() -> str:
    timestamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
    return f"worker-{timestamp}"


class SttWorkerRequest(BaseModel):
    schema_version: Literal[1] = 1
    job_id: str = Field(default_factory=default_worker_job_id)
    audio_path: Path
    language: str = "auto"
    model_path: Path
    device: str = "auto"
    compute_type: str = "auto"
    batch_size: int = Field(default=8, gt=0)
    vad: str = "normal"
    mode: str = "balanced"
    word_timestamps: bool = False


class SttWorkerResponse(SttProviderResponse):
    schema_version: Literal[1] = 1
    segments: list[SttProviderSegment]


class WorkerErrorDetail(BaseModel):
    code: str
    message: str
    retryable: bool = False
    details: dict[str, Any] = Field(default_factory=dict)
    stderr_tail: str = ""


class WorkerErrorResponse(BaseModel):
    schema_version: Literal[1] = 1
    error: WorkerErrorDetail
