# Python API Reference

Generated: 2026-05-21

Source paths:

- `src/fast_sub/`
- `src/fast_sub_workers/`
- `pyproject.toml`

Generation command:

```powershell
rg -n "^(class|def) [A-Za-z_]|^[A-Z][A-Za-z0-9_]+ = |^@dataclass|^class [A-Za-z0-9_]+\\(" src\fast_sub src\fast_sub_workers -g "*.py"
```

This page is a checked-in reference snapshot. Python remains the v0 CLI, local worker, provider adapter, benchmark, and model-store ecosystem. Electron must not call Python internals directly.

## Package Entrypoints

From `pyproject.toml`:

```text
fast-sub = fast_sub.app:main
fast-sub-worker-faster-whisper = fast_sub_workers.faster_whisper:main
```

Optional extras:

| Extra | Purpose |
| --- | --- |
| `local-asr` | Installs `faster-whisper` for the local STT worker. |
| `local-translate` | Installs `ctranslate2` and `sentencepiece` for local NLLB translation. |

`web-translate` is intentionally not declared. The previous `translators`
dependency chain pulled in vulnerable `js2py` releases, so web translation
support is disabled from packaged extras until the upstream chain is safe.

## Provider Contract

Source: `src/fast_sub/contracts/provider.py`

Enums:

| Enum | Values |
| --- | --- |
| `ProviderType` | `stt`, `translate` |
| `ProviderLocation` | `local`, `remote-web`, `api` |
| `ProviderStatusCode` | `available`, `missing_api_key`, `missing_dependency`, `missing_model`, `not_implemented` |

Models:

`ProviderMetadata`:

```text
id
type
location
supported_languages
supports_word_timestamps
supports_batch
requires_gpu
offline
license
privacy_note
```

`ProviderStatus`:

```text
id
status
message
```

`ProviderInfo`:

```text
metadata
status
```

`SttProviderRequest`:

```text
job_id
audio_path
language
model_path
model
device
compute_type
batch_size
vad
mode
```

`SttProviderSegment`:

```text
start_sec
end_sec
text
confidence
words
```

`SttProviderResponse`:

```text
provider
language
elapsed_sec
actual_device
actual_compute_type
segments
warnings
```

`TranslationProviderRequest`:

```text
job_id
texts
source_language
target_language
mode
model
```

`TranslationProviderResponse`:

```text
provider
translations
warnings
```

## Worker Protocol

Source: `src/fast_sub/contracts/worker.py`

`WORKER_SCHEMA_VERSION` is `1`.

`SttWorkerRequest`:

| Field | Default | Notes |
| --- | --- | --- |
| `schema_version` | `1` | Numeric schema version. |
| `job_id` | Generated UTC id | Worker job id. |
| `audio_path` | Required | Normalized local audio path. |
| `language` | `auto` | Source language. |
| `model_path` | Required | Local model directory/file path. |
| `device` | `auto` | Runtime device. |
| `compute_type` | `auto` | Runtime compute type. |
| `batch_size` | `8` | Must be greater than `0`. |
| `vad` | `normal` | VAD mode. |
| `mode` | `balanced` | Runtime profile. |
| `word_timestamps` | `false` | Word timestamp request. |

`SttWorkerResponse` extends `SttProviderResponse` and adds `schema_version`.

`WorkerErrorResponse`:

```text
schema_version
error.code
error.message
error.retryable
error.details
error.stderr_tail
```

Worker implementation:

- `src/fast_sub_workers/faster_whisper.py`
- Provider id: `local-faster-whisper`
- Supported devices: `auto`, `cuda`, `cpu`
- Supported compute types: `auto`, `float16`, `int8_float16`, `int8`
- Supported VAD: `off`, `normal`, `aggressive`
- Supported modes: `fast`, `balanced`, `quality`

## STT Service

Source: `src/fast_sub/stt/service.py`

`TranscribeOptions`:

```text
provider
model
language
device
compute_type
batch_size
gpu_load
vad
mode
output
keep_temp
worker_command
```

`TranscribeResult.as_dict()` emits:

```text
srt_path
provider
model
device
compute_type
compute
actual_device
actual_compute_type
language_detected
duration_sec
duration
elapsed_sec
elapsed
worker_elapsed_sec
rtfx
segments_count
gpu_load
batch_size
warnings
```

Public functions:

- `transcribe_media(input_file, options)`: local STT pipeline entry.
- `normalize_worker_segments(raw_segments)`: validates and normalizes worker segments.
- `transcribe_error_payload(exc)`: returns CLI JSON error payload.

## Translation Service Models

Source: `src/fast_sub/translation/models.py`

`TranslateOptions`:

```text
provider
source_language
target_language
mode
bilingual_order
output
model
model_path
batch_size
timeout
sleep_seconds
resume
api_key
base_url
```

`TranslateSrtResult.as_dict()` emits:

```text
srt_path
provider
source_language
target_language
mode
cues_count
translated_count
failed_count
errors_path
checkpoint_path
warnings
```

`TranslationError`:

```text
batch_start_id
batch_end_id
message
raw_response
```

`TranslationResult`:

```text
segments
errors
```

Remote translation privacy:

- `web-bing`, `web-google`, and `api-openai-chat` upload subtitle text only when explicitly selected.
- Raw API keys must not be included in committed docs, logs, CLI args, or generated references.

## Subtitle Models

Source: `src/fast_sub/subtitles/models.py`

Enums:

| Enum | Values |
| --- | --- |
| `Mode` | `original`, `translated`, `bilingual` |
| `BilingualOrder` | `original-first`, `translated-first` |

Models:

`RefineOptions`:

```text
lang
max_chars
min_duration
max_duration
```

`SubtitleCue`:

```text
start
end
text
```

`Segment`:

```text
id
start
end
text
translation
```

## Auto Pipeline

Source: `src/fast_sub/pipeline/models.py`

`AutoOptions`:

```text
provider
model
language
device
compute_type
batch_size
gpu_load
vad
mode
output
dry_run
yes
keep_temp
refine_max_chars
refine_max_duration
worker_command
```

`AutoStep.as_dict()` emits:

```text
name
status
message
action_hint
details
```

`AutoResult.as_dict()` emits:

```text
ok
input
output
provider
model
language
dry_run
elapsed_sec
steps
error
transcribe
```

## Model Store

Source: `src/fast_sub/model_store/manifest.py`

`ModelManifestFile`:

```text
path
size_bytes
sha256
url
mirrors
```

`ModelManifestEntry`:

```text
id
name
type
backend
size_bytes
license
url
mirrors
sha256
recommended_for
filename
files
manifest_type
required_file_count
```

Built-in Python manifest ids:

```text
whisper-base
whisper-small
whisper-large-v3-turbo
nllb-200-distilled-600m-ct2-int8
```

## Media And Output Models

Source: `src/fast_sub/media/models.py`

`AnalysisResult.as_dict()` emits:

```text
duration_sec
speech_ratio
silence_ratio
mean_volume_db
peak_volume_db
estimated_segments
avg_segment_sec
recommended_vad
recommended_mode
warnings
```

Source: `src/fast_sub/output/models.py`

`BurnOptions`:

```text
font
font_size
preset
```

## Public CLI JSON Payloads

The Python CLI preserves these broad JSON envelope conventions:

- Success payloads include `ok: true` and command-specific result fields.
- Failure payloads include `ok: false` and `error`.
- Error payloads include stable `code`, `stage`, `message`, optional `action_hint`, and `details`.
- stdout JSON must not be mixed with logs.

CLI contract changes require updating tests, active docs, and any Go/Electron adapter that depends on the shape.
