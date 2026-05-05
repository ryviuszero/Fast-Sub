"""Errors raised by the automatic subtitle pipeline."""

from __future__ import annotations

from fast_sub.contracts.errors import SubGenError
from fast_sub.pipeline.models import AutoResult


class AutoPipelineError(SubGenError):
    """Raised when auto pipeline execution fails with a structured result."""

    def __init__(self, result: AutoResult) -> None:
        self.result = result
        super().__init__(result.error or "fast-sub auto failed.")


__all__ = ["AutoPipelineError"]
