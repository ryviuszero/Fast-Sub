from __future__ import annotations

from collections.abc import Callable
from typing import Any

import typer

from fast_sub.cli.errors import exit_code_for_payload, json_error_for_exception
from fast_sub.cli.helpers import echo_json, err_console, redact_secrets
from fast_sub.contracts.errors import SubGenError


def run_json_command(
    action: Callable[[], Any],
    *,
    json_output: bool,
    stage: str,
    error_code: str = "command_failed",
    success_indent: int | None = 2,
) -> Any:
    """Run a CLI action and render either JSON output or a formatted error."""
    try:
        payload = action()
    except SubGenError as exc:
        error_payload = json_error_for_exception(exc, stage=stage, code=error_code)
        if json_output:
            echo_json(error_payload)
        else:
            err_console.print(f"[red]Error:[/red] {redact_secrets(str(exc))}")
        raise typer.Exit(exit_code_for_payload(error_payload)) from exc

    if json_output:
        echo_json(payload, indent=success_indent)
    return payload
