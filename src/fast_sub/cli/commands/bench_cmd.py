from __future__ import annotations

import json
import os
import sys
import tomllib
from collections.abc import Callable
from pathlib import Path
from typing import Annotated, Any

import typer

from fast_sub.benchmark.manifests import (
    render_sample_manifest_schema,
    render_translate_sample_manifest_schema,
    sample_manifest_schema_payload,
    translate_sample_manifest_schema_payload,
)
from fast_sub.benchmark.models import (
    BENCH_PROFILE_CHOICES,
    BenchOptions,
    BenchTranslateOptions,
)
from fast_sub.benchmark.transcription import (
    BenchError,
    load_sample_metadata,
    render_brief_report,
    run_bench,
)
from fast_sub.benchmark.translation import (
    BenchTranslateError,
    run_bench_translate,
)
from fast_sub.benchmark.translation import (
    render_markdown_report as render_translate_bench_markdown_report,
)
from fast_sub.cli.constants import OPENAI_BASE_URL
from fast_sub.cli.context import console, err_console
from fast_sub.cli.errors import error_payload
from fast_sub.cli.redaction import redact_secrets
from fast_sub.config import load_config
from fast_sub.stt.constants import VALID_LANGUAGES

BenchRunner = Callable[[Path, BenchOptions], dict[str, Any]]
BenchTranslateRunner = Callable[[Path, BenchTranslateOptions], dict[str, Any]]


def register_bench_commands(
    app: typer.Typer,
    *,
    bench_runner: BenchRunner = run_bench,
    bench_translate_runner: BenchTranslateRunner = run_bench_translate,
) -> None:
    """Register benchmark CLI commands."""

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
        run_bench_command(
            ctx=ctx,
            input_file=input_file,
            provider=provider,
            model=model,
            language=language,
            mode=mode,
            repeat=repeat,
            profile=profile,
            gpu_load=gpu_load,
            batch_size=batch_size,
            markdown=markdown,
            markdown_path=markdown_path,
            sample_manifest=sample_manifest,
            json_output=json_output,
            bench_runner=bench_runner,
        )

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
        run_bench_translate_command(
            input_file=input_file,
            reference=reference,
            provider=provider,
            source_lang=source_lang,
            target_lang=target_lang,
            output_dir=output_dir,
            json_output=json_output,
            markdown=markdown,
            markdown_path=markdown_path,
            repeat=repeat,
            model=model,
            model_path_option=model_path_option,
            batch_size=batch_size,
            timeout=timeout,
            sleep_seconds=sleep_seconds,
            api_key=api_key,
            base_url=base_url,
            config_path=config_path,
            bench_translate_runner=bench_translate_runner,
        )


def run_bench_command(
    *,
    ctx: typer.Context,
    input_file: Path,
    provider: str,
    model: str,
    language: str,
    mode: str,
    repeat: int,
    profile: str,
    gpu_load: str,
    batch_size: int | None,
    markdown: bool,
    markdown_path: Path | None,
    sample_manifest: Path | None,
    json_output: bool,
    bench_runner: BenchRunner = run_bench,
) -> None:
    """Run the transcription benchmark command."""
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
        report = bench_runner(input_file, options)
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


def run_bench_translate_command(
    *,
    input_file: Path,
    reference: Path | None,
    provider: str | None,
    source_lang: str,
    target_lang: str | None,
    output_dir: Path | None,
    json_output: bool,
    markdown: bool,
    markdown_path: Path | None,
    repeat: int,
    model: str | None,
    model_path_option: Path | None,
    batch_size: int | None,
    timeout: float | None,
    sleep_seconds: float | None,
    api_key: str | None,
    base_url: str | None,
    config_path: Path | None,
    bench_translate_runner: BenchTranslateRunner = run_bench_translate,
) -> None:
    """Run the translation benchmark command."""
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
        _print_bench_translate_privacy_notice(resolved_provider, json_output=json_output)
        resolved_model = resolve_bench_translate_model(
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
        report = bench_translate_runner(
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
                err_console.print(f"[red]Error:[/red] {redact_secrets(str(exc))}")
                console.print(render_translate_bench_markdown_report(exc.report))
            raise typer.Exit(bench_translate_report_exit_code(exc.report)) from exc
        payload = bench_translate_error_payload(exc)
        if json_output:
            typer.echo(json.dumps(payload, ensure_ascii=False))
        else:
            err_console.print(f"[red]Error:[/red] {redact_secrets(str(exc))}")
        raise typer.Exit(2) from exc

    if json_output:
        typer.echo(json.dumps(report, ensure_ascii=False, indent=2))
        return
    console.print(render_translate_bench_markdown_report(report))


def bench_translate_error_payload(exc: BenchTranslateError) -> dict[str, Any]:
    """Build the structured CLI error payload for bench-translate failures."""
    message = str(exc)
    lower = message.lower()
    code = "invalid_options"
    if "unknown provider" in lower:
        code = "invalid_provider"
    elif "input file does not exist" in lower or "reference file does not exist" in lower:
        code = "invalid_input"
    elif "could not read" in lower or "must be .srt" in lower or "must be .txt" in lower:
        code = "invalid_input"
    return error_payload(code=code, stage="bench-translate", message=message)


def bench_translate_report_exit_code(report: dict[str, Any]) -> int:
    """Map a bench-translate report to the process exit code."""
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


def resolve_bench_translate_model(
    *,
    provider: str,
    cli_model: str | None,
    config_model: str | None,
    config_provider: str | None,
) -> str | None:
    """Resolve the translation benchmark model from CLI, config, and environment."""
    if cli_model:
        return cli_model
    if config_model and config_provider in {None, provider}:
        return config_model
    if provider == "api-openai-chat":
        return os.getenv("OPENAI_MODEL")
    return None


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


def _print_bench_translate_privacy_notice(provider: str, *, json_output: bool) -> None:
    if json_output:
        return
    if provider in {"web-bing", "web-google"}:
        err_console.print(
            "[yellow]Privacy:[/yellow] subtitle text will be sent to a third-party web "
            "translation service for this benchmark."
        )
    if provider == "api-openai-chat":
        err_console.print(
            "[yellow]Privacy:[/yellow] subtitle text will be sent to the configured "
            "OpenAI-compatible API for this benchmark."
        )
