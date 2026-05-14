from __future__ import annotations

import json
from dataclasses import dataclass

import httpx

from fast_sub.clients.errors import OpenAIChatClientError
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
        try:
            response = self._post_chat_completion(
                self._translation_payload(
                    batch,
                    source_lang=source_lang,
                    target_lang=target_lang,
                )
            )
            content = _message_content(response)
            return parse_chat_translations(content, expected_ids=expected_ids)
        except OpenAIChatClientError:
            raise
        except (KeyError, TypeError, ValueError) as exc:
            raise OpenAIChatClientError(f"Invalid chat translation response: {exc}") from exc

    def _post_chat_completion(self, payload: dict[str, object]) -> dict[str, object]:
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        try:
            with httpx.Client(timeout=self.timeout) as client:
                response = client.post(self._chat_completions_url, headers=headers, json=payload)
                response.raise_for_status()
            data = response.json()
        except httpx.HTTPError as exc:
            raise OpenAIChatClientError(f"Chat completion request failed: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise OpenAIChatClientError(f"Chat completion returned invalid JSON: {exc}") from exc
        if not isinstance(data, dict):
            raise OpenAIChatClientError("Chat completion response must be a JSON object.")
        return data

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


def _message_content(response: dict[str, object]) -> str:
    choices = response["choices"]
    if not isinstance(choices, list) or not choices:
        raise OpenAIChatClientError("Chat completion response has no choices.")
    first_choice = choices[0]
    if not isinstance(first_choice, dict):
        raise OpenAIChatClientError("Chat completion choice must be an object.")
    legacy_text = first_choice.get("text")
    if isinstance(legacy_text, str) and legacy_text.strip():
        return legacy_text
    message = first_choice["message"]
    if not isinstance(message, dict):
        raise OpenAIChatClientError("Chat completion message must be an object.")
    content = message["content"]
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
                continue
            if isinstance(item, dict):
                text = item.get("text") or item.get("content")
                if isinstance(text, str):
                    parts.append(text)
        joined = "\n".join(part for part in parts if part.strip()).strip()
        if joined:
            return joined
    raise OpenAIChatClientError("Chat completion message content must be text.")


__all__ = ["OpenAIChatClient"]
