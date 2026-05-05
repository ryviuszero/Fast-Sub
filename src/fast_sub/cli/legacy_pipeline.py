from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import TypeVar

import typer

from fast_sub.cli.constants import (
    DIRECTORY_PROGRESS_FILE,
    LANGUAGE_CODE_PATTERN,
    OPENAI_BASE_URL,
    OPENAI_DEFAULT_MAX_AUDIO_MB,
    OPENAI_DEFAULT_STT_MODEL,
    OPENAI_TRANSCRIBE_JSON_ONLY_MODELS,
    WHISPERX_DEFAULT_STT_MODEL,
)
from fast_sub.cli.helpers import console, err_console, redact_secrets, validate_positive
from fast_sub.config import AppConfig, load_config
from fast_sub.contracts.errors import ProviderResponseError, SubGenError
from fast_sub.infrastructure.ffmpeg import (
    ensure_media_tools,
    is_audio_file,
    is_media_file,
    list_media_files,
    prepare_audio,
)
from fast_sub.models import (
    BilingualOrder,
    Mode,
    SttProvider,
    SubtitleFormat,
    TranslationError,
    TranslationResult,
    WhisperXComputeType,
    WhisperXDevice,
)
from fast_sub.output.paths import default_output_path, job_dir
from fast_sub.stt.legacy import transcribe_segments, transcribe_segments_whisperx, transcribe_srt
from fast_sub.subtitles.srt import render_srt
from fast_sub.translation.service import translate_segments

T = TypeVar("T")


# Public entry points

def legacy_run(
    input_file: Path,
    output: Path | None,
    options: AppConfig,
    keep_temp: bool,
) -> None:
    """Run the legacy OpenAI-compatible/WhisperX subtitle pipeline."""
    try:
        _run_input(input_file=input_file, output=output, options=options, keep_temp=keep_temp)
    except SubGenError as exc:
        err_console.print(f"[red]Error:[/red] {redact_secrets(str(exc))}")
        raise typer.Exit(1) from exc


def resolve_legacy_options(
    *,
    config_path: Path | None,
    mode: Mode | None,
    original_only: bool,
    source_lang: str | None,
    target_lang: str | None,
    stt_base_url: str | None,
    stt_api_key: str | None,
    stt_provider: SttProvider | None,
    stt_model: str | None,
    stt_temperature: float | None,
    whisperx_device: WhisperXDevice | None,
    whisperx_compute_type: WhisperXComputeType | None,
    whisperx_batch_size: int | None,
    max_audio_mb: float | None,
    translator: str | None,
    subtitle_format: SubtitleFormat | None,
    max_line_chars: int | None,
    bilingual_order: BilingualOrder | None,
) -> AppConfig:
    """Resolve legacy config values from a config file plus CLI overrides."""
    options = load_config(config_path)
    options.stt.provider = _prefer(stt_provider, options.stt.provider)
    options.stt.base_url = _prefer(stt_base_url, options.stt.base_url)
    options.stt.api_key = _prefer(stt_api_key, options.stt.api_key)
    options.stt.model = _prefer(stt_model, options.stt.model)
    options.stt.temperature = _prefer(stt_temperature, options.stt.temperature)
    options.stt.whisperx_device = _prefer(whisperx_device, options.stt.whisperx_device)
    options.stt.whisperx_compute_type = _prefer(
        whisperx_compute_type,
        options.stt.whisperx_compute_type,
    )
    options.stt.whisperx_batch_size = _prefer(
        whisperx_batch_size,
        options.stt.whisperx_batch_size,
    )
    options.stt.max_audio_mb = _prefer(max_audio_mb, options.stt.max_audio_mb)
    options.translator.service = _prefer(translator, options.translator.service)
    options.subtitle.mode = Mode.ORIGINAL if original_only else _prefer(mode, options.subtitle.mode)
    options.subtitle.source_lang = _prefer(source_lang, options.subtitle.source_lang)
    options.subtitle.target_lang = _prefer(target_lang, options.subtitle.target_lang)
    options.subtitle.format = _prefer(subtitle_format, options.subtitle.format)
    options.subtitle.max_line_chars = _prefer(max_line_chars, options.subtitle.max_line_chars)
    options.subtitle.bilingual_order = _prefer(bilingual_order, options.subtitle.bilingual_order)
    _apply_openai_defaults(options)
    return options


# Input dispatch

def _run_input(
    input_file: Path,
    output: Path | None,
    options: AppConfig,
    keep_temp: bool,
) -> None:
    if input_file.is_dir():
        _run_directory(input_file, output, options, keep_temp)
        return
    _run_pipeline(input_file, output, options, keep_temp)


# Directory batch progress

def _run_directory(
    input_dir: Path,
    output_dir: Path | None,
    options: AppConfig,
    keep_temp: bool,
) -> None:
    _validate_directory_input(input_dir, output_dir, options)
    media_files = list_media_files(input_dir)
    if not media_files:
        raise SubGenError(f"No supported video or audio files found in: {input_dir}")

    if output_dir is not None:
        output_dir.mkdir(parents=True, exist_ok=True)

    progress_path = _directory_progress_path(input_dir, output_dir)
    progress = _load_directory_progress(progress_path)
    console.print(f"[cyan]Found {len(media_files)} media file(s). Progress:[/cyan] {progress_path}")

    failures: list[tuple[Path, str]] = []
    for index, media_file in enumerate(media_files, start=1):
        item_output = _directory_item_output_path(media_file, output_dir, options)
        if _is_directory_item_complete(media_file, item_output, progress):
            console.print(
                f"[green]Skipping completed:[/green] {media_file} ({index}/{len(media_files)})"
            )
            continue

        console.print(f"[cyan]Processing ({index}/{len(media_files)}):[/cyan] {media_file}")
        try:
            _run_pipeline(media_file, item_output, options, keep_temp)
            _mark_directory_item_complete(media_file, item_output, progress)
            _write_directory_progress(progress_path, progress)
            console.print(f"[green]Updated progress:[/green] {progress_path}")
        except SubGenError as exc:
            failures.append((media_file, str(exc)))
            console.print(f"[red]Failed:[/red] {media_file} - {exc}")

    if failures:
        raise SubGenError(
            f"Failed to generate subtitles for {len(failures)} of {len(media_files)} file(s)."
        )


def _directory_item_output_path(
    input_file: Path,
    output_dir: Path | None,
    options: AppConfig,
) -> Path:
    assert options.subtitle.mode is not None
    assert options.subtitle.source_lang is not None
    output_path = default_output_path(
        input_file,
        options.subtitle.mode,
        options.subtitle.source_lang,
        options.subtitle.target_lang,
    )
    if output_dir is None:
        return output_path
    return output_dir / output_path.name


def _directory_progress_path(input_dir: Path, output_dir: Path | None) -> Path:
    return (output_dir or input_dir) / DIRECTORY_PROGRESS_FILE


def _load_directory_progress(progress_path: Path) -> dict[str, object]:
    if not progress_path.exists():
        return {"version": 1, "completed": {}}
    try:
        content = json.loads(progress_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise SubGenError(f"Progress file is not valid JSON: {progress_path}") from exc
    if not isinstance(content, dict):
        raise SubGenError(f"Progress file has invalid shape: {progress_path}")
    completed = content.get("completed")
    if not isinstance(completed, dict):
        content["completed"] = {}
    content["version"] = 1
    return content


def _write_directory_progress(progress_path: Path, progress: dict[str, object]) -> None:
    progress_path.parent.mkdir(parents=True, exist_ok=True)
    progress_path.write_text(json.dumps(progress, ensure_ascii=False, indent=2), encoding="utf-8")


def _is_directory_item_complete(
    input_file: Path,
    output_path: Path,
    progress: dict[str, object],
) -> bool:
    completed = progress.get("completed", {})
    if not isinstance(completed, dict):
        return False
    entry = completed.get(_directory_item_key(input_file))
    if not isinstance(entry, dict):
        return False
    signature = _directory_item_signature(input_file)
    return (
        entry.get("size") == signature["size"]
        and entry.get("mtime_ns") == signature["mtime_ns"]
        and output_path.exists()
    )


def _mark_directory_item_complete(
    input_file: Path,
    output_path: Path,
    progress: dict[str, object],
) -> None:
    completed = progress.setdefault("completed", {})
    if not isinstance(completed, dict):
        completed = {}
        progress["completed"] = completed
    completed[_directory_item_key(input_file)] = {
        **_directory_item_signature(input_file),
        "output": str(output_path),
    }


def _directory_item_key(input_file: Path) -> str:
    return str(input_file.resolve())


def _directory_item_signature(input_file: Path) -> dict[str, int]:
    stat = input_file.stat()
    return {"size": stat.st_size, "mtime_ns": stat.st_mtime_ns}


# Pipeline execution

def _run_pipeline(
    input_file: Path,
    output: Path | None,
    options: AppConfig,
    keep_temp: bool,
) -> None:
    _validate_input(input_file, options)
    ensure_media_tools()

    mode = options.subtitle.mode
    source_lang = options.subtitle.source_lang
    target_lang = options.subtitle.target_lang
    assert mode is not None
    assert source_lang is not None

    out_path = output or default_output_path(input_file, mode, source_lang, target_lang)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    work_dir = job_dir(input_file)
    audio_path = work_dir / "audio.wav"
    work_dir.mkdir(parents=True, exist_ok=True)

    try:
        action = "Preparing audio input..." if is_audio_file(input_file) else "Extracting audio..."
        console.print(f"[cyan]{action}[/cyan]")
        prepare_audio(input_file, audio_path)
        if options.stt.max_audio_mb is not None:
            _validate_audio_size(audio_path, options.stt.max_audio_mb)

        if mode is Mode.ORIGINAL:
            _write_original(options, audio_path, out_path)
        else:
            _write_translated_or_bilingual(options, audio_path, out_path, work_dir)
        console.print(f"[green]Wrote subtitle:[/green] {out_path}")
    finally:
        if not keep_temp and work_dir.exists():
            shutil.rmtree(work_dir)


def _write_original(options: AppConfig, audio_path: Path, out_path: Path) -> None:
    assert options.subtitle.source_lang
    assert options.stt.model
    console.print("[cyan]Transcribing original subtitles...[/cyan]")
    if options.stt.provider is SttProvider.WHISPERX:
        segments = transcribe_segments_whisperx(
            audio=audio_path,
            model=options.stt.model,
            source_lang=options.subtitle.source_lang,
            device=options.stt.whisperx_device,
            compute_type=options.stt.whisperx_compute_type,
            batch_size=options.stt.whisperx_batch_size,
        )
        out_path.write_text(render_srt(segments, mode=Mode.ORIGINAL), encoding="utf-8")
        return

    assert options.stt.base_url and options.stt.api_key
    try:
        srt_text = transcribe_srt(
            audio=audio_path,
            base_url=options.stt.base_url,
            api_key=options.stt.api_key,
            model=options.stt.model,
            source_lang=options.subtitle.source_lang,
            temperature=options.stt.temperature,
        )
    except ProviderResponseError:
        console.print("[yellow]Direct SRT failed; falling back to verbose_json.[/yellow]")
        segments = transcribe_segments(
            audio=audio_path,
            base_url=options.stt.base_url,
            api_key=options.stt.api_key,
            model=options.stt.model,
            source_lang=options.subtitle.source_lang,
            temperature=options.stt.temperature,
        )
        srt_text = render_srt(segments, mode=Mode.ORIGINAL)
    out_path.write_text(srt_text, encoding="utf-8")


def _write_translated_or_bilingual(
    options: AppConfig,
    audio_path: Path,
    out_path: Path,
    work_dir: Path,
) -> None:
    assert options.stt.provider is SttProvider.OPENAI_COMPATIBLE
    assert options.stt.base_url and options.stt.api_key and options.stt.model
    assert options.subtitle.mode and options.subtitle.source_lang

    console.print("[cyan]Transcribing timestamped segments...[/cyan]")
    segments = transcribe_segments(
        audio=audio_path,
        base_url=options.stt.base_url,
        api_key=options.stt.api_key,
        model=options.stt.model,
        source_lang=options.subtitle.source_lang,
        temperature=options.stt.temperature,
    )
    (work_dir / "transcript.json").write_text(
        json.dumps([segment.model_dump() for segment in segments], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    console.print("[cyan]Translating subtitles...[/cyan]")
    result = translate_segments(
        segments=segments,
        translator=options.translator.service,
        source_lang=options.subtitle.source_lang,
        target_lang=options.subtitle.target_lang,
    )
    (work_dir / f"translation.{options.subtitle.target_lang}.json").write_text(
        json.dumps(
            [segment.model_dump() for segment in result.segments],
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    if result.errors:
        _write_translation_errors(result.errors, work_dir, out_path)
        if _all_translation_batches_failed(result):
            raise SubGenError(
                "All translation batches failed. See the generated .errors.json file "
                "for the provider response."
            )

    srt_text = render_srt(
        result.segments,
        mode=options.subtitle.mode,
        bilingual_order=options.subtitle.bilingual_order,
        max_line_chars=options.subtitle.max_line_chars,
    )
    out_path.write_text(srt_text, encoding="utf-8")

    if result.errors:
        console.print(
            f"[yellow]Translation completed with {len(result.errors)} failed batch(es).[/yellow]"
        )


def _write_translation_errors(
    errors: list[TranslationError],
    work_dir: Path,
    out_path: Path,
) -> None:
    error_text = json.dumps(
        [error.model_dump() for error in errors],
        ensure_ascii=False,
        indent=2,
    )
    (work_dir / "errors.json").write_text(error_text, encoding="utf-8")
    out_path.with_suffix(".errors.json").write_text(error_text, encoding="utf-8")


def _all_translation_batches_failed(result: TranslationResult) -> bool:
    return bool(result.errors) and all(not segment.translation for segment in result.segments)


# Validation

def _validate_input(input_file: Path, options: AppConfig) -> None:
    if not input_file.exists():
        raise SubGenError(f"Input file does not exist: {input_file}")
    if not input_file.is_file():
        raise SubGenError(f"Input path is not a file: {input_file}")
    if not is_media_file(input_file):
        raise SubGenError(f"Unsupported input file type: {input_file}")
    _validate_common_options(options)


def _validate_directory_input(
    input_dir: Path,
    output_dir: Path | None,
    options: AppConfig,
) -> None:
    if not input_dir.exists():
        raise SubGenError(f"Input directory does not exist: {input_dir}")
    if not input_dir.is_dir():
        raise SubGenError(f"Input path is not a directory: {input_dir}")
    if output_dir is not None and output_dir.exists() and not output_dir.is_dir():
        raise SubGenError("--output must be a directory when input is a directory.")
    _validate_common_options(options)


def _validate_common_options(options: AppConfig) -> None:
    if options.subtitle.format is not SubtitleFormat.SRT:
        raise SubGenError("v0.1 only supports --format srt.")
    _validate_url(options.stt.base_url, "--stt-base-url")
    _validate_language_code(options.subtitle.source_lang, "--source-lang")
    _validate_temperature(options.stt.temperature, "--stt-temperature", minimum=0, maximum=1)
    if options.stt.max_audio_mb is not None:
        validate_positive(options.stt.max_audio_mb, "--max-audio-mb")
    if options.subtitle.max_line_chars is not None:
        validate_positive(options.subtitle.max_line_chars, "--max-line-chars")
    validate_positive(options.stt.whisperx_batch_size, "--whisperx-batch-size")
    _require(options.subtitle.mode, "--mode")
    _require(options.subtitle.source_lang, "--source-lang")
    _require(options.stt.model, "--stt-model")
    if options.stt.provider is SttProvider.WHISPERX:
        if options.subtitle.mode is not Mode.ORIGINAL:
            raise SubGenError("WhisperX backend v0.1 only supports original subtitles.")
        return

    _validate_stt_model_support(options)
    _require(options.stt.base_url, "--stt-base-url")
    _require(options.stt.api_key, "--stt-api-key")
    if options.subtitle.mode in {Mode.TRANSLATED, Mode.BILINGUAL}:
        _validate_language_code(options.subtitle.target_lang, "--target-lang")
        _require(options.translator.service, "--translator")


def _require(value: object, option: str) -> None:
    if value is None or value == "":
        raise SubGenError(f"Missing required option: {option}")


def _validate_url(value: str | None, option: str) -> None:
    if value is None:
        return
    if not value.startswith(("http://", "https://")):
        raise SubGenError(f"{option} must start with http:// or https://")


def _validate_language_code(value: str | None, option: str) -> None:
    if value is None:
        return
    if option == "--source-lang" and value == "auto":
        return
    if LANGUAGE_CODE_PATTERN.fullmatch(value) is None:
        raise SubGenError(f"{option} must look like an ISO language code, for example en or zh.")


def _validate_temperature(value: float, option: str, *, minimum: float, maximum: float) -> None:
    if value < minimum or value > maximum:
        raise SubGenError(f"{option} must be between {minimum:g} and {maximum:g}.")


def _validate_audio_size(audio_path: Path, max_audio_mb: float) -> None:
    max_bytes = max_audio_mb * 1024 * 1024
    if audio_path.stat().st_size > max_bytes:
        raise SubGenError(
            f"Prepared audio is larger than {max_audio_mb:g} MB. "
            "OpenAI audio uploads are limited to 25 MB; v0.1 does not split long media yet."
        )


def _validate_stt_model_support(options: AppConfig) -> None:
    model = options.stt.model
    if model not in OPENAI_TRANSCRIBE_JSON_ONLY_MODELS:
        return
    raise SubGenError(
        f"{model} only supports response_format=json in OpenAI's transcription API. "
        "fast-sub v0.1 needs srt or verbose_json timestamps; use whisper-1 or a compatible "
        "provider/model that supports timestamped segments."
    )


# Defaults and tiny utilities

def _apply_openai_defaults(options: AppConfig) -> None:
    if options.stt.provider is SttProvider.WHISPERX:
        if options.stt.model is None:
            options.stt.model = WHISPERX_DEFAULT_STT_MODEL
        return

    if options.stt.base_url is None:
        options.stt.base_url = OPENAI_BASE_URL

    if _is_openai_base_url(options.stt.base_url):
        if options.stt.model is None:
            options.stt.model = OPENAI_DEFAULT_STT_MODEL
        if options.stt.max_audio_mb is None:
            options.stt.max_audio_mb = OPENAI_DEFAULT_MAX_AUDIO_MB


def _is_openai_base_url(value: str | None) -> bool:
    if value is None:
        return False
    normalized = value.rstrip("/").lower()
    return normalized in {"https://api.openai.com/v1", "https://api.openai.com"}


def _prefer(value: T | None, fallback: T) -> T:
    return fallback if value is None else value
