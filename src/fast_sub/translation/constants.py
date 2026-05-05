from __future__ import annotations

DEFAULT_NLLB_MODEL_ID = "nllb-200-distilled-600m-ct2-int8"
TRANSLATION_PROVIDERS = {"web-bing", "web-google", "api-openai-chat", "local-nllb-ct2"}
LANGUAGES = {"auto", "en", "zh", "ja", "ko"}
TARGET_LANGUAGES = {"en", "zh", "ja", "ko"}

__all__ = [
    "DEFAULT_NLLB_MODEL_ID",
    "LANGUAGES",
    "TARGET_LANGUAGES",
    "TRANSLATION_PROVIDERS",
]
