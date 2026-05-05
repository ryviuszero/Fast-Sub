"""Data models for output operations."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BurnOptions:
    """Subtitle burn styling and encoding preset options."""

    font: str | None = None
    font_size: int | None = None
    preset: str = "balanced"


__all__ = ["BurnOptions"]
