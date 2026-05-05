"""Errors raised by model store operations."""

from __future__ import annotations


class ModelManagerError(RuntimeError):
    """Raised when model installation or verification fails."""


__all__ = ["ModelManagerError"]
