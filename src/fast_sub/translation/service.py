from __future__ import annotations

import hashlib
import json
import os
import re
import time
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import pysubs2

from fast_sub.clients.openai_chat import OpenAIChatClient
from fast_sub.clients.web_translation import WebTranslationClientError, translate_text
from fast_sub.model_store.manager import model_path, verify_model
from fast_sub.model_store.manifest import get_model
from fast_sub.subtitles.models import Mode, Segment
from fast_sub.subtitles.srt import render_srt
from fast_sub.translation import constants as translation_constants
from fast_sub.translation.errors import TranslationProviderError as _TranslationProviderError
from fast_sub.translation.language import detect_subtitle_language, flores_code
from fast_sub.translation.models import (
    TranslateOptions,
    TranslateSrtResult,
    TranslationError,
    TranslationResult,
)
from fast_sub.translation.parsing import parse_chat_translations as parse_chat_translations


@dataclass(frozen=True)
class _TranslatePaths:
    output: Path
    progress: Path
    errors: Path


def translate_srt(input_file: Path, options: TranslateOptions) -> TranslateSrtResult:
    """Translate an SRT file and write the translated subtitle output.

    The workflow validates options, loads cues, resumes checkpointed
    translations, calls the configured provider, and renders the final SRT file.
    """
    _validate_translate_options(options)
    if not input_file.exists() or not input_file.is_file():
        raise _TranslationProviderError("invalid_input", f"Input file does not exist: {input_file}")

    paths = _translate_paths(input_file, options)
    segments = read_srt_segments(input_file)
    options = _resolve_local_source_language(options, segments)
    input_hash = sha256_file(input_file)
    fingerprint = _checkpoint_fingerprint(input_file, input_hash, options)
    translated_by_id = _checkpoint_translations(paths.progress, fingerprint, resume=options.resume)
    errors: list[TranslationError] = []
    warnings: list[str] = []

    try:
        _translate_missing_segments(
            segments,
            options,
            translated_by_id=translated_by_id,
            errors=errors,
            warnings=warnings,
            progress_path=paths.progress,
            fingerprint=fingerprint,
            checkpoint_enabled=options.resume,
        )

        return _finish_translate_srt(
            segments,
            options,
            paths,
            translated_by_id=translated_by_id,
            errors=errors,
            warnings=warnings,
        )
    finally:
        if not options.resume:
            _remove_checkpoint(paths.progress)


def _translate_paths(input_file: Path, options: TranslateOptions) -> _TranslatePaths:
    output = options.output or input_file.with_name(
        f"{input_file.stem}.{options.target_language}.srt"
    )
    return _TranslatePaths(
        output=output,
        progress=Path(str(output) + ".translate-progress.json"),
        errors=output.with_suffix(".errors.json"),
    )


def _resolve_local_source_language(
    options: TranslateOptions,
    segments: list[Segment],
) -> TranslateOptions:
    if options.provider != "local-nllb-ct2" or options.source_language != "auto":
        return options

    detected_language = detect_subtitle_language(segments)
    if detected_language is None:
        raise _TranslationProviderError(
            "invalid_options",
            (
                "local-nllb-ct2 could not reliably detect the subtitle source "
                "language; pass --from en|zh|ja|ko."
            ),
        )
    return replace(options, source_language=detected_language)


def _checkpoint_translations(
    progress_path: Path,
    fingerprint: dict[str, Any],
    *,
    resume: bool,
) -> dict[int, str]:
    checkpoint = _load_checkpoint(progress_path, fingerprint) if resume else {}
    return {
        int(key): str(value)
        for key, value in checkpoint.get("translations", {}).items()
        if str(key).isdigit()
    }


def _translate_missing_segments(
    segments: list[Segment],
    options: TranslateOptions,
    *,
    translated_by_id: dict[int, str],
    errors: list[TranslationError],
    warnings: list[str],
    progress_path: Path,
    fingerprint: dict[str, Any],
    checkpoint_enabled: bool,
) -> None:
    to_translate = [segment for segment in segments if segment.id not in translated_by_id]
    if not to_translate:
        warnings.append("Reused all cue translations from checkpoint.")
        return

    result = translate_segments(
        segments=to_translate,
        provider=options.provider,
        source_lang=options.source_language,
        target_lang=options.target_language,
        model=options.model,
        model_path=options.model_path,
        batch_size=options.batch_size,
        timeout=options.timeout,
        sleep_seconds=options.sleep_seconds,
        api_key=options.api_key,
        base_url=options.base_url,
    )
    warnings.extend(getattr(result, "warnings", []))
    errors.extend(result.errors)
    for segment in result.segments:
        if segment.translation:
            translated_by_id[segment.id] = _target_text_only(segment.translation, segment.text)
            if checkpoint_enabled:
                _write_checkpoint(progress_path, fingerprint, translated_by_id, errors)


def _finish_translate_srt(
    segments: list[Segment],
    options: TranslateOptions,
    paths: _TranslatePaths,
    *,
    translated_by_id: dict[int, str],
    errors: list[TranslationError],
    warnings: list[str],
) -> TranslateSrtResult:
    final_segments = _final_segments(segments, translated_by_id, errors)
    failed_count = sum(1 for segment in final_segments if segment.id not in translated_by_id)
    translated_count = len(translated_by_id)
    if errors:
        write_translation_errors(
            paths.errors,
            provider=options.provider,
            errors=errors,
            warnings=warnings,
        )
    _raise_if_no_translation(segments, translated_count, errors, options, paths.errors)
    _write_translated_srt(paths.output, final_segments, options)
    return _translate_srt_result(
        paths,
        options,
        cues_count=len(segments),
        translated_count=translated_count,
        failed_count=failed_count,
        has_errors=bool(errors),
        warnings=warnings,
    )


def _final_segments(
    segments: list[Segment],
    translated_by_id: dict[int, str],
    errors: list[TranslationError],
) -> list[Segment]:
    final_segments: list[Segment] = []
    for segment in segments:
        copy = segment.model_copy()
        copy.translation = translated_by_id.get(segment.id)
        if copy.translation is None and _segment_has_error(segment.id, errors):
            copy.translation = copy.text
        final_segments.append(copy)
    return final_segments


def _target_text_only(translation: str, source_text: str) -> str:
    """Drop provider-echoed source text from a translated cue.

    Some OpenAI-compatible local models ignore the JSON-only prompt and put
    "source + translation" into the text field. The renderer decides whether
    to show bilingual subtitles; the provider translation field must contain
    target-language text only.
    """
    text = _normalize_text(translation)
    source = _normalize_text(source_text)
    if not text or not source:
        return text

    labeled = _translation_after_label(text)
    if labeled:
        text = labeled

    if text == source:
        return text
    if text.startswith(source):
        remainder = text[len(source) :]
        if not remainder[:1].isspace():
            return text
        remainder = re.sub(r"^[\s:：\-—–|/\\]+", "", remainder)
        labeled_remainder = _translation_after_label(remainder)
        if labeled_remainder:
            remainder = labeled_remainder
        remainder = remainder.strip()
        if remainder:
            return remainder
    return text


def _translation_after_label(text: str) -> str:
    matches = list(
        re.finditer(
            r"(?im)^\s*(?:translation|translated(?:\s+text)?|target|译文|翻译|目标译文)\s*[:：]\s*",
            text,
        )
    )
    if not matches:
        return ""
    return text[matches[-1].end() :].strip()


def _segment_has_error(segment_id: int, errors: list[TranslationError]) -> bool:
    return any(error.batch_start_id <= segment_id <= error.batch_end_id for error in errors)


def _raise_if_no_translation(
    segments: list[Segment],
    translated_count: int,
    errors: list[TranslationError],
    options: TranslateOptions,
    errors_path: Path,
) -> None:
    if not segments or translated_count > 0:
        return

    if not errors:
        errors.append(
            TranslationError(
                batch_start_id=segments[0].id,
                batch_end_id=segments[-1].id,
                message="No cue was translated.",
                raw_response=None,
            )
        )
        write_translation_errors(errors_path, provider=options.provider, errors=errors)
    first_error = _sanitize_error(errors[0].message).strip() if errors else ""
    detail = "All translation cues failed; no final SRT was written."
    if first_error:
        detail = f"{detail} First error: {first_error}"
    raise _TranslationProviderError(
        _all_failed_error_code(first_error),
        detail,
        hint=f"See {errors_path} for per-cue errors.",
    )


def _write_translated_srt(
    output: Path,
    segments: list[Segment],
    options: TranslateOptions,
) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        render_srt(
            segments,
            mode=options.mode,
            bilingual_order=options.bilingual_order,
        ),
        encoding="utf-8",
    )


def _translate_srt_result(
    paths: _TranslatePaths,
    options: TranslateOptions,
    *,
    cues_count: int,
    translated_count: int,
    failed_count: int,
    has_errors: bool,
    warnings: list[str],
) -> TranslateSrtResult:
    return TranslateSrtResult(
        srt_path=paths.output,
        provider=options.provider,
        source_language=options.source_language,
        target_language=options.target_language,
        mode=options.mode.value,
        cues_count=cues_count,
        translated_count=translated_count,
        failed_count=failed_count,
        errors_path=paths.errors if has_errors else None,
        checkpoint_path=paths.progress,
        warnings=warnings,
    )


def read_srt_segments(path: Path) -> list[Segment]:
    """Read an SRT file into normalized subtitle segments."""
    subs = pysubs2.load(str(path), encoding="utf-8", format_="srt")
    return [
        Segment(
            id=index,
            start=event.start / 1000,
            end=event.end / 1000,
            text=_normalize_text(event.text),
        )
        for index, event in enumerate(subs.events, start=1)
        if _normalize_text(event.text)
    ]


def translate_segments(
    *,
    segments: list[Segment],
    translator: str | None = None,
    provider: str | None = None,
    source_lang: str,
    target_lang: str,
    retries: int = 2,
    model: str | None = None,
    model_path: Path | None = None,
    batch_size: int = 8,
    timeout: float = 60.0,
    sleep_seconds: float = 0.0,
    api_key: str | None = None,
    base_url: str = "https://api.openai.com/v1",
) -> TranslationResult:
    """Translate subtitle segments with the selected translation provider."""
    resolved_provider = provider or _legacy_translator_to_provider(translator)
    if resolved_provider in {"web-bing", "web-google"}:
        return _translate_web_segments(
            segments=segments,
            translator="bing" if resolved_provider == "web-bing" else "google",
            source_lang=source_lang,
            target_lang=target_lang,
            retries=retries,
            timeout=timeout,
            sleep_seconds=sleep_seconds,
        )
    if resolved_provider == "api-openai-chat":
        return _translate_openai_chat_segments(
            segments=segments,
            source_lang=source_lang,
            target_lang=target_lang,
            model=model,
            api_key=api_key,
            base_url=base_url,
            batch_size=batch_size,
            timeout=timeout,
        )
    if resolved_provider == "local-nllb-ct2":
        return _translate_nllb_segments(
            segments=segments,
            source_lang=source_lang,
            target_lang=target_lang,
            model=model,
            explicit_model_path=model_path,
            batch_size=batch_size,
        )
    raise _TranslationProviderError(
        "invalid_provider",
        f"Unknown translation provider: {resolved_provider}",
    )


def _translate_web_segments(
    *,
    segments: list[Segment],
    translator: str,
    source_lang: str,
    target_lang: str,
    retries: int,
    timeout: float,
    sleep_seconds: float,
) -> TranslationResult:
    translated = [segment.model_copy() for segment in segments]
    errors: list[TranslationError] = []
    for segment in translated:
        error: TranslationError | None = None
        for _attempt in range(retries + 1):
            try:
                result = _translate_text(
                    text=segment.text,
                    translator=translator,
                    from_language=source_lang,
                    to_language=target_lang,
                    timeout=timeout,
                )
                segment.translation = str(result).strip()
                if not segment.translation:
                    raise ValueError("Translator returned empty text.")
                error = None
                break
            except Exception as exc:
                hint = " Try `--provider web-bing`." if translator == "google" else ""
                error = TranslationError(
                    batch_start_id=segment.id,
                    batch_end_id=segment.id,
                    message=f"{exc}{hint}",
                    raw_response=None,
                )
        if error is not None:
            errors.append(_friendly_web_error(error, translator))
        if sleep_seconds > 0:
            time.sleep(sleep_seconds)
    return TranslationResult(segments=translated, errors=errors)


def _friendly_web_error(error: TranslationError, translator: str) -> TranslationError:
    if translator != "google" or "--provider web-bing" not in error.message:
        return error
    return TranslationError(
        batch_start_id=error.batch_start_id,
        batch_end_id=error.batch_end_id,
        message=error.message.replace(
            " Try `--provider web-bing`.",
            " Try Bing web translation or local/API translation.",
        ),
        raw_response=error.raw_response,
    )


def _translate_openai_chat_segments(
    *,
    segments: list[Segment],
    source_lang: str,
    target_lang: str,
    model: str | None,
    api_key: str | None,
    base_url: str,
    batch_size: int,
    timeout: float,
) -> TranslationResult:
    if not model:
        raise _TranslationProviderError(
            "invalid_options",
            "api-openai-chat requires an explicit --model; fast-sub does not hard-code one.",
        )
    translated = [segment.model_copy() for segment in segments]
    by_id = {segment.id: segment for segment in translated}
    errors: list[TranslationError] = []
    for batch in _chunks(segments, batch_size):
        _translate_chat_batch_with_fallback(
            batch=batch,
            by_id=by_id,
            errors=errors,
            source_lang=source_lang,
            target_lang=target_lang,
            model=model,
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
        )
    return TranslationResult(segments=translated, errors=errors)


def _translate_chat_batch_with_fallback(
    *,
    batch: list[Segment],
    by_id: dict[int, Segment],
    errors: list[TranslationError],
    source_lang: str,
    target_lang: str,
    model: str,
    api_key: str | None,
    base_url: str,
    timeout: float,
) -> None:
    try:
        translations = _request_openai_chat_translation(
            batch,
            source_lang=source_lang,
            target_lang=target_lang,
            model=model,
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
        )
    except Exception as exc:
        if len(batch) > 1:
            midpoint = max(1, len(batch) // 2)
            _translate_chat_batch_with_fallback(
                batch=batch[:midpoint],
                by_id=by_id,
                errors=errors,
                source_lang=source_lang,
                target_lang=target_lang,
                model=model,
                api_key=api_key,
                base_url=base_url,
                timeout=timeout,
            )
            _translate_chat_batch_with_fallback(
                batch=batch[midpoint:],
                by_id=by_id,
                errors=errors,
                source_lang=source_lang,
                target_lang=target_lang,
                model=model,
                api_key=api_key,
                base_url=base_url,
                timeout=timeout,
            )
            return
        errors.append(
            TranslationError(
                batch_start_id=batch[0].id,
                batch_end_id=batch[-1].id,
                message=_sanitize_error(str(exc)),
                raw_response=None,
            )
        )
        return
    for cue_id, text in translations.items():
        by_id[cue_id].translation = text


def _request_openai_chat_translation(
    batch: list[Segment],
    *,
    source_lang: str,
    target_lang: str,
    model: str,
    api_key: str | None,
    base_url: str,
    timeout: float,
) -> dict[int, str]:
    client = OpenAIChatClient(
        model=model,
        api_key=api_key,
        base_url=base_url,
        timeout=timeout,
    )
    return client.translate_batch(batch, source_lang=source_lang, target_lang=target_lang)


def _translate_nllb_segments(
    *,
    segments: list[Segment],
    source_lang: str,
    target_lang: str,
    model: str | None,
    explicit_model_path: Path | None,
    batch_size: int,
) -> TranslationResult:
    if source_lang == "auto":
        raise _TranslationProviderError(
            "invalid_options",
            "local-nllb-ct2 requires explicit --from en|zh|ja|ko; --from auto is not reliable.",
        )
    resolved_model_path = resolve_nllb_model_path(
        model=model,
        explicit_model_path=explicit_model_path,
    )
    try:
        import ctranslate2  # type: ignore[import-not-found]
        import sentencepiece as spm  # type: ignore[import-not-found]
    except ImportError as exc:
        raise _TranslationProviderError(
            "missing_dependency",
            (
                "local-nllb-ct2 requires ctranslate2 and sentencepiece. "
                "Run `uv run --extra local-translate fast-sub ...` for one-off use, "
                "or `uv sync --extra local-translate` to install the local translation extra."
            ),
        ) from exc

    source_code = flores_code(source_lang)
    target_code = flores_code(target_lang)
    sp_model = _find_sentencepiece_model(resolved_model_path)
    processor = spm.SentencePieceProcessor(model_file=str(sp_model))
    translator = ctranslate2.Translator(str(resolved_model_path), device="auto")
    translated = [segment.model_copy() for segment in segments]
    by_id = {segment.id: segment for segment in translated}
    errors: list[TranslationError] = []
    for batch in _chunks(translated, batch_size):
        _translate_nllb_batch_with_fallback(
            batch=batch,
            by_id=by_id,
            errors=errors,
            source_code=source_code,
            target_code=target_code,
            processor=processor,
            translator=translator,
        )
    return TranslationResult(segments=translated, errors=errors)


def _translate_nllb_batch_with_fallback(
    *,
    batch: list[Segment],
    by_id: dict[int, Segment],
    errors: list[TranslationError],
    source_code: str,
    target_code: str,
    processor: Any,
    translator: Any,
) -> None:
    try:
        source_tokens = [
            [source_code, *processor.encode(segment.text, out_type=str), "</s>"]
            for segment in batch
        ]
        results = translator.translate_batch(
            source_tokens,
            target_prefix=[[target_code] for _ in batch],
            disable_unk=True,
        )
        if len(results) != len(batch):
            raise ValueError("NLLB returned a mismatched translation count.")
        for segment, result in zip(batch, results, strict=True):
            tokens = list(result.hypotheses[0])
            if tokens and tokens[0] == target_code:
                tokens = tokens[1:]
            translation = processor.decode(tokens).strip()
            if not translation:
                raise ValueError("NLLB returned empty translation text.")
            by_id[segment.id].translation = translation
    except Exception as exc:
        if len(batch) > 1:
            midpoint = max(1, len(batch) // 2)
            _translate_nllb_batch_with_fallback(
                batch=batch[:midpoint],
                by_id=by_id,
                errors=errors,
                source_code=source_code,
                target_code=target_code,
                processor=processor,
                translator=translator,
            )
            _translate_nllb_batch_with_fallback(
                batch=batch[midpoint:],
                by_id=by_id,
                errors=errors,
                source_code=source_code,
                target_code=target_code,
                processor=processor,
                translator=translator,
            )
            return
        by_id[batch[0].id].translation = None
        errors.append(
            TranslationError(
                batch_start_id=batch[0].id,
                batch_end_id=batch[-1].id,
                message=_sanitize_error(str(exc)),
                raw_response=None,
            )
        )


def resolve_nllb_model_path(*, model: str | None, explicit_model_path: Path | None) -> Path:
    """Resolve the local NLLB model directory or raise a provider error."""
    if explicit_model_path is not None:
        try:
            if explicit_model_path.exists() and explicit_model_path.is_dir():
                return explicit_model_path
        except OSError as exc:
            raise _TranslationProviderError(
                "missing_model",
                f"Model path is inaccessible: {explicit_model_path} ({exc})",
            ) from exc
        raise _TranslationProviderError(
            "missing_model",
            f"Model path does not exist: {explicit_model_path}",
        )

    model_id = model or translation_constants.DEFAULT_NLLB_MODEL_ID
    try:
        manifest = get_model(model_id)
    except KeyError as exc:
        raise _TranslationProviderError("missing_model", str(exc)) from exc
    status = verify_model(manifest)
    if not status.installed:
        raise _TranslationProviderError(
            "missing_model",
            f"missing_model: {status.message} Run `fast-sub models install {model_id}`.",
        )
    return model_path(manifest)


def write_translation_errors(
    path: Path,
    *,
    provider: str,
    errors: list[TranslationError],
    warnings: list[str] | None = None,
) -> None:
    """Write sanitized per-batch translation errors as JSON."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "provider": provider,
                "warnings": [_sanitize_error(warning) for warning in warnings or []],
                "errors": [
                    {
                        "batch_start_id": error.batch_start_id,
                        "batch_end_id": error.batch_end_id,
                        "message": _sanitize_error(error.message),
                    }
                    for error in errors
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def _validate_translate_options(options: TranslateOptions) -> None:
    if options.provider not in translation_constants.TRANSLATION_PROVIDERS:
        raise _TranslationProviderError("invalid_provider", f"Unknown provider: {options.provider}")
    if options.source_language not in translation_constants.LANGUAGES:
        raise _TranslationProviderError(
            "invalid_options",
            f"Unsupported source language: {options.source_language}",
        )
    if options.target_language not in translation_constants.TARGET_LANGUAGES:
        raise _TranslationProviderError(
            "invalid_options",
            f"Unsupported target language: {options.target_language}",
        )
    if options.batch_size <= 0:
        raise _TranslationProviderError("invalid_options", "--batch-size must be greater than 0.")
    if options.mode not in {Mode.TRANSLATED, Mode.BILINGUAL}:
        raise _TranslationProviderError("invalid_options", "--mode must be replace or bilingual.")


def _translate_text(
    *,
    text: str,
    translator: str,
    from_language: str,
    to_language: str,
    timeout: float | None = None,
) -> str:
    try:
        return translate_text(
            text=text,
            translator=translator,
            from_language=from_language,
            to_language=to_language,
            timeout=timeout,
        )
    except WebTranslationClientError as exc:
        code = getattr(exc, "code", "provider_failed")
        raise _TranslationProviderError(
            _web_client_error_code(code),
            str(exc),
        ) from exc


def _web_client_error_code(code: str) -> str:
    if code in {
        "missing_dependency",
        "missing_helper",
        "missing_node_runtime",
        "helper_start_failed",
    }:
        return "missing_dependency"
    if code == "invalid_input":
        return "invalid_input"
    return code or "provider_failed"


def _all_failed_error_code(first_error: str) -> str:
    lower = first_error.lower()
    if any(
        marker in lower
        for marker in (
            "missing_dependency",
            "missing helper",
            "helper is not configured",
            "helper runtime is missing",
            "helper file is missing",
            "web translation helper is unavailable",
            "web translation helper runtime is unavailable",
            "web translation helper could not start",
        )
    ):
        return "missing_dependency"
    if "invalid_input" in lower:
        return "invalid_input"
    return "provider_failed"


def _checkpoint_fingerprint(
    input_file: Path,
    input_hash: str,
    options: TranslateOptions,
) -> dict[str, Any]:
    return {
        "input_file": str(input_file.resolve()),
        "input_hash": input_hash,
        "provider": options.provider,
        "source_language": options.source_language,
        "target_language": options.target_language,
        "mode": options.mode.value,
        "bilingual_order": options.bilingual_order.value,
        "model": options.model,
        "model_path": str(options.model_path.resolve()) if options.model_path else None,
    }


def _load_checkpoint(path: Path, fingerprint: dict[str, Any]) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return {}
    return payload if payload.get("fingerprint") == fingerprint else {}


def _write_checkpoint(
    path: Path,
    fingerprint: dict[str, Any],
    translations: dict[int, str],
    errors: list[TranslationError],
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "fingerprint": fingerprint,
                "translations": {str(key): value for key, value in sorted(translations.items())},
                "errors": [
                    {
                        "batch_start_id": error.batch_start_id,
                        "batch_end_id": error.batch_end_id,
                        "message": _sanitize_error(error.message),
                    }
                    for error in errors
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def _remove_checkpoint(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        return
    except OSError:
        return


def sha256_file(path: Path) -> str:
    """Return the SHA-256 hex digest for a file."""
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _chunks(items: list[Segment], size: int) -> list[list[Segment]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def _legacy_translator_to_provider(translator: str | None) -> str:
    if translator is None or translator in {"bing", "web-bing"}:
        return "web-bing"
    if translator in {"google", "web-google"}:
        return "web-google"
    return translator


def _find_sentencepiece_model(path: Path) -> Path:
    for name in ("sentencepiece.bpe.model", "spm.model", "tokenizer.model"):
        candidate = path / name
        if candidate.exists():
            return candidate
    raise _TranslationProviderError(
        "missing_model",
        f"NLLB sentencepiece model is missing in {path}. "
        f"Run `fast-sub models install {translation_constants.DEFAULT_NLLB_MODEL_ID}`.",
    )


def _normalize_text(text: str) -> str:
    lines = text.replace("\\N", "\n").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    return "\n".join(line.strip() for line in lines if line.strip())


def _sanitize_error(message: str) -> str:
    redacted = re.sub(r"sk-[A-Za-z0-9_-]{8,}", "sk-[redacted]", message)
    redacted = re.sub(r"(?i)(authorization:\s*bearer\s+)[^\s]+", r"\1[redacted]", redacted)
    redacted = re.sub(r"(?i)(api[_-]?key|token)=([^&\s]+)", r"\1=[redacted]", redacted)
    secret = os.getenv("OPENAI_API_KEY")
    if secret:
        redacted = redacted.replace(secret, "[redacted]")
    return redacted
