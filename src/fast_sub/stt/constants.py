from __future__ import annotations

from fast_sub.providers.constants import DEFAULT_STT_MODEL, DEFAULT_STT_PROVIDER

DEFAULT_PROVIDER = DEFAULT_STT_PROVIDER
DEFAULT_MODEL = DEFAULT_STT_MODEL
DEFAULT_LANGUAGE = "auto"
DEFAULT_DEVICE = "auto"
DEFAULT_COMPUTE_TYPE = "auto"
DEFAULT_BATCH_SIZE = 4
DEFAULT_GPU_LOAD = "balanced"
DEFAULT_VAD = "auto"
DEFAULT_MODE = "balanced"
GPU_LOAD_BATCH_SIZES = {
    "low": 2,
    "balanced": DEFAULT_BATCH_SIZE,
    "max": 8,
}
VALID_LANGUAGES = {"auto", "zh", "en", "ja", "ko"}
VALID_DEVICES = {"auto", "cuda", "cpu"}
VALID_COMPUTE_TYPES = {"auto", "float16", "int8_float16", "int8"}
VALID_VAD = {"auto", "off", "normal", "aggressive"}
VALID_MODES = {"fast", "balanced", "quality"}
VALID_GPU_LOADS = set(GPU_LOAD_BATCH_SIZES)
WORKER_COMMAND_ENV = "FAST_SUB_STT_WORKER_COMMAND"

__all__ = [
    "DEFAULT_BATCH_SIZE",
    "DEFAULT_COMPUTE_TYPE",
    "DEFAULT_DEVICE",
    "DEFAULT_GPU_LOAD",
    "DEFAULT_LANGUAGE",
    "DEFAULT_MODE",
    "DEFAULT_MODEL",
    "DEFAULT_PROVIDER",
    "DEFAULT_VAD",
    "GPU_LOAD_BATCH_SIZES",
    "VALID_COMPUTE_TYPES",
    "VALID_DEVICES",
    "VALID_GPU_LOADS",
    "VALID_LANGUAGES",
    "VALID_MODES",
    "VALID_VAD",
    "WORKER_COMMAND_ENV",
]
