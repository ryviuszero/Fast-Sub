"""Model installation, integrity verification, and download orchestration."""

from __future__ import annotations

import hashlib
import shutil
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse

from fast_sub.clients.downloads import (
    DownloadClientError,
    aria2_executable,
    download_aria2,
    download_httpx,
)
from fast_sub.model_store import constants as model_store_constants
from fast_sub.model_store.errors import ModelManagerError as _ModelManagerError
from fast_sub.model_store.manifest import ModelManifestEntry, ModelManifestFile
from fast_sub.model_store.models import DownloadProgress, ModelStatus
from fast_sub.output.paths import model_cache_dir


def model_path(model: ModelManifestEntry, cache_dir: Path | None = None) -> Path:
    """Return the expected local install path for a manifest entry."""
    root = cache_dir or model_cache_dir()
    if model.files:
        return root / model.id
    filename = model.filename or _filename_from_url(str(model.url)) or f"{model.id}.bin"
    return root / model.id / filename


def verify_model(model: ModelManifestEntry, cache_dir: Path | None = None) -> ModelStatus:
    """Verify whether a model exists locally and matches its manifest."""
    path = model_path(model, cache_dir)
    if model.files:
        return _verify_directory_model(model, path)

    try:
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
    except OSError as exc:
        return _inaccessible_status(model, path, exc)

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
    timeout: float = model_store_constants.DEFAULT_MODEL_DOWNLOAD_TIMEOUT_SEC,
    downloader: str = "auto",
    aria2_connections: int = model_store_constants.DEFAULT_ARIA2_CONNECTIONS,
    aria2_split: int = model_store_constants.DEFAULT_ARIA2_SPLIT,
    progress: DownloadProgress | None = None,
) -> ModelStatus:
    """Install a model and verify the downloaded artifact before marking it installed."""
    existing = verify_model(model, cache_dir)
    if existing.installed:
        return existing
    if existing.status == "hash_mismatch":
        raise _ModelManagerError(
            f"Refusing to overwrite existing model with mismatched sha256: {existing.path}"
        )

    if model.files:
        _install_directory_model(
            model,
            model_path(model, cache_dir),
            timeout=timeout,
            downloader=downloader,
            aria2_connections=aria2_connections,
            aria2_split=aria2_split,
            progress=progress,
        )
        return verify_model(model, cache_dir)

    path = model_path(model, cache_dir)
    _install_single_file_model(
        model,
        path,
        timeout=timeout,
        downloader=downloader,
        aria2_connections=aria2_connections,
        aria2_split=aria2_split,
        progress=progress,
    )
    return verify_model(model, cache_dir)


def _install_directory_model(
    model: ModelManifestEntry,
    path: Path,
    *,
    timeout: float,
    downloader: str,
    aria2_connections: int,
    aria2_split: int,
    progress: DownloadProgress | None,
) -> None:
    path.mkdir(parents=True, exist_ok=True)
    _ensure_disk_space(path, model.size_bytes)
    for manifest_file in model.files:
        _install_manifest_file(
            model,
            manifest_file,
            path,
            timeout=timeout,
            downloader=downloader,
            aria2_connections=aria2_connections,
            aria2_split=aria2_split,
            progress=progress,
        )


def _install_single_file_model(
    model: ModelManifestEntry,
    path: Path,
    *,
    timeout: float,
    downloader: str,
    aria2_connections: int,
    aria2_split: int,
    progress: DownloadProgress | None,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    _ensure_disk_space(path.parent, model.size_bytes)
    last_error = _download_verified(
        model.id,
        _candidate_urls(model, None),
        path,
        model.sha256,
        timeout=timeout,
        downloader=downloader,
        aria2_connections=aria2_connections,
        aria2_split=aria2_split,
        progress=progress,
    )
    if last_error is None:
        return

    assert last_error is not None
    raise _ModelManagerError(f"Failed to install {model.id}: {last_error}") from last_error


def sha256_file(path: Path) -> str:
    """Return the SHA-256 digest for a file."""
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(model_store_constants.SHA256_CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _download_httpx(
    url: str,
    part_path: Path,
    *,
    timeout: float,
    progress: DownloadProgress | None,
    label: str,
) -> None:
    download_httpx(url, part_path, timeout=timeout, progress=progress, label=label)


def _verify_directory_model(model: ModelManifestEntry, path: Path) -> ModelStatus:
    try:
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
    except OSError as exc:
        return _inaccessible_status(model, path, exc)

    return _verify_directory_files(model, path)


def _verify_directory_files(model: ModelManifestEntry, path: Path) -> ModelStatus:
    total_size = 0
    for index, manifest_file in enumerate(model.files):
        file_path = path / manifest_file.path
        verified = _verify_directory_file(model, manifest_file, file_path, checked_files=index)
        if not verified.installed:
            return verified
        total_size += verified.size_bytes or 0

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


def _verify_directory_file(
    model: ModelManifestEntry,
    manifest_file: ModelManifestFile,
    file_path: Path,
    *,
    checked_files: int,
) -> ModelStatus:
    try:
        if not file_path.exists():
            return ModelStatus(
                id=model.id,
                path=file_path,
                installed=False,
                status="missing",
                message=f"Required model file is missing: {manifest_file.path}",
                checked_files=checked_files,
                manifest_type=model.manifest_type,
            )
        if not file_path.is_file():
            return ModelStatus(
                id=model.id,
                path=file_path,
                installed=False,
                status="invalid_path",
                message=f"Required model path is not a file: {manifest_file.path}",
                checked_files=checked_files,
                manifest_type=model.manifest_type,
            )
        actual_size = file_path.stat().st_size
        actual_sha = sha256_file(file_path)
    except OSError as exc:
        return _inaccessible_status(model, file_path, exc, checked_files=checked_files)

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
            checked_files=checked_files,
            manifest_type=model.manifest_type,
        )
    return ModelStatus(
        id=model.id,
        path=file_path,
        installed=True,
        status="installed",
        message=f"Required model file is installed and verified: {manifest_file.path}",
        sha256=actual_sha,
        size_bytes=actual_size,
        checked_files=checked_files + 1,
        manifest_type=model.manifest_type,
    )


def _inaccessible_status(
    model: ModelManifestEntry,
    path: Path,
    error: OSError,
    *,
    checked_files: int = 0,
) -> ModelStatus:
    return ModelStatus(
        id=model.id,
        path=path,
        installed=False,
        status="inaccessible",
        message=f"Model path is inaccessible: {path} ({error})",
        checked_files=checked_files,
        manifest_type=model.manifest_type,
    )


def _install_manifest_file(
    model: ModelManifestEntry,
    manifest_file: ModelManifestFile,
    model_dir: Path,
    *,
    timeout: float,
    downloader: str,
    aria2_connections: int,
    aria2_split: int,
    progress: DownloadProgress | None,
) -> None:
    path = model_dir / manifest_file.path
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if not path.is_file():
            raise _ModelManagerError(f"Model path exists but is not a file: {path}")
        actual_sha = sha256_file(path)
        if actual_sha == manifest_file.sha256:
            return
        raise _ModelManagerError(
            f"Refusing to overwrite existing model file with mismatched sha256: {path}"
        )
    last_error = _download_verified(
        model.id,
        _candidate_urls(model, manifest_file),
        path,
        manifest_file.sha256,
        timeout=timeout,
        downloader=downloader,
        aria2_connections=aria2_connections,
        aria2_split=aria2_split,
        progress=progress,
        label=f"{model.id}/{manifest_file.path}",
    )
    if last_error is not None:
        raise _ModelManagerError(
            f"Failed to install {model.id} file {manifest_file.path}: {last_error}"
        ) from last_error


def _download_verified(
    model_id: str,
    urls: list[str],
    path: Path,
    expected_sha256: str | None,
    *,
    timeout: float,
    downloader: str,
    aria2_connections: int,
    aria2_split: int,
    progress: DownloadProgress | None,
    label: str | None = None,
) -> Exception | None:
    if expected_sha256 is None:
        raise _ModelManagerError(f"Manifest entry for {model_id} is missing sha256.")

    part_path = path.with_suffix(path.suffix + ".part")
    last_error: Exception | None = None
    backend = _resolve_downloader(downloader)
    download_label = label or model_id
    for url in urls:
        try:
            _download(
                url,
                part_path,
                timeout=timeout,
                downloader=backend,
                aria2_connections=aria2_connections,
                aria2_split=aria2_split,
                progress=progress,
                label=download_label,
            )
            actual_sha = sha256_file(part_path)
            if actual_sha != expected_sha256:
                _unlink_if_exists(part_path)
                raise _ModelManagerError(
                    f"Downloaded sha256 mismatch for {model_id}: "
                    f"expected {expected_sha256}, got {actual_sha}"
                )
            part_path.replace(path)
            return None
        except (DownloadClientError, OSError, _ModelManagerError) as exc:
            last_error = exc
    return last_error


def _download(
    url: str,
    part_path: Path,
    *,
    timeout: float,
    downloader: str,
    aria2_connections: int,
    aria2_split: int,
    progress: DownloadProgress | None,
    label: str,
) -> None:
    if downloader == "aria2":
        try:
            _download_aria2(
                url,
                part_path,
                timeout=timeout,
                connections=aria2_connections,
                split=aria2_split,
            )
        except DownloadClientError as exc:
            raise _ModelManagerError(str(exc)) from exc
        if part_path.exists():
            size = part_path.stat().st_size
            _emit_download_progress(progress, label, size, size)
        return
    _download_httpx(url, part_path, timeout=timeout, progress=progress, label=label)


def _resolve_downloader(value: str) -> str:
    if value not in model_store_constants.MODEL_DOWNLOADERS:
        raise _ModelManagerError(
            f"Unsupported model downloader: {value}. "
            f"Choose one of: {', '.join(sorted(model_store_constants.MODEL_DOWNLOADERS))}."
        )
    if value == "auto":
        return "aria2" if _aria2_executable() else "httpx"
    if value == "aria2" and not _aria2_executable():
        raise _ModelManagerError("aria2c was requested but was not found on PATH.")
    return value


def _download_aria2(
    url: str,
    part_path: Path,
    *,
    timeout: float,
    connections: int,
    split: int,
) -> None:
    download_aria2(
        url,
        part_path,
        timeout=timeout,
        connections=connections,
        split=split,
    )


def _aria2_executable() -> Path | None:
    return aria2_executable()


def _emit_download_progress(
    progress: DownloadProgress | None,
    label: str,
    downloaded: int,
    total: int | None,
) -> None:
    if progress is not None:
        progress(label, downloaded, total)


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
    reserve = max(
        model_store_constants.MIN_DISK_RESERVE_BYTES,
        required_bytes // model_store_constants.DISK_RESERVE_RATIO_DIVISOR,
    )
    if usage.free < required_bytes + reserve:
        raise _ModelManagerError(
            "Not enough free disk space for model download. "
            f"Need about {required_bytes + reserve} bytes, have {usage.free} bytes."
        )


def _filename_from_url(url: str) -> str | None:
    name = Path(unquote(urlparse(url).path)).name
    return name or None
