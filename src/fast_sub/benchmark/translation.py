from __future__ import annotations

import hashlib
import json
import math
import os
import re
import statistics
import time
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

import pysubs2

from fast_sub.contracts.errors import SubGenError
from fast_sub.models import BilingualOrder, Mode
from fast_sub.translation.constants import TARGET_LANGUAGES, TRANSLATION_PROVIDERS
from fast_sub.translation.errors import TranslationProviderError
from fast_sub.translation.service import (
    TranslateOptions,
    sha256_file,
    translate_srt,
)

BENCH_TRANSLATE_SCHEMA_VERSION = 1
MEASUREMENT_SCOPE = "translate_srt_v1"
NORMALIZATION_PROFILE = "translate_quality_basic_v1"
LIGHTWEIGHT_METRIC_IMPLEMENTATION = "fast_sub_lightweight_v1"
LIGHTWEIGHT_TOKENIZER = "char_cjk_or_whitespace_v1"
REMOTE_WEB_PROVIDERS = {"web-bing", "web-google"}
REMOTE_API_PROVIDERS = {"api-openai-chat"}
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


@dataclass(frozen=True)
class BenchTranslateOptions:
    reference: Path
    provider: str
    source_language: str = "auto"
    target_language: str = "zh"
    output_dir: Path | None = None
    markdown: bool = False
    markdown_path: Path | None = None
    repeat: int = 1
    model: str | None = None
    model_path: Path | None = None
    batch_size: int = 8
    timeout: float = 60.0
    sleep_seconds: float = 0.0
    api_key: str | None = None
    base_url: str = "https://api.openai.com/v1"
    command: list[str] | None = None


class BenchTranslateError(SubGenError):
    def __init__(self, message: str, *, report: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.report = report


def translate_sample_manifest_schema_payload() -> dict[str, Any]:
    return {
        "schema_version": BENCH_TRANSLATE_SCHEMA_VERSION,
        "kind": "fast_sub_bench_translate_manifest_schema",
        "measurement_scope": MEASUREMENT_SCOPE,
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


def run_bench_translate(
    input_file: Path,
    options: BenchTranslateOptions,
    *,
    translator: Any | None = None,
) -> dict[str, Any]:
    _validate_options(input_file, options)
    run_translate = translator or translate_srt
    input_sha = sha256_file(input_file)
    reference_sha = sha256_file(options.reference)
    config_hash = _config_hash(options, input_sha=input_sha, reference_sha=reference_sha)
    generated_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    output_dir = options.output_dir or _default_output_dir(
        input_file,
        target_language=options.target_language,
        provider=options.provider,
        generated_at=generated_at,
        config_hash=config_hash,
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    reference = _load_reference(options.reference)
    dependency_versions = _dependency_versions()
    privacy = _provider_privacy(options.provider)
    metric_info = _metric_info(options.target_language)
    command = _redacted_command(options.command, input_file=input_file, reference=options.reference)
    source_texts = _load_srt_texts(input_file)
    sample = {
        "input_basename": input_file.name,
        "reference_basename": options.reference.name,
        "reference_type": reference["reference_type"],
        "reference_alignment_status": _reference_alignment_status(
            reference,
            prediction_count=len(source_texts),
        ),
    }
    report: dict[str, Any] = {
        "schema_version": BENCH_TRANSLATE_SCHEMA_VERSION,
        "generated_at": generated_at,
        "measurement_scope": MEASUREMENT_SCOPE,
        "input_basename": input_file.name,
        "input_path_redacted": True,
        "reference_basename": options.reference.name,
        "reference_path_redacted": True,
        "command": command,
        "sample": sample,
        "provider": options.provider,
        "model": options.model,
        "source_language": options.source_language,
        "target_language": options.target_language,
        "fast_sub_version": _package_version(),
        "dependency_versions": dependency_versions,
        "input_sha256": input_sha,
        "reference_sha256": reference_sha,
        "config_hash": config_hash,
        "provider_privacy_class": privacy["provider_privacy_class"],
        "uploads_text": privacy["uploads_text"],
        "redaction_applied": True,
        "runs": [],
        "summary": {},
    }
    failed_all = False
    for index in range(1, options.repeat + 1):
        run = _run_once(
            input_file,
            options,
            run_translate,
            output_dir,
            index,
            reference,
            metric_info,
        )
        report["runs"].append(run)
        failed_all = failed_all or run.get("status") == "failed"

    report["summary"] = summarize_translate_runs(
        report["runs"],
        sample=sample,
        metric_info=metric_info,
    )
    if failed_all and any(run.get("status") == "ok" for run in report["runs"]):
        report["summary"]["warnings"].append("At least one repeat failed.")
    report_path = output_dir / "report.json"
    report["report_path"] = report_path.name
    report_path.write_text(
        json.dumps(_redact_value(report), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    if options.markdown or options.markdown_path is not None:
        markdown_path = options.markdown_path or (output_dir / "report.md")
        markdown_path.parent.mkdir(parents=True, exist_ok=True)
        markdown_path.write_text(render_markdown_report(report), encoding="utf-8")
        report["markdown_path"] = markdown_path.name
        report_path.write_text(
            json.dumps(_redact_value(report), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    if not any(run.get("status") == "ok" for run in report["runs"]):
        raise BenchTranslateError("All translation benchmark runs failed.", report=report)
    return _redact_value(report)


def summarize_translate_runs(
    runs: list[dict[str, Any]],
    *,
    sample: dict[str, Any],
    metric_info: dict[str, Any],
) -> dict[str, Any]:
    ok_runs = [run for run in runs if run.get("status") == "ok"]
    first_quality: dict[str, Any] = {}
    for run in ok_runs:
        quality = run.get("quality")
        if isinstance(quality, dict):
            first_quality = quality
            break
    summary: dict[str, Any] = {
        "runs": len(runs),
        "ok_runs": len(ok_runs),
        "failed_runs": sum(1 for run in runs if run.get("status") == "failed"),
        "reference_type": first_quality.get("reference_type") or sample.get("reference_type"),
        "reference_alignment_status": first_quality.get("reference_alignment_status")
        or sample.get("reference_alignment_status"),
        "metric_input_unit": first_quality.get("metric_input_unit") or "text_sequence_v1",
        "metric_implementation": metric_info["metric_implementation"],
        "metric_version": metric_info["metric_version"],
        "metric_signature": metric_info["metric_signature"],
        "score_scale": "0-1",
        "normalization_profile": NORMALIZATION_PROFILE,
        "tokenizer": metric_info["tokenizer"],
        "case": metric_info["case"],
        "smooth": metric_info["smooth"],
        "warnings": [],
    }
    for key in ("elapsed_sec", "chars_per_sec", "cues_per_sec", "failed_count"):
        summary.update(_stats_for(key, ok_runs))
    for key in ("bleu", "chrf", "exact_match_rate"):
        values = _numbers(
            (run.get("quality") or {}).get(key)
            for run in ok_runs
            if isinstance(run.get("quality"), dict)
        )
        summary.update(_stats_values(key, values))
    return summary


def render_markdown_report(report: dict[str, Any]) -> str:
    summary = report.get("summary", {})
    quality_note = (
        "Scores are rough reference-based signals, not a human-quality guarantee. "
        "Higher BLEU, chrF, and exact match are better; lower failed cue count is better. "
        "Do not compare scores across different references, domains, or sample lengths."
    )
    lines = [
        "# Fast Sub Translation Benchmark Report",
        "",
        "## Summary",
        "",
        f"- Input: `{report.get('input_basename')}`",
        f"- Reference: `{report.get('reference_basename')}`",
        f"- Runs: `{summary.get('ok_runs')}/{summary.get('runs')}` ok",
        f"- BLEU avg: `{_format_number(summary.get('bleu_avg'))}`",
        f"- chrF avg: `{_format_number(summary.get('chrf_avg'))}`",
        f"- Exact match avg: `{_format_number(summary.get('exact_match_rate_avg'))}`",
        f"- Failed cue avg: `{_format_number(summary.get('failed_count_avg'))}`",
        "",
        "## Provider",
        "",
        f"- Provider: `{report.get('provider')}`",
        f"- Model: `{report.get('model') or 'default'}`",
        f"- Source language: `{report.get('source_language')}`",
        f"- Target language: `{report.get('target_language')}`",
        f"- Privacy class: `{report.get('provider_privacy_class')}`",
        f"- Uploads text: `{report.get('uploads_text')}`",
        "",
        "## Quality",
        "",
        f"- Reference type: `{summary.get('reference_type')}`",
        f"- Alignment: `{summary.get('reference_alignment_status')}`",
        f"- Metric input unit: `{summary.get('metric_input_unit')}`",
        f"- Metric implementation: `{summary.get('metric_implementation')}`",
        f"- Metric version: `{summary.get('metric_version')}`",
        f"- Metric signature: `{summary.get('metric_signature')}`",
        f"- Score scale: `{summary.get('score_scale')}`",
        f"- Normalization: `{summary.get('normalization_profile')}`",
        f"- Tokenizer: `{summary.get('tokenizer')}`",
        f"- Case: `{summary.get('case')}`",
        f"- Smooth: `{summary.get('smooth')}`",
        f"- Note: {quality_note}",
        "",
        "## Performance",
        "",
        f"- Elapsed avg/min/max/stddev: `{_summary_quad(summary, 'elapsed_sec')}`",
        f"- chars/sec avg/min/max/stddev: `{_summary_quad(summary, 'chars_per_sec')}`",
        f"- cues/sec avg/min/max/stddev: `{_summary_quad(summary, 'cues_per_sec')}`",
        "",
        "## Run Details",
        "",
        "| run | status | elapsed | chars/sec | cues/sec | BLEU | chrF | exact | failed |",
        "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for run in report.get("runs", []):
        quality = run.get("quality") or {}
        lines.append(
            "| "
            + " | ".join(
                [
                    str(run.get("index")),
                    str(run.get("status")),
                    _format_seconds(run.get("elapsed_sec")),
                    _format_number(run.get("chars_per_sec")),
                    _format_number(run.get("cues_per_sec")),
                    _format_number(quality.get("bleu")),
                    _format_number(quality.get("chrf")),
                    _format_number(quality.get("exact_match_rate")),
                    str(run.get("failed_count") if run.get("failed_count") is not None else ""),
                ]
            )
            + " |"
        )
    lines.extend(["", "## Warnings And Errors", ""])
    messages = _collect_messages(report)
    if not messages:
        lines.append("- None.")
    else:
        lines.extend(f"- {message}" for message in messages)
    return "\n".join(lines) + "\n"


def _run_once(
    input_file: Path,
    options: BenchTranslateOptions,
    run_translate: Any,
    output_dir: Path,
    index: int,
    reference: dict[str, Any],
    metric_info: dict[str, Any],
) -> dict[str, Any]:
    output_path = output_dir / f"run-{index}.{options.target_language}.srt"
    start = time.perf_counter()
    try:
        result = run_translate(
            input_file,
            TranslateOptions(
                provider=options.provider,
                source_language=options.source_language,
                target_language=options.target_language,
                mode=Mode.TRANSLATED,
                bilingual_order=BilingualOrder.ORIGINAL_FIRST,
                output=output_path,
                model=options.model,
                model_path=options.model_path,
                batch_size=options.batch_size,
                timeout=options.timeout,
                sleep_seconds=options.sleep_seconds,
                resume=False,
                api_key=options.api_key,
                base_url=options.base_url,
            ),
        )
    except TranslationProviderError as exc:
        elapsed = _round(time.perf_counter() - start)
        errors_path = output_path.with_suffix(".errors.json")
        run = _failed_run(
            index,
            exc,
            elapsed,
            errors_path=errors_path if errors_path.exists() else None,
        )
        run["quality"] = _null_quality(reference, metric_info)
        return run
    except Exception as exc:
        elapsed = _round(time.perf_counter() - start)
        run = _failed_run(index, exc, elapsed, errors_path=None)
        run["quality"] = _null_quality(reference, metric_info)
        return run
    elapsed = _round(time.perf_counter() - start)
    prediction_texts = _load_srt_texts(result.srt_path)
    source_texts = _load_srt_texts(input_file)
    quality = score_translation_quality(
        prediction_texts=prediction_texts,
        reference=reference,
        source_cue_count=len(source_texts),
        metric_info=metric_info,
    )
    chars = sum(len(text) for text in source_texts)
    return {
        "index": index,
        "status": "ok",
        "provider": result.provider,
        "model": options.model,
        "source_language": result.source_language,
        "target_language": result.target_language,
        "srt_path": result.srt_path.name,
        "cues_count": result.cues_count,
        "translated_count": result.translated_count,
        "failed_count": result.failed_count,
        "elapsed_sec": elapsed,
        "chars_per_sec": _rate(chars, elapsed),
        "cues_per_sec": _rate(result.cues_count, elapsed),
        "quality": quality,
        "batch_size_requested": options.batch_size,
        "batch_size_effective": options.batch_size,
        "retry_count": None,
        "single_cue_fallback_count": None,
        "rate_limit_sleep_sec_total": _round(max(0, result.cues_count) * options.sleep_seconds),
        "warnings": [_redact_secrets(warning) for warning in result.warnings or []],
        "errors_path": result.errors_path.name if result.errors_path else None,
        "output_dir": output_dir.name,
        "resume_used": False,
    }


def score_translation_quality(
    *,
    prediction_texts: list[str],
    reference: dict[str, Any],
    source_cue_count: int,
    metric_info: dict[str, Any] | None = None,
) -> dict[str, Any]:
    metric_info = metric_info or _metric_info()
    del source_cue_count
    reference_texts = list(reference.get("texts") or [])
    prediction_count = len(prediction_texts)
    reference_count = len(reference_texts)
    alignment = _reference_alignment_status(reference, prediction_count=prediction_count)
    metric_predictions, metric_references = _metric_corpus_sequences(
        prediction_texts,
        reference_texts,
    )
    if metric_info["metric_implementation"] == "sacrebleu":
        bleu, chrf, raw = _score_sacrebleu(metric_predictions, metric_references, metric_info)
    else:
        bleu = _lightweight_bleu_corpus(metric_predictions, metric_references)
        chrf = _lightweight_chrf_corpus(metric_predictions, metric_references)
        raw = {
            "bleu_raw_score": bleu,
            "bleu_raw_scale": "0-1",
            "chrf_raw_score": chrf,
            "chrf_raw_scale": "0-1",
        }
    exact = None
    if alignment == "aligned":
        normalized_predictions = [_normalize_quality_text(text) for text in prediction_texts]
        normalized_references = [_normalize_quality_text(text) for text in reference_texts]
        matches = sum(
            1
            for prediction, ref in zip(normalized_predictions, normalized_references, strict=True)
            if prediction == ref
        )
        exact = _round(matches / len(normalized_references)) if normalized_references else None
    return {
        "reference_available": True,
        "reference_type": reference.get("reference_type"),
        "reference_alignment_status": alignment,
        "prediction_units": prediction_count,
        "reference_units": reference_count,
        "metric_input_unit": "text_sequence_v1",
        "bleu": bleu,
        "chrf": chrf,
        "exact_match_rate": exact,
        "metric_implementation": metric_info["metric_implementation"],
        "metric_version": metric_info["metric_version"],
        "metric_signature": metric_info["metric_signature"],
        "score_scale": "0-1",
        "normalization_profile": NORMALIZATION_PROFILE,
        "tokenizer": metric_info["tokenizer"],
        "case": metric_info["case"],
        "smooth": metric_info["smooth"],
        **raw,
    }


def _load_reference(path: Path) -> dict[str, Any]:
    suffix = path.suffix.lower()
    if suffix == ".srt":
        return {"reference_type": "srt", "texts": _load_srt_texts(path)}
    if suffix == ".txt":
        return {"reference_type": "txt", "texts": _load_txt_lines(path)}
    raise BenchTranslateError("Reference must be .srt or .txt.")


def _load_srt_texts(path: Path) -> list[str]:
    subs = pysubs2.load(str(path), encoding="utf-8", format_="srt")
    texts = [_normalize_subtitle_text(event.text) for event in subs.events]
    return [text for text in texts if text]


def _load_txt_lines(path: Path) -> list[str]:
    raw_lines = path.read_text(encoding="utf-8").splitlines()
    lines = [_normalize_subtitle_text(line) for line in raw_lines]
    return [line for line in lines if line]


def _reference_alignment_status(reference: dict[str, Any], *, prediction_count: int) -> str:
    if reference.get("reference_type") == "txt":
        return "aligned" if len(reference.get("texts") or []) == prediction_count else "corpus_only"
    if reference.get("reference_type") == "srt":
        if len(reference.get("texts") or []) == prediction_count:
            return "aligned"
        return "count_mismatch"
    return "invalid"


def _source_cue_count(path: Path) -> int:
    return len(_load_srt_texts(path))


def _validate_options(input_file: Path, options: BenchTranslateOptions) -> None:
    if not input_file.exists() or not input_file.is_file():
        raise BenchTranslateError(f"Input file does not exist: {input_file}")
    if input_file.suffix.lower() != ".srt":
        raise BenchTranslateError("bench-translate input must be an .srt file.")
    if options.provider not in TRANSLATION_PROVIDERS:
        raise BenchTranslateError(f"Unknown provider: {options.provider}")
    if options.target_language not in TARGET_LANGUAGES:
        raise BenchTranslateError("--to must be one of: en, zh, ja, ko.")
    if not options.reference.exists() or not options.reference.is_file():
        raise BenchTranslateError(f"Reference file does not exist: {options.reference}")
    if options.reference.suffix.lower() not in {".srt", ".txt"}:
        raise BenchTranslateError("Reference must be .srt or .txt.")
    if options.repeat <= 0:
        raise BenchTranslateError("--repeat must be greater than 0.")
    if options.batch_size <= 0:
        raise BenchTranslateError("--batch-size must be greater than 0.")
    if options.timeout <= 0:
        raise BenchTranslateError("--timeout must be greater than 0.")
    if options.sleep_seconds < 0:
        raise BenchTranslateError("--sleep-seconds must be greater than or equal to 0.")
    try:
        _load_srt_texts(input_file)
        _load_reference(options.reference)
    except BenchTranslateError:
        raise
    except Exception as exc:
        raise BenchTranslateError(f"Could not read subtitle/reference: {exc}") from exc


def _metric_info(target_language: str | None = None) -> dict[str, Any]:
    try:
        import sacrebleu  # type: ignore[import-not-found]
    except Exception:
        return {
            "metric_implementation": LIGHTWEIGHT_METRIC_IMPLEMENTATION,
            "metric_version": "1",
            "metric_signature": (
                "fast_sub_lightweight_v1;"
                "not_equivalent_to_sacrebleu;bleu=clipped_1_4gram_bp;chrf=char_6gram_beta2"
            ),
            "tokenizer": LIGHTWEIGHT_TOKENIZER,
            "case": "casefold",
            "smooth": "bleu_epsilon_1e-9;chrf_none",
        }
    bleu_tokenizer = _sacrebleu_tokenizer_for_target(target_language)
    try:
        bleu_metric = sacrebleu.metrics.BLEU()
        chrf_metric = sacrebleu.metrics.CHRF()
        version_text = getattr(sacrebleu, "__version__", "unknown")
        signature = (
            f"sacrebleu-{version_text};"
            "bleu="
            f"tok:{bleu_tokenizer}|"
            f"case:{'lc' if bleu_metric.lowercase else 'mixed'}|"
            f"smooth:{bleu_metric.smooth_method}|"
            f"eff:{'yes' if bleu_metric.effective_order else 'no'};"
            "chrf="
            f"char_order:{chrf_metric.char_order}|"
            f"word_order:{chrf_metric.word_order}|"
            f"beta:{chrf_metric.beta}|"
            f"case:{'lc' if chrf_metric.lowercase else 'mixed'}"
        )
    except Exception:
        version_text = getattr(sacrebleu, "__version__", "unknown")
        signature = f"sacrebleu-{version_text}"
    return {
        "metric_implementation": "sacrebleu",
        "metric_version": version_text,
        "metric_signature": signature,
        "tokenizer": bleu_tokenizer,
        "case": "mixed",
        "smooth": "bleu_exp;chrf_none",
    }


def _sacrebleu_tokenizer_for_target(target_language: str | None) -> str:
    if target_language == "zh":
        return "zh"
    if target_language in {"ja", "ko"}:
        return "char"
    return "13a"


def _score_sacrebleu(
    predictions: list[str],
    references: list[str],
    metric_info: dict[str, Any],
) -> tuple[float | None, float | None, dict[str, Any]]:
    try:
        import sacrebleu  # type: ignore[import-not-found]

        bleu_raw = sacrebleu.corpus_bleu(
            predictions,
            [references],
            tokenize=metric_info["tokenizer"],
        ).score
        chrf_raw = sacrebleu.corpus_chrf(predictions, [references]).score
    except Exception:
        return (
            None,
            None,
            {
                "bleu_raw_score": None,
                "bleu_raw_scale": "0-100",
                "chrf_raw_score": None,
                "chrf_raw_scale": "0-100",
            },
        )
    return (
        _round(bleu_raw / 100),
        _round(chrf_raw / 100),
        {
            "bleu_raw_score": _round(bleu_raw),
            "bleu_raw_scale": "0-100",
            "chrf_raw_score": _round(chrf_raw),
            "chrf_raw_scale": "0-100",
        },
    )


def _metric_corpus_sequences(
    predictions: list[str],
    references: list[str],
) -> tuple[list[str], list[str]]:
    if len(predictions) == len(references):
        return predictions, references
    return ["\n".join(predictions)], ["\n".join(references)]


def _lightweight_bleu_corpus(predictions: list[str], references: list[str]) -> float | None:
    return _lightweight_bleu("\n".join(predictions), "\n".join(references))


def _lightweight_chrf_corpus(predictions: list[str], references: list[str]) -> float | None:
    return _lightweight_chrf("\n".join(predictions), "\n".join(references))


def _lightweight_bleu(prediction: str, reference: str) -> float | None:
    pred_tokens = _quality_tokens(prediction)
    ref_tokens = _quality_tokens(reference)
    if not ref_tokens:
        return None
    if not pred_tokens:
        return 0.0
    precisions: list[float] = []
    for n in range(1, 5):
        pred_counts = _ngram_counts(pred_tokens, n)
        ref_counts = _ngram_counts(ref_tokens, n)
        if not pred_counts:
            precisions.append(0.0)
            continue
        clipped = sum(min(count, ref_counts.get(ngram, 0)) for ngram, count in pred_counts.items())
        precisions.append(clipped / sum(pred_counts.values()))
    smooth = 1e-9
    log_precision = sum(math.log(max(value, smooth)) for value in precisions) / 4
    if len(pred_tokens) > len(ref_tokens):
        bp = 1.0
    else:
        bp = math.exp(1 - len(ref_tokens) / len(pred_tokens))
    return _round(bp * math.exp(log_precision))


def _lightweight_chrf(
    prediction: str,
    reference: str,
    *,
    n: int = 6,
    beta: float = 2.0,
) -> float | None:
    pred = _normalize_quality_text(prediction).replace(" ", "")
    ref = _normalize_quality_text(reference).replace(" ", "")
    if not ref:
        return None
    if not pred:
        return 0.0
    scores = []
    for size in range(1, n + 1):
        pred_counts = _ngram_counts(list(pred), size)
        ref_counts = _ngram_counts(list(ref), size)
        if not pred_counts or not ref_counts:
            continue
        overlap = sum(min(count, ref_counts.get(ngram, 0)) for ngram, count in pred_counts.items())
        precision = overlap / sum(pred_counts.values())
        recall = overlap / sum(ref_counts.values())
        denom = beta * beta * precision + recall
        scores.append(((1 + beta * beta) * precision * recall / denom) if denom else 0.0)
    return _round(statistics.fmean(scores)) if scores else 0.0


def _quality_tokens(text: str) -> list[str]:
    normalized = _normalize_quality_text(text)
    if any(_is_cjk(char) for char in normalized):
        return [char for char in normalized if not char.isspace()]
    return normalized.split()


def _normalize_quality_text(text: str) -> str:
    normalized = _normalize_subtitle_text(text).casefold()
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def _normalize_subtitle_text(text: str) -> str:
    normalized = text.replace("\\N", "\n").replace("\r\n", "\n").replace("\r", "\n")
    normalized = re.sub(r"<[^>]+>", "", normalized)
    return "\n".join(line.strip() for line in normalized.splitlines() if line.strip())


def _ngram_counts(tokens: list[str], n: int) -> Counter[tuple[str, ...]]:
    return Counter(tuple(tokens[index : index + n]) for index in range(0, len(tokens) - n + 1))


def _is_cjk(char: str) -> bool:
    return (
        "\u4e00" <= char <= "\u9fff" or "\u3040" <= char <= "\u30ff" or "\uac00" <= char <= "\ud7af"
    )


def _null_quality(reference: dict[str, Any], metric_info: dict[str, Any]) -> dict[str, Any]:
    return {
        "reference_available": True,
        "reference_type": reference.get("reference_type"),
        "reference_alignment_status": "invalid",
        "prediction_units": None,
        "reference_units": len(reference.get("texts") or []),
        "metric_input_unit": "text_sequence_v1",
        "bleu": None,
        "chrf": None,
        "exact_match_rate": None,
        "metric_implementation": metric_info["metric_implementation"],
        "metric_version": metric_info["metric_version"],
        "metric_signature": metric_info["metric_signature"],
        "score_scale": "0-1",
        "normalization_profile": NORMALIZATION_PROFILE,
        "tokenizer": metric_info["tokenizer"],
        "case": metric_info["case"],
        "smooth": metric_info["smooth"],
    }


def _failed_run(
    index: int,
    exc: Exception,
    elapsed: float,
    *,
    errors_path: Path | None,
) -> dict[str, Any]:
    return {
        "index": index,
        "status": "failed",
        "reason": _redact_secrets(str(exc)),
        "error": {
            "code": getattr(exc, "code", exc.__class__.__name__),
            "message": _redact_secrets(str(exc)),
        },
        "elapsed_sec": elapsed,
        "chars_per_sec": None,
        "cues_per_sec": None,
        "failed_count": None,
        "warnings": [],
        "errors_path": errors_path.name if errors_path else None,
        "resume_used": False,
    }


def _default_output_dir(
    input_file: Path,
    *,
    target_language: str,
    provider: str,
    generated_at: str,
    config_hash: str,
) -> Path:
    stamp = generated_at.replace(":", "").replace("-", "").replace(".", "").replace("Z", "z")
    return (
        Path(".fast-sub")
        / "bench-translate"
        / f"{input_file.stem}-{target_language}-{provider}-{stamp}-{config_hash[:8]}"
    )


def _config_hash(options: BenchTranslateOptions, *, input_sha: str, reference_sha: str) -> str:
    payload = {
        "input_sha256": input_sha,
        "reference_sha256": reference_sha,
        "provider": options.provider,
        "source_language": options.source_language,
        "target_language": options.target_language,
        "model": options.model,
        "model_path": options.model_path.name if options.model_path else None,
        "batch_size": options.batch_size,
        "timeout": options.timeout,
        "sleep_seconds": options.sleep_seconds,
        "repeat": options.repeat,
        "resume": False,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


def _dependency_versions() -> dict[str, str | None]:
    names = ("pysubs2", "sacrebleu", "httpx")
    versions: dict[str, str | None] = {}
    for name in names:
        try:
            versions[name] = version(name)
        except PackageNotFoundError:
            versions[name] = None
    return versions


def _package_version() -> str:
    try:
        return version("fast-sub")
    except PackageNotFoundError:
        return "0.0.0+local"


def _provider_privacy(provider: str) -> dict[str, Any]:
    if provider in REMOTE_WEB_PROVIDERS:
        return {"provider_privacy_class": "remote-web", "uploads_text": True}
    if provider in REMOTE_API_PROVIDERS:
        return {"provider_privacy_class": "remote-api", "uploads_text": True}
    return {"provider_privacy_class": "local", "uploads_text": False}


def _redacted_command(
    command: list[str] | None,
    *,
    input_file: Path,
    reference: Path,
) -> str | None:
    if not command:
        return None
    path_options = {"--reference", "--output-dir", "--markdown-path", "--model-path"}
    secret_options = {"--api-key"}
    redacted: list[str] = []
    redact_path_next = False
    redact_secret_next = False
    for token in command:
        option, separator, value = token.partition("=")
        if redact_secret_next:
            redacted.append("[redacted]")
            redact_secret_next = False
            continue
        if redact_path_next:
            redacted.append(Path(token).name)
            redact_path_next = False
            continue
        if separator and option in secret_options:
            redacted.append(f"{option}=[redacted]")
        elif separator and option in path_options:
            redacted.append(f"{option}={Path(value).name}")
        elif token in secret_options:
            redacted.append(token)
            redact_secret_next = True
        elif token in path_options:
            redacted.append(token)
            redact_path_next = True
        elif token == str(input_file):
            redacted.append(input_file.name)
        elif token == str(reference):
            redacted.append(reference.name)
        else:
            redacted.append(_redact_secrets(token))
    return " ".join(redacted)


def _redact_value(value: Any) -> Any:
    if isinstance(value, str):
        return _redact_secrets(value)
    if isinstance(value, list):
        return [_redact_value(item) for item in value]
    if isinstance(value, dict):
        return {key: _redact_value(item) for key, item in value.items()}
    return value


def _redact_secrets(message: str) -> str:
    redacted = re.sub(r"sk-[A-Za-z0-9_-]{8,}", "sk-[redacted]", message)
    redacted = re.sub(r"(?i)(authorization:\s*bearer\s+)[^\s]+", r"\1[redacted]", redacted)
    redacted = re.sub(r"(?i)(api[_-]?key|token)=([^&\s]+)", r"\1=[redacted]", redacted)
    for name in ("OPENAI_API_KEY", "FAST_SUB_STT_API_KEY"):
        secret = os.getenv(name)
        if secret:
            redacted = redacted.replace(secret, "[redacted]")
    return redacted


def _collect_messages(report: dict[str, Any]) -> list[str]:
    messages: list[str] = []
    for run in report.get("runs", []):
        for warning in run.get("warnings") or []:
            messages.append(f"run {run.get('index')} warning: {warning}")
        if run.get("status") == "failed":
            messages.append(f"run {run.get('index')} error: {run.get('reason')}")
        if run.get("errors_path"):
            messages.append(f"run {run.get('index')} errors: {run.get('errors_path')}")
    return messages


def _stats_for(key: str, runs: list[dict[str, Any]]) -> dict[str, Any]:
    return _stats_values(key, _numbers(run.get(key) for run in runs))


def _stats_values(key: str, values: list[float]) -> dict[str, Any]:
    if len(values) > 1:
        stddev = _round(statistics.pstdev(values))
    elif values:
        stddev = 0.0
    else:
        stddev = None
    return {
        f"{key}_avg": _mean(values),
        f"{key}_min": _round(min(values)) if values else None,
        f"{key}_max": _round(max(values)) if values else None,
        f"{key}_stddev": stddev,
    }


def _mean(values: list[float]) -> float | None:
    return _round(statistics.fmean(values)) if values else None


def _rate(numerator: int | float, elapsed_sec: float) -> float | None:
    if elapsed_sec <= 0:
        return None
    return _round(numerator / elapsed_sec)


def _round(value: float) -> float:
    return round(float(value), 6)


def _number(value: Any) -> float | None:
    try:
        return None if value is None else float(value)
    except (TypeError, ValueError):
        return None


def _numbers(values: Iterable[Any]) -> list[float]:
    return [number for value in values if (number := _number(value)) is not None]


def _format_number(value: Any) -> str:
    number = _number(value)
    return "" if number is None else f"{number:.3f}"


def _format_seconds(value: Any) -> str:
    number = _number(value)
    return "" if number is None else f"{number:.3f}s"


def _summary_quad(summary: dict[str, Any], key: str) -> str:
    return "/".join(
        _format_number(summary.get(f"{key}_{suffix}")) for suffix in ("avg", "min", "max", "stddev")
    )
