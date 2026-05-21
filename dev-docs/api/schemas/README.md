# Schema Reference

Generated: 2026-05-21

This directory indexes JSON shapes that cross process, CLI, daemon, worker, or UI boundaries. The hand-written contract source of truth remains:

- `../../go-docs/specs/daemon-api.md`
- `../../ui-docs/architecture.md`
- `../go/README.md`
- `../python/README.md`
- `../desktop/README.md`

Generation command:

```powershell
rg -n "json:\"|BaseModel|interface |export type|schema_version|ok|error" internal src desktop/shared desktop/preload desktop/renderer/src/client -g "*.go" -g "*.py" -g "*.ts"
```

## Stable Schema Versions

| Schema | Current Version | Source |
| --- | --- | --- |
| Go daemon envelope | `1` | `internal/contracts/daemon.go` |
| Go jobs | `schema_version` field, currently daemon-aligned | `internal/jobs/types.go` |
| Go STT worker request/response | `1` | `internal/worker/stt.go` |
| Python STT worker request/response | `1` | `src/fast_sub/contracts/worker.py` |
| Go model manifest | `1` | `internal/models/manifest.go` |

## Daemon API Envelope

Success:

```json
{
  "schema_version": 1,
  "ok": true,
  "result": {},
  "error": null,
  "warnings": []
}
```

Failure:

```json
{
  "schema_version": 1,
  "ok": false,
  "result": null,
  "error": {
    "code": "missing_model",
    "stage": "model",
    "message": "Model is not installed.",
    "action_hint": "Install a compatible model.",
    "details": {}
  },
  "warnings": []
}
```

## Job Create Request

```json
{
  "schema_version": 1,
  "type": "transcribe",
  "model_id": "",
  "input_path": "C:/path/input.wav",
  "subtitle_path": "",
  "output_path": "C:/path/output.srt",
  "provider": "local-faster-whisper",
  "model": "whisper-small",
  "model_path": "",
  "language": "auto",
  "target_language": "en",
  "output_type": "original_srt",
  "output_format": "srt",
  "word_timestamps": "false",
  "translation_provider": "local-nllb-ct2",
  "translation_model": "nllb-200-distilled-600m-ct2-int8",
  "translation_upload_confirmed": false,
  "options": {}
}
```

Supported `type` values:

```text
transcribe
model_install
translate_srt
burn_in
```

## Job Snapshot

```json
{
  "schema_version": 1,
  "job_id": "job_123",
  "type": "transcribe",
  "status": "running",
  "stage": "transcribing",
  "progress": {
    "percent": 45,
    "current": 0,
    "total": 0
  },
  "provider": "local-faster-whisper",
  "model": "whisper-small",
  "input_path": "C:/path/input.wav",
  "output_path": "C:/path/output.srt",
  "created_at": "2026-05-21T00:00:00Z",
  "started_at": "2026-05-21T00:00:01Z",
  "finished_at": null,
  "result": null,
  "error": null
}
```

## Job Result Envelope

```json
{
  "job_id": "job_123",
  "status": "succeeded",
  "result": {
    "input_path": "C:/path/input.wav",
    "output_path": "C:/path/output.srt",
    "language": "en",
    "segments": 42,
    "elapsed_sec": 12.3,
    "provider": "local-faster-whisper",
    "model": "whisper-small",
    "warnings": []
  },
  "error": null
}
```

## Provider List Item

```json
{
  "id": "local-faster-whisper",
  "type": "stt",
  "location": "local",
  "backend": "faster-whisper-python-worker",
  "offline": true,
  "requires_api_key": false,
  "requires_model": true,
  "privacy_note": "Runs transcription locally through the Python faster-whisper worker. Audio is not uploaded.",
  "supported_languages": ["auto", "en", "zh", "ja", "ko"],
  "supports_word_timestamps": true,
  "supports_batch": true,
  "capabilities": ["transcribe", "srt", "word_timestamps"],
  "compatible_model_types": ["asr"],
  "status": "available",
  "check_mode": "static",
  "warnings": []
}
```

## Provider Check Result

```json
{
  "provider_id": "api-openai-chat",
  "status": "available",
  "check_mode": "live",
  "available": true,
  "metadata": {},
  "checks": [
    {
      "name": "models_endpoint",
      "ok": true,
      "status": "available",
      "message": "OpenAI-compatible endpoint responded successfully."
    }
  ],
  "warnings": [],
  "action_hint": "",
  "details": {
    "live_network": true,
    "base_url": "https://api.openai.com/v1",
    "api_key_configured": true
  }
}
```

## Model Manifest

```json
{
  "schema_version": 1,
  "models": [
    {
      "id": "whisper-small",
      "name": "Whisper Small",
      "type": "asr",
      "backend": "faster-whisper",
      "artifact_kind": "model",
      "compatible_providers": ["local-faster-whisper"],
      "revision": "536b0662742c02347bc0e980a01041f333bce120",
      "size_bytes": 486212372,
      "license": "MIT",
      "urls": ["https://example.invalid/model/"],
      "required_files": [
        {
          "path": "model.bin",
          "size_bytes": 483546902,
          "sha256": "sha256hex"
        }
      ],
      "privacy_class": "local",
      "install_layout": "directory",
      "source_type": "http",
      "platforms": ["all"],
      "min_disk_free_bytes": 510522990,
      "estimated_ram_bytes": 2147483648
    }
  ]
}
```

Do not replace real manifest URLs with examples in source code. The example above intentionally avoids copying a live URL into the schema sample.

## STT Worker Request

```json
{
  "schema_version": 1,
  "job_id": "job_123",
  "audio_path": "C:/path/audio.16k.mono.wav",
  "model_path": "C:/path/model",
  "language": "auto",
  "device": "auto",
  "compute_type": "auto",
  "batch_size": 8,
  "vad": "normal",
  "mode": "balanced",
  "word_timestamps": false
}
```

## STT Worker Response

```json
{
  "schema_version": 1,
  "provider": "local-faster-whisper",
  "language": "en",
  "elapsed_sec": 10.2,
  "actual_device": "cpu",
  "actual_compute_type": "int8",
  "segments": [
    {
      "id": 1,
      "start": 0.0,
      "end": 2.5,
      "text": "Hello world.",
      "words": []
    }
  ],
  "warnings": [],
  "error": null,
  "ok": true
}
```

Worker error:

```json
{
  "schema_version": 1,
  "error": {
    "code": "MODEL_NOT_FOUND",
    "message": "Model path does not exist.",
    "retryable": false,
    "details": {},
    "stderr_tail": ""
  }
}
```

## Desktop Create Job Request

Renderer/main request shape:

```json
{
  "type": "transcribe",
  "inputPaths": ["C:/path/input.wav"],
  "outputDirectory": "C:/path",
  "outputPath": "C:/path/output.srt",
  "outputType": "original_srt",
  "outputFormat": "srt",
  "outputConflict": "ask",
  "language": "auto",
  "targetLanguage": "en",
  "providerId": "local-faster-whisper",
  "modelId": "whisper-small",
  "translationProviderId": "local-nllb-ct2",
  "translationModelId": "nllb-200-distilled-600m-ct2-int8",
  "translationUploadConfirmed": false,
  "remoteUploadConfirmed": false
}
```

Desktop request fields are adapted by the main process before daemon submission.

## Desktop Job Event

```json
{
  "type": "progress",
  "progress": {
    "status": "running",
    "progressPercent": 45,
    "stageLabel": "Transcribing",
    "currentFile": "input.wav"
  }
}
```

## Privacy And Redaction Rules

Generated schema samples must not contain:

- Real API keys.
- Ready tokens.
- Authorization headers.
- Signed URLs.
- Proxy credentials.
- Real user media paths.
- Machine-specific local absolute paths from a contributor machine.

Use synthetic paths such as `C:/path/input.wav` or `<repo>` in examples.
