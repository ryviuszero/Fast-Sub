import json
import shutil
import uuid
from pathlib import Path

import pysubs2
from typer.testing import CliRunner

from fast_sub.cli import app
from fast_sub.subtitle import RefineOptions, refine_srt_text

SRT_WITH_EMPTY_AND_OVERLAP = """1
00:00:00,000 --> 00:00:00,500
Hi

2
00:00:00,400 --> 00:00:01,200


3
00:00:00,800 --> 00:00:02,000
there
"""


def test_refine_removes_blank_cues_merges_short_and_repairs_overlap() -> None:
    refined = refine_srt_text(SRT_WITH_EMPTY_AND_OVERLAP, RefineOptions(lang="en"))
    subs = pysubs2.SSAFile.from_string(refined, format_="srt")

    assert len(subs.events) == 1
    assert subs.events[0].text == "Hi there"
    assert subs.events[0].start == 0
    assert subs.events[0].end == 2000


def test_refine_splits_long_english_text_into_readable_lines() -> None:
    refined = refine_srt_text(
        """1
00:00:00,000 --> 00:00:08,000
This is a deliberately long English subtitle line that should be wrapped and split into
smaller readable subtitles for common players.
""",
        RefineOptions(lang="en", max_chars=42, max_duration=6),
    )
    subs = pysubs2.SSAFile.from_string(refined, format_="srt")

    assert len(subs.events) > 1
    assert all(event.start < event.end for event in subs.events)
    assert all(len(line) <= 42 for event in subs.events for line in event.text.split("\\N"))


def test_refine_uses_cjk_line_length_when_language_is_auto() -> None:
    refined = refine_srt_text(
        """1
00:00:00,000 --> 00:00:05,000
这是一个比较长的中文字幕它应该按照较短的默认长度进行拆行以便观看
""",
        RefineOptions(lang="auto"),
    )
    subs = pysubs2.SSAFile.from_string(refined, format_="srt")

    assert all(len(line) <= 22 for event in subs.events for line in event.text.split("\\N"))


def test_refine_cli_writes_default_output_and_json() -> None:
    work_dir = _make_work_dir()
    try:
        input_path = work_dir / "input.srt"
        input_path.write_text(SRT_WITH_EMPTY_AND_OVERLAP, encoding="utf-8")

        result = CliRunner().invoke(app, ["refine", str(input_path), "--json"])

        assert result.exit_code == 0
        payload = json.loads(result.stdout)
        output_path = work_dir / "input.refined.srt"
        assert payload["ok"] is True
        assert payload["output"] == str(output_path)
        assert output_path.exists()
    finally:
        shutil.rmtree(work_dir)


def _make_work_dir() -> Path:
    work_dir = Path(".test-work") / uuid.uuid4().hex
    work_dir.mkdir(parents=True)
    return work_dir
