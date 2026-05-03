from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any


def list_model_rows(
    *,
    list_models_func: Callable[[], list[Any]],
    verify_model_func: Callable[[Any], Any],
    model_path_func: Callable[[Any], Path],
) -> list[dict[str, Any]]:
    rows = []
    for model in list_models_func():
        status = verify_model_func(model)
        rows.append(
            {
                "id": model.id,
                "name": model.name,
                "type": model.type,
                "backend": model.backend,
                "size_bytes": model.size_bytes,
                "license": model.license,
                "manifest_type": model.manifest_type,
                "required_files": model.required_file_count,
                "installed": status.installed,
                "status": status.status,
                "path": str(model_path_func(model)),
                "recommended_for": model.recommended_for,
            }
        )
    return rows


def verify_model_status(
    *,
    model_id: str,
    get_model_func: Callable[[str], Any],
    verify_model_func: Callable[[Any], Any],
) -> Any:
    return verify_model_func(get_model_func(model_id))


def install_model_use_case(
    *,
    model_id: str,
    downloader: str,
    aria2_connections: int,
    aria2_split: int,
    progress: Callable[[str, int, int | None], None],
    get_model_func: Callable[[str], Any],
    validate_downloader_func: Callable[[str], None],
    install_model_func: Callable[..., Any],
) -> tuple[Any, Any]:
    model = get_model_func(model_id)
    validate_downloader_func(downloader)
    status = install_model_func(
        model,
        downloader=downloader,
        aria2_connections=aria2_connections,
        aria2_split=aria2_split,
        progress=progress,
    )
    return model, status
