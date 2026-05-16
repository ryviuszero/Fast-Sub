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
        if len(expected_ids) == 1:
            text = _plain_text_translation(cleaned)
            if text:
                return {expected_ids[0]: text}
        raise ValueError("Could not parse provider JSON response.") from exc
    items: object
    if isinstance(payload, list):
        if len(expected_ids) == 1 and len(payload) == 1 and isinstance(payload[0], str):
            text = _plain_text_translation(payload[0])
            if text:
                return {expected_ids[0]: text}
        items = payload
    elif isinstance(payload, dict):
        items = payload.get("translations") or payload.get("results") or payload.get("items")
        if items is None and len(expected_ids) == 1:
            raw_text = (
                payload.get("text")
                or payload.get("translation")
                or payload.get("translated_text")
                or payload.get("target")
                or payload.get(str(expected_ids[0]))
            )
            if isinstance(raw_text, str) and raw_text.strip():
                return {expected_ids[0]: raw_text.strip()}
    else:
        items = None
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


def _plain_text_translation(value: str) -> str:
    text = value.strip()
    if not text:
        return ""
    text = re.sub(r"^```(?:text|markdown)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)
    text = re.sub(
        r"^\s*(?:translation|translated text|译文|翻译)\s*[:：]\s*", "", text, flags=re.IGNORECASE
    )
    text = re.sub(r"^\s*(?:id\s*)?\d+\s*[.)、:：-]\s*", "", text, flags=re.IGNORECASE)
    text = text.strip().strip('"').strip()
    if not text:
        return ""
    if text.startswith("{") or text.startswith("["):
        return ""
    return text


__all__ = ["parse_chat_translations"]
