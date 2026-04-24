from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Annotated, TypeVar

import typer
from rich.console import Console

from sub_gen.config import AppConfig, load_config
from sub_gen.errors import ProviderResponseError, SubGenError
from sub_gen.media import ensure_media_tools, is_audio_file, prepare_audio
from sub_gen.models import BilingualOrder, Mode, SubtitleFormat, TranslationError, TranslationResult
from sub_gen.paths import default_output_path, job_dir
from sub_gen.stt import transcribe_segments, transcribe_srt
from sub_gen.subtitle import render_srt
from sub_gen.translate import translate_segments

console = Console()
T = TypeVar("T")
OPENAI_BASE_URL = "https://api.openai.com/v1"
OPENAI_DEFAULT_STT_MODEL = "whisper-1"
OPENAI_DEFAULT_MAX_AUDIO_MB = 25.0
OPENAI_TRANSCRIBE_JSON_ONLY_MODELS = {
    "gpt-4o-transcribe",
    "gpt-4o-mini-transcribe",
    "gpt-4o-transcribe-diarize",
}
LANGUAGE_CODE_PATTERN = re.compile(r"^[a-z]{2,3}(?:-[A-Za-z0-9]+)?$")


def main() -> None:
    typer.run(run)


def run(
    input_file: Annotated[Path, typer.Argument(help="Input video or audio path.")],
    mode: Annotated[Mode | None, typer.Option(help="Subtitle mode.")] = None,
    source_lang: Annotated[
        str | None, typer.Option(help="Source language, for example en.")
    ] = None,
    target_lang: Annotated[
        str | None, typer.Option(help="Target language. Defaults to en.")
    ] = None,
    stt_base_url: Annotated[
        str | None, typer.Option(help="OpenAI-compatible STT base URL.")
    ] = None,
    stt_api_key: Annotated[str | None, typer.Option(help="STT API key.")] = None,
    stt_model: Annotated[str | None, typer.Option(help="STT model name.")] = None,
    stt_temperature: Annotated[
        float | None,
        typer.Option(help="STT sampling temperature. OpenAI accepts 0 to 1."),
    ] = None,
    max_audio_mb: Annotated[
        float | None,
        typer.Option(help="Maximum prepared audio upload size in MB. OpenAI default is 25."),
    ] = None,
    translator: Annotated[
        str | None,
        typer.Option(help="translators service name, for example bing or alibaba."),
    ] = None,
    output: Annotated[Path | None, typer.Option(help="Output subtitle path.")] = None,
    subtitle_format: Annotated[
        SubtitleFormat | None, typer.Option("--format", help="Subtitle format. v0.1 supports srt.")
    ] = None,
    max_line_chars: Annotated[
        int | None, typer.Option(help="Soft maximum characters per subtitle line.")
    ] = None,
    bilingual_order: Annotated[
        BilingualOrder | None, typer.Option(help="Text order for bilingual subtitles.")
    ] = None,
    keep_temp: Annotated[bool, typer.Option(help="Keep temporary files.")] = False,
    config: Annotated[Path | None, typer.Option(help="TOML config file.")] = None,
) -> None:
    try:
        options = _resolve_options(
            config_path=config,
            mode=mode,
            source_lang=source_lang,
            target_lang=target_lang,
            stt_base_url=stt_base_url,
            stt_api_key=stt_api_key,
            stt_model=stt_model,
            stt_temperature=stt_temperature,
            max_audio_mb=max_audio_mb,
            translator=translator,
            subtitle_format=subtitle_format,
            max_line_chars=max_line_chars,
            bilingual_order=bilingual_order,
        )
        _run_pipeline(
            input_file=input_file,
            output=output,
            options=options,
            keep_temp=keep_temp,
        )
    except SubGenError as exc:
        console.print(f"[red]Error:[/red] {exc}")
        raise typer.Exit(1) from exc


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
    assert options.stt.base_url and options.stt.api_key and options.stt.model
    assert options.subtitle.source_lang
    console.print("[cyan]Transcribing original subtitles...[/cyan]")
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


def _resolve_options(
    *,
    config_path: Path | None,
    mode: Mode | None,
    source_lang: str | None,
    target_lang: str | None,
    stt_base_url: str | None,
    stt_api_key: str | None,
    stt_model: str | None,
    stt_temperature: float | None,
    max_audio_mb: float | None,
    translator: str | None,
    subtitle_format: SubtitleFormat | None,
    max_line_chars: int | None,
    bilingual_order: BilingualOrder | None,
) -> AppConfig:
    options = load_config(config_path)
    options.stt.base_url = _prefer(stt_base_url, options.stt.base_url)
    options.stt.api_key = _prefer(stt_api_key, options.stt.api_key)
    options.stt.model = _prefer(stt_model, options.stt.model)
    options.stt.temperature = _prefer(stt_temperature, options.stt.temperature)
    options.stt.max_audio_mb = _prefer(max_audio_mb, options.stt.max_audio_mb)
    options.translator.service = _prefer(translator, options.translator.service)
    options.subtitle.mode = _prefer(mode, options.subtitle.mode)
    options.subtitle.source_lang = _prefer(source_lang, options.subtitle.source_lang)
    options.subtitle.target_lang = _prefer(target_lang, options.subtitle.target_lang)
    options.subtitle.format = _prefer(subtitle_format, options.subtitle.format)
    options.subtitle.max_line_chars = _prefer(max_line_chars, options.subtitle.max_line_chars)
    options.subtitle.bilingual_order = _prefer(bilingual_order, options.subtitle.bilingual_order)
    _apply_openai_defaults(options)
    return options


def _validate_input(input_file: Path, options: AppConfig) -> None:
    if not input_file.exists():
        raise SubGenError(f"Input file does not exist: {input_file}")
    if not input_file.is_file():
        raise SubGenError(f"Input path is not a file: {input_file}")
    if options.subtitle.format is not SubtitleFormat.SRT:
        raise SubGenError("v0.1 only supports --format srt.")
    _validate_url(options.stt.base_url, "--stt-base-url")
    _validate_language_code(options.subtitle.source_lang, "--source-lang")
    _validate_temperature(options.stt.temperature, "--stt-temperature", minimum=0, maximum=1)
    if options.stt.max_audio_mb is not None:
        _validate_positive(options.stt.max_audio_mb, "--max-audio-mb")
    if options.subtitle.max_line_chars is not None:
        _validate_positive(options.subtitle.max_line_chars, "--max-line-chars")
    _validate_stt_model_support(options)
    _require(options.subtitle.mode, "--mode")
    _require(options.subtitle.source_lang, "--source-lang")
    _require(options.stt.base_url, "--stt-base-url")
    _require(options.stt.api_key, "--stt-api-key")
    _require(options.stt.model, "--stt-model")
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
        raise SubGenError(
            f"{option} must look like an ISO language code, for example en or zh."
        )


def _validate_temperature(value: float, option: str, *, minimum: float, maximum: float) -> None:
    if value < minimum or value > maximum:
        raise SubGenError(f"{option} must be between {minimum:g} and {maximum:g}.")


def _validate_positive(value: float | int, option: str) -> None:
    if value <= 0:
        raise SubGenError(f"{option} must be greater than 0.")


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
        "sub-gen v0.1 needs srt or verbose_json timestamps; use whisper-1 or a compatible "
        "provider/model that supports timestamped segments."
    )


def _apply_openai_defaults(options: AppConfig) -> None:
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
