from __future__ import annotations

import hashlib
import json
import os
import re
import time
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import httpx
import pysubs2

from fast_sub.model_manager import model_path, verify_model
from fast_sub.model_manifest import get_model
from fast_sub.models import BilingualOrder, Mode, Segment, TranslationError, TranslationResult
from fast_sub.subtitle import render_srt

DEFAULT_NLLB_MODEL_ID = "nllb-200-distilled-600m-ct2-int8"
TRANSLATION_PROVIDERS = {"web-bing", "web-google", "api-openai-chat", "local-nllb-ct2"}
LANGUAGES = {"auto", "en", "zh", "ja", "ko"}
TARGET_LANGUAGES = {"en", "zh", "ja", "ko"}
FLORES_CODES = {
    "en": "eng_Latn",
    "zh": "zho_Hans",
    "ja": "jpn_Jpan",
    "ko": "kor_Hang",
}


class TranslationProviderError(RuntimeError):
    def __init__(self, code: str, message: str, *, hint: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.hint = hint


@dataclass(frozen=True)
class TranslateOptions:
    provider: str
    source_language: str
    target_language: str
    mode: Mode = Mode.TRANSLATED
    bilingual_order: BilingualOrder = BilingualOrder.ORIGINAL_FIRST
    output: Path | None = None
    model: str | None = None
    model_path: Path | None = None
    batch_size: int = 8
    timeout: float = 60.0
    sleep_seconds: float = 0.0
    resume: bool = True
    api_key: str | None = None
    base_url: str = "https://api.openai.com/v1"


@dataclass(frozen=True)
class TranslateSrtResult:
    srt_path: Path
    provider: str
    source_language: str
    target_language: str
    mode: str
    cues_count: int
    translated_count: int
    failed_count: int
    errors_path: Path | None = None
    checkpoint_path: Path | None = None
    warnings: list[str] | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "srt_path": str(self.srt_path),
            "provider": self.provider,
            "source_language": self.source_language,
            "target_language": self.target_language,
            "mode": self.mode,
            "cues_count": self.cues_count,
            "translated_count": self.translated_count,
            "failed_count": self.failed_count,
            "errors_path": str(self.errors_path) if self.errors_path else None,
            "checkpoint_path": str(self.checkpoint_path) if self.checkpoint_path else None,
            "warnings": self.warnings or [],
        }


def translate_srt(input_file: Path, options: TranslateOptions) -> TranslateSrtResult:
    _validate_translate_options(options)
    if not input_file.exists() or not input_file.is_file():
        raise TranslationProviderError("invalid_input", f"Input file does not exist: {input_file}")

    output = options.output or input_file.with_name(
        f"{input_file.stem}.{options.target_language}.srt"
    )
    progress_path = Path(str(output) + ".translate-progress.json")
    errors_path = output.with_suffix(".errors.json")
    segments = read_srt_segments(input_file)
    if options.provider == "local-nllb-ct2" and options.source_language == "auto":
        detected_language = detect_subtitle_language(segments)
        if detected_language is None:
            raise TranslationProviderError(
                "invalid_options",
                (
                    "local-nllb-ct2 could not reliably detect the subtitle source "
                    "language; pass --from en|zh|ja|ko."
                ),
            )
        options = replace(options, source_language=detected_language)
    input_hash = sha256_file(input_file)
    fingerprint = _checkpoint_fingerprint(input_file, input_hash, options)
    checkpoint = _load_checkpoint(progress_path, fingerprint) if options.resume else {}

    translated_by_id: dict[int, str] = {
        int(key): str(value)
        for key, value in checkpoint.get("translations", {}).items()
        if str(key).isdigit()
    }
    errors: list[TranslationError] = []
    warnings: list[str] = []

    to_translate = [segment for segment in segments if segment.id not in translated_by_id]
    if to_translate:
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
                translated_by_id[segment.id] = segment.translation
                _write_checkpoint(progress_path, fingerprint, translated_by_id, errors)
    else:
        warnings.append("Reused all cue translations from checkpoint.")

    final_segments: list[Segment] = []
    for segment in segments:
        copy = segment.model_copy()
        copy.translation = translated_by_id.get(segment.id)
        if copy.translation is None and any(
            error.batch_start_id <= segment.id <= error.batch_end_id for error in errors
        ):
            copy.translation = copy.text
        final_segments.append(copy)

    failed_count = sum(1 for segment in final_segments if segment.id not in translated_by_id)
    translated_count = len(translated_by_id)
    if errors:
        write_translation_errors(
            errors_path,
            provider=options.provider,
            errors=errors,
            warnings=warnings,
        )
    if segments and translated_count == 0:
        if not errors:
            errors = [
                TranslationError(
                    batch_start_id=segments[0].id,
                    batch_end_id=segments[-1].id,
                    message="No cue was translated.",
                    raw_response=None,
                )
            ]
            write_translation_errors(errors_path, provider=options.provider, errors=errors)
        raise TranslationProviderError(
            "provider_failed",
            "All translation cues failed; no final SRT was written.",
            hint=f"See {errors_path} for per-cue errors.",
        )

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        render_srt(
            final_segments,
            mode=options.mode,
            bilingual_order=options.bilingual_order,
        ),
        encoding="utf-8",
    )
    return TranslateSrtResult(
        srt_path=output,
        provider=options.provider,
        source_language=options.source_language,
        target_language=options.target_language,
        mode=options.mode.value,
        cues_count=len(segments),
        translated_count=translated_count,
        failed_count=failed_count,
        errors_path=errors_path if errors else None,
        checkpoint_path=progress_path,
        warnings=warnings,
    )


def read_srt_segments(path: Path) -> list[Segment]:
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
    resolved_provider = provider or _legacy_translator_to_provider(translator)
    if resolved_provider in {"web-bing", "web-google"}:
        return _translate_web_segments(
            segments=segments,
            translator="bing" if resolved_provider == "web-bing" else "google",
            source_lang=source_lang,
            target_lang=target_lang,
            retries=retries,
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
    raise TranslationProviderError(
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
            errors.append(error)
        if sleep_seconds > 0:
            time.sleep(sleep_seconds)
    return TranslationResult(segments=translated, errors=errors)


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
    if not api_key:
        raise TranslationProviderError(
            "missing_api_key",
            "api-openai-chat requires an explicit API key via --api-key or OPENAI_API_KEY.",
        )
    if not model:
        raise TranslationProviderError(
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
    api_key: str,
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
    api_key: str,
    base_url: str,
    timeout: float,
) -> dict[int, str]:
    expected_ids = [segment.id for segment in batch]
    payload = {
        "model": model,
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
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    url = base_url.rstrip("/") + "/chat/completions"
    with httpx.Client(timeout=timeout) as client:
        response = client.post(url, headers=headers, json=payload)
        response.raise_for_status()
    data = response.json()
    content = data["choices"][0]["message"]["content"]
    return parse_chat_translations(content, expected_ids=expected_ids)


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
        raise TranslationProviderError(
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
        raise TranslationProviderError(
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
    errors: list[TranslationError] = []
    for batch in _chunks(translated, batch_size):
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
                segment.translation = processor.decode(tokens).strip()
                if not segment.translation:
                    raise ValueError("NLLB returned empty translation text.")
        except Exception as exc:
            for segment in batch:
                segment.translation = None
            errors.append(
                TranslationError(
                    batch_start_id=batch[0].id,
                    batch_end_id=batch[-1].id,
                    message=_sanitize_error(str(exc)),
                    raw_response=None,
                )
            )
    return TranslationResult(segments=translated, errors=errors)


def resolve_nllb_model_path(*, model: str | None, explicit_model_path: Path | None) -> Path:
    if explicit_model_path is not None:
        try:
            if explicit_model_path.exists() and explicit_model_path.is_dir():
                return explicit_model_path
        except OSError as exc:
            raise TranslationProviderError(
                "missing_model",
                f"Model path is inaccessible: {explicit_model_path} ({exc})",
            ) from exc
        raise TranslationProviderError(
            "missing_model",
            f"Model path does not exist: {explicit_model_path}",
        )

    model_id = model or DEFAULT_NLLB_MODEL_ID
    try:
        manifest = get_model(model_id)
    except KeyError as exc:
        raise TranslationProviderError("missing_model", str(exc)) from exc
    status = verify_model(manifest)
    if not status.installed:
        raise TranslationProviderError(
            "missing_model",
            f"missing_model: {status.message} Run `fast-sub models install {model_id}`.",
        )
    return model_path(manifest)


def flores_code(language: str) -> str:
    try:
        return FLORES_CODES[language]
    except KeyError as exc:
        raise TranslationProviderError(
            "invalid_options",
            f"Unsupported NLLB language: {language}",
        ) from exc


def write_translation_errors(
    path: Path,
    *,
    provider: str,
    errors: list[TranslationError],
    warnings: list[str] | None = None,
) -> None:
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
    if options.provider not in TRANSLATION_PROVIDERS:
        raise TranslationProviderError("invalid_provider", f"Unknown provider: {options.provider}")
    if options.source_language not in LANGUAGES:
        raise TranslationProviderError(
            "invalid_options",
            f"Unsupported source language: {options.source_language}",
        )
    if options.target_language not in TARGET_LANGUAGES:
        raise TranslationProviderError(
            "invalid_options",
            f"Unsupported target language: {options.target_language}",
        )
    if options.batch_size <= 0:
        raise TranslationProviderError("invalid_options", "--batch-size must be greater than 0.")
    if options.mode not in {Mode.TRANSLATED, Mode.BILINGUAL}:
        raise TranslationProviderError("invalid_options", "--mode must be replace or bilingual.")


def _translate_text(
    *,
    text: str,
    translator: str,
    from_language: str,
    to_language: str,
) -> str:
    os.environ.setdefault("translators_default_region", "EN")
    try:
        import translators as ts  # type: ignore[import-not-found]
    except ImportError as exc:
        raise TranslationProviderError(
            "missing_dependency",
            "Web translation requires the GPL-3.0 `translators` package. "
            "Install with `uv sync --extra web-translate` or accept the default dependency.",
        ) from exc
    return str(
        ts.translate_text(
            text,
            translator=translator,
            from_language=from_language,
            to_language=to_language,
        )
    )


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


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _chunks(items: list[Segment], size: int) -> list[list[Segment]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def _legacy_translator_to_provider(translator: str | None) -> str:
    if translator in {"bing", "web-bing", None}:
        return "web-bing"
    if translator in {"google", "web-google"}:
        return "web-google"
    return translator


def _find_sentencepiece_model(path: Path) -> Path:
    for name in ("sentencepiece.bpe.model", "spm.model", "tokenizer.model"):
        candidate = path / name
        if candidate.exists():
            return candidate
    raise TranslationProviderError(
        "missing_model",
        f"NLLB sentencepiece model is missing in {path}. "
        f"Run `fast-sub models install {DEFAULT_NLLB_MODEL_ID}`.",
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
