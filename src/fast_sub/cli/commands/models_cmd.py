from __future__ import annotations

import json
from typing import Annotated

import typer
from rich.progress import (
    BarColumn,
    DownloadColumn,
    Progress,
    TaskID,
    TextColumn,
    TimeRemainingColumn,
    TransferSpeedColumn,
)

from fast_sub.cli.context import console, err_console
from fast_sub.cli.errors import error_payload
from fast_sub.cli.redaction import redact_secrets
from fast_sub.model_store.constants import MODEL_DOWNLOADERS
from fast_sub.model_store.errors import ModelManagerError
from fast_sub.model_store.manager import (
    install_model,
    model_path,
    verify_model,
)
from fast_sub.model_store.manifest import get_model, list_models
from fast_sub.model_store.service import (
    install_model_use_case,
    list_model_rows,
    verify_model_status,
)

models_app = typer.Typer(help="Manage local model downloads.", no_args_is_help=True)


@models_app.command("list")
def models_list_command(
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Print machine-readable JSON."),
    ] = False,
) -> None:
    """List known models and local installation status."""
    rows = list_model_rows(
        list_models_func=list_models,
        verify_model_func=verify_model,
        model_path_func=model_path,
    )
    if json_output:
        typer.echo(json.dumps(rows, ensure_ascii=False, indent=2))
        return

    for row in rows:
        installed = "yes" if row["installed"] else row["status"]
        console.print(
            f"{row['id']}\t{_format_bytes(row['size_bytes'])}\t"
            f"{row['license']}\t{row['manifest_type']}:{row['required_files']}\t{installed}"
        )


@models_app.command("verify")
def models_verify_command(
    model_id: Annotated[str, typer.Argument(help="Model id from `models list`.")],
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Print machine-readable JSON."),
    ] = False,
) -> None:
    """Verify a downloaded model against the manifest sha256 entries."""
    try:
        status = verify_model_status(
            model_id=model_id,
            get_model_func=get_model,
            verify_model_func=verify_model,
        )
    except KeyError as exc:
        payload = error_payload(
            code="invalid_input",
            stage="model",
            message=str(exc),
            action_hint="Run `fast-sub models list` to see available models.",
        )
        if json_output:
            typer.echo(json.dumps(payload, ensure_ascii=False))
        else:
            err_console.print(f"[red]Error:[/red] {redact_secrets(str(exc))}")
        raise typer.Exit(2) from exc

    if json_output:
        typer.echo(json.dumps(status.as_dict(), ensure_ascii=False, indent=2))
    else:
        color = "green" if status.installed else "yellow"
        console.print(f"[{color}]{status.status}:[/{color}] {status.message} {status.path}")
    if not status.installed:
        raise typer.Exit(4)


@models_app.command("install")
def models_install_command(
    model_id: Annotated[str, typer.Argument(help="Model id from `models list`.")],
    downloader: Annotated[
        str,
        typer.Option("--downloader", help="Download backend: auto, httpx, or aria2."),
    ] = "auto",
    aria2_connections: Annotated[
        int,
        typer.Option("--aria2-connections", help="aria2 connections per server."),
    ] = 8,
    aria2_split: Annotated[
        int,
        typer.Option("--aria2-split", help="aria2 split count."),
    ] = 8,
) -> None:
    """Download and verify a model into the local cache."""
    try:
        model = get_model(model_id)
        _validate_model_downloader(downloader)
        with _model_download_progress() as progress:
            model, status = install_model_use_case(
                model_id=model_id,
                downloader=downloader,
                aria2_connections=aria2_connections,
                aria2_split=aria2_split,
                progress=progress,
                get_model_func=lambda _model_id: model,
                validate_downloader_func=lambda _downloader: None,
                install_model_func=install_model,
            )
    except (KeyError, ModelManagerError) as exc:
        err_console.print(f"[red]Error:[/red] {redact_secrets(str(exc))}")
        code = 2 if isinstance(exc, KeyError) else 5
        raise typer.Exit(code) from exc
    console.print(
        f"[green]Installed:[/green] {model.id} -> {status.path} "
        f"({status.checked_files} file(s) verified)"
    )


def _validate_model_downloader(value: str) -> None:
    if value not in MODEL_DOWNLOADERS:
        supported = ", ".join(sorted(MODEL_DOWNLOADERS))
        raise ModelManagerError(
            f"Unsupported model downloader: {value}. Choose one of: {supported}."
        )


def _model_download_progress():  # noqa: ANN202
    progress = Progress(
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        DownloadColumn(),
        TransferSpeedColumn(),
        TimeRemainingColumn(),
        console=console,
    )
    tasks: dict[str, TaskID] = {}

    def update(label: str, downloaded: int, total: int | None) -> None:
        if label not in tasks:
            tasks[label] = progress.add_task(
                label,
                total=total,
                completed=downloaded,
            )
            return
        task_id = tasks[label]
        if total is not None:
            progress.update(task_id, total=total)
        progress.update(task_id, completed=downloaded)

    class ProgressContext:
        def __enter__(self):  # noqa: ANN204
            progress.start()
            return update

        def __exit__(self, exc_type, exc, tb):  # noqa: ANN001, ANN204
            progress.stop()
            return False

    return ProgressContext()


def _format_bytes(value: object) -> str:
    size = float(value)
    units = ["B", "KB", "MB", "GB", "TB"]
    for unit in units:
        if size < 1024 or unit == units[-1]:
            if unit == "B":
                return f"{int(size)} {unit}"
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"
