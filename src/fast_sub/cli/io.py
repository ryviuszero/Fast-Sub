from __future__ import annotations

import json
from typing import Any

import typer


def echo_json(payload: Any, *, pretty: bool = False) -> None:
    """Print a JSON payload using the CLI's UTF-8 friendly formatting."""
    indent = 2 if pretty else None
    typer.echo(json.dumps(payload, ensure_ascii=False, indent=indent))
