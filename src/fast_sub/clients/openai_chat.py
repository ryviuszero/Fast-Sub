from __future__ import annotations

import json
from dataclasses import dataclass

import httpx

from fast_sub.subtitles.models import Segment
from fast_sub.translation.parsing import parse_chat_translations


@dataclass(frozen=True)
class OpenAIChatClient:
    """HTTP client for OpenAI-compatible chat completion translation requests."""

    model: str
    api_key: str
    base_url: str
    timeout: float

    def translate_batch(
        self,
        batch: list[Segment],
        *,
        source_lang: str,
        target_lang: str,
    ) -> dict[int, str]:
        """Translate one subtitle batch through the chat completions API."""
        expected_ids = [segment.id for segment in batch]
        response = self._post_chat_completion(
            self._translation_payload(
                batch,
                source_lang=source_lang,
                target_lang=target_lang,
            )
        )
        content = response["choices"][0]["message"]["content"]
        return parse_chat_translations(content, expected_ids=expected_ids)

    def _post_chat_completion(self, payload: dict[str, object]) -> dict[str, object]:
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        with httpx.Client(timeout=self.timeout) as client:
            response = client.post(self._chat_completions_url, headers=headers, json=payload)
            response.raise_for_status()
        return response.json()

    def _translation_payload(
        self,
        batch: list[Segment],
        *,
        source_lang: str,
        target_lang: str,
    ) -> dict[str, object]:
        return {
            "model": self.model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Translate subtitle cues. Return JSON only: "
                        '{"translations":[{"id":1,"text":"..."}]}. Preserve ids and count.'
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "source_language": source_lang,
                            "target_language": target_lang,
                            "cues": [{"id": item.id, "text": item.text} for item in batch],
                        },
                        ensure_ascii=False,
                    ),
                },
            ],
            "temperature": 0,
        }

    @property
    def _chat_completions_url(self) -> str:
        return self.base_url.rstrip("/") + "/chat/completions"


__all__ = ["OpenAIChatClient"]
