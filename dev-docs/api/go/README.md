# Go API Reference

Generated: 2026-05-21

Source paths:

- `cmd/fast-sub-go/`
- `internal/cli/`
- `internal/contracts/`
- `internal/daemon/`
- `internal/jobs/`
- `internal/providers/`
- `internal/models/`
- `internal/worker/`
- `internal/runtime/openai/`
- `internal/runtime/whispercpp/`
- `internal/ffmpeg/`
- `internal/subtitle/`

Generation command:

```powershell
rg -n "^(type|func|const|var) [A-Z]|^func \(.*\) [A-Z]|^type [A-Za-z0-9_]+ struct|^type [A-Za-z0-9_]+ interface" internal cmd -g "*.go"
```

This page is a checked-in reference snapshot. The source of truth for daemon behavior remains `../../go-docs/specs/daemon-api.md`.

## Module

```text
module fast-sub
go 1.22
```

## CLI Entry

`cmd/fast-sub-go/main.go` starts the Go CLI and delegates command handling to `internal/cli`.

Primary command areas:

- `serve` / `daemon`: start the loopback daemon.
- `doctor`: inspect local native dependencies.
- `probe`: inspect media metadata through ffprobe.
- `extract`: extract normalized audio through ffmpeg.
- `providers list|test`: inspect provider readiness.
- `models list|install|verify`: manage Go-managed model artifacts.
- `transcribe` / `auto`: run transcription through selected providers.

Public behavior constraints:

- JSON stdout must remain parseable and free of logs.
- Secret values and credential-bearing URLs must be redacted.
- CLI flags, JSON fields, and exit codes are contract-sensitive.

## Structured Errors

Source: `internal/errors/errors.go`

`AppError` JSON shape:

```json
{
  "code": "missing_model",
  "stage": "model",
  "message": "Human-readable redacted message.",
  "action_hint": "Optional recovery hint.",
  "details": {}
}
```

Stable error codes:

| Code | Meaning |
| --- | --- |
| `invalid_input` | User input or filesystem path is invalid. |
| `invalid_usage` | CLI usage is invalid. |
| `missing_dependency` | Required binary, package, or runtime dependency is unavailable. |
| `missing_worker` | STT worker command is unavailable. |
| `missing_model` | Required local model is missing or incompatible. |
| `missing_api_key` | Remote API authentication is required or rejected. |
| `api_failed` | Remote API call failed. |
| `not_implemented` | Requested feature is not implemented. |
| `provider_unavailable` | Selected provider is not currently usable. |
| `download_failed` | Model or artifact download failed. |
| `model_install_busy` | Another model install lock is active or recovering. |
| `hash_mismatch` | Downloaded artifact did not match expected SHA-256. |
| `output_exists` | Output path exists and overwrite was not allowed. |
| `ffmpeg_failed` | ffmpeg operation failed. |
| `ffprobe_failed` | ffprobe operation failed. |
| `worker_failed` | Worker returned a failed response or process failure. |
| `worker_timeout` | Worker exceeded timeout. |
| `worker_canceled` | Worker was canceled. |
| `worker_protocol_error` | Worker request/response schema was invalid. |
| `canceled` | User or daemon canceled the job. |
| `permission_denied` | Filesystem permission failure. |
| `disk_full` | Disk space failure. |

Exit code mapping:

| Exit Code | Meaning |
| --- | --- |
| `0` | Success. |
| `1` | General failure. |
| `2` | Invalid input, usage, output exists, or not implemented. |
| `3` | Missing dependency or worker. |
| `4` | Missing model. |
| `5` | Disk full, missing API key, provider unavailable, or model install busy. |
| `6` | Permission denied. |
| `7` | ffmpeg/ffprobe process failed. |
| `8` | Worker protocol, timeout, canceled, or worker failure. |

## Daemon Envelope

Source: `internal/contracts/daemon.go`

`DaemonSchemaVersion` is `1`.

`APIResponse`:

| Field | Type | Notes |
| --- | --- | --- |
| `schema_version` | `int` | Current value is `1`. |
| `ok` | `boolean` | Success flag. |
| `result` | `any` | Endpoint-specific result. |
| `error` | `AppError | null` | Structured error on failure. |
| `warnings` | `string[]` | Redaction-safe warnings. |

`Ready`:

| Field | Type | Notes |
| --- | --- | --- |
| `schema_version` | `int` | Current value is `1`. |
| `ready` | `boolean` | Whether daemon is ready. |
| `base_url` | `string` | Loopback daemon URL. |
| `token` | `string` | Ready token. Treat as secret. |
| `pid` | `int` | Daemon process id. |

Security boundary:

- Daemon listens on loopback.
- Non-health/version endpoints require the ready token.
- Ready token, Authorization headers, signed URLs, and proxy credentials must not be logged raw.

## Jobs

Source: `internal/jobs/types.go`

Job statuses:

```text
created
queued
running
canceling
succeeded
failed
canceled
interrupted
```

Terminal statuses:

```text
succeeded
failed
canceled
interrupted
```

`CreateRequest`:

| JSON Field | Go Field | Notes |
| --- | --- | --- |
| `schema_version` | `SchemaVersion` | Request schema version. |
| `type` | `Type` | `transcribe`, `model_install`, `translate_srt`, or `burn_in`. |
| `model_id` | `ModelID` | Model id for model jobs. |
| `input_path` | `InputPath` | Local input media/SRT/text path. |
| `subtitle_path` | `SubtitlePath` | Subtitle path for burn-in jobs. |
| `output_path` | `OutputPath` | Requested output path. |
| `provider` | `Provider` | ASR provider id. |
| `model` | `Model` | ASR model id/name. |
| `model_path` | `ModelPath` | Explicit local model path. |
| `language` | `Language` | Source language or `auto`. |
| `target_language` | `TargetLanguage` | Translation target language. |
| `output_type` | `OutputType` | Desktop/main-flow output type. |
| `output_format` | `OutputFormat` | Output format. |
| `word_timestamps` | `WordTimestamps` | Word timestamp request string. |
| `translation_provider` | `TranslationProvider` | Translation provider id. |
| `translation_model` | `TranslationModel` | Translation model id/name. |
| `translation_upload_confirmed` | `TranslationUploadConfirmed` | Required for remote text upload. |
| `options` | `Options` | Job-specific options. |

`Job`:

| JSON Field | Type | Notes |
| --- | --- | --- |
| `schema_version` | `int` | Current job schema. |
| `job_id` | `string` | Stable job id. |
| `type` | `string` | Job kind. |
| `status` | `string` | Job status. |
| `stage` | `string` | Current processing stage. |
| `progress` | `Progress` | Percent/current/total progress. |
| `provider` | `string` | Provider id. |
| `model` | `string` | Model id/name. |
| `input_path` | `string` | Local path. |
| `output_path` | `string` | Local path. |
| `created_at` | `time` | Creation timestamp. |
| `started_at` | `time | null` | Start timestamp. |
| `finished_at` | `time | null` | Finish timestamp. |
| `result` | `Result | null` | Present on success. |
| `error` | `AppError | null` | Present on failure. |

`Result`:

| JSON Field | Type |
| --- | --- |
| `input_path` | `string` |
| `output_path` | `string` |
| `language` | `string` |
| `segments` | `int` |
| `elapsed_sec` | `float` |
| `provider` | `string` |
| `model` | `string` |
| `api_upload_format` | `string` |
| `warnings` | `string[]` |

## Providers

Source: `internal/providers/providers.go`

Provider statuses:

```text
available
missing_dependency
missing_model
missing_api_key
invalid_config
disabled
not_implemented
```

Check modes:

```text
static
live
```

Registered provider ids:

| Provider ID | Type | Location | Backend | Upload Behavior |
| --- | --- | --- | --- | --- |
| `local-faster-whisper` | `stt` | `local` | `faster-whisper-python-worker` | Local only. |
| `local-whisper-cpp` | `stt` | `native` | `whisper.cpp` | Local only. |
| `api-openai-transcription` | `stt` | `api` | `openai-compatible-transcription` | Uploads audio only when explicitly selected. |
| `local-nllb-ct2` | `translation` | `local` | `nllb-ct2` | Local only. |
| `web-bing` | `translation` | `web` | `bing-web-translate` | Uploads subtitle text only when explicitly selected; no-key, experimental, best-effort packaged helper path. |
| `web-google` | `translation` | `web` | `google-web-translate` | Uploads subtitle text only when explicitly selected; no-key, experimental, best-effort packaged helper path. |
| `api-openai-chat` | `translation` | `api` | `openai-compatible-chat` | Uploads subtitle text only when explicitly selected. |

`Metadata` fields:

```text
id
type
location
backend
offline
requires_api_key
requires_model
privacy_note
supported_languages
supports_word_timestamps
supports_batch
capabilities
compatible_model_types
```

`CheckResult` fields:

```text
provider_id
status
check_mode
available
metadata
checks
warnings
action_hint
details
```

## Models

Source: `internal/models/manifest.go`

`Manifest`:

| JSON Field | Type |
| --- | --- |
| `schema_version` | `int` |
| `models` | `ManifestEntry[]` |

`ManifestEntry`:

| JSON Field | Notes |
| --- | --- |
| `id` | Stable model id. |
| `name` | Display name. |
| `type` | `asr`, `translate`, or artifact type. |
| `backend` | Runtime backend such as `faster-whisper`, `whisper.cpp`, or `nllb-ct2`. |
| `artifact_kind` | `model` or native artifact kind. |
| `compatible_providers` | Provider ids that can use this artifact. |
| `version` | Optional version. |
| `revision` | Upstream revision. |
| `size_bytes` | Download/install size basis. |
| `license` | License label. |
| `license_url` | Optional license URL. |
| `urls` | Download source URLs. |
| `sha256` | Required for file layout. |
| `required_files` | Required files for directory layout. |
| `default_for` | Providers for which this is default. |
| `privacy_class` | Usually `local`. |
| `install_layout` | `file` or `directory`. |
| `source_type` | Download source type. |
| `etag` | Optional HTTP validator. |
| `platforms` | `all`, OS, or OS/arch filters. |
| `min_disk_free_bytes` | Recommended minimum free disk. |
| `estimated_ram_bytes` | Runtime memory hint. |

Built-in model ids:

```text
whisper-base
whisper-small
whisper-large-v3-turbo
whispercpp-base
whispercpp-small
whispercpp-large-v3-turbo-q5_0
nllb-200-distilled-600m-ct2-int8
```

Default local-first policy:

- Prefer small/default models for first-run installation.
- Do not bundle model files in release packages.
- Download, verify, and install models into managed local storage.

## STT Worker Bridge

Source: `internal/worker/stt.go`

`STTSchemaVersion` is `1`.

`STTRequest`:

```text
schema_version
job_id
audio_path
model_path
language
device
compute_type
batch_size
vad
mode
word_timestamps
```

`STTResponse`:

```text
schema_version
provider
language
elapsed_sec
actual_device
actual_compute_type
segments
warnings
error
ok
```

`STTWorkerError`:

```text
code
message
retryable
details
stderr_tail
```

Worker environment policy:

- Worker subprocess env is allowlisted.
- API keys are not passed to the local STT worker.
- Python UTF-8 env values are forced for Windows-safe text handling.
- `UV_CACHE_DIR=.uv-cache` is provided when not already set.

## Native Runtime Helpers

Important packages:

- `internal/ffmpeg`: ffmpeg/ffprobe probing, extraction, API upload preparation, and burn-in.
- `internal/runtime/openai`: OpenAI-compatible transcription client.
- `internal/runtime/whispercpp`: whisper.cpp binary discovery, capability detection, JSON/SRT parsing, and transcription.
- `internal/subtitle`: segment models and SRT rendering/refinement.

Contract-sensitive functions:

- `ffmpeg.Runner.PrepareAPIUploadAudio`
- `ffmpeg.Runner.BurnIn`
- `openai.Client.Transcribe`
- `whispercpp.Transcribe`
- `subtitle.RenderSRT`
- `subtitle.RefineSegments`

Keep all native stderr tails redacted before surfacing them through JSON, logs, or desktop diagnostics.
