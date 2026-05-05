from __future__ import annotations

import json
import os
import re
import shutil
import sys
import tomllib
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Annotated, Any, TypeVar

import typer

from fast_sub.benchmark.transcription import (
    BENCH_PROFILE_CHOICES,
    BenchError,
    BenchOptions,
    load_sample_metadata,
    render_brief_report,
    render_sample_manifest_schema,
    run_bench,
    sample_manifest_schema_payload,
)
from fast_sub.benchmark.translation import (
    BenchTranslateError,
    BenchTranslateOptions,
    render_translate_sample_manifest_schema,
    run_bench_translate,
    translate_sample_manifest_schema_payload,
)
from fast_sub.benchmark.translation import (
    render_markdown_report as render_translate_bench_markdown_report,
)
from fast_sub.cli.commands.media_cmd import register_media_commands
from fast_sub.cli.commands.models_cmd import models_app
from fast_sub.cli.commands.providers_cmd import providers_app
from fast_sub.cli.context import console, err_console
from fast_sub.cli.errors import (
    action_hint_for_message as _contract_action_hint_for_message,
)
from fast_sub.cli.errors import (
    classify_error_code as _contract_classify_error_code,
)
from fast_sub.cli.errors import (
    error_payload as _contract_error_payload,
)
from fast_sub.cli.errors import (
    exit_code_for_payload as _contract_exit_code_for_payload,
)
from fast_sub.cli.errors import (
    json_error_for_exception as _contract_json_error_for_exception,
)
from fast_sub.cli.redaction import (
    redact_secrets as _contract_redact_secrets,
)
from fast_sub.cli.redaction import (
    redact_value as _contract_redact_value,
)
from fast_sub.config import AppConfig, load_config, load_dotenv
from fast_sub.contracts.errors import ProviderResponseError, SubGenError, WorkerRunnerError
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
from fast_sub.pipeline.orchestrator import AutoOptions, AutoPipelineError, auto_media
from fast_sub.stt.constants import VALID_LANGUAGES
from fast_sub.stt.legacy import transcribe_segments, transcribe_segments_whisperx, transcribe_srt
from fast_sub.stt.service import (
    TranscribeOptions,
    transcribe_error_payload,
    transcribe_media,
)
from fast_sub.subtitles.srt import RefineOptions, refine_srt_text, render_srt
from fast_sub.translation.errors import TranslationProviderError
from fast_sub.translation.service import (
    TranslateOptions,
    translate_segments,
    translate_srt,
)

T = TypeVar("T")
app = typer.Typer(help="Fast local subtitles for video.", no_args_is_help=True)
COMMAND_NAMES = {
    "analyze",
    "auto",
    "bench",
    "bench-translate",
    "bench-translate-manifest",
    "bench-manifest",
    "burn",
    "doctor",
    "extract",
    "probe",
    "providers",
    "refine",
    "run",
    "models",
    "transcribe",
    "translate",
}
OPENAI_BASE_URL = "https://api.openai.com/v1"
OPENAI_DEFAULT_STT_MODEL = "whisper-1"
OPENAI_DEFAULT_MAX_AUDIO_MB = 25.0
WHISPERX_DEFAULT_STT_MODEL = "small"
OPENAI_TRANSCRIBE_JSON_ONLY_MODELS = {
    "gpt-4o-transcribe",
    "gpt-4o-mini-transcribe",
    "gpt-4o-transcribe-diarize",
}
LANGUAGE_CODE_PATTERN = re.compile(r"^[a-z]{2,3}(?:-[A-Za-z0-9]+)?$")
DIRECTORY_PROGRESS_FILE = ".fast-sub-progress.json"
app.add_typer(providers_app, name="providers")


def _package_version() -> str:
    try:
        return version("fast-sub")
    except PackageNotFoundError:
        return "0.0.0+local"


def _version_callback(value: bool) -> None:
    if not value:
        return
    typer.echo(_package_version())
    raise typer.Exit()


@app.callback()
def root_callback(
    version_flag: Annotated[
        bool,
        typer.Option(
            "--version",
            callback=_version_callback,
            is_eager=True,
            help="Print the fast-sub version.",
        ),
    ] = False,
) -> None:
    """Fast local subtitles for video."""
    del version_flag
    load_dotenv()


def main() -> None:
    load_dotenv()
    if _should_use_command_app(sys.argv[1:]):
        app()
        return
    typer.run(run)


def _should_use_command_app(args: list[str]) -> bool:
    if not args:
        return True
    first = args[0]
    return first in COMMAND_NAMES or first in {"--help", "-h", "--version"}


app.add_typer(models_app, name="models")
register_media_commands(app)


def _error_payload(
    *,
    code: str,
    stage: str,
    message: str,
    action_hint: str | None = None,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return _contract_error_payload(
        code=code,
        stage=stage,
        message=message,
        action_hint=action_hint,
        details=details,
    )


def _json_error_for_exception(exc: BaseException, *, stage: str, code: str) -> dict[str, Any]:
    return _contract_json_error_for_exception(exc, stage=stage, code=code)


def _exit_code_for_payload(payload: dict[str, Any]) -> int:
    return _contract_exit_code_for_payload(payload)


def _classify_error_code(message: str, *, fallback: str) -> str:
    return _contract_classify_error_code(message, fallback=fallback)


def _action_hint_for_message(message: str) -> str | None:
    return _contract_action_hint_for_message(message)


def _redact_value(value: Any) -> Any:
    return _contract_redact_value(value)


def _redact_secrets(message: str) -> str:
    return _contract_redact_secrets(message)


@app.command("bench-manifest")
def bench_manifest_command(
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Print machine-readable sample manifest schema."),
    ] = False,
) -> None:
    """Show the sample manifest fields consumed by `fast-sub bench`."""
    payload = sample_manifest_schema_payload()
    if json_output:
        typer.echo(json.dumps(payload, ensure_ascii=False, indent=2))
        return
    console.print(render_sample_manifest_schema())


@app.command("bench-translate-manifest")
def bench_translate_manifest_command(
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Print machine-readable translation manifest schema."),
    ] = False,
) -> None:
    """Show the manifest fields planned for `fast-sub bench-translate` matrices."""
    payload = translate_sample_manifest_schema_payload()
    if json_output:
        typer.echo(json.dumps(payload, ensure_ascii=False, indent=2))
        return
    console.print(render_translate_sample_manifest_schema())


@app.command("bench", context_settings={"allow_extra_args": True})
def bench_command(
    ctx: typer.Context,
    input_file: Annotated[Path, typer.Argument(help="Input video/audio file.")],
    provider: Annotated[
        str,
        typer.Option("--provider", help="STT provider id."),
    ] = "local-faster-whisper",
    model: Annotated[
        str,
        typer.Option("--model", help="ASR model id."),
    ] = "whisper-small",
    language: Annotated[
        str,
        typer.Option("--language", help="Language: auto, zh, en, ja, or ko."),
    ] = "auto",
    mode: Annotated[
        str,
        typer.Option("--mode", help="Transcription mode: fast, balanced, or quality."),
    ] = "balanced",
    repeat: Annotated[
        int,
        typer.Option("--repeat", help="Runs per benchmark profile."),
    ] = 1,
    profile: Annotated[
        str,
        typer.Option("--profile", help="Benchmark profile: all, cpu-int8, or auto."),
    ] = "all",
    gpu_load: Annotated[
        str,
        typer.Option("--gpu-load", help="GPU load profile: low, balanced, or max."),
    ] = "balanced",
    batch_size: Annotated[
        int | None,
        typer.Option("--batch-size", help="Worker batch size. Overrides --gpu-load."),
    ] = None,
    markdown: Annotated[
        bool,
        typer.Option("--markdown", help="Write a Markdown report to the default report path."),
    ] = False,
    markdown_path: Annotated[
        Path | None,
        typer.Option("--markdown-path", help="Write a Markdown report to this explicit path."),
    ] = None,
    sample_manifest: Annotated[
        Path | None,
        typer.Option(
            "--sample-manifest",
            help="Optional benchmark sample manifest JSON. See `fast-sub bench-manifest`.",
        ),
    ] = None,
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Print machine-readable JSON report."),
    ] = False,
) -> None:
    """Benchmark transcribe_media_v1 for local STT profiles."""
    resolved_sample_manifest = sample_manifest or _infer_bench_sample_manifest(input_file)
    resolved_language = language
    if language == "auto" and resolved_sample_manifest is not None:
        resolved_language = _infer_bench_language(
            resolved_sample_manifest,
            input_file=input_file,
        )
    resolved_markdown = _resolve_bench_markdown(
        ctx,
        markdown=markdown,
        markdown_path=markdown_path,
        input_file=input_file,
    )
    if markdown and resolved_markdown is None:
        resolved_markdown = _infer_bench_markdown_path(input_file)
    options = BenchOptions(
        provider=provider,
        model=model,
        language=resolved_language,
        mode=mode,
        repeat=repeat,
        profile=profile,
        gpu_load=gpu_load,
        batch_size=batch_size,
        markdown=resolved_markdown,
        sample_manifest=resolved_sample_manifest,
        sample_id=None,
        command=sys.argv[1:],
        progress=_bench_progress_logger(json_output=json_output),
    )
    try:
        _validate_bench_profile(profile)
        report = run_bench(input_file, options)
    except BenchError as exc:
        if json_output and exc.report is not None:
            typer.echo(json.dumps(exc.report, ensure_ascii=False, indent=2))
        elif json_output:
            typer.echo(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        else:
            err_console.print(f"[red]Error:[/red] {exc}")
        raise typer.Exit(1) from exc

    if json_output:
        typer.echo(json.dumps(report, ensure_ascii=False, indent=2))
        return
    console.print(render_brief_report(report))


def _validate_bench_profile(value: str) -> None:
    if value not in BENCH_PROFILE_CHOICES:
        supported = ", ".join(sorted(BENCH_PROFILE_CHOICES))
        raise BenchError(f"--profile must be one of: {supported}.")


def _resolve_bench_markdown(
    ctx: typer.Context,
    *,
    markdown: bool,
    markdown_path: Path | None,
    input_file: Path,
) -> Path | None:
    extras = list(ctx.args)
    if markdown_path is not None:
        if extras:
            raise typer.BadParameter(f"Unexpected extra argument: {extras[0]}")
        return markdown_path
    if markdown and len(extras) == 1:
        return Path(extras[0])
    if extras:
        raise typer.BadParameter(f"Unexpected extra argument: {extras[0]}")
    if markdown:
        return _infer_bench_markdown_path(input_file)
    return None


def _infer_bench_sample_manifest(input_file: Path) -> Path | None:
    normalized = input_file.as_posix()
    if "/local_tests/media/light/" in normalized or normalized.startswith(
        "local_tests/media/light/"
    ):
        return Path("local_tests/manifests/benchmark-assets-light.json")
    if "/local_tests/media/" in normalized or normalized.startswith("local_tests/media/"):
        return Path("local_tests/manifests/benchmark-assets.json")
    return None


def _infer_bench_markdown_path(input_file: Path) -> Path:
    sample_id = input_file.stem
    normalized = input_file.as_posix()
    if "/local_tests/media/light/" in normalized or normalized.startswith(
        "local_tests/media/light/"
    ):
        return Path("local_tests/reports/light") / f"{sample_id}.md"
    if "/local_tests/media/" in normalized or normalized.startswith("local_tests/media/"):
        return Path("local_tests/reports") / f"{sample_id}.md"
    return Path("local_tests/reports") / f"{sample_id}.md"


def _infer_bench_language(
    manifest_path: Path,
    *,
    input_file: Path,
) -> str:
    try:
        sample = load_sample_metadata(
            manifest_path,
            sample_id=None,
            input_file=input_file,
        )
    except BenchError:
        return "auto"
    language = sample.get("language")
    return language if isinstance(language, str) and language in VALID_LANGUAGES else "auto"


def _bench_progress_logger(*, json_output: bool):  # noqa: ANN202
    console_target = err_console if json_output else console

    def log(event: str, **payload: Any) -> None:
        profile = payload.get("profile")
        name = getattr(profile, "name", "unknown")
        if event == "profile_start":
            console_target.print(
                f"[cyan]Benchmark profile[/cyan] {name} ({payload.get('repeat')} run(s))"
            )
            return
        if event == "run_start":
            console_target.print(
                f"  [cyan]Run[/cyan] {payload.get('index')}/{payload.get('repeat')} started"
            )
            return
        if event == "run_done":
            run = payload.get("run", {})
            if run.get("status") == "ok":
                parts = [
                    f"elapsed={_format_progress_number(run.get('elapsed_sec'))}s",
                    f"rtfx={_format_progress_number(run.get('rtfx_e2e'))}",
                ]
                quality = run.get("quality") or {}
                cer = _format_progress_number(quality.get("cer"))
                wer = _format_progress_number(quality.get("wer"))
                if cer:
                    parts.append(f"cer={cer}")
                if wer:
                    parts.append(f"wer={wer}")
                console_target.print("  [green]Done[/green] " + " ".join(parts))
            else:
                console_target.print(f"  [red]Failed[/red] {run.get('reason') or 'unknown error'}")
            return
        if event == "profile_done":
            summary = payload.get("summary", {})
            console_target.print(
                f"[green]Profile complete[/green] {name}: "
                f"ok={summary.get('ok_runs', 0)}/{summary.get('runs', 0)} "
                f"avg_rtfx={_format_progress_number(summary.get('rtfx_e2e_avg'))}"
            )

    return log


def _format_progress_number(value: Any) -> str:
    try:
        return "" if value is None else f"{float(value):.3f}"
    except (TypeError, ValueError):
        return ""


@app.command("bench-translate")
def bench_translate_command(
    input_file: Annotated[Path, typer.Argument(help="Input source SRT file.")],
    reference: Annotated[
        Path | None,
        typer.Option("--reference", help="Target-language reference .srt or .txt path."),
    ] = None,
    provider: Annotated[
        str | None,
        typer.Option("--provider", help="Translation provider id."),
    ] = None,
    source_lang: Annotated[
        str,
        typer.Option("--from", help="Source language: auto, en, zh, ja, ko."),
    ] = "auto",
    target_lang: Annotated[
        str | None,
        typer.Option("--to", help="Target language: en, zh, ja, ko."),
    ] = None,
    output_dir: Annotated[
        Path | None,
        typer.Option("--output-dir", help="Benchmark output directory."),
    ] = None,
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Print machine-readable JSON report."),
    ] = False,
    markdown: Annotated[
        bool,
        typer.Option("--markdown", help="Write a Markdown report."),
    ] = False,
    markdown_path: Annotated[
        Path | None,
        typer.Option("--markdown-path", help="Write Markdown report to this path."),
    ] = None,
    repeat: Annotated[
        int,
        typer.Option("--repeat", help="Number of benchmark repeats."),
    ] = 1,
    model: Annotated[
        str | None,
        typer.Option("--model", help="Provider model id or local model manifest id."),
    ] = None,
    model_path_option: Annotated[
        Path | None,
        typer.Option("--model-path", help="Local provider model directory."),
    ] = None,
    batch_size: Annotated[
        int | None,
        typer.Option("--batch-size", help="Translation batch size."),
    ] = None,
    timeout: Annotated[
        float | None,
        typer.Option("--timeout", help="Provider timeout in seconds."),
    ] = None,
    sleep_seconds: Annotated[
        float | None,
        typer.Option("--sleep-seconds", help="Sleep between web translation cue calls."),
    ] = None,
    api_key: Annotated[
        str | None,
        typer.Option("--api-key", help="API key for api-openai-chat."),
    ] = None,
    base_url: Annotated[
        str | None,
        typer.Option("--base-url", help="OpenAI-compatible base URL."),
    ] = None,
    config_path: Annotated[
        Path | None,
        typer.Option("--config", help="Optional TOML config path."),
    ] = None,
) -> None:
    """Benchmark source SRT -> translate_srt_v1 -> target SRT quality."""
    try:
        try:
            config = load_config(config_path)
        except (FileNotFoundError, OSError, tomllib.TOMLDecodeError, ValueError) as exc:
            raise BenchTranslateError(f"Could not read config: {exc}") from exc
        resolved_provider = provider or config.translator.provider
        if resolved_provider is None:
            raise BenchTranslateError(
                "Missing required option: --provider. Remote providers are never selected silently."
            )
        if target_lang is None:
            raise BenchTranslateError("Missing required option: --to.")
        if reference is None:
            raise BenchTranslateError("Missing required option: --reference.")
        if resolved_provider in {"web-bing", "web-google"} and not json_output:
            err_console.print(
                "[yellow]Privacy:[/yellow] subtitle text will be sent to a third-party web "
                "translation service for this benchmark."
            )
        if resolved_provider == "api-openai-chat" and not json_output:
            err_console.print(
                "[yellow]Privacy:[/yellow] subtitle text will be sent to the configured "
                "OpenAI-compatible API for this benchmark."
            )
        resolved_model = _resolve_bench_translate_model(
            provider=resolved_provider,
            cli_model=model,
            config_model=config.translator.model,
            config_provider=config.translator.provider,
        )
        resolved_model_path = model_path_option or (
            Path(config.translator.model_path) if config.translator.model_path else None
        )
        resolved_api_key = api_key or os.getenv(config.translator.api_key_env)
        resolved_base_url = base_url or config.translator.base_url or OPENAI_BASE_URL
        if resolved_provider == "api-openai-chat":
            if not resolved_model:
                raise BenchTranslateError(
                    "api-openai-chat requires --model or OPENAI_MODEL for bench-translate."
                )
            if not resolved_api_key:
                raise BenchTranslateError(
                    "api-openai-chat requires --api-key or OPENAI_API_KEY for bench-translate."
                )
        report = run_bench_translate(
            input_file,
            BenchTranslateOptions(
                reference=reference,
                provider=resolved_provider,
                source_language=source_lang,
                target_language=target_lang,
                output_dir=output_dir,
                markdown=markdown,
                markdown_path=markdown_path,
                repeat=repeat,
                model=resolved_model,
                model_path=resolved_model_path,
                batch_size=batch_size if batch_size is not None else config.translator.batch_size,
                timeout=timeout if timeout is not None else config.translator.timeout,
                sleep_seconds=sleep_seconds
                if sleep_seconds is not None
                else config.translator.sleep_seconds,
                api_key=resolved_api_key,
                base_url=resolved_base_url,
                command=sys.argv[1:],
            ),
        )
    except BenchTranslateError as exc:
        if exc.report is not None:
            if json_output:
                typer.echo(json.dumps(exc.report, ensure_ascii=False, indent=2))
            else:
                err_console.print(f"[red]Error:[/red] {_redact_secrets(str(exc))}")
                console.print(render_translate_bench_markdown_report(exc.report))
            raise typer.Exit(_bench_translate_report_exit_code(exc.report)) from exc
        payload = _bench_translate_error_payload(exc)
        if json_output:
            typer.echo(json.dumps(payload, ensure_ascii=False))
        else:
            err_console.print(f"[red]Error:[/red] {_redact_secrets(str(exc))}")
        raise typer.Exit(2) from exc

    if json_output:
        typer.echo(json.dumps(report, ensure_ascii=False, indent=2))
        return
    console.print(render_translate_bench_markdown_report(report))


def _bench_translate_error_payload(exc: BenchTranslateError) -> dict[str, Any]:
    message = str(exc)
    lower = message.lower()
    code = "invalid_options"
    if "unknown provider" in lower:
        code = "invalid_provider"
    elif "input file does not exist" in lower or "reference file does not exist" in lower:
        code = "invalid_input"
    elif "could not read" in lower or "must be .srt" in lower or "must be .txt" in lower:
        code = "invalid_input"
    return _error_payload(code=code, stage="bench-translate", message=message)


def _bench_translate_report_exit_code(report: dict[str, Any]) -> int:
    codes = {
        str((run.get("error") or {}).get("code", "")).lower()
        for run in report.get("runs", [])
        if isinstance(run, dict)
    }
    if codes & {"invalid_input", "invalid_options", "invalid_provider"}:
        return 2
    if codes & {"missing_dependency"}:
        return 3
    if codes & {"missing_model", "model_not_found"}:
        return 4
    return 1


def _resolve_bench_translate_model(
    *,
    provider: str,
    cli_model: str | None,
    config_model: str | None,
    config_provider: str | None,
) -> str | None:
    if cli_model:
        return cli_model
    if config_model and config_provider in {None, provider}:
        return config_model
    if provider == "api-openai-chat":
        return os.getenv("OPENAI_MODEL")
    return None


@app.command("transcribe")
def transcribe_command(
    input_file: Annotated[Path, typer.Argument(help="Input video/audio file.")],
    provider: Annotated[
        str,
        typer.Option("--provider", help="STT provider id."),
    ] = "local-faster-whisper",
    model: Annotated[
        str,
        typer.Option("--model", help="ASR model id."),
    ] = "whisper-small",
    language: Annotated[
        str,
        typer.Option("--language", help="Language: auto, zh, en, ja, or ko."),
    ] = "auto",
    device: Annotated[
        str,
        typer.Option("--device", help="Worker device: auto, cuda, or cpu."),
    ] = "auto",
    compute: Annotated[
        str,
        typer.Option("--compute", help="Worker compute type."),
    ] = "auto",
    batch_size: Annotated[
        int | None,
        typer.Option("--batch-size", help="Worker batch size. Overrides --gpu-load."),
    ] = None,
    gpu_load: Annotated[
        str,
        typer.Option("--gpu-load", help="GPU load profile: low, balanced, or max."),
    ] = "balanced",
    vad: Annotated[
        str,
        typer.Option("--vad", help="VAD mode: auto, off, normal, or aggressive."),
    ] = "auto",
    mode: Annotated[
        str,
        typer.Option("--mode", help="Transcription mode: fast, balanced, or quality."),
    ] = "balanced",
    output: Annotated[
        Path | None,
        typer.Option("--output", "-o", help="Output .srt path."),
    ] = None,
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Print machine-readable result metadata."),
    ] = False,
    keep_temp: Annotated[
        bool,
        typer.Option("--keep-temp", help="Keep prepared audio and worker JSON files."),
    ] = False,
) -> None:
    """Transcribe media into source-language subtitles."""
    try:
        result = transcribe_media(
            input_file,
            TranscribeOptions(
                provider=provider,
                model=model,
                language=language,
                device=device,
                compute_type=compute,
                batch_size=batch_size,
                gpu_load=gpu_load,
                vad=vad,
                mode=mode,
                output=output,
                keep_temp=keep_temp,
            ),
        )
    except (SubGenError, WorkerRunnerError) as exc:
        payload = transcribe_error_payload(exc)
        if json_output:
            typer.echo(json.dumps(_redact_value(payload), ensure_ascii=False))
        else:
            err_console.print(f"[red]Error:[/red] {_redact_secrets(str(exc))}")
        raise typer.Exit(_exit_code_for_payload(payload)) from exc

    if json_output:
        typer.echo(json.dumps(result.as_dict(), ensure_ascii=False, indent=2))
        return
    err_console.print(f"[green]Wrote subtitle:[/green] {result.srt_path}")
    if result.warnings:
        err_console.print(f"[yellow]warnings:[/yellow] {len(result.warnings)}")


@app.command("auto")
def auto_command(
    input_file: Annotated[Path, typer.Argument(help="Input video/audio file.")],
    provider: Annotated[
        str,
        typer.Option("--provider", help="STT provider id."),
    ] = "local-faster-whisper",
    model: Annotated[
        str,
        typer.Option("--model", help="ASR model id."),
    ] = "whisper-small",
    language: Annotated[
        str,
        typer.Option("--language", help="Language: auto, zh, en, ja, or ko."),
    ] = "auto",
    device: Annotated[
        str,
        typer.Option("--device", help="Worker device: auto, cuda, or cpu."),
    ] = "auto",
    compute: Annotated[
        str,
        typer.Option("--compute", help="Worker compute type."),
    ] = "auto",
    batch_size: Annotated[
        int | None,
        typer.Option("--batch-size", help="Worker batch size. Overrides --gpu-load."),
    ] = None,
    gpu_load: Annotated[
        str,
        typer.Option("--gpu-load", help="GPU load profile: low, balanced, or max."),
    ] = "balanced",
    vad: Annotated[
        str,
        typer.Option("--vad", help="VAD mode: auto, off, normal, or aggressive."),
    ] = "auto",
    mode: Annotated[
        str,
        typer.Option("--mode", help="Transcription mode: fast, balanced, or quality."),
    ] = "balanced",
    output: Annotated[
        Path | None,
        typer.Option("--output", "-o", help="Final output .srt path."),
    ] = None,
    dry_run: Annotated[
        bool,
        typer.Option("--dry-run", help="Print the auto plan without downloading or transcribing."),
    ] = False,
    yes: Annotated[
        bool,
        typer.Option("--yes", "-y", help="Allow automatic local model installation."),
    ] = False,
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Print machine-readable result metadata."),
    ] = False,
    keep_temp: Annotated[
        bool,
        typer.Option("--keep-temp", help="Keep prepared audio and worker JSON files."),
    ] = False,
) -> None:
    """Plan and run the local subtitle pipeline."""
    _run_auto_entry(
        input_file=input_file,
        provider=provider,
        model=model,
        language=language,
        device=device,
        compute=compute,
        batch_size=batch_size,
        gpu_load=gpu_load,
        vad=vad,
        mode=mode,
        output=output,
        dry_run=dry_run,
        yes=yes,
        json_output=json_output,
        keep_temp=keep_temp,
    )


def _run_auto_entry(
    *,
    input_file: Path,
    provider: str,
    model: str,
    language: str,
    device: str,
    compute: str,
    batch_size: int | None,
    gpu_load: str,
    vad: str,
    mode: str,
    output: Path | None,
    dry_run: bool,
    yes: bool,
    json_output: bool,
    keep_temp: bool,
) -> None:
    try:
        result = auto_media(
            input_file,
            AutoOptions(
                provider=provider,
                model=model,
                language=language,
                device=device,
                compute_type=compute,
                batch_size=batch_size,
                gpu_load=gpu_load,
                vad=vad,
                mode=mode,
                output=output,
                dry_run=dry_run,
                yes=yes,
                keep_temp=keep_temp,
            ),
        )
    except AutoPipelineError as exc:
        if json_output:
            typer.echo(json.dumps(exc.result.as_dict(), ensure_ascii=False, indent=2))
        else:
            _print_auto_result(exc.result)
            err_console.print(f"[red]Error:[/red] {_redact_secrets(str(exc))}")
        raise typer.Exit(_auto_exit_code(exc.result)) from exc

    if json_output:
        typer.echo(json.dumps(result.as_dict(), ensure_ascii=False, indent=2))
        return
    _print_auto_result(result)


def _auto_exit_code(result: Any) -> int:
    statuses = {getattr(step, "status", "") for step in result.steps}
    names = {getattr(step, "name", "") for step in result.steps}
    if "missing_model" in statuses:
        return 4
    if "missing_dependency" in statuses:
        return 3
    if "input" in names:
        input_step = next((step for step in result.steps if step.name == "input"), None)
        if input_step is not None and input_step.status != "ok":
            return 2
    error = result.error or ""
    payload = _json_error_for_exception(SubGenError(error), stage="auto", code="command_failed")
    return _exit_code_for_payload(payload)


def _print_auto_result(result: Any) -> None:
    console.print("[bold]Fast Sub auto[/bold]")
    for step in result.steps:
        color = _auto_step_color(step.status)
        console.print(f"[{color}]{step.name}:[/{color}] {step.status} - {step.message}")
        if step.action_hint:
            console.print(f"  hint: {step.action_hint}")
    if result.ok and not result.dry_run:
        console.print(f"[green]Wrote subtitle:[/green] {result.output}")
    elif result.ok:
        console.print(f"[cyan]Dry run only:[/cyan] planned output {result.output}")


def _auto_step_color(status: str) -> str:
    if status in {"ok", "installed", "planned"}:
        return "green"
    if status in {"missing_model", "blocked", "installing"}:
        return "yellow"
    return "red"


@app.command("translate")
def translate_command(
    input_file: Annotated[Path, typer.Argument(help="Input subtitle file.")],
    provider: Annotated[
        str | None,
        typer.Option("--provider", help="Translation provider id."),
    ] = None,
    source_lang: Annotated[
        str,
        typer.Option("--from", help="Source language: auto, en, zh, ja, ko."),
    ] = "auto",
    target_lang: Annotated[
        str | None,
        typer.Option("--to", help="Target language: en, zh, ja, ko."),
    ] = None,
    mode: Annotated[
        str,
        typer.Option("--mode", help="Output mode: replace or bilingual."),
    ] = "replace",
    bilingual_order: Annotated[
        BilingualOrder,
        typer.Option("--bilingual-order", help="Bilingual line order."),
    ] = BilingualOrder.ORIGINAL_FIRST,
    output: Annotated[
        Path | None,
        typer.Option("--output", "-o", help="Output SRT path."),
    ] = None,
    model: Annotated[
        str | None,
        typer.Option("--model", help="Provider model id or local model manifest id."),
    ] = None,
    model_path_option: Annotated[
        Path | None,
        typer.Option("--model-path", help="Local provider model directory."),
    ] = None,
    batch_size: Annotated[
        int,
        typer.Option("--batch-size", help="Translation batch size."),
    ] = 8,
    timeout: Annotated[
        float,
        typer.Option("--timeout", help="Provider timeout in seconds."),
    ] = 60.0,
    sleep_seconds: Annotated[
        float,
        typer.Option("--sleep-seconds", help="Sleep between web translation cue calls."),
    ] = 0.0,
    api_key: Annotated[
        str | None,
        typer.Option("--api-key", help="API key for api-openai-chat."),
    ] = None,
    base_url: Annotated[
        str | None,
        typer.Option("--base-url", help="OpenAI-compatible base URL."),
    ] = None,
    config_path: Annotated[
        Path | None,
        typer.Option("--config", help="Optional TOML config path."),
    ] = None,
    resume: Annotated[
        bool,
        typer.Option("--resume/--no-resume", help="Reuse matching translate checkpoint."),
    ] = True,
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Print machine-readable result metadata."),
    ] = False,
) -> None:
    """Translate an SRT file while preserving cue order and timing."""
    try:
        config = load_config(config_path)
        resolved_provider = provider or getattr(config.translator, "provider", None)
        if not resolved_provider:
            raise TranslationProviderError(
                "invalid_options",
                (
                    "Missing required option: --provider. "
                    "Remote providers are never selected silently."
                ),
                hint="Choose web-bing, web-google, api-openai-chat, or local-nllb-ct2.",
            )
        if not target_lang:
            raise TranslationProviderError(
                "invalid_options",
                "Missing required option: --to.",
                hint="Pass --to zh, --to en, --to ja, or --to ko.",
            )
        output_mode = Mode.BILINGUAL if mode == "bilingual" else Mode.TRANSLATED
        if mode not in {"replace", "bilingual"}:
            raise TranslationProviderError(
                "invalid_options",
                "--mode must be replace or bilingual.",
            )
        if resolved_provider in {"web-bing", "web-google"} and not json_output:
            err_console.print(
                "[yellow]Privacy:[/yellow] subtitle text will be sent to a third-party web "
                "translation service. Stability, rate limits, and regional access are outside "
                "Fast Sub's control."
            )
        options = TranslateOptions(
            provider=resolved_provider,
            source_language=source_lang,
            target_language=target_lang,
            mode=output_mode,
            bilingual_order=bilingual_order,
            output=output,
            model=_resolve_translate_model(
                provider=resolved_provider,
                cli_model=model,
                config_model=config.translator.model,
                config_provider=config.translator.provider,
            ),
            model_path=model_path_option,
            batch_size=batch_size,
            timeout=timeout,
            sleep_seconds=sleep_seconds,
            resume=resume,
            api_key=api_key or os.getenv("OPENAI_API_KEY"),
            base_url=base_url
            or config.translator.base_url
            or os.getenv("OPENAI_BASE_URL")
            or OPENAI_BASE_URL,
        )
        result = translate_srt(input_file, options)
    except TranslationProviderError as exc:
        guessed_output = output
        if guessed_output is None and target_lang:
            guessed_output = input_file.with_name(f"{input_file.stem}.{target_lang}.srt")
        errors_path = str(guessed_output.with_suffix(".errors.json")) if guessed_output else None
        payload = _error_payload(
            code=exc.code,
            stage="translate",
            message=str(exc),
            action_hint=exc.hint,
            details={"input": str(input_file), "errors_path": errors_path},
        )
        if json_output:
            typer.echo(json.dumps(payload, ensure_ascii=False))
        else:
            err_console.print(f"[red]Error:[/red] {_redact_secrets(str(exc))}")
            if exc.hint:
                err_console.print(f"[yellow]Hint:[/yellow] {_redact_secrets(exc.hint)}")
        raise typer.Exit(_exit_code_for_payload(payload)) from exc
    except Exception as exc:
        payload = _json_error_for_exception(exc, stage="translate", code="provider_failed")
        if json_output:
            typer.echo(json.dumps(payload, ensure_ascii=False))
        else:
            err_console.print(f"[red]Error:[/red] {_redact_secrets(str(exc))}")
        raise typer.Exit(_exit_code_for_payload(payload)) from exc

    if json_output:
        typer.echo(json.dumps(result.as_dict(), ensure_ascii=False))
    else:
        console.print(f"[green]Wrote translated subtitle:[/green] {result.srt_path}")
        if result.errors_path:
            err_console.print(f"[yellow]Translation warnings:[/yellow] {result.errors_path}")


def _resolve_translate_model(
    *,
    provider: str,
    cli_model: str | None,
    config_model: str | None,
    config_provider: str | None,
) -> str | None:
    if cli_model:
        return cli_model
    if provider == "api-openai-chat":
        return os.getenv("OPENAI_MODEL") or (
            config_model if config_provider in {None, provider} else None
        )
    if config_provider == provider:
        return config_model
    return None


@app.command("refine")
def refine_command(
    input_file: Annotated[Path, typer.Argument(help="Input subtitle file.")],
    output: Annotated[
        Path | None,
        typer.Option("--output", "-o", help="Output subtitle path."),
    ] = None,
    lang: Annotated[
        str,
        typer.Option(help="Subtitle language: auto, zh, en, ja, or ko."),
    ] = "auto",
    max_chars: Annotated[
        int | None,
        typer.Option(help="Soft maximum characters per subtitle line."),
    ] = None,
    max_duration: Annotated[
        float,
        typer.Option(help="Suggested maximum subtitle duration in seconds."),
    ] = 6.0,
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Print machine-readable result metadata."),
    ] = False,
) -> None:
    """Clean and normalize subtitle timing/text."""
    try:
        out_path = refine_subtitle_file(
            input_file=input_file,
            output=output,
            lang=lang,
            max_chars=max_chars,
            max_duration=max_duration,
        )
    except SubGenError as exc:
        payload = _json_error_for_exception(exc, stage="refine", code="invalid_input")
        if json_output:
            typer.echo(json.dumps(payload, ensure_ascii=False))
        else:
            err_console.print(f"[red]Error:[/red] {_redact_secrets(str(exc))}")
        raise typer.Exit(_exit_code_for_payload(payload)) from exc

    if json_output:
        typer.echo(
            json.dumps(
                {
                    "ok": True,
                    "input": str(input_file),
                    "output": str(out_path),
                },
                ensure_ascii=False,
            )
        )
    else:
        console.print(f"[green]Wrote refined subtitle:[/green] {out_path}")


def refine_subtitle_file(
    *,
    input_file: Path,
    output: Path | None,
    lang: str,
    max_chars: int | None,
    max_duration: float,
) -> Path:
    _validate_refine_input(input_file, lang, max_chars, max_duration)
    out_path = output or input_file.with_name(f"{input_file.stem}.refined.srt")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    refined = refine_srt_text(
        input_file.read_text(encoding="utf-8-sig"),
        RefineOptions(lang=lang, max_chars=max_chars, max_duration=max_duration),
    )
    out_path.write_text(refined, encoding="utf-8")
    return out_path


def _validate_refine_input(
    input_file: Path,
    lang: str,
    max_chars: int | None,
    max_duration: float,
) -> None:
    if not input_file.exists():
        raise SubGenError(f"Input file does not exist: {input_file}")
    if not input_file.is_file():
        raise SubGenError(f"Input path is not a file: {input_file}")
    if input_file.suffix.lower() != ".srt":
        raise SubGenError("refine currently supports .srt input only.")
    if lang not in {"auto", "zh", "en", "ja", "ko"}:
        raise SubGenError("--lang must be one of: auto, zh, en, ja, ko.")
    if max_chars is not None:
        _validate_positive(max_chars, "--max-chars")
    _validate_positive(max_duration, "--max-duration")


@app.command("run")
def run(
    input_file: Annotated[Path, typer.Argument(help="Input video/audio file.")],
    provider: Annotated[
        str,
        typer.Option("--provider", help="STT provider id. v0 defaults to local-faster-whisper."),
    ] = "local-faster-whisper",
    model: Annotated[
        str,
        typer.Option("--model", help="ASR model id."),
    ] = "whisper-small",
    language: Annotated[
        str,
        typer.Option("--language", help="Language: auto, zh, en, ja, or ko."),
    ] = "auto",
    device: Annotated[
        str,
        typer.Option("--device", help="Worker device: auto, cuda, or cpu."),
    ] = "auto",
    compute: Annotated[
        str,
        typer.Option("--compute", help="Worker compute type."),
    ] = "auto",
    batch_size: Annotated[
        int | None,
        typer.Option("--batch-size", help="Worker batch size. Overrides --gpu-load."),
    ] = None,
    gpu_load: Annotated[
        str,
        typer.Option("--gpu-load", help="GPU load profile: low, balanced, or max."),
    ] = "balanced",
    vad: Annotated[
        str,
        typer.Option("--vad", help="VAD mode: auto, off, normal, or aggressive."),
    ] = "auto",
    mode: Annotated[
        str,
        typer.Option("--mode", help="Transcription mode: fast, balanced, or quality."),
    ] = "balanced",
    output: Annotated[
        Path | None,
        typer.Option("--output", "-o", help="Final output .srt path."),
    ] = None,
    dry_run: Annotated[
        bool,
        typer.Option("--dry-run", help="Print the auto plan without downloading or transcribing."),
    ] = False,
    yes: Annotated[
        bool,
        typer.Option("--yes", "-y", help="Allow automatic local model installation."),
    ] = False,
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Print machine-readable result metadata."),
    ] = False,
    keep_temp: Annotated[
        bool,
        typer.Option("--keep-temp", help="Keep prepared audio and worker JSON files."),
    ] = False,
) -> None:
    """Compatibility alias for `fast-sub auto` using the v0 local pipeline."""
    _run_auto_entry(
        input_file=input_file,
        provider=provider,
        model=model,
        language=language,
        device=device,
        compute=compute,
        batch_size=batch_size,
        gpu_load=gpu_load,
        vad=vad,
        mode=mode,
        output=output,
        dry_run=dry_run,
        yes=yes,
        json_output=json_output,
        keep_temp=keep_temp,
    )


def legacy_run(
    input_file: Path,
    output: Path | None,
    options: AppConfig,
    keep_temp: bool,
) -> None:
    """Legacy OpenAI-compatible/WhisperX pipeline kept off the v0 CLI surface."""
    try:
        _run_input(input_file=input_file, output=output, options=options, keep_temp=keep_temp)
    except SubGenError as exc:
        err_console.print(f"[red]Error:[/red] {_redact_secrets(str(exc))}")
        raise typer.Exit(1) from exc


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


def _resolve_options(
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
        _validate_positive(options.stt.max_audio_mb, "--max-audio-mb")
    if options.subtitle.max_line_chars is not None:
        _validate_positive(options.subtitle.max_line_chars, "--max-line-chars")
    _validate_positive(options.stt.whisperx_batch_size, "--whisperx-batch-size")
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
        "fast-sub v0.1 needs srt or verbose_json timestamps; use whisper-1 or a compatible "
        "provider/model that supports timestamped segments."
    )


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
