from __future__ import annotations

import pysubs2

from sub_gen.models import BilingualOrder, Mode, Segment


def _seconds_to_ms(seconds: float) -> int:
    return max(0, round(seconds * 1000))


def _wrap_soft(text: str, max_chars: int | None) -> str:
    if not max_chars or len(text) <= max_chars:
        return text
    words = text.split()
    if len(words) <= 1:
        return text
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = word if not current else f"{current} {word}"
        if len(candidate) > max_chars:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return "\n".join(lines)


def render_srt(
    segments: list[Segment],
    mode: Mode,
    bilingual_order: BilingualOrder = BilingualOrder.ORIGINAL_FIRST,
    max_line_chars: int | None = None,
) -> str:
    subs = pysubs2.SSAFile()
    for segment in segments:
        text = _event_text(segment, mode, bilingual_order, max_line_chars)
        if not text:
            continue
        subs.events.append(
            pysubs2.SSAEvent(
                start=_seconds_to_ms(segment.start),
                end=_seconds_to_ms(segment.end),
                text=text,
            )
        )
    return subs.to_string("srt")


def _event_text(
    segment: Segment,
    mode: Mode,
    bilingual_order: BilingualOrder,
    max_line_chars: int | None,
) -> str:
    original = _wrap_soft(segment.text.strip(), max_line_chars)
    translated = _wrap_soft((segment.translation or "").strip(), max_line_chars)
    if mode is Mode.ORIGINAL:
        return original
    if mode is Mode.TRANSLATED:
        return translated
    if bilingual_order is BilingualOrder.TRANSLATED_FIRST:
        return "\n".join(part for part in (translated, original) if part)
    return "\n".join(part for part in (original, translated) if part)

