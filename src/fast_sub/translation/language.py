from __future__ import annotations

from fast_sub.subtitles.models import Segment
from fast_sub.translation.models import TranslationProviderError

FLORES_CODES = {
    "en": "eng_Latn",
    "zh": "zho_Hans",
    "ja": "jpn_Jpan",
    "ko": "kor_Hang",
}


def detect_subtitle_language(segments: list[Segment]) -> str | None:
    text = "\n".join(segment.text for segment in segments).strip()
    if not text:
        return None
    simplified_zh_markers = set("这们吗么为还说话过没见听欢气个")
    counts = {
        "ja_kana": sum(1 for char in text if "\u3040" <= char <= "\u30ff"),
        "ko": sum(1 for char in text if "\uac00" <= char <= "\ud7af"),
        "han": sum(1 for char in text if "\u4e00" <= char <= "\u9fff"),
        "latin": sum(1 for char in text if "A" <= char <= "Z" or "a" <= char <= "z"),
        "zh_marker": sum(1 for char in text if char in simplified_zh_markers),
    }
    signal_total = counts["ja_kana"] + counts["ko"] + counts["han"] + counts["latin"]
    if signal_total == 0:
        return None
    if counts["ko"] >= 4 and counts["ko"] / signal_total >= 0.4:
        return "ko"
    if counts["ja_kana"] >= 4 and counts["ja_kana"] / signal_total >= 0.2:
        return "ja"
    if counts["zh_marker"] >= 1 and counts["han"] >= 4 and counts["han"] / signal_total >= 0.4:
        return "zh"
    if counts["latin"] >= 8 and counts["latin"] / signal_total >= 0.8:
        return "en"
    return None


def flores_code(language: str) -> str:
    try:
        return FLORES_CODES[language]
    except KeyError as exc:
        raise TranslationProviderError(
            "invalid_options",
            f"Unsupported NLLB language: {language}",
        ) from exc


__all__ = ["FLORES_CODES", "detect_subtitle_language", "flores_code"]
