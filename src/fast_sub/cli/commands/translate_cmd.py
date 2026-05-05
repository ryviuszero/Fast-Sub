from __future__ import annotations

import json
import os
from collections.abc import Callable
from pathlib import Path
from typing import Annotated, Any

import typer

from fast_sub.cli.constants import OPENAI_BASE_URL
from fast_sub.cli.context import console, err_console
from fast_sub.cli.errors import error_payload, exit_code_for_payload, json_error_for_exception
from fast_sub.cli.redaction import redact_secrets
from fast_sub.config import load_config
from fast_sub.models import BilingualOrder, Mode
from fast_sub.translation.errors import TranslationProviderError
from fast_sub.translation.service import TranslateOptions, translate_srt

TranslateRunner = Callable[[Path, TranslateOptions], Any]


def register_translate_command(
    app: typer.Typer,
    *,
    translate_runner: TranslateRunner = translate_srt,
) -> None:
    """Register the subtitle translation command."""

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
        run_translate_command(
            input_file=input_file,
            provider=provider,
            source_lang=source_lang,
            target_lang=target_lang,
            mode=mode,
            bilingual_order=bilingual_order,
            output=output,
            model=model,
            model_path_option=model_path_option,
            batch_size=batch_size,
            timeout=timeout,
            sleep_seconds=sleep_seconds,
            api_key=api_key,
            base_url=base_url,
            config_path=config_path,
            resume=resume,
            json_output=json_output,
            translate_runner=translate_runner,
        )


def run_translate_command(
    *,
    input_file: Path,
    provider: str | None,
    source_lang: str,
    target_lang: str | None,
    mode: str,
    bilingual_order: BilingualOrder,
    output: Path | None,
    model: str | None,
    model_path_option: Path | None,
    batch_size: int,
    timeout: float,
    sleep_seconds: float,
    api_key: str | None,
    base_url: str | None,
    config_path: Path | None,
    resume: bool,
    json_output: bool,
    translate_runner: TranslateRunner = translate_srt,
) -> None:
    """Translate subtitles and render CLI output."""
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
        if mode not in {"replace", "bilingual"}:
            raise TranslationProviderError(
                "invalid_options",
                "--mode must be replace or bilingual.",
            )
        _print_translate_privacy_notice(resolved_provider, json_output=json_output)
        options = TranslateOptions(
            provider=resolved_provider,
            source_language=source_lang,
            target_language=target_lang,
            mode=Mode.BILINGUAL if mode == "bilingual" else Mode.TRANSLATED,
            bilingual_order=bilingual_order,
            output=output,
            model=resolve_translate_model(
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
        result = translate_runner(input_file, options)
    except TranslationProviderError as exc:
        _handle_translate_provider_error(
            exc,
            input_file=input_file,
            output=output,
            target_lang=target_lang,
            json_output=json_output,
        )
    except Exception as exc:
        payload = json_error_for_exception(exc, stage="translate", code="provider_failed")
        if json_output:
            typer.echo(json.dumps(payload, ensure_ascii=False))
        else:
            err_console.print(f"[red]Error:[/red] {redact_secrets(str(exc))}")
        raise typer.Exit(exit_code_for_payload(payload)) from exc

    if json_output:
        typer.echo(json.dumps(result.as_dict(), ensure_ascii=False))
    else:
        console.print(f"[green]Wrote translated subtitle:[/green] {result.srt_path}")
        if result.errors_path:
            err_console.print(f"[yellow]Translation warnings:[/yellow] {result.errors_path}")


def resolve_translate_model(
    *,
    provider: str,
    cli_model: str | None,
    config_model: str | None,
    config_provider: str | None,
) -> str | None:
    """Resolve the translation model from CLI, environment, and config values."""
    if cli_model:
        return cli_model
    if provider == "api-openai-chat":
        return os.getenv("OPENAI_MODEL") or (
            config_model if config_provider in {None, provider} else None
        )
    if config_provider == provider:
        return config_model
    return None


def _print_translate_privacy_notice(provider: str, *, json_output: bool) -> None:
    if provider not in {"web-bing", "web-google"} or json_output:
        return
    err_console.print(
        "[yellow]Privacy:[/yellow] subtitle text will be sent to a third-party web "
        "translation service. Stability, rate limits, and regional access are outside "
        "Fast Sub's control."
    )


def _handle_translate_provider_error(
    exc: TranslationProviderError,
    *,
    input_file: Path,
    output: Path | None,
    target_lang: str | None,
    json_output: bool,
) -> None:
    guessed_output = output
    if guessed_output is None and target_lang:
        guessed_output = input_file.with_name(f"{input_file.stem}.{target_lang}.srt")
    errors_path = str(guessed_output.with_suffix(".errors.json")) if guessed_output else None
    payload = error_payload(
        code=exc.code,
        stage="translate",
        message=str(exc),
        action_hint=exc.hint,
        details={"input": str(input_file), "errors_path": errors_path},
    )
    if json_output:
        typer.echo(json.dumps(payload, ensure_ascii=False))
    else:
        err_console.print(f"[red]Error:[/red] {redact_secrets(str(exc))}")
        if exc.hint:
            err_console.print(f"[yellow]Hint:[/yellow] {redact_secrets(exc.hint)}")
    raise typer.Exit(exit_code_for_payload(payload)) from exc
