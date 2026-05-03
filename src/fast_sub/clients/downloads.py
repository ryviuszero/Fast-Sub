from __future__ import annotations

import shutil
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

import httpx

DownloadProgress = Callable[[str, int, int | None], None]


class DownloadClientError(RuntimeError):
    """Raised when a network download client fails."""


class HttpDownloadError(DownloadClientError):
    """Raised when an HTTP model download fails."""


def download_httpx(
    url: str,
    part_path: Path,
    *,
    timeout: float,
    progress: DownloadProgress | None,
    label: str,
) -> None:
    """Download a file with resumable HTTP range support."""
    headers: dict[str, str] = {}
    resume_from = part_path.stat().st_size if part_path.exists() else 0
    if resume_from:
        headers["Range"] = f"bytes={resume_from}-"

    try:
        with httpx.stream(
            "GET",
            url,
            headers=headers,
            follow_redirects=True,
            timeout=timeout,
        ) as response:
            response.raise_for_status()
            total = _response_total(response, resume_from)
            downloaded = resume_from if response.status_code == 206 else 0
            _emit_download_progress(progress, label, downloaded, total)
            mode = "ab" if resume_from and response.status_code == 206 else "wb"
            with part_path.open(mode) as file:
                for chunk in response.iter_bytes():
                    file.write(chunk)
                    downloaded += len(chunk)
                    _emit_download_progress(progress, label, downloaded, total)
    except httpx.HTTPError as exc:
        raise HttpDownloadError(str(exc)) from exc


def download_aria2(
    url: str,
    part_path: Path,
    *,
    timeout: float,
    connections: int,
    split: int,
) -> None:
    """Download a file through aria2c."""
    if connections <= 0 or split <= 0:
        raise DownloadClientError("aria2 connection and split counts must be greater than 0.")
    part_path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        str(aria2_executable() or "aria2c"),
        "--continue=true",
        "--allow-overwrite=true",
        "--auto-file-renaming=false",
        f"--max-connection-per-server={connections}",
        f"--split={split}",
        "--min-split-size=1M",
        f"--timeout={max(1, int(timeout))}",
        f"--connect-timeout={max(1, int(timeout))}",
        "--summary-interval=1",
        "--console-log-level=notice",
        "--file-allocation=none",
        "--check-certificate=true",
        "--dir",
        str(part_path.parent),
        "--out",
        part_path.name,
        url,
    ]
    completed = subprocess.run(
        command,
        check=False,
        text=True,
        stdout=sys.stderr,
        stderr=sys.stderr,
    )
    if completed.returncode != 0:
        raise DownloadClientError(f"aria2c download failed with exit code {completed.returncode}.")
    if not part_path.exists():
        raise DownloadClientError("aria2c completed but did not create the expected file.")


def aria2_executable() -> Path | None:
    """Return the aria2c executable path when it is available on PATH."""
    path = shutil.which("aria2c")
    return Path(path) if path else None


def _response_total(response: httpx.Response, resume_from: int) -> int | None:
    value = response.headers.get("content-length")
    if value is None:
        return None
    try:
        length = int(value)
    except ValueError:
        return None
    if length < 0:
        return None
    return length + resume_from if response.status_code == 206 else length


def _emit_download_progress(
    progress: DownloadProgress | None,
    label: str,
    downloaded: int,
    total: int | None,
) -> None:
    if progress is not None:
        progress(label, downloaded, total)


__all__ = [
    "DownloadClientError",
    "HttpDownloadError",
    "aria2_executable",
    "download_aria2",
    "download_httpx",
]
