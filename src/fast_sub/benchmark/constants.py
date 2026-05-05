"""Constants for transcription and translation benchmark runs."""

from __future__ import annotations

BENCH_PROFILE_CHOICES = {"all", "cpu-int8", "auto"}
DEFAULT_PROFILE_SPECS = (
    ("cpu-int8", "cpu", "int8"),
    ("auto", "auto", "auto"),
)

TRANSLATION_NORMALIZATION_PROFILE = "translate_quality_basic_v1"
LIGHTWEIGHT_METRIC_IMPLEMENTATION = "fast_sub_lightweight_v1"
LIGHTWEIGHT_TOKENIZER = "char_cjk_or_whitespace_v1"
REMOTE_WEB_PROVIDERS = {"web-bing", "web-google"}
REMOTE_API_PROVIDERS = {"api-openai-chat"}

BENCH_OUTPUT_DIR_PARTS = (".fast-sub", "bench")
BENCH_TRANSLATE_OUTPUT_DIR_PARTS = (".fast-sub", "bench-translate")
BENCH_TRANSLATE_REPORT_NAME = "report.json"
BENCH_TRANSLATE_MARKDOWN_NAME = "report.md"

__all__ = [
    "BENCH_OUTPUT_DIR_PARTS",
    "BENCH_PROFILE_CHOICES",
    "BENCH_TRANSLATE_MARKDOWN_NAME",
    "BENCH_TRANSLATE_OUTPUT_DIR_PARTS",
    "BENCH_TRANSLATE_REPORT_NAME",
    "DEFAULT_PROFILE_SPECS",
    "LIGHTWEIGHT_METRIC_IMPLEMENTATION",
    "LIGHTWEIGHT_TOKENIZER",
    "REMOTE_API_PROVIDERS",
    "REMOTE_WEB_PROVIDERS",
    "TRANSLATION_NORMALIZATION_PROFILE",
]
