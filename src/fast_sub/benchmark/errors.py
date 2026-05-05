"""Errors raised by benchmark workflows."""

from __future__ import annotations

from typing import Any

from fast_sub.contracts.errors import SubGenError


class BenchError(SubGenError):
    """Raised when transcription benchmark execution cannot produce a valid report."""

    def __init__(self, message: str, *, report: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.report = report


class BenchTranslateError(SubGenError):
    """Raised when translation benchmark execution cannot produce a valid report."""

    def __init__(self, message: str, *, report: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.report = report


__all__ = ["BenchError", "BenchTranslateError"]
