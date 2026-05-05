from __future__ import annotations

import json
from typing import Any

BENCH_SCHEMA_VERSION = 1
BENCH_MEASUREMENT_SCOPE = "transcribe_media_v1"
BENCH_TRANSLATE_SCHEMA_VERSION = 1
BENCH_TRANSLATE_MEASUREMENT_SCOPE = "translate_srt_v1"
SAMPLE_MANIFEST_EXAMPLE = {
    "schema_version": 1,
    "samples": [
        {
            "id": "zh-interview-1m",
            "kind": "sample",
            "prepared_media_path": "local_tests/media/light/zh-interview-1m.wav",
            "prepared_media_checksum_sha256": "<sha256>",
            "reference_transcript_path": "local_tests/references/light/zh-interview-1m.txt",
            "reference_transcript_checksum_sha256": "<sha256>",
            "language": "zh",
            "source_dataset": "AISHELL-1",
            "source_url": "https://openslr.org/33/",
            "license": "Apache-2.0",
            "redistributable": True,
            "target_metrics": ["rtfx", "cer", "segments_count", "invalid_segments_count"],
        }
    ],
}
SAMPLE_MANIFEST_REQUIRED_FIELDS = (
    "samples",
    "samples[].id",
    "samples[].prepared_media_path",
)
SAMPLE_MANIFEST_RECOMMENDED_FIELDS = (
    "samples[].prepared_media_checksum_sha256",
    "samples[].reference_transcript_path",
    "samples[].reference_transcript_checksum_sha256",
    "samples[].language",
    "samples[].source_dataset",
    "samples[].source_url",
    "samples[].license",
    "samples[].redistributable",
    "samples[].target_metrics",
)
TRANSLATE_SAMPLE_MANIFEST_EXAMPLE = {
    "schema_version": 1,
    "providers": [
        {"id": "web-bing"},
        {"id": "local-nllb-ct2", "model": "nllb-200-distilled-600m-ct2-int8"},
    ],
    "samples": [
        {
            "id": "en-podcast-1m-to-zh",
            "source_subtitle_path": "local_tests/bench_translate/datasets/light/en-zh.source.srt",
            "reference_translation_path": (
                "local_tests/bench_translate/datasets/light/en-zh.reference.srt"
            ),
            "source_language": "en",
            "target_language": "zh",
            "domain": "podcast",
            "source_dataset": "authorized local sample",
            "license": "local-only",
            "redistributable": False,
            "target_metrics": ["bleu", "chrf", "exact_match_rate", "elapsed_sec"],
        }
    ],
}
TRANSLATE_SAMPLE_MANIFEST_REQUIRED_FIELDS = (
    "providers",
    "providers[].id",
    "samples",
    "samples[].id",
    "samples[].source_subtitle_path",
    "samples[].reference_translation_path",
    "samples[].source_language",
    "samples[].target_language",
)


def sample_manifest_schema_payload() -> dict[str, Any]:
    return {
        "schema_version": BENCH_SCHEMA_VERSION,
        "kind": "fast_sub_bench_sample_manifest_schema",
        "matching_rule": (
            "fast-sub bench matches the input media filename against samples[].prepared_media_path."
        ),
        "required_fields": list(SAMPLE_MANIFEST_REQUIRED_FIELDS),
        "recommended_fields": list(SAMPLE_MANIFEST_RECOMMENDED_FIELDS),
        "supported_languages": ["auto", "zh", "en", "ja", "ko"],
        "notes": [
            "assets[] is not required by fast-sub bench.",
            "The bench CLI does not take --sample-id; use prepared_media_path to match samples.",
            "reference_transcript_path enables WER/CER scoring.",
            "Unsupported language metadata falls back to auto for transcription.",
        ],
        "example": SAMPLE_MANIFEST_EXAMPLE,
    }


def render_sample_manifest_schema() -> str:
    payload = sample_manifest_schema_payload()
    lines = [
        "Fast Sub Bench Sample Manifest",
        "",
        "Matching:",
        f"- {payload['matching_rule']}",
        "",
        "Required fields:",
        *[f"- {field}" for field in payload["required_fields"]],
        "",
        "Recommended fields:",
        *[f"- {field}" for field in payload["recommended_fields"]],
        "",
        "Supported language values:",
        "- auto, zh, en, ja, ko",
        "",
        "Example:",
        json.dumps(payload["example"], ensure_ascii=False, indent=2),
    ]
    return "\n".join(lines)


def translate_sample_manifest_schema_payload() -> dict[str, Any]:
    return {
        "schema_version": BENCH_TRANSLATE_SCHEMA_VERSION,
        "kind": "fast_sub_bench_translate_manifest_schema",
        "measurement_scope": BENCH_TRANSLATE_MEASUREMENT_SCOPE,
        "required_fields": list(TRANSLATE_SAMPLE_MANIFEST_REQUIRED_FIELDS),
        "provider_matrix": (
            "Run each samples[] entry against each providers[] entry. CLI overrides should be "
            "recorded in the report when manifest execution is implemented."
        ),
        "supported_languages": ["auto", "en", "zh", "ja", "ko"],
        "reference_types": ["srt", "txt"],
        "dataset_profiles": ["light", "standard"],
        "core_directions": ["en-zh", "ja-zh", "ko-zh", "zh-en", "ja-en", "ko-en"],
        "notes": [
            "Dataset raw files are manually downloaded by the user.",
            "Sampling scripts must read local_tests/bench_translate/raw/ only and avoid network.",
            "Do not commit real source subtitles, references, model files, or reports.",
            "Scores are per sample/reference and should not be aggregated as one quality truth.",
        ],
        "example": TRANSLATE_SAMPLE_MANIFEST_EXAMPLE,
    }


def render_translate_sample_manifest_schema() -> str:
    payload = translate_sample_manifest_schema_payload()
    lines = [
        "Fast Sub Translation Benchmark Manifest",
        "",
        "Provider matrix:",
        f"- {payload['provider_matrix']}",
        "",
        "Required fields:",
        *[f"- {field}" for field in payload["required_fields"]],
        "",
        "Reference types:",
        "- srt, txt",
        "",
        "Dataset profiles:",
        "- light, standard",
        "",
        "Core directions:",
        "- en-zh, ja-zh, ko-zh, zh-en, ja-en, ko-en",
        "",
        "Example:",
        json.dumps(payload["example"], ensure_ascii=False, indent=2),
    ]
    return "\n".join(lines)

__all__ = [
    "render_sample_manifest_schema",
    "render_translate_sample_manifest_schema",
    "sample_manifest_schema_payload",
    "translate_sample_manifest_schema_payload",
]
