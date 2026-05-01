from __future__ import annotations

import hashlib
import shutil
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlparse

import httpx

from fast_sub.model_manifest import ModelManifestEntry
from fast_sub.paths import model_cache_dir


class ModelManagerError(RuntimeError):
    """Raised when model installation or verification fails."""


@dataclass(frozen=True)
class ModelStatus:
    id: str
    path: Path
    installed: bool
    status: str
    message: str
    sha256: str | None = None
    size_bytes: int | None = None

    def as_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "path": str(self.path),
            "installed": self.installed,
            "status": self.status,
            "message": self.message,
            "sha256": self.sha256,
            "size_bytes": self.size_bytes,
        }


def model_path(model: ModelManifestEntry, cache_dir: Path | None = None) -> Path:
    root = cache_dir or model_cache_dir()
    filename = model.filename or _filename_from_url(str(model.url)) or f"{model.id}.bin"
    return root / model.id / filename


def verify_model(model: ModelManifestEntry, cache_dir: Path | None = None) -> ModelStatus:
    path = model_path(model, cache_dir)
    if not path.exists():
        return ModelStatus(
            id=model.id,
            path=path,
            installed=False,
            status="missing",
            message="Model file is missing.",
        )
    if not path.is_file():
        return ModelStatus(
            id=model.id,
            path=path,
            installed=False,
            status="invalid_path",
            message="Model path exists but is not a file.",
        )

    actual_size = path.stat().st_size
    actual_sha = sha256_file(path)
    if actual_sha != model.sha256:
        return ModelStatus(
            id=model.id,
            path=path,
            installed=False,
            status="hash_mismatch",
            message="Model file exists, but sha256 does not match the manifest.",
            sha256=actual_sha,
            size_bytes=actual_size,
        )
    return ModelStatus(
        id=model.id,
        path=path,
        installed=True,
        status="installed",
        message="Model is installed and verified.",
        sha256=actual_sha,
        size_bytes=actual_size,
    )


def install_model(
    model: ModelManifestEntry,
    cache_dir: Path | None = None,
    *,
    timeout: float = 60,
) -> ModelStatus:
    existing = verify_model(model, cache_dir)
    if existing.installed:
        return existing
    if existing.status == "hash_mismatch":
        raise ModelManagerError(
            f"Refusing to overwrite existing model with mismatched sha256: {existing.path}"
        )

    path = model_path(model, cache_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    _ensure_disk_space(path.parent, model.size_bytes)
    part_path = path.with_suffix(path.suffix + ".part")

    urls = [str(model.url), *(str(url) for url in model.mirrors)]
    last_error: Exception | None = None
    for url in urls:
        try:
            _download(url, part_path, timeout=timeout)
            actual_sha = sha256_file(part_path)
            if actual_sha != model.sha256:
                raise ModelManagerError(
                    f"Downloaded sha256 mismatch for {model.id}: "
                    f"expected {model.sha256}, got {actual_sha}"
                )
            part_path.replace(path)
            return verify_model(model, cache_dir)
        except (httpx.HTTPError, OSError, ModelManagerError) as exc:
            last_error = exc

    assert last_error is not None
    raise ModelManagerError(f"Failed to install {model.id}: {last_error}") from last_error


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _download(url: str, part_path: Path, *, timeout: float) -> None:
    headers: dict[str, str] = {}
    resume_from = part_path.stat().st_size if part_path.exists() else 0
    if resume_from:
        headers["Range"] = f"bytes={resume_from}-"

    with httpx.stream("GET", url, headers=headers, follow_redirects=True, timeout=timeout) as res:
        res.raise_for_status()
        mode = "ab" if resume_from and res.status_code == 206 else "wb"
        with part_path.open(mode) as file:
            for chunk in res.iter_bytes():
                file.write(chunk)


def _ensure_disk_space(directory: Path, required_bytes: int) -> None:
    usage = shutil.disk_usage(directory)
    reserve = max(50 * 1024 * 1024, required_bytes // 20)
    if usage.free < required_bytes + reserve:
        raise ModelManagerError(
            "Not enough free disk space for model download. "
            f"Need about {required_bytes + reserve} bytes, have {usage.free} bytes."
        )


def _filename_from_url(url: str) -> str | None:
    name = Path(unquote(urlparse(url).path)).name
    return name or None
