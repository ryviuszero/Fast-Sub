from __future__ import annotations

import json
import re


def parse_chat_translations(content: str, *, expected_ids: list[int]) -> dict[int, str]:
    cleaned = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL | re.IGNORECASE)
    fenced = re.search(r"```(?:json)?\s*(.*?)```", cleaned, flags=re.DOTALL | re.IGNORECASE)
    if fenced:
        cleaned = fenced.group(1)
    else:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            cleaned = cleaned[start : end + 1]
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ValueError("Could not parse provider JSON response.") from exc
    items = payload.get("translations")
    if not isinstance(items, list):
        raise ValueError("Provider JSON response is missing translations list.")
    translations: dict[int, str] = {}
    for item in items:
        if not isinstance(item, dict) or "id" not in item or "text" not in item:
            raise ValueError("Provider JSON response contains malformed translation item.")
        translations[int(item["id"])] = str(item["text"]).strip()
    if set(translations) != set(expected_ids) or len(translations) != len(expected_ids):
        raise ValueError("Provider response id/count mismatch.")
    if any(not text for text in translations.values()):
        raise ValueError("Provider response contains empty translation text.")
    return translations


__all__ = ["parse_chat_translations"]
