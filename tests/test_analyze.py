import shutil
import subprocess
from pathlib import Path

import pytest

from fast_sub.contracts.errors import SubGenError
from fast_sub.media.service import (
    CLIPPING_RISK_WARNING,
    FRAGMENTED_SPEECH_WARNING,
    HIGH_SILENCE_RATIO_WARNING,
    LOW_VOLUME_WARNING,
    TimeInterval,
    analyze_media,
    build_analysis_result,
    parse_ffmpeg_analysis,
    recommend_mode,
    recommend_vad,
)


def test_parse_ffmpeg_analysis_extracts_volume_and_silence_segments() -> None:
    parsed = parse_ffmpeg_analysis(
        """
        [silencedetect @ 000] silence_start: 1.25
        [silencedetect @ 000] silence_end: 2.75 | silence_duration: 1.50
        [Parsed_volumedetect_1 @ 000] mean_volume: -22.5 dB
        [Parsed_volumedetect_1 @ 000] max_volume: -2.1 dB
        """
    )

    assert parsed.mean_volume_db == -22.5
    assert parsed.peak_volume_db == -2.1
    assert parsed.silence_segments == [TimeInterval(1.25, 2.75)]


def test_build_analysis_result_calculates_ratios_and_recommendations() -> None:
    result = build_analysis_result(
        duration_sec=10.0,
        mean_volume_db=-22.5,
        peak_volume_db=-2.1,
        silence_segments=[TimeInterval(2.0, 4.0), TimeInterval(8.0, 9.0)],
    )

    assert result.silence_ratio == 0.3
    assert result.speech_ratio == 0.7
    assert result.estimated_segments == 3
    assert result.avg_segment_sec == pytest.approx(2.333)
    assert result.recommended_vad == "normal"
    assert result.recommended_mode == "fast"
    assert result.warnings == []


@pytest.mark.parametrize(
    ("duration_sec", "silence_ratio", "expected"),
    [
        (600.0, 0.36, "aggressive"),
        (600.0, 0.16, "normal"),
        (60.0, 0.10, "off"),
        (600.0, 0.10, "normal"),
    ],
)
def test_recommend_vad_rules(
    duration_sec: float,
    silence_ratio: float,
    expected: str,
) -> None:
    assert recommend_vad(duration_sec, silence_ratio) == expected


def test_recommend_mode_uses_quality_for_parseable_warning_enums() -> None:
    assert recommend_mode(600.0, [LOW_VOLUME_WARNING]) == "quality"
    assert recommend_mode(600.0, [FRAGMENTED_SPEECH_WARNING]) == "quality"
    assert recommend_mode(600.0, [HIGH_SILENCE_RATIO_WARNING]) == "quality"
    assert recommend_mode(30.0, []) == "fast"
    assert recommend_mode(600.0, [CLIPPING_RISK_WARNING]) == "balanced"


def test_warning_rules_are_stable_enums() -> None:
    result = build_analysis_result(
        duration_sec=60.0,
        mean_volume_db=-40.0,
        peak_volume_db=-0.2,
        silence_segments=[TimeInterval(index * 2.0, index * 2.0 + 0.8) for index in range(25)],
    )

    assert result.warnings == [
        LOW_VOLUME_WARNING,
        CLIPPING_RISK_WARNING,
        FRAGMENTED_SPEECH_WARNING,
    ]
    assert all(warning.isupper() for warning in result.warnings)


def test_analyze_media_maps_ffmpeg_failure_to_user_error(monkeypatch: pytest.MonkeyPatch) -> None:
    media = Path("tests/fixtures/sample.wav")

    def fake_run(command, capture_output, check):  # noqa: ANN001
        if command[0] == "ffprobe":
            return subprocess.CompletedProcess(
                command,
                0,
                stdout=b'{"streams":[{"index":0,"codec_type":"audio"}],"format":{"duration":"1"}}',
                stderr=b"",
            )
        return subprocess.CompletedProcess(command, 1, stdout=b"", stderr=b"filter failed")

    monkeypatch.setattr(shutil, "which", lambda name: name)
    monkeypatch.setattr(subprocess, "run", fake_run)

    with pytest.raises(SubGenError, match="ffmpeg failed to analyze audio"):
        analyze_media(media)


def test_analyze_media_runs_on_fixture_when_ffmpeg_is_available() -> None:
    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        return

    result = analyze_media(Path("tests/fixtures/sample.wav"))

    assert result.duration_sec is not None
    assert result.duration_sec > 0
    assert 0 <= result.speech_ratio <= 1
    assert 0 <= result.silence_ratio <= 1
    assert result.recommended_vad in {"off", "normal", "aggressive"}
    assert result.recommended_mode in {"fast", "balanced", "quality"}
