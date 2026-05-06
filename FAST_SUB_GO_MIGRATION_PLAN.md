# Fast Sub Go Migration Plan

## Summary

Fast Sub v0 is currently a Python CLI technical preview for local source-language subtitles. The long-term product direction is:

```text
Go product core + Python model workers + native binaries
```

The Go migration should be incremental. It should not start as a full rewrite, and it should not remove the Python v0 CLI immediately. The migration goal is better packaging, process control, downloading, path handling, task orchestration, UI/daemon integration, and long-term stability. It is not expected to make faster-whisper GPU inference itself dramatically faster.

Recommended sequence:

```text
Round 7: translation provider loop
Round 7.5: translation benchmark report design
Round 7.75: Go 迁移前的 Python 可维护性整理
Round 8: Go migration foundation
Round 9: Go transcribe/auto main path
Round 10: Go product core before UI
Round 11: desktop UI
Round 12: Web version
```

Round 7 translation has landed in the Python CLI before Go owns the main subtitle path, closing a user-visible product gap. Round 7.5 adds a Python-side standalone `bench-translate` report so translation quality can be compared before Go migration; the existing `bench` command remains scoped to media transcription benchmark. Round 7.75 先做一轮小型 Python 可维护性整理，重点是拆分 CLI command handler、补 characterization tests，避免 Round 8 直接压在过大的 `cli.py` 上启动。Round 8 Go foundation should still stay limited to `doctor`, `probe`, `extract`, shared contracts, and compatibility tests. Round 8 must not replace the Python v0 CLI or change the user-facing default path.

Compatibility boundary:

- Go must preserve the user-facing semantics of `translate_srt_v1` when it later owns translation orchestration.
- Go must preserve or explicitly version the Python `bench_translate_v1` report schema: provider/model/source/target, hashes, privacy/upload class, cue counts, partial/all failure status, elapsed time, throughput, BLEU, chrF, exact match, reference alignment status, and canonical 0-1 score scale.
- Go compatibility tests should normalize JSON formatting but keep field meaning, exit code behavior, path redaction, and secret redaction compatible with the Python CLI.

## Target Architecture

```text
Go
= CLI / daemon / config / paths / logs / jobs / downloader / ffmpeg / provider runtime / SRT/ASS / benchmark

Python
= faster-whisper worker / NLLB worker / AI ecosystem adapters

Native binaries
= ffmpeg / ffprobe / whisper.cpp / ONNX / TensorRT / CTranslate2 workers

Desktop UI
= Electron or Tauri shell calling Go CLI/daemon

Web
= later, reusing job/provider/model contracts
```

The stable boundary between Go and workers is file-based JSON:

```text
Go writes request.json
Go starts worker process
Worker writes response.json
Worker logs to stderr
Go validates response.json
Go renders output / handles errors
```

Shared contracts should be treated as migration assets, not incidental implementation details:

```text
docs/schemas/stt-worker-request.v1.json
docs/schemas/stt-worker-response.v1.json
docs/schemas/stt-worker-error.v1.json
tests/fixtures/worker/request.v1.json
tests/fixtures/worker/response.v1.json
tests/fixtures/worker/error.v1.json
```

If full JSON Schema files feel too heavy for the first Go branch, the fixture files are still required. Go and Python should both validate against the same examples.

Worker response writing should be atomic:

```text
worker writes response.json.tmp
worker fsync/close where practical
worker renames response.json.tmp -> response.json
Go reads response.json only after process exit
Go validates schema_version before using payload
```

Worker logs and process output:

- Worker stdout is reserved and should normally be empty.
- Worker stderr is human/debug logs only.
- Go captures stderr tail for structured errors.
- `--json` command output must remain JSON-only on stdout.

Worker discovery order:

1. Explicit CLI option where available.
2. Environment override, for example `FAST_SUB_STT_WORKER_COMMAND`.
3. `PATH` lookup for `fast-sub-worker-faster-whisper`.
4. Python module fallback, for example `python -m fast_sub_workers.faster_whisper`, only when Python environment is known.
5. Clear `missing_worker` error with installation instructions.

Python workers must not:

- Read the main app configuration.
- Download models.
- Decide output paths.
- Write final SRT/ASS/MP4 outputs.
- Own UI/API scheduling.
- Silently upload audio or subtitle text.

## Proposed Go Project Layout

Round 8 should create a small but intentional Go layout instead of a single large `main.go`:

```text
go.mod
cmd/fast-sub-go/main.go
internal/cli
internal/errors
internal/media
internal/paths
internal/ffmpeg
internal/worker
internal/subtitle
internal/bench
internal/testutil
```

Initial package responsibilities:

- `internal/cli`: command wiring, stdout/stderr policy, JSON mode.
- `internal/errors`: v0 exit code and structured error contract.
- `internal/media`: media file validation and shared media types.
- `internal/ffmpeg`: `ffmpeg`/`ffprobe` command construction and parsing.
- `internal/paths`: model/cache/job/log path resolution, Windows path behavior.
- `internal/worker`: request/response schema, process launch, timeout, stderr tail, atomic response validation.
- `internal/subtitle`: SRT render/parse helpers when Go starts owning subtitle output.
- `internal/bench`: later Go benchmark orchestration.
- `internal/testutil`: fake ffmpeg/worker helpers and golden fixture comparison.

The `cmd/fast-sub-go` package should stay thin.

## Round 7: Translation Provider Loop

Goal: turn Fast Sub from a source-subtitle CLI into a usable subtitle translation tool.

Recommended branch:

```text
codex/fast-sub-translate-cli
```

Summary:

- Implement `fast-sub translate input.srt --to zh` as a real SRT translation command.
- Support installing the default local translation model through `fast-sub models install nllb-200-distilled-600m-ct2-int8`.
- Support three translation provider families:
  - free web translation through `translators`
  - OpenAI-compatible chat translation
  - local NLLB/CTranslate2 translation
- Land free web translation first with `web-bing` and `web-google`; `translators` is GPL-3.0 and is handled as the `web-translate` optional extra for packaging review.
- Require explicit provider selection or configuration before any subtitle text is sent to a third party.

CLI interface:

```text
fast-sub translate input.srt --to zh --provider web-bing
fast-sub translate input.srt --to zh --provider web-google
fast-sub translate input.srt --to zh --provider api-openai-chat --model <model>
fast-sub translate input.srt --to zh --provider local-nllb-ct2
fast-sub translate input.srt --to zh --provider local-nllb-ct2 --model-path <path>
```

Required command options:

- `--to <lang>` target language.
- `--provider <id>` unless configured in `[translator]`.

Supported command options:

- `--from auto`
- `--mode replace|bilingual`
- `--bilingual-order original-first|translated-first`
- `--output` / `-o`
- `--batch-size`
- `--timeout`
- `--sleep-seconds`
- `--json`

Provider behavior:

- `web-bing` maps to `translators.translate_text(..., translator="bing")`.
- `web-google` maps to `translators.translate_text(..., translator="google")`.
- Web providers require no API key but must clearly report that subtitle text is sent to third-party web translation services.
- Google may fail in mainland China network environments; errors should suggest retrying with `web-bing`.
- `api-openai-chat` uses an OpenAI-compatible chat endpoint and requires an API key plus an explicit model from CLI/config.
- `api-openai-chat` must not have a hard-coded default model.
- `local-nllb-ct2` defaults to model id `nllb-200-distilled-600m-ct2-int8` unless `--model` or `--model-path` is provided.
- Round 7 supports explicit `fast-sub models install nllb-200-distilled-600m-ct2-int8`; it does not make `auto --yes` install translation models by default.
- `local-nllb-ct2 --from auto` first uses lightweight subtitle language detection; if it cannot reliably infer `en|zh|ja|ko`, the CLI asks the user to pass `--from` explicitly. Go should preserve the FLORES-200 mapping (`eng_Latn`, `zho_Hans`, `jpn_Jpan`, `kor_Hang`) when it later owns translation orchestration.

Provider architecture:

- Reuse `ProviderType.TRANSLATE`, `TranslationProviderRequest`, and `TranslationProviderResponse`.
- Add `web-bing` and `web-google` as no-key remote translation providers in the provider registry.
- Route the `translate` CLI through a unified translation provider resolver.
- Resolve `local-nllb-ct2` through the model manager, not only through a raw `--model-path`.
- Keep the old `translators` helper only as legacy/internal support if needed; the CLI should use the provider layer.
- For chat providers, harden response parsing for fenced JSON, `<think>` blocks, prefix text, malformed JSON, and id/count mismatches.
- Redact API keys, Authorization headers, raw secrets, and sensitive request details from logs, JSON, and reports.

SRT behavior:

- Parse input SRT with `pysubs2` and convert cues to the existing `Segment` model.
- Keep cue order, time axis, and subtitle count stable.
- In `replace` mode, write translated text; if a line fails, fall back to the original line so the cue is not dropped.
- In `bilingual` mode, write original plus translation; if a line fails, preserve the original line.
- If every batch or every line fails, exit non-zero and do not write a misleading final subtitle file.
- Write `.errors.json` for translation warnings/failures where possible.

Configuration:

- Extend `[translator]` with:
  - `provider`
  - `model`
  - `base_url`
  - `api_key_env`
  - `model_path`
  - `batch_size`
  - `timeout`
  - `sleep_seconds`
- Document privacy differences between local, free web, and OpenAI-compatible API providers.
- Document that `translators` is GPL-3.0 licensed and must be reviewed before packaged distribution.

Acceptance:

- A 100-entry SRT produces a 100-entry translated or bilingual SRT for success and partial-failure cases.
- `translate --json` success and failure output are parseable.
- Missing provider, unknown provider, missing API key, missing installed NLLB model, missing local model path, and invalid batch size produce parseable errors.
- Missing local NLLB model points to `fast-sub models install nllb-200-distilled-600m-ct2-int8`.
- Partial failures exit successfully with warnings, original-text fallback, and `.errors.json`.
- All-line/all-batch failures exit non-zero and do not create a misleading translated subtitle.
- API keys and raw secrets never appear in logs, JSON, reports, or provider test output.
- Local translation is documented as memory-sensitive.

Test plan:

- Mock `translators.translate_text` to verify `web-bing` and `web-google` argument mapping.
- Cover `auto -> zh`, `en -> zh`, empty returns, exceptions, timeout behavior, and Google failure hints.
- Add CLI tests for provider-required errors, JSON purity, `replace`, `bilingual`, partial failure, and all-failure behavior.
- Add chat parser tests for plain JSON, fenced JSON, `<think>` output, prefix text, malformed JSON, and id/count mismatch.
- Add local NLLB resolver tests for missing dependency, missing installed model, invalid model id, and missing model path.

## Round 8: Go Migration Foundation

Goal: add a parallel Go CLI foundation without replacing Python v0.

Round 8 应该在 Round 7.75 Python cleanup 合并后开始；如果 Round 7.75 中途停在某个安全点，也必须明确记录停止原因。Round 8 不应该吸收 Python 重构工作；Round 8 中的 Python 改动应限制在 fixtures、golden compatibility outputs 或 Go 测试需要的 contract 文档。

Recommended branch:

```text
codex/fast-sub-go-foundation
```

Key work:

- Add a Go module and a separate Go entrypoint, such as `cmd/fast-sub-go`.
- Add the intentional Go project layout described above.
- Implement:
  - `fast-sub-go --version`
  - `fast-sub-go doctor`
  - `fast-sub-go probe`
  - `fast-sub-go extract`
- Match the v0 exit code and JSON error contract.
- Use direct `ffmpeg`/`ffprobe` binary execution through `exec.CommandContext`; do not use CGo FFmpeg bindings in Round 8.
- Do not run model inference in Go.
- Keep `uv run fast-sub` as the stable Python CLI during this round.
- Add golden compatibility checks for JSON shape, exit code behavior, and Windows paths.

Acceptance:

- Go CLI works with normal paths, paths containing spaces, and Chinese paths.
- `doctor/probe/extract` produce output with the same semantics as the Python CLI.
- Same fixture input produces comparable normalized JSON between Python and Go for `probe` and `analyze`-adjacent metadata where applicable.
- Same fixture failure produces compatible exit code and `error.code`.
- No real model download is needed for default tests.
- Python v0 remains unchanged as the user-facing stable path.

## Round 9: Go Transcribe And Auto Main Path

Goal: make Go own the local subtitle orchestration while Python remains the faster-whisper worker.

Recommended branch:

```text
codex/fast-sub-go-transcribe-auto
```

Key work:

- Implement Go-side `transcribe` and `auto`.
- Implement Go-side worker request writing, worker process launch, timeout handling, response validation, SRT rendering, and job/temp/log handling.
- Implement cancellation and process cleanup:
  - worker timeout
  - ffmpeg timeout
  - user cancel signal
  - Windows process cleanup strategy
  - stderr tail capture
  - `--keep-temp` debug files
- Call the existing Python worker through:

```text
fast-sub-worker-faster-whisper --request request.json --response response.json
```

- Keep the Python CLI as fallback until Go reaches parity.
- Benchmark Go CLI overhead against Python CLI overhead.
- Preserve file-based JSON worker protocol v1.

Acceptance:

- `fast-sub-go auto input.mp4 --yes` can produce a source-language SRT.
- Go and Python use compatible worker request/response schema.
- Worker logs stay on stderr; structured result stays in `response.json`.
- Worker response is written/read atomically and rejects mismatched `schema_version`.
- Missing worker, timeout, invalid JSON, worker error response, and missing model all produce structured errors.
- Benchmark reports compare end-to-end elapsed, worker elapsed, and orchestration overhead.

Go parity gate before making Go the default:

- `doctor/probe/extract` parity tests pass.
- `transcribe/auto` real-model smoke passes on at least one local machine.
- `bench` report compatibility is documented.
- Windows path tests cover spaces, Chinese characters, UNC-like paths where possible, and long-ish paths.
- JSON purity tests pass for success and common failures.
- Python fallback remains documented until at least one release after Go default switch.

## Round 10: Go Product Core Before UI

Goal: finish the Go product core enough that the next desktop UI round can call Go for model download, provider status, local STT, API STT, native whisper.cpp STT, and the main auto/transcribe path.

Detailed spec:

```text
go-docs/specs/round10-go-product-core.md
```

Recommended parallel branches:

```text
codex/fast-sub-go-models-download
codex/fast-sub-go-provider-runtime
codex/fast-sub-go-openai-stt
codex/fast-sub-go-whisper-cpp
```

Recommended merge order:

```text
1. codex/fast-sub-go-models-download
2. codex/fast-sub-go-provider-runtime
3. codex/fast-sub-go-openai-stt
4. codex/fast-sub-go-whisper-cpp
```

Key work:

- Move all model/binary download capability to Go.
- Implement Go `models list/install/verify` with `.part`, resume, sha256, per-model lock, checksum mismatch cleanup, and directory/multi-file verification.
- Implement Go provider registry and `providers list/test`.
- Make Round 9 `transcribe/auto` support `--model <id>` through the Go model resolver while preserving `--model-path`.
- Make `auto --yes` able to install local models, but never silently enable API upload.
- Implement real `api-openai-transcription` through explicit provider selection, explicit model, explicit API key/config, mock HTTP tests, and secret redaction.
- Implement `local-whisper-cpp` as a native backend by calling an external whisper.cpp binary through argv, not CGo.
- Keep Python as worker / AI adapter only; Python should not own download or provider decision logic going forward.

Acceptance:

- `fast-sub-go models list/install/verify --json` works with fake HTTP tests and does not require real network by default.
- `fast-sub-go providers list/test --json` reports `local-faster-whisper`, `local-whisper-cpp`, and `api-openai-transcription`.
- Provider states are consistent: `available`, `missing_dependency`, `missing_model`, `missing_api_key`, `disabled`, `not_implemented`.
- `fast-sub-go transcribe input.mp4 --provider local-faster-whisper --model whisper-small --json` works in default tests with fakes.
- `fast-sub-go transcribe input.mp4 --provider local-whisper-cpp --model whisper-small --json` works in default tests with a fake whisper.cpp binary.
- `fast-sub-go transcribe input.mp4 --provider api-openai-transcription --model <model> --json` works in default tests with a mock HTTP server.
- `fast-sub-go auto input.mp4 --model whisper-small --yes --json` can trigger local model install but never API upload.
- JSON output remains parseable on success and failure.
- API keys, Authorization headers, raw secrets, model download URLs with credentials, and sensitive request bodies are redacted.
- Default automated tests do not require real models, GPU, real ffmpeg, real whisper.cpp, real OpenAI, or real network.

## Round 10.5: Go Daemon / Job API Gate

Goal: avoid building a desktop UI directly on fragile one-shot CLI calls.

This can be a small planning/implementation round before desktop UI if progress, cancellation, and background jobs are needed.

Possible API forms:

- Local HTTP daemon.
- Local stdio JSON protocol.
- CLI-managed job directory with polling.

Minimum job concepts:

```text
job create
job status
job logs
job cancel
job output
```

Desktop UI should call the daemon/job API or a stable CLI contract, not reimplement model/provider/subtitle logic.

## Round 11: Desktop UI

Goal: build the desktop shell after the Go product core is stable enough to call.

Recommended branch:

```text
codex/fast-sub-desktop-shell
```

Default direction:

- Use Electron if stability and ecosystem are the priority.
- Use Tauri if package size and native feel become the priority.
- Do not let the UI reimplement subtitle logic.

Expected UI capabilities:

- Drag in video/audio.
- Choose source subtitles, translated subtitles, bilingual subtitles, or burn-in.
- Show model download progress.
- Show transcribe/translate progress.
- Cancel or inspect background jobs.
- Open output directory.

The UI should not start until one of these is true:

- Go CLI has stable job/progress/cancel semantics.
- A minimal Go daemon/job API exists.

## Round 12: Web Version

Goal: add Web access after local CLI/desktop semantics are stable.

Possible forms:

- Local Web UI connected to a local Go daemon.
- Hosted Web version with explicit upload, retention, privacy, and cost boundaries.
- Hybrid self-hosted backend.

The Web version should reuse job/provider/model contracts rather than reimplementing subtitle logic.

## Test Strategy

Default automated tests:

- No real model downloads.
- No real large media downloads.
- Use fake workers or small fixtures when possible.
- Cover exit codes, JSON purity, path safety, and worker schema compatibility.

Compatibility tests:

- Go and Python output semantics match for shared commands.
- Worker request/response schema remains backward compatible.
- Go and Python both accept shared worker fixture JSON.
- Golden JSON fixtures compare normalized fields, not raw formatting.
- Windows paths with spaces, Chinese characters, and long paths are covered.

Manual release tests:

- Real faster-whisper small model.
- CPU profile.
- GPU/3060 profile.
- Real benchmark sample.
- Go vs Python orchestration overhead comparison.

Key metrics:

```text
end_to_end_elapsed_sec
worker_elapsed_sec
orchestration_overhead_sec
rtfx
peak_memory
peak_vram
model_load_behavior
failure_recovery
```

Migration gate metrics:

```text
python_e2e_elapsed_sec
go_e2e_elapsed_sec
worker_elapsed_sec
go_orchestration_overhead_sec
python_orchestration_overhead_sec
schema_compatibility
json_purity
cancel_success
timeout_success
```

## Assumptions

- Python v0 CLI remains available until Go reaches command parity.
- Go migration starts as a parallel CLI, not an immediate replacement.
- Python remains the long-term model worker layer.
- Round 7 translation has happened before Go owns the main subtitle path; Round 8 foundation can start if it stays limited to low-risk commands and shared contracts.
- Go migration mainly improves distribution, stability, task control, cancellation, logging, downloading, and UI/daemon integration.
- Desktop UI should wait until Go CLI/daemon is stable enough to avoid UI work being blocked by Python environment issues.
- `fast-sub-go` should not replace `fast-sub` until the Go parity gate is satisfied and documented.
