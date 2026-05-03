from __future__ import annotations

import re

from typer.testing import CliRunner

import fast_sub.cli.runtime as cli

runner = CliRunner()


def _normalized(text: str) -> str:
    text = re.sub(r"\x1b\[[0-9;]*m", "", text)
    text = text.replace("\r\n", "\n")
    return re.sub(r"[ \t]+", " ", text)


def test_root_help_keeps_public_command_families() -> None:
    result = runner.invoke(cli.app, ["--help"])

    assert result.exit_code == 0
    help_text = _normalized(result.stdout)
    for command in [
        "auto",
        "bench",
        "bench-translate",
        "burn",
        "models",
        "providers",
        "run",
        "transcribe",
        "translate",
    ]:
        assert command in help_text
    assert "Fast local subtitles for video." in help_text


def test_smoke_help_surfaces_stable_options() -> None:
    cases = {
        ("transcribe", "--help"): ["--provider", "--model", "--language", "--json"],
        ("translate", "--help"): ["--provider", "--to", "--mode", "--json"],
        ("bench", "--help"): ["--profile", "--repeat", "--markdown", "--json"],
        ("bench-translate", "--help"): ["--reference", "--provider", "--to", "--json"],
    }

    for args, expected_fragments in cases.items():
        result = runner.invoke(cli.app, list(args))
        assert result.exit_code == 0
        help_text = _normalized(result.stdout)
        for fragment in expected_fragments:
            assert fragment in help_text
