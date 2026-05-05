from __future__ import annotations

import pysubs2

from fast_sub.subtitles import constants as subtitle_constants
from fast_sub.subtitles.models import BilingualOrder, Mode, RefineOptions, Segment, SubtitleCue


def render_srt(
    segments: list[Segment],
    mode: Mode,
    bilingual_order: BilingualOrder = BilingualOrder.ORIGINAL_FIRST,
    max_line_chars: int | None = None,
) -> str:
    """Render subtitle segments as SRT text.

    The selected mode controls whether each cue contains original text,
    translated text, or both in the requested bilingual order.
    """
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


def refine_srt_text(srt_text: str, options: RefineOptions | None = None) -> str:
    """Clean and normalize an SRT document.

    This parses SRT text into cues, repairs timing problems, drops blank cues,
    wraps long text, and returns a new SRT document.
    """
    options = options or RefineOptions()
    subs = pysubs2.SSAFile.from_string(srt_text, format_="srt")
    cues = [
        SubtitleCue(event.start, event.end, _normalize_text(event.text)) for event in subs.events
    ]
    refined = refine_cues(cues, options)
    output = pysubs2.SSAFile()
    for cue in refined:
        output.events.append(
            pysubs2.SSAEvent(
                start=cue.start,
                end=cue.end,
                text=cue.text,
            )
        )
    return output.to_string("srt")


def refine_cues(cues: list[SubtitleCue], options: RefineOptions) -> list[SubtitleCue]:
    """Refine parsed subtitle cues without performing SRT I/O.

    The cue pipeline removes empty entries, repairs timeline ordering, merges
    short cues, splits long cues, and performs a final timeline repair pass.
    """
    cleaned = _drop_blank_cues(cues)
    if not cleaned:
        return []

    max_chars = _resolve_max_chars(cleaned, options)
    repaired = _repair_timeline(cleaned, options)
    merged = _merge_short_cues(repaired, options, max_chars)
    split = _split_long_cues(merged, options, max_chars)
    return _repair_timeline(split, options)


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


def _normalize_text(text: str) -> str:
    lines = text.replace("\\N", "\n").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    return "\n".join(line.strip() for line in lines if line.strip())


def _drop_blank_cues(cues: list[SubtitleCue]) -> list[SubtitleCue]:
    cleaned: list[SubtitleCue] = []
    for cue in cues:
        text = _normalize_text(cue.text)
        if text:
            cleaned.append(SubtitleCue(max(0, cue.start), max(0, cue.end), text))
    return cleaned


def _repair_timeline(cues: list[SubtitleCue], options: RefineOptions) -> list[SubtitleCue]:
    repaired: list[SubtitleCue] = []
    previous_end = 0
    min_duration_ms = _seconds_to_ms(options.min_duration)
    for cue in cues:
        start = max(0, cue.start)
        end = max(start, cue.end)
        if start < previous_end:
            start = previous_end
        if end <= start:
            end = start + min_duration_ms
        repaired.append(SubtitleCue(start, end, cue.text))
        previous_end = end
    return repaired


def _merge_short_cues(
    cues: list[SubtitleCue],
    options: RefineOptions,
    max_chars: int,
) -> list[SubtitleCue]:
    merged: list[SubtitleCue] = []
    min_duration_ms = _seconds_to_ms(options.min_duration)
    max_duration_ms = _seconds_to_ms(options.max_duration)

    index = 0
    while index < len(cues):
        cue = cues[index]
        duration = cue.end - cue.start

        if duration >= min_duration_ms:
            merged.append(cue)
            index += 1
            continue

        if index + 1 < len(cues):
            following = cues[index + 1]
            combined_text = _join_text(cue.text, following.text)
            if (
                following.end - cue.start <= max_duration_ms
                and _plain_len(combined_text) <= max_chars * 2
            ):
                cues[index + 1] = SubtitleCue(cue.start, following.end, combined_text)
                index += 1
                continue

        if merged and cue.end - merged[-1].start <= max_duration_ms:
            previous = merged[-1]
            combined_text = _join_text(previous.text, cue.text)
            if _plain_len(combined_text) <= max_chars * 2:
                merged[-1] = SubtitleCue(previous.start, cue.end, combined_text)
            else:
                merged.append(cue)
        else:
            merged.append(cue)

        index += 1
    return merged


def _split_long_cues(
    cues: list[SubtitleCue],
    options: RefineOptions,
    max_chars: int,
) -> list[SubtitleCue]:
    split: list[SubtitleCue] = []
    max_duration_ms = _seconds_to_ms(options.max_duration)
    min_split_ms = _seconds_to_ms(subtitle_constants.MIN_SPLIT_DURATION_SEC)

    for cue in cues:
        chunks = _text_chunks(cue.text, max_chars)
        duration = cue.end - cue.start
        if duration > max_duration_ms and len(chunks) == 1:
            chunks = _split_chunk(chunks[0], max_chars)
        if len(chunks) <= 1 or duration // len(chunks) < min_split_ms:
            split.append(SubtitleCue(cue.start, cue.end, _wrap_subtitle_text(cue.text, max_chars)))
            continue

        step = duration / len(chunks)
        for chunk_index, chunk in enumerate(chunks):
            start = round(cue.start + step * chunk_index)
            end = round(cue.start + step * (chunk_index + 1))
            split.append(SubtitleCue(start, end, _wrap_subtitle_text(chunk, max_chars)))
    return split


def _text_chunks(text: str, max_chars: int) -> list[str]:
    normalized = _normalize_text(text)
    if _plain_len(normalized) <= max_chars * 2:
        return [normalized]

    paragraphs = [line for line in normalized.split("\n") if line]
    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        parts = _split_chunk(paragraph, max_chars)
        for part in parts:
            candidate = part if not current else f"{current}\n{part}"
            if _plain_len(candidate) > max_chars * 2 and current:
                chunks.append(current)
                current = part
            else:
                current = candidate
    if current:
        chunks.append(current)
    return chunks


def _split_chunk(text: str, max_chars: int) -> list[str]:
    if " " in text:
        chunks: list[str] = []
        current = ""
        for word in text.split():
            candidate = word if not current else f"{current} {word}"
            if len(candidate) > max_chars and current:
                chunks.append(current)
                current = word
            else:
                current = candidate
        if current:
            chunks.append(current)
        return chunks
    return [text[index : index + max_chars] for index in range(0, len(text), max_chars)]


def _wrap_subtitle_text(text: str, max_chars: int) -> str:
    lines = []
    for chunk in _split_chunk(_normalize_text(text).replace("\n", " "), max_chars):
        if not lines or _plain_len(lines[-1]) + 1 + _plain_len(chunk) > max_chars:
            lines.append(chunk)
        else:
            lines[-1] = f"{lines[-1]} {chunk}"
    return "\n".join(lines)


def _resolve_max_chars(cues: list[SubtitleCue], options: RefineOptions) -> int:
    if options.max_chars is not None:
        return options.max_chars
    lang = options.lang.lower()
    if lang in {"zh", "ja", "ko"} or (lang == "auto" and _contains_cjk(cues)):
        return subtitle_constants.CJK_DEFAULT_LINE_CHARS
    return subtitle_constants.EN_DEFAULT_LINE_CHARS


def _contains_cjk(cues: list[SubtitleCue]) -> bool:
    return any(
        "\u4e00" <= char <= "\u9fff" or "\u3040" <= char <= "\u30ff" or "\uac00" <= char <= "\ud7af"
        for cue in cues
        for char in cue.text
    )


def _join_text(first: str, second: str) -> str:
    return "\n".join(part for part in (_normalize_text(first), _normalize_text(second)) if part)


def _plain_len(text: str) -> int:
    return len(text.replace("\n", ""))
