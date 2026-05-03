from pathlib import Path

from typer.testing import CliRunner

import fast_sub.cli.commands.media_cmd as media_cmd
import fast_sub.cli.runtime as cli
from fast_sub.contracts.errors import SubGenError

runner = CliRunner()


def test_burn_command_writes_output(monkeypatch):
    calls = []

    def fake_burn_subtitles(input_file, subtitle_file, output=None, options=None):  # noqa: ANN001
        calls.append((input_file, subtitle_file, output, options))
        return output or Path("input.subtitled.mp4")

    monkeypatch.setattr(media_cmd, "burn_subtitles", fake_burn_subtitles)

    result = runner.invoke(
        cli.app,
        [
            "burn",
            "input.mp4",
            "input.srt",
            "--output",
            "out.mp4",
            "--font",
            "Noto Sans CJK SC",
            "--font-size",
            "30",
            "--preset",
            "quality",
        ],
    )

    assert result.exit_code == 0
    assert "Wrote subtitled video" in result.stdout
    input_file, subtitle_file, output, options = calls[0]
    assert input_file == Path("input.mp4")
    assert subtitle_file == Path("input.srt")
    assert output == Path("out.mp4")
    assert options.font == "Noto Sans CJK SC"
    assert options.font_size == 30
    assert options.preset == "quality"


def test_burn_command_returns_error(monkeypatch):
    def fake_burn_subtitles(input_file, subtitle_file, output=None, options=None):  # noqa: ANN001
        raise SubGenError("ffmpeg failed to burn subtitles: bad filter")

    monkeypatch.setattr(media_cmd, "burn_subtitles", fake_burn_subtitles)

    result = runner.invoke(cli.app, ["burn", "input.mp4", "input.srt"])

    assert result.exit_code == 1
    assert "bad filter" in result.stdout
