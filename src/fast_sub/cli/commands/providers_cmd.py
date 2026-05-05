from __future__ import annotations

from typing import Annotated

import typer

from fast_sub.cli.errors import error_payload
from fast_sub.cli.helpers import console, echo_json, err_console, redact_secrets
from fast_sub.providers.registry import default_registry

providers_app = typer.Typer(help="Inspect provider contracts.", no_args_is_help=True)


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
        payload = error_payload(
            code="invalid_input",
            stage="provider",
            message=f"Unknown provider: {provider_id}",
            action_hint="Run `fast-sub providers list` to see available providers.",
        )
        if json_output:
            echo_json(payload)
        else:
            err_console.print(f"[red]Unknown provider:[/red] {redact_secrets(provider_id)}")
        raise typer.Exit(2)

    provider = registry.inspect(provider_id)
    if json_output:
        console.print_json(data=provider.model_dump(mode="json"))
        return

    console.print(f"{provider.metadata.id}: {provider.status.status.value}")
    console.print(provider.status.message)
