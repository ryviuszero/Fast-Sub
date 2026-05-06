# Fast Sub Agent Guide

## Project Summary

Fast Sub is a local-first subtitle tool for video and audio files.

Current product shape:

```text
Python v0 CLI today
Go product core next
Python model workers / AI adapters long term
Native binaries for ffmpeg, whisper.cpp, CTranslate2, ONNX/TensorRT later
Desktop UI and Web after CLI/daemon contracts stabilize
```

Primary user-facing goals:

- Generate local source-language subtitles quickly.
- Translate SRT subtitles through explicit local, web, or API providers.
- Keep local workflows private by default.
- Provide reproducible benchmark tooling for STT and translation quality/performance.
- Preserve stable CLI, JSON, exit-code, provider, model, worker, and benchmark contracts while migrating to Go.

## Current Progress

Completed on `master`:

- Project renamed to `fast-sub`, package path is `src/fast_sub`.
- Python v0 CLI is functional.
- `auto`, bare command, and `run` route to the local subtitle pipeline.
- `transcribe` uses the local faster-whisper worker path.
- `translate` supports `web-bing`, `web-google`, `api-openai-chat`, and `local-nllb-ct2`.
- `models list/install/verify` supports ASR and translation models.
- `bench` benchmarks media transcription.
- `bench-translate` benchmarks subtitle translation quality/runtime.
- Round 7.75 Python layering cleanup has landed:
  - CLI command shell split into `fast_sub.cli.commands`.
  - Service/client/provider/model-store/benchmark/STT/translation package boundaries clarified.
  - `mypy src` baseline is clean.

Next planned phase:

```text
Round 8: Go migration foundation
```

Round 8 should add a parallel Go CLI foundation and must not replace the Python CLI yet.

## Key Documents

- `FAST_SUB_PLAN.md`: overall product and milestone plan.
- `FAST_SUB_GO_MIGRATION_PLAN.md`: Go migration roadmap.
- `FAST_SUB_PARALLEL_ROUND7_75.md`: Python layering cleanup plan.
- `FAST_SUB_ROUND7_75_IMPLEMENTATION.md`: completed Round 7.75 implementation notes.
- `FAST_SUB_ARCHITECTURE.md`: current Python architecture map.
- `go-docs/project-standards.md`: project standards and code style for the Go migration era.
- `docs/development.md`: Python development notes.
- `docs/project-standards.md`: Python package/code style standards.

## Working Rules

- Prefer planning and review in the PM thread; implement code in dedicated feature branches or worktrees.
- Keep public behavior stable unless the user explicitly approves a contract change.
- Do not silently change CLI command names, options, defaults, JSON schema, exit codes, report schema, or worker/provider contracts.
- Do not make API or web provider behavior implicit. Any remote upload of audio/text must be explicit.
- Do not commit large local media, real benchmark outputs, model files, API keys, or local paths.
- Respect dirty worktrees. Never revert unrelated user changes.
- Use `rg` for searching when available; fall back to PowerShell commands if `rg` is blocked.
- Use `apply_patch` for manual file edits.
- Keep edits scoped to the current request.

## Branching And Merge Style

- Default branch prefix for Codex work is `codex/`.
- Prefer one clear branch per implementation round.
- For large rounds, squash implementation work into one reviewable commit before merging to `master`.
- Prefer fast-forward merges into `master` when possible.
- Document verification results in the final response.

## Python Development

Python package entry points:

```text
fast-sub = fast_sub.app:main
fast-sub-worker-faster-whisper = fast_sub_workers.faster_whisper:main
```

Default Python checks:

```bash
uv run ruff format --check src\fast_sub tests
uv run ruff check src\fast_sub tests
uv run mypy src
uv run pytest
```

Known local note:

- On Windows, pytest may warn that `.pytest_cache` cannot be written. This warning does not by itself indicate test failure.

Python package ownership:

- `fast_sub/cli/`: Typer commands, JSON/stdout/stderr policy, redaction, exit codes.
- `fast_sub/clients/`: network and third-party service clients.
- `fast_sub/infrastructure/`: ffmpeg, ffprobe, worker subprocess, local runtime adapters.
- `fast_sub/providers/`: provider registry, metadata, availability, resolution.
- `fast_sub/stt/`: transcription options/results, worker orchestration, STT errors/constants.
- `fast_sub/translation/`: translation options/results, language mapping, parsing, service.
- `fast_sub/subtitles/`: subtitle models, SRT parse/render, refine.
- `fast_sub/media/`: probe/extract/analyze and media rules.
- `fast_sub/model_store/`: model manifest, install, verify, download, status.
- `fast_sub/output/`: output paths and burn-in behavior.
- `fast_sub/pipeline/`: cross-module auto/run orchestration.
- `fast_sub/benchmark/`: benchmark options, metrics, reports, execution.
- `fast_sub/contracts/`: stable provider/worker/error contracts.

## Go Migration Rules

Round 8 should start with a parallel Go CLI, likely under:

```text
cmd/fast-sub-go/
internal/cli/
internal/errors/
internal/media/
internal/ffmpeg/
internal/paths/
internal/worker/
internal/subtitle/
internal/bench/
internal/testutil/
```

Round 8 boundaries:

- Add `fast-sub-go` as a parallel CLI; do not replace `fast-sub`.
- Start with low-risk commands such as `version`, `doctor`, `probe`, and `extract`.
- Match Python v0 JSON, exit-code, path, and stderr/stdout behavior.
- Use `exec.CommandContext` for `ffmpeg` / `ffprobe`; do not use CGo ffmpeg bindings.
- Do not run model inference in Go.
- Python edits during Round 8 should be limited to fixtures, golden outputs, or contract documentation needed by Go tests.

Go checks once Go code exists:

```bash
gofmt -w <changed-go-files>
go test ./...
```

## Review Priorities

Review in this order:

1. Public behavior compatibility.
2. JSON purity and exit-code stability.
3. Privacy and secret redaction.
4. Whether new side effects were introduced.
5. Test coverage for high-risk paths.
6. Correct package ownership and dependency direction.
7. Naming, types, errors, comments/docstrings, and formatting.

