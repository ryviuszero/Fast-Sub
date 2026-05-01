from __future__ import annotations

import os

from fast_sub.models import Segment, TranslationError, TranslationResult


def translate_segments(
    *,
    segments: list[Segment],
    translator: str,
    source_lang: str,
    target_lang: str,
    retries: int = 2,
) -> TranslationResult:
    translated = [segment.model_copy() for segment in segments]
    errors: list[TranslationError] = []

    for segment in translated:
        error: TranslationError | None = None
        for _attempt in range(retries + 1):
            try:
                result = _translate_text(
                    text=segment.text,
                    translator=translator,
                    from_language=source_lang,
                    to_language=target_lang,
                )
                segment.translation = str(result).strip()
                if not segment.translation:
                    raise ValueError("Translator returned empty text.")
                error = None
                break
            except Exception as exc:
                error = TranslationError(
                    batch_start_id=segment.id,
                    batch_end_id=segment.id,
                    message=str(exc),
                    raw_response=None,
                )
        if error is not None:
            errors.append(error)

    return TranslationResult(segments=translated, errors=errors)


def _translate_text(
    *,
    text: str,
    translator: str,
    from_language: str,
    to_language: str,
) -> str:
    os.environ.setdefault("translators_default_region", "EN")
    import translators as ts

    return str(
        ts.translate_text(
            text,
            translator=translator,
            from_language=from_language,
            to_language=to_language,
        )
    )
