from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from rich.console import Console

console = Console()
err_console = Console(stderr=True)


@dataclass(frozen=True)
class CliContext:
    """Shared CLI rendering and workspace options."""

    json_output: bool = False
    workdir: Path | None = None
    verbose: bool = False
