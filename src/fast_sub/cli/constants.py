from __future__ import annotations

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

__all__ = ["COMMAND_NAMES", "OPENAI_BASE_URL"]
