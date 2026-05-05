from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from fast_sub.media.constants import AnalysisWarning, RecommendedMode, RecommendedVad


@dataclass(frozen=True)
class TimeInterval:
    start_sec: float
    end_sec: float

    @property
    def duration_sec(self) -> float:
        return max(0.0, self.end_sec - self.start_sec)

    def as_dict(self) -> dict[str, float]:
        return {
            "start_sec": round(self.start_sec, 3),
            "end_sec": round(self.end_sec, 3),
            "duration_sec": round(self.duration_sec, 3),
        }


@dataclass(frozen=True)
class AnalysisResult:
    duration_sec: float | None
    speech_ratio: float
    silence_ratio: float
    mean_volume_db: float | None
    peak_volume_db: float | None
    estimated_segments: int
    avg_segment_sec: float
    recommended_vad: RecommendedVad
    recommended_mode: RecommendedMode
    warnings: list[AnalysisWarning] = field(default_factory=list)
    silence_segments: list[TimeInterval] = field(default_factory=list)
    speech_segments: list[TimeInterval] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "duration_sec": self.duration_sec,
            "speech_ratio": self.speech_ratio,
            "silence_ratio": self.silence_ratio,
            "mean_volume_db": self.mean_volume_db,
            "peak_volume_db": self.peak_volume_db,
            "estimated_segments": self.estimated_segments,
            "avg_segment_sec": self.avg_segment_sec,
            "recommended_vad": self.recommended_vad,
            "recommended_mode": self.recommended_mode,
            "warnings": list(self.warnings),
        }


@dataclass(frozen=True)
class FfmpegAnalysis:
    mean_volume_db: float | None
    peak_volume_db: float | None
    silence_segments: list[TimeInterval]


__all__ = ["AnalysisResult", "FfmpegAnalysis", "TimeInterval"]
