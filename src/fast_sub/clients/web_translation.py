from __future__ import annotations

import os


class WebTranslationClientError(RuntimeError):
    """Raised when a web translation request cannot be completed."""


def translate_text(
    *,
    text: str,
    translator: str,
    from_language: str,
    to_language: str,
) -> str:
    """Translate text through the third-party web translator package."""
    os.environ.setdefault("translators_default_region", "EN")
    try:
        import translators as ts  # type: ignore[import-not-found]
    except ImportError as exc:
        raise WebTranslationClientError(
            "Web translation requires the GPL-3.0 `translators` package. "
            "Install with `uv sync --extra web-translate` or accept the default dependency."
        ) from exc
    return str(
        ts.translate_text(
            text,
            translator=translator,
            from_language=from_language,
            to_language=to_language,
        )
    )


__all__ = ["WebTranslationClientError", "translate_text"]
