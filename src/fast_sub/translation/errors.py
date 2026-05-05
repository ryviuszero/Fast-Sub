from __future__ import annotations


class TranslationProviderError(RuntimeError):
    """Raised when subtitle translation cannot be completed."""

    def __init__(self, code: str, message: str, *, hint: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.hint = hint


__all__ = ["TranslationProviderError"]
