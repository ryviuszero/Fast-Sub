from __future__ import annotations

import json
import subprocess
import tempfile
from collections.abc import Sequence
from pathlib import Path

from pydantic import ValidationError

from fast_sub.errors import WorkerRunnerError
from fast_sub.worker_models import SttWorkerRequest, SttWorkerResponse, WorkerErrorResponse

DEFAULT_WORKER_TIMEOUT_SEC = 30 * 60
STDERR_TAIL_BYTES = 4096


def run_stt_worker(
    command: Sequence[str | Path],
    request: SttWorkerRequest,
    *,
    timeout_sec: float = DEFAULT_WORKER_TIMEOUT_SEC,
    workdir: Path | None = None,
) -> SttWorkerResponse:
    if not command:
        raise WorkerRunnerError("Worker command is empty.")

    if workdir is not None:
        workdir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(
        prefix="fast-sub-worker-",
        dir=workdir,
        ignore_cleanup_errors=True,
    ) as temp_dir:
        temp_path = Path(temp_dir)
        request_path = temp_path / "request.json"
        response_path = temp_path / "response.json"
        try:
            request_path.write_text(
                request.model_dump_json(indent=2),
                encoding="utf-8",
            )
        except OSError as exc:
            raise WorkerRunnerError(f"Worker request file could not be written: {exc}") from exc

        argv = [str(part) for part in command]
        argv.extend(["--request", str(request_path), "--response", str(response_path)])

        try:
            completed = subprocess.run(
                argv,
                capture_output=True,
                timeout=timeout_sec,
                shell=False,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            stderr_tail = _decode_tail(exc.stderr)
            message = f"Worker timed out after {timeout_sec:g} seconds."
            if stderr_tail:
                message = f"{message} stderr: {stderr_tail}"
            raise WorkerRunnerError(message) from exc
        except OSError as exc:
            raise WorkerRunnerError(f"Failed to start worker: {exc}") from exc

        stderr_tail = _decode_tail(completed.stderr)
        if completed.returncode != 0 and not response_path.exists():
            message = f"Worker exited with code {completed.returncode}."
            if stderr_tail:
                message = f"{message} stderr: {stderr_tail}"
            raise WorkerRunnerError(message)

        response_payload = _read_response_payload(response_path, stderr_tail)

        worker_error = _parse_worker_error(response_payload, stderr_tail)
        if worker_error is not None:
            detail = worker_error.error
            message = f"Worker failed with {detail.code}: {detail.message}"
            tail = detail.stderr_tail or stderr_tail
            if tail:
                message = f"{message} stderr: {tail}"
            raise WorkerRunnerError(message)

        if completed.returncode != 0:
            message = f"Worker exited with code {completed.returncode}."
            if stderr_tail:
                message = f"{message} stderr: {stderr_tail}"
            raise WorkerRunnerError(message)

        try:
            return SttWorkerResponse.model_validate(response_payload)
        except ValidationError as exc:
            raise WorkerRunnerError(f"Worker response schema is invalid: {exc}") from exc


def _read_response_payload(response_path: Path, stderr_tail: str) -> object:
    if not response_path.exists():
        message = f"Worker response file was not created: {response_path}"
        if stderr_tail:
            message = f"{message}. stderr: {stderr_tail}"
        raise WorkerRunnerError(message)

    try:
        return json.loads(response_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise WorkerRunnerError(f"Worker response JSON is invalid: {exc}") from exc
    except OSError as exc:
        raise WorkerRunnerError(f"Worker response file could not be read: {exc}") from exc


def _parse_worker_error(payload: object, stderr_tail: str) -> WorkerErrorResponse | None:
    if not isinstance(payload, dict) or "error" not in payload:
        return None

    try:
        worker_error = WorkerErrorResponse.model_validate(payload)
    except ValidationError as exc:
        raise WorkerRunnerError(f"Worker error response schema is invalid: {exc}") from exc

    if not worker_error.error.stderr_tail and stderr_tail:
        worker_error.error.stderr_tail = stderr_tail
    return worker_error


def _decode_tail(data: bytes | str | None) -> str:
    if data is None:
        return ""
    if isinstance(data, str):
        raw = data.encode("utf-8", errors="replace")
    else:
        raw = data
    tail = raw[-STDERR_TAIL_BYTES:]
    return tail.decode("utf-8", errors="replace").strip()
