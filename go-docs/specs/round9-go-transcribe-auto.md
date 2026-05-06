# Fast Sub Round 9: Go Transcribe And Auto Main Path

## Summary

Round 9 的目标是让并行 Go CLI 开始拥有本地字幕主路径：

```text
probe -> extract -> Python STT worker -> render SRT
```

Go 在本轮负责流程编排、路径、临时文件、结构化错误、JSON 输出、超时和子进程控制。Python 继续只负责模型 worker / AI adapter，不在本轮被重构成 Go 推理，也不替换 Python v0 CLI。

Round 9 仍然是并行迁移阶段：

- `fast-sub` Python CLI 继续作为稳定入口。
- `fast-sub-go` 增加 `transcribe` 和 `auto` preview。
- 默认测试不能依赖真实模型、GPU、网络或真实 ffmpeg。

## Context From Round 8

Round 8 已新增：

- `go.mod`
- `cmd/fast-sub-go`
- `internal/cli`
- `internal/errors`
- `internal/ffmpeg`
- `internal/media`
- `internal/paths`
- `fast-sub-go --version`
- `fast-sub-go doctor [--json]`
- `fast-sub-go probe <input> [--json]`
- `fast-sub-go extract <input> --output <wav> [--json]`

Round 8 已确认：

- ffmpeg / ffprobe 使用 `exec.CommandContext`。
- Go `--json` 使用 `fast_sub_cli_result_v1` wrapper。
- fake ffmpeg / ffprobe 测试覆盖 JSON purity、常见失败、空格路径和中文路径。
- Go 测试按 Go 默认习惯放在被测 package 旁边。

Round 9 需要承接的兼容缺口：

- Python 部分命令当前仍输出裸 JSON payload，Go 使用统一 wrapper。Round 9 需要为共享命令增加 compatibility fixtures 或明确版本化策略。
- Go 还没有 worker request/response、SRT render、job/temp folder、cancel/timeout 清理和 `transcribe/auto`。

## Goals

- 实现 `fast-sub-go transcribe <input> [options]` preview。
- 实现 `fast-sub-go auto <input> [options]` preview，先等价路由到本地转写主路径。
- Go 编排本地字幕生成流程：
  - validate input
  - probe media
  - extract normalized 16kHz mono wav
  - write STT worker request JSON
  - run Python STT worker subprocess
  - read and validate worker response JSON
  - render `.srt`
  - emit structured result / error
- 建立 STT worker file protocol v1 的 Go-side model 和验证。
- 增加最小 job/temp folder，用于存放中间音频、request、response、stderr tail 和最终输出。
- 保持 JSON purity：`--json` stdout 在成功和失败时都必须可解析。
- 增加 Go/Python compatibility fixtures，锁住共享命令和 worker contract 的字段语义。
- 增加 fake worker 测试，默认测试不需要真实模型。

## Non-Goals

- 不替换 Python `fast-sub`。
- 不在 Go 中实现模型推理。
- 不接入 provider runtime。
- 不实现 translation provider orchestration。
- 不实现 model downloader / installer。
- 不实现 daemon、HTTP/WebSocket、job queue、background scheduler。
- 不实现 worker manager、worker pool、adaptive warm worker、resource lock。
- 不实现 Electron UI 或 Web。
- 不继续 Python refactor。
- 不使用 CGo ffmpeg bindings。
- 不要求默认测试使用真实 ffmpeg、真实模型、GPU 或网络。

## CLI Contract

新增命令：

```bash
fast-sub-go transcribe <input> [--output <srt>] [--model <id>] [--model-path <path>] [--language <lang|auto>] [--json]
fast-sub-go auto <input> [--output <srt>] [--model <id>] [--model-path <path>] [--language <lang|auto>] [--json]
```

Round 9 建议先支持最小稳定选项：

- `--output`, `-o`
- `--model`
- `--model-path`
- `--language`
- `--worker-command`
- `--keep-temp`
- `--json`

默认行为：

- `language=auto`
- 不自动下载模型。
- 不静默上传任何音频或字幕文本。
- 缺 worker 返回 `missing_worker`。
- 缺模型或模型路径无效返回 `missing_model`。
- 输出路径不传时，按当前 Python v0 语义生成默认 `.srt` 路径，或者明确记录 Go preview 的版本化差异。

JSON success 顶层继续使用 Round 8 wrapper：

```json
{
  "schema_version": "fast_sub_cli_result_v1",
  "ok": true,
  "command": "transcribe",
  "result": {}
}
```

transcribe result 至少包含：

```json
{
  "input_path": "input.mp4",
  "output_path": "input.srt",
  "language": "zh",
  "segments": 10,
  "elapsed_sec": 12.34,
  "job_dir": ".fast-sub/jobs/..."
}
```

失败继续使用 structured error：

```json
{
  "schema_version": "fast_sub_cli_result_v1",
  "ok": false,
  "command": "transcribe",
  "exit_code": 1,
  "error": {
    "code": "worker_failed",
    "stage": "transcribing",
    "message": "Worker failed.",
    "action_hint": "Check worker installation and model path.",
    "details": {}
  }
}
```

## Worker File Protocol V1

Go 写 request JSON：

```json
{
  "schema_version": "stt_worker_request_v1",
  "job_id": "job_123",
  "audio_path": ".fast-sub/jobs/job_123/audio.wav",
  "model_path": "C:/FastSub/models/whisper-small",
  "language": "auto",
  "device": "auto",
  "compute_type": "auto",
  "batch_size": 8
}
```

Go 启动 worker：

```bash
fast-sub-worker-faster-whisper --request <job>/request.json --response <job>/response.json
```

Python worker 输出 response JSON：

```json
{
  "schema_version": "stt_worker_response_v1",
  "ok": true,
  "language": "zh",
  "segments": [
    {
      "start_sec": 0.0,
      "end_sec": 2.5,
      "text": "你好，欢迎使用 Fast Sub。"
    }
  ],
  "warnings": []
}
```

失败 response：

```json
{
  "schema_version": "stt_worker_response_v1",
  "ok": false,
  "error": {
    "code": "missing_model",
    "message": "Model path does not exist.",
    "retryable": false
  }
}
```

Rules:

- Worker stdout is reserved and should normally be empty.
- Worker stderr is human/debug logs only.
- Go captures stderr tail for structured errors.
- Go reads response only after worker exits.
- Response must contain expected `schema_version`.
- Invalid JSON, missing response file, wrong schema, missing segments, and worker non-zero exit become structured Go errors.
- Response writing should be atomic on Python side: write `.tmp`, then rename to final response.

## Worker Discovery

Round 9 should implement a conservative discovery order:

1. Explicit `--worker-command`.
2. `FAST_SUB_STT_WORKER_COMMAND`.
3. `PATH` lookup for `fast-sub-worker-faster-whisper`.
4. Clear `missing_worker` error.

Do not add a worker manager or warm worker implementation in Round 9.

## Minimal Job Folder

Round 9 can add a minimal job/temp folder, without implementing a daemon job lifecycle:

```text
.fast-sub/
  jobs/
    job_<id>/
      audio.wav
      request.json
      response.json
      worker.stderr.log
      output.srt
```

Rules:

- Go owns final output path.
- Python worker does not write final SRT.
- On success, default cleanup policy may remove intermediate audio unless `--keep-temp` is set.
- On failure, keep request/response/stderr tail where practical for diagnosis.
- Never commit real job outputs.

## Progress And Cancel Minimum

Round 9 should not implement a full progress API, but should stabilize internal stage names:

```text
probing_media
extracting_audio
writing_worker_request
transcribing
rendering
done
```

Minimum cancel/timeout behavior:

- Use contexts for ffmpeg, ffprobe, and worker process.
- Ctrl+C or context cancellation should terminate active child process where practical.
- Timeout should clean incomplete temp output.
- Canceled work should not be reported as ordinary success.

## Error Codes

Round 9 should preserve and expand the structured error set:

```text
invalid_input
missing_dependency
missing_worker
missing_model
ffmpeg_failed
ffprobe_failed
worker_failed
worker_timeout
worker_canceled
worker_protocol_error
canceled
permission_denied
disk_full
```

Exit code guidance:

```text
0 success
1 general failure / worker failure
2 invalid input / usage
3 missing local dependency
4 missing model
7 ffmpeg / ffprobe failure
8 worker protocol / timeout / canceled family if useful
```

If exit codes differ from Python v0, document the versioned difference and add compatibility tests.

## SRT Rendering

Go should render final `.srt` from worker segments.

Rules:

- Preserve segment order.
- Reject negative timestamps.
- Reject `end_sec < start_sec`.
- Escape/normalize line endings consistently.
- Use stable SRT timestamp formatting: `HH:MM:SS,mmm`.
- Do not write an empty success SRT if worker returned no segments unless explicitly allowed and documented.

Suggested package:

```text
internal/subtitle
```

Only create this package when the renderer is implemented; do not create an empty package.

## Compatibility Fixtures

Add fixtures only where they lock stable contracts:

```text
tests/fixtures/go/cli/probe-success.json
tests/fixtures/go/cli/probe-missing-input.json
tests/fixtures/worker/stt-request.v1.json
tests/fixtures/worker/stt-response-success.v1.json
tests/fixtures/worker/stt-response-error.v1.json
```

Compatibility strategy:

- Normalize JSON formatting.
- Do not normalize away field names or field meanings.
- Explicitly document Go wrapper vs Python bare payload where they differ.
- API keys, Authorization headers, tokens, raw subtitle text, and sensitive local paths must not appear in fixtures unless redacted.

## Tests

Default `go test ./...` must use:

- fake ffmpeg / ffprobe where needed.
- fake STT worker binary.
- small local temp files.
- no network.
- no real model.
- no GPU.

Test coverage should include:

- `transcribe --json` success with fake worker.
- `auto --json` success with fake worker.
- missing input.
- missing ffmpeg / ffprobe.
- missing worker.
- missing model / model path.
- worker exits non-zero.
- worker writes invalid JSON.
- worker writes wrong schema.
- worker returns `ok=false`.
- worker timeout.
- empty segments behavior.
- invalid segment timestamps.
- output path exists without overwrite.
- Windows paths with spaces and Chinese characters.
- JSON stdout can be unmarshaled on success and failure.
- stderr diagnostics do not pollute JSON stdout.

Optional manual smoke:

```bash
go run ./cmd/fast-sub-go transcribe sample.mp4 --model-path <local-model> --json
go run ./cmd/fast-sub-go auto sample.mp4 --model-path <local-model> --json
```

Manual smoke may require real ffmpeg, Python worker, and a local model. It must not be part of default tests.

## Acceptance Criteria

- `gofmt` applied to changed Go files.
- `go test ./...` passes.
- `fast-sub-go --version` still works.
- `fast-sub-go doctor --json` still emits parseable JSON.
- `fast-sub-go probe <input> --json` still emits parseable JSON.
- `fast-sub-go extract <input> --output <wav> --json` still emits parseable JSON.
- `fast-sub-go transcribe <input> --json` works with a fake worker in tests.
- `fast-sub-go auto <input> --json` works with a fake worker in tests.
- Default tests do not require models, GPU, network, or real ffmpeg.
- Python v0 CLI is not replaced.
- Python runtime files are unchanged except fixtures or contract docs if absolutely needed.
- No worker manager, daemon, queue, resource lock, or warm worker implementation is introduced.

## Implementation Notes

- Keep `cmd/fast-sub-go` thin.
- Keep CLI stdout/stderr writer injection.
- Prefer standard library `flag` or the current small parser unless command complexity clearly justifies a CLI framework.
- Use `exec.CommandContext` for every subprocess.
- Use argument arrays, not shell command strings.
- Use `filepath` for paths.
- Keep details redaction-safe.
- Keep package creation demand-driven; do not add empty future packages.
