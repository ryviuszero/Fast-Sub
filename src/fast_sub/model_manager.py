from __future__ import annotations

import hashlib
import shutil
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse

import httpx

from fast_sub.model_manifest import ModelManifestEntry, ModelManifestFile
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
    checked_files: int = 0
    manifest_type: str = "file"

    def as_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "path": str(self.path),
            "installed": self.installed,
            "status": self.status,
            "message": self.message,
            "sha256": self.sha256,
            "size_bytes": self.size_bytes,
            "checked_files": self.checked_files,
            "manifest_type": self.manifest_type,
        }


def model_path(model: ModelManifestEntry, cache_dir: Path | None = None) -> Path:
    root = cache_dir or model_cache_dir()
    if model.files:
        return root / model.id
    filename = model.filename or _filename_from_url(str(model.url)) or f"{model.id}.bin"
    return root / model.id / filename


def verify_model(model: ModelManifestEntry, cache_dir: Path | None = None) -> ModelStatus:
    path = model_path(model, cache_dir)
    if model.files:
        return _verify_directory_model(model, path)

    if not path.exists():
        return ModelStatus(
            id=model.id,
            path=path,
            installed=False,
            status="missing",
            message="Model file is missing.",
            manifest_type=model.manifest_type,
        )
    if not path.is_file():
        return ModelStatus(
            id=model.id,
            path=path,
            installed=False,
            status="invalid_path",
            message="Model path exists but is not a file.",
            manifest_type=model.manifest_type,
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
            manifest_type=model.manifest_type,
        )
    return ModelStatus(
        id=model.id,
        path=path,
        installed=True,
        status="installed",
        message="Model is installed and verified.",
        sha256=actual_sha,
        size_bytes=actual_size,
        checked_files=1,
        manifest_type=model.manifest_type,
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
    if model.files:
        path.mkdir(parents=True, exist_ok=True)
        _ensure_disk_space(path, model.size_bytes)
        for manifest_file in model.files:
            _install_manifest_file(model, manifest_file, path, timeout=timeout)
        return verify_model(model, cache_dir)

    path.parent.mkdir(parents=True, exist_ok=True)
    _ensure_disk_space(path.parent, model.size_bytes)
    last_error = _download_verified(
        model.id,
        _candidate_urls(model, None),
        path,
        model.sha256,
        timeout=timeout,
    )
    if last_error is None:
        return verify_model(model, cache_dir)

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


def _verify_directory_model(model: ModelManifestEntry, path: Path) -> ModelStatus:
    if not path.exists():
        return ModelStatus(
            id=model.id,
            path=path,
            installed=False,
            status="missing",
            message="Model directory is missing.",
            manifest_type=model.manifest_type,
        )
    if not path.is_dir():
        return ModelStatus(
            id=model.id,
            path=path,
            installed=False,
            status="invalid_path",
            message="Model path exists but is not a directory.",
            manifest_type=model.manifest_type,
        )

    total_size = 0
    for index, manifest_file in enumerate(model.files):
        file_path = path / manifest_file.path
        if not file_path.exists():
            return ModelStatus(
                id=model.id,
                path=file_path,
                installed=False,
                status="missing",
                message=f"Required model file is missing: {manifest_file.path}",
                checked_files=index,
                manifest_type=model.manifest_type,
            )
        if not file_path.is_file():
            return ModelStatus(
                id=model.id,
                path=file_path,
                installed=False,
                status="invalid_path",
                message=f"Required model path is not a file: {manifest_file.path}",
                checked_files=index,
                manifest_type=model.manifest_type,
            )
        actual_size = file_path.stat().st_size
        actual_sha = sha256_file(file_path)
        total_size += actual_size
        if actual_sha != manifest_file.sha256:
            return ModelStatus(
                id=model.id,
                path=file_path,
                installed=False,
                status="hash_mismatch",
                message=(
                    "Required model file exists, but sha256 does not match the manifest: "
                    f"{manifest_file.path}"
                ),
                sha256=actual_sha,
                size_bytes=actual_size,
                checked_files=index,
                manifest_type=model.manifest_type,
            )

    return ModelStatus(
        id=model.id,
        path=path,
        installed=True,
        status="installed",
        message=f"Model directory is installed and verified ({len(model.files)} files).",
        size_bytes=total_size,
        checked_files=len(model.files),
        manifest_type=model.manifest_type,
    )


def _install_manifest_file(
    model: ModelManifestEntry,
    manifest_file: ModelManifestFile,
    model_dir: Path,
    *,
    timeout: float,
) -> None:
    path = model_dir / manifest_file.path
    path.parent.mkdir(parents=True, exist_ok=True)
    last_error = _download_verified(
        model.id,
        _candidate_urls(model, manifest_file),
        path,
        manifest_file.sha256,
        timeout=timeout,
    )
    if last_error is not None:
        raise ModelManagerError(
            f"Failed to install {model.id} file {manifest_file.path}: {last_error}"
        ) from last_error


def _download_verified(
    model_id: str,
    urls: list[str],
    path: Path,
    expected_sha256: str | None,
    *,
    timeout: float,
) -> Exception | None:
    if expected_sha256 is None:
        raise ModelManagerError(f"Manifest entry for {model_id} is missing sha256.")

    part_path = path.with_suffix(path.suffix + ".part")
    last_error: Exception | None = None
    for url in urls:
        try:
            _download(url, part_path, timeout=timeout)
            actual_sha = sha256_file(part_path)
            if actual_sha != expected_sha256:
                _unlink_if_exists(part_path)
                raise ModelManagerError(
                    f"Downloaded sha256 mismatch for {model_id}: "
                    f"expected {expected_sha256}, got {actual_sha}"
                )
            part_path.replace(path)
            return None
        except (httpx.HTTPError, OSError, ModelManagerError) as exc:
            last_error = exc
    return last_error


def _candidate_urls(
    model: ModelManifestEntry,
    manifest_file: ModelManifestFile | None,
) -> list[str]:
    if manifest_file is None:
        return [str(model.url), *(str(url) for url in model.mirrors)]

    urls: list[str] = []
    if manifest_file.url is not None:
        urls.append(str(manifest_file.url))
    elif model.url is not None:
        urls.append(urljoin(str(model.url), manifest_file.path))
    urls.extend(str(url) for url in manifest_file.mirrors)
    urls.extend(urljoin(str(root), manifest_file.path) for root in model.mirrors)
    return urls


def _unlink_if_exists(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        pass


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
