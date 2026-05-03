from __future__ import annotations

import json
import os
import re
import shutil
import sys
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Annotated, Any, TypeVar

import typer
from rich.console import Console
from rich.progress import (
    BarColumn,
    DownloadColumn,
    Progress,
    TaskID,
    TextColumn,
    TimeRemainingColumn,
    TransferSpeedColumn,
)

from fast_sub.analyze import AnalysisResult, analyze_media
from fast_sub.auto import AutoOptions, AutoPipelineError, auto_media
from fast_sub.bench import (
    BENCH_PROFILE_CHOICES,
    BenchError,
    BenchOptions,
    load_sample_metadata,
    render_brief_report,
    render_sample_manifest_schema,
    run_bench,
    sample_manifest_schema_payload,
)
from fast_sub.burn import BurnOptions, burn_subtitles
from fast_sub.config import AppConfig, load_config
from fast_sub.errors import ProviderResponseError, SubGenError, WorkerRunnerError
from fast_sub.media import (
    doctor_ok,
    doctor_status,
    ensure_media_tools,
    is_audio_file,
    is_media_file,
    list_media_files,
    prepare_audio,
    probe_media,
)
from fast_sub.model_manager import (
    MODEL_DOWNLOADERS,
    ModelManagerError,
    install_model,
    model_path,
    verify_model,
)
from fast_sub.model_manifest import get_model, list_models
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
from fast_sub.paths import default_output_path, job_dir
from fast_sub.providers import default_registry
from fast_sub.stt import transcribe_segments, transcribe_segments_whisperx, transcribe_srt
from fast_sub.subtitle import RefineOptions, refine_srt_text, render_srt
from fast_sub.transcribe import (
    VALID_LANGUAGES,
    TranscribeOptions,
    transcribe_error_payload,
    transcribe_media,
)
from fast_sub.translate import translate_segments

console = Console()
err_console = Console(stderr=True)
T = TypeVar("T")
app = typer.Typer(help="Fast local subtitles for video.", no_args_is_help=True)
providers_app = typer.Typer(help="Inspect provider contracts.", no_args_is_help=True)
models_app = typer.Typer(help="Manage local model downloads.", no_args_is_help=True)
COMMAND_NAMES = {
    "analyze",
    "auto",
    "bench",
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


def main() -> None:
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


def _error_payload(
    *,
    code: str,
    stage: str,
    message: str,
    action_hint: str | None = None,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    error: dict[str, Any] = {
        "code": code,
        "stage": stage,
        "message": _redact_secrets(message),
    }
    if action_hint:
        error["action_hint"] = _redact_secrets(action_hint)
    if details:
        error["details"] = _redact_value(details)
    return {"ok": False, "error": error}


def _json_error_for_exception(exc: BaseException, *, stage: str, code: str) -> dict[str, Any]:
    return _error_payload(
        code=_classify_error_code(str(exc), fallback=code),
        stage=stage,
        message=str(exc),
        action_hint=_action_hint_for_message(str(exc)),
    )


def _exit_code_for_payload(payload: dict[str, Any]) -> int:
    error = payload.get("error", {})
    code = str(error.get("code", "")).lower()
    stage = str(error.get("stage", "")).lower()
    if code in {"invalid_input", "invalid_options", "invalid_usage"} or stage == "input":
        return 2
    if code in {"missing_dependency", "ffmpeg_failed", "ffprobe_failed"}:
        return 3
    if code in {"missing_model", "model_not_found"}:
        return 4
    if code in {"download_failed", "checksum_failed", "cache_failed"}:
        return 5
    return 1


def _classify_error_code(message: str, *, fallback: str) -> str:
    lower = message.lower()
    if "input file does not exist" in lower or "unsupported input file type" in lower:
        return "invalid_input"
    if "input path is not a file" in lower or "no audio stream" in lower:
        return "invalid_input"
    if "missing_model" in lower or "model is not installed" in lower:
        return "missing_model"
    if "models install" in lower or "model directory is missing" in lower:
        return "missing_model"
    if "ffmpeg" in lower or "ffprobe" in lower:
        return "missing_dependency"
    if "local-asr" in lower or "faster_whisper" in lower or "not installed" in lower:
        return "missing_dependency"
    if "checksum" in lower:
        return "checksum_failed"
    if "download" in lower:
        return "download_failed"
    return fallback.lower()


def _action_hint_for_message(message: str) -> str | None:
    lower = message.lower()
    if "local-asr" in lower or "faster_whisper" in lower:
        return (
            "Install local ASR dependencies with `uv sync --extra local-asr` "
            "or `pip install fast-sub[local-asr]`."
        )
    if "missing_model" in lower or "model is not installed" in lower or "models install" in lower:
        match = re.search(r"whisper-[A-Za-z0-9_.-]+", message)
        model_id = match.group(0) if match else "whisper-small"
        return f"Run `fast-sub models install {model_id}` or `fast-sub auto --yes`."
    return None


def _redact_value(value: Any) -> Any:
    if isinstance(value, str):
        return _redact_secrets(value)
    if isinstance(value, dict):
        return {key: _redact_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_redact_value(item) for item in value]
    return value


def _redact_secrets(message: str) -> str:
    redacted = message
    for name in ("OPENAI_API_KEY", "FAST_SUB_STT_API_KEY"):
        secret = os.getenv(name)
        if secret:
            redacted = redacted.replace(secret, "[redacted]")
    redacted = re.sub(r"sk-[A-Za-z0-9_-]{8,}", "sk-[redacted]", redacted)
    redacted = re.sub(r"(?i)(api[_-]?key|token)=([^&\s]+)", r"\1=[redacted]", redacted)
    return redacted


@models_app.command("list")
def models_list_command(
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Print machine-readable JSON."),
    ] = False,
) -> None:
    """List known models and local installation status."""
    rows = []
    for model in list_models():
        status = verify_model(model)
        rows.append(
            {
                "id": model.id,
                "name": model.name,
                "type": model.type,
                "backend": model.backend,
                "size_bytes": model.size_bytes,
                "license": model.license,
                "manifest_type": model.manifest_type,
                "required_files": model.required_file_count,
                "installed": status.installed,
                "status": status.status,
                "path": str(model_path(model)),
                "recommended_for": model.recommended_for,
            }
        )
    if json_output:
        typer.echo(json.dumps(rows, ensure_ascii=False, indent=2))
        return

    for row in rows:
        installed = "yes" if row["installed"] else row["status"]
        console.print(
            f"{row['id']}\t{_format_bytes(row['size_bytes'])}\t"
            f"{row['license']}\t{row['manifest_type']}:{row['required_files']}\t{installed}"
        )


@models_app.command("verify")
def models_verify_command(
    model_id: Annotated[str, typer.Argument(help="Model id from `models list`.")],
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Print machine-readable JSON."),
    ] = False,
) -> None:
    """Verify a downloaded model against the manifest sha256 entries."""
    try:
        status = verify_model(get_model(model_id))
    except KeyError as exc:
        payload = _error_payload(
            code="invalid_input",
            stage="model",
            message=str(exc),
            action_hint="Run `fast-sub models list` to see available models.",
        )
        if json_output:
            typer.echo(json.dumps(payload, ensure_ascii=False))
        else:
            err_console.print(f"[red]Error:[/red] {_redact_secrets(str(exc))}")
        raise typer.Exit(2) from exc

    if json_output:
        typer.echo(json.dumps(status.as_dict(), ensure_ascii=False, indent=2))
    else:
        color = "green" if status.installed else "yellow"
        console.print(f"[{color}]{status.status}:[/{color}] {status.message} {status.path}")
    if not status.installed:
        raise typer.Exit(4)


@models_app.command("install")
def models_install_command(
    model_id: Annotated[str, typer.Argument(help="Model id from `models list`.")],
    downloader: Annotated[
        str,
        typer.Option("--downloader", help="Download backend: auto, httpx, or aria2."),
    ] = "auto",
    aria2_connections: Annotated[
        int,
        typer.Option("--aria2-connections", help="aria2 connections per server."),
    ] = 8,
    aria2_split: Annotated[
        int,
        typer.Option("--aria2-split", help="aria2 split count."),
    ] = 8,
) -> None:
    """Download and verify a model into the local cache."""
    try:
        model = get_model(model_id)
        _validate_model_downloader(downloader)
        with _model_download_progress() as progress:
            status = install_model(
                model,
                downloader=downloader,
                aria2_connections=aria2_connections,
                aria2_split=aria2_split,
                progress=progress,
            )
    except (KeyError, ModelManagerError) as exc:
        err_console.print(f"[red]Error:[/red] {_redact_secrets(str(exc))}")
        code = 2 if isinstance(exc, KeyError) else 5
        raise typer.Exit(code) from exc
    console.print(
        f"[green]Installed:[/green] {model.id} -> {status.path} "
        f"({status.checked_files} file(s) verified)"
    )


@app.command("doctor")
def doctor_command(
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Print machine-readable JSON."),
    ] = False,
) -> None:
    """Check local dependencies and runtime readiness."""
    status = doctor_status()
    if json_output:
        typer.echo(json.dumps(status, ensure_ascii=False, indent=2))
    else:
        _print_doctor_status(status)
    if not doctor_ok(status):
        raise typer.Exit(3)


@app.command("probe")
def probe_command(
    input_file: Annotated[Path, typer.Argument(help="Input video/audio file.")],
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Print machine-readable JSON."),
    ] = False,
) -> None:
    """Inspect media metadata."""
    try:
        info = probe_media(input_file)
    except SubGenError as exc:
        if json_output:
            typer.echo(
                json.dumps(
                    _json_error_for_exception(exc, stage="input", code="invalid_input"),
                    ensure_ascii=False,
                )
            )
        else:
            err_console.print(f"[red]Error:[/red] {_redact_secrets(str(exc))}")
        raise typer.Exit(2) from exc
    if json_output:
        typer.echo(json.dumps(info, ensure_ascii=False, indent=2))
        return
    _print_probe_info(info)


@app.command("extract")
def extract_command(
    input_file: Annotated[Path, typer.Argument(help="Input video/audio file.")],
    output: Annotated[
        Path | None,
        typer.Option("--output", "-o", help="Output wav path."),
    ] = None,
    audio_stream: Annotated[
        int | None,
        typer.Option("--audio-stream", help="Input ffprobe stream index to extract."),
    ] = None,
) -> None:
    """Extract normalized 16kHz mono wav audio."""
    try:
        _validate_extract_input(input_file)
        out_path = output or (job_dir(input_file) / "audio.16k.mono.wav")
        prepare_audio(input_file, out_path, audio_stream=audio_stream)
    except SubGenError as exc:
        payload = _json_error_for_exception(exc, stage="extract", code="command_failed")
        err_console.print(f"[red]Error:[/red] {_redact_secrets(str(exc))}")
        raise typer.Exit(_exit_code_for_payload(payload)) from exc
    console.print(f"[green]Wrote audio:[/green] {out_path}")


def _print_doctor_status(status: dict[str, Any]) -> None:
    console.print("[bold]Fast Sub doctor[/bold]")
    for tool in ("ffmpeg", "ffprobe"):
        item = status[tool]
        label = "[green]ok[/green]" if item["available"] else "[red]missing[/red]"
        detail = item["path"] or "not found on PATH"
        console.print(f"{tool}: {label} ({detail})")
    python = status["python"]
    py_label = "[green]ok[/green]" if python["ok"] else "[red]unsupported[/red]"
    console.print(f"python: {py_label} ({python['version']})")
    for key in ("cache_dir", "jobs_dir"):
        item = status[key]
        label = "[green]writable[/green]" if item["writable"] else "[red]not writable[/red]"
        console.print(f"{key}: {label} ({item['path']})")
        if item["error"]:
            console.print(f"  [red]{item['error']}[/red]")


def _validate_model_downloader(value: str) -> None:
    if value not in MODEL_DOWNLOADERS:
        supported = ", ".join(sorted(MODEL_DOWNLOADERS))
        raise ModelManagerError(
            f"Unsupported model downloader: {value}. Choose one of: {supported}."
        )


def _model_download_progress():  # noqa: ANN202
    progress = Progress(
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        DownloadColumn(),
        TransferSpeedColumn(),
        TimeRemainingColumn(),
        console=console,
    )
    tasks: dict[str, TaskID] = {}

    def update(label: str, downloaded: int, total: int | None) -> None:
        if label not in tasks:
            tasks[label] = progress.add_task(
                label,
                total=total,
                completed=downloaded,
            )
            return
        task_id = tasks[label]
        if total is not None:
            progress.update(task_id, total=total)
        progress.update(task_id, completed=downloaded)

    class ProgressContext:
        def __enter__(self):  # noqa: ANN204
            progress.__enter__()
            return update

        def __exit__(self, exc_type, exc, tb):  # noqa: ANN001, ANN204
            return progress.__exit__(exc_type, exc, tb)

    return ProgressContext()


def _print_probe_info(info: dict[str, Any]) -> None:
    console.print(f"path: {info['path']}")
    console.print(f"duration_sec: {info['duration_sec']}")
    console.print(f"container: {info['container']}")
    console.print(f"audio_streams: {len(info['audio_streams'])}")
    console.print(f"video_streams: {len(info['video_streams'])}")
    selected = info["selected_audio_stream"]
    console.print(
        "selected_audio_stream: "
        f"index={selected.get('index')} codec={selected.get('codec')} "
        f"channels={selected.get('channels')} sample_rate={selected.get('sample_rate')}"
    )


def _validate_extract_input(input_file: Path) -> None:
    if not input_file.exists():
        raise SubGenError(f"Input file does not exist: {input_file}")
    if not input_file.is_file():
        raise SubGenError(f"Input path is not a file: {input_file}")
    if not is_media_file(input_file):
        raise SubGenError(f"Unsupported input file type: {input_file}")
    ensure_media_tools()


@app.command("analyze")
def analyze_command(
    input_file: Annotated[Path, typer.Argument(help="Input video/audio file.")],
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Print machine-readable JSON."),
    ] = False,
) -> None:
    """Analyze audio characteristics for automatic scheduling."""
    try:
        result = analyze_media(input_file)
    except SubGenError as exc:
        payload = _json_error_for_exception(exc, stage="analyze", code="command_failed")
        if json_output:
            typer.echo(json.dumps(payload, ensure_ascii=False))
        else:
            err_console.print(f"[red]Error:[/red] {_redact_secrets(str(exc))}")
        raise typer.Exit(_exit_code_for_payload(payload)) from exc

    if json_output:
        typer.echo(json.dumps(result.as_dict(), ensure_ascii=False, indent=2))
        return
    _print_analysis_result(result)


def _print_analysis_result(result: AnalysisResult) -> None:
    console.print("[bold]Fast Sub analyze[/bold]")
    console.print(f"duration_sec: {result.duration_sec}")
    console.print(f"speech_ratio: {result.speech_ratio:.4f}")
    console.print(f"silence_ratio: {result.silence_ratio:.4f}")
    console.print(f"mean_volume_db: {result.mean_volume_db}")
    console.print(f"peak_volume_db: {result.peak_volume_db}")
    console.print(f"estimated_segments: {result.estimated_segments}")
    console.print(f"avg_segment_sec: {result.avg_segment_sec}")
    console.print(f"recommended_vad: {result.recommended_vad}")
    console.print(f"recommended_mode: {result.recommended_mode}")
    if result.warnings:
        console.print(f"warnings: {', '.join(result.warnings)}")
    else:
        console.print("warnings: none")


@app.command("burn")
def burn_command(
    input_file: Annotated[Path, typer.Argument(help="Input video file.")],
    subtitle_file: Annotated[Path, typer.Argument(help="Input .srt subtitle file.")],
    output: Annotated[
        Path | None,
        typer.Option("--output", "-o", help="Output video path."),
    ] = None,
    font: Annotated[
        str | None,
        typer.Option("--font", help="Subtitle font family passed to ffmpeg force_style."),
    ] = None,
    font_size: Annotated[
        int | None,
        typer.Option("--font-size", help="Subtitle font size passed to ffmpeg force_style."),
    ] = None,
    preset: Annotated[
        str,
        typer.Option("--preset", help="Encoding preset: fast, balanced, or quality."),
    ] = "balanced",
) -> None:
    """Burn SRT subtitles into a video with ffmpeg."""
    try:
        out_path = burn_subtitles(
            input_file=input_file,
            subtitle_file=subtitle_file,
            output=output,
            options=BurnOptions(font=font, font_size=font_size, preset=preset),
        )
    except SubGenError as exc:
        console.print(f"[red]Error:[/red] {exc}")
        raise typer.Exit(1) from exc
    console.print(f"[green]Wrote subtitled video:[/green] {out_path}")


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
                f"[cyan]Benchmark profile[/cyan] {name} "
                f"({payload.get('repeat')} run(s))"
            )
            return
        if event == "run_start":
            console_target.print(
                f"  [cyan]Run[/cyan] {payload.get('index')}/{payload.get('repeat')} "
                f"started"
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
                console_target.print(
                    f"  [red]Failed[/red] {run.get('reason') or 'unknown error'}"
                )
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
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Print machine-readable result metadata."),
    ] = False,
) -> None:
    """Preview placeholder; translation is post-v0."""
    payload = _error_payload(
        code="not_implemented",
        stage="translate",
        message="Translation is not implemented in fast-sub v0.",
        action_hint="Generate source subtitles with `fast-sub auto input.mp4`.",
        details={"input": str(input_file)},
    )
    if json_output:
        typer.echo(json.dumps(payload, ensure_ascii=False))
    else:
        err_console.print("[yellow]translate is not implemented in fast-sub v0.[/yellow]")
    raise typer.Exit(1)


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


@providers_app.command("list")
def providers_list_command(
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Output machine-readable JSON."),
    ] = False,
) -> None:
    """List known STT and translation providers."""
    providers = default_registry().list()
    if json_output:
        console.print_json(data=[provider.model_dump(mode="json") for provider in providers])
        return

    for provider in providers:
        metadata = provider.metadata
        console.print(
            f"{metadata.id}\t{metadata.type.value}\t{metadata.location.value}\t"
            f"{provider.status.status.value}"
        )


@providers_app.command("test")
def providers_test_command(
    provider_id: Annotated[str, typer.Argument(help="Provider id to inspect.")],
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Output machine-readable JSON."),
    ] = False,
) -> None:
    """Check whether a provider contract can be selected."""
    registry = default_registry()
    if registry.get(provider_id) is None:
        payload = _error_payload(
            code="invalid_input",
            stage="provider",
            message=f"Unknown provider: {provider_id}",
            action_hint="Run `fast-sub providers list` to see available providers.",
        )
        if json_output:
            typer.echo(json.dumps(payload, ensure_ascii=False))
        else:
            err_console.print(f"[red]Unknown provider:[/red] {_redact_secrets(provider_id)}")
        raise typer.Exit(2)

    provider = registry.inspect(provider_id)
    if json_output:
        console.print_json(data=provider.model_dump(mode="json"))
        return

    console.print(f"{provider.metadata.id}: {provider.status.status.value}")
    console.print(provider.status.message)


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
    console.print(
        f"[cyan]Found {len(media_files)} media file(s). Progress:[/cyan] {progress_path}"
    )

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


def _format_bytes(value: object) -> str:
    size = float(value)
    units = ["B", "KB", "MB", "GB", "TB"]
    for unit in units:
        if size < 1024 or unit == units[-1]:
            if unit == "B":
                return f"{int(size)} {unit}"
            return f"{size:.1f} {unit}"
        size /= 1024


