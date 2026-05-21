# Fast Sub Round 6: v0 Hardening And Release Readiness

## Summary

Round 6 is the v0 hardening/release round. The product already has the core local subtitle path:

```text
probe/extract/analyze
-> model/provider resolution
-> local-faster-whisper worker
-> transcribe
-> refine
-> auto
-> bench
-> benchmark asset helper
```

This round should not broaden the product with new major features. The goal is to make the existing CLI reliable enough to call v0: predictable errors, coherent command behavior, clean docs, release smoke tests, and a clear boundary for unfinished translation/UI/Web work.

## Current State

Completed before Round 6:

- `fast-sub transcribe` uses the local faster-whisper worker path.
- `fast-sub auto` can plan/run the minimum local subtitle pipeline.
- `fast-sub bench` can benchmark `transcribe_media_v1`.
- `scripts/bench_assets.py` can prepare real benchmark inputs through a controlled asset/sample workflow.
- `models` and provider resolution have structured local model/dependency states.

Known unfinished areas at the start of Round 6:

- `translate` is still a placeholder.
- The old `run` path still contains legacy OpenAI-compatible / WhisperX behavior.
- Exit codes and JSON error payloads are not yet fully consistent across all commands.
- Real local model smoke testing is not yet recorded as a release checklist.
- Packaging/release docs need one final pass.

Round 6 implementation update:

- `translate` remains a placeholder and now reports a structured v0 `not_implemented` error when `--json` is used.
- `run` and bare command routing now use the same local `auto` path as `fast-sub auto input.mp4`.
- High-risk exit codes and JSON error payloads are covered by release smoke tests.
- Manual real-model smoke steps are recorded in `mvp.md`, `mvp.zh.md`, and this file.
- Packaging metadata now describes Fast Sub as local-first rather than OpenAI-compatible/API-first.

## Implementation Scope

Round 6 implementation is carried on:

```text
codex/fast-sub-v0-hardening
```

Reason to keep implementation in one branch:

- The changes are cross-cutting across CLI behavior, docs, smoke tests, and error handling.
- Splitting too aggressively would create conflicts in `src/fast_sub/cli.py`, docs, and tests.
- This is a release-hardening pass, so review should see the whole v0 behavior together.

Optional follow-up branch only if dev-docs/release notes later need a separate review:

```text
codex/fast-sub-v0-docs-release
```

Use it only if documentation/release notes become large enough to review separately after core hardening is merged.

## Goals

- Make the v0 command surface coherent.
- Route default local subtitle usage through the new provider/worker pipeline.
- Preserve explicit legacy/API behavior only behind clear commands/options, if kept at all.
- Standardize error payloads and exit codes for user-facing commands.
- Add release-oriented smoke tests that do not require real model downloads by default.
- Document the exact v0 install and run path.
- Record manual real-model benchmark/smoke steps for local machines.

## Non-Goals

- Do not implement full translation provider support in Round 6.
- Do not build Electron UI.
- Do not build Web UI.
- Do not download real models/media in default tests.
- Do not add new STT backends.
- Do not turn `scripts/bench_assets.py` into a public product CLI unless there is a separate decision.

## Workstream 1: CLI Surface And Legacy Run

v0 command surface contract:

| Command | v0 behavior | Stability | Notes |
| --- | --- | --- | --- |
| `fast-sub auto input.mp4` | Canonical end-to-end local command | stable v0 | Uses provider/model resolution, local worker, transcribe, refine. |
| `fast-sub input.mp4` | Alias to the same local path as `auto` | compatibility stable | Bare command must never trigger API upload or legacy OpenAI-compatible flow. |
| `fast-sub run input.mp4` | Alias to the same local path as `auto` for v0 | compatibility stable | Existing scripts keep working, but docs should prefer `auto`. |
| `fast-sub transcribe input.mp4` | Source-language transcription only | stable v0 | Lower-level command used by `bench` and advanced users. |
| `fast-sub translate ...` | Placeholder / preview only | not implemented in v0 | Must exit non-zero with a clear “not implemented in v0” message. |
| Legacy OpenAI-compatible / WhisperX `run` behavior | Removed from implicit default path | post-v0/legacy | If retained, it must move behind explicit docs/options and never be selected silently. |

Hard v0 decision:

- `fast-sub auto input.mp4` remains the documented default command for generating source subtitles.
- Bare command `fast-sub input.mp4` must call the same local path as `auto`.
- `fast-sub run input.mp4` must call the same local path as `auto` for v0 compatibility.
- Old OpenAI-compatible / WhisperX behavior must not be the implicit default v0 path.
- Any API upload behavior is post-v0 or explicitly opt-in only.

Acceptance:

- There is one documented default command for generating source subtitles.
- Bare command compatibility still works.
- Legacy/API upload behavior is never triggered silently.
- Tests cover bare command and `run` routing to the local `auto` behavior.
- Help text does not present legacy/API/WhisperX `run` as the default v0 workflow.

## Workstream 2: Structured Errors And Exit Codes

Target commands:

```text
doctor
probe
extract
analyze
models list/install/verify
providers list/test
transcribe
auto
bench
burn
refine
translate placeholder
```

Tasks:

- Audit exception handling for traceback leaks.
- Align missing input, missing dependency, missing model, provider failure, worker failure, ffmpeg failure, and checksum/download failure with the documented exit codes.
- Ensure `--json` mode returns structured error payloads where commands support JSON output.
- Ensure progress and warnings do not pollute stdout in JSON mode.
- Keep human output concise and actionable.

Recommended v0 exit code contract:

| Exit code | Meaning | Examples |
| ---: | --- | --- |
| `0` | Success | Subtitle written, dry-run plan produced, list command succeeded. |
| `1` | Command failed | Worker failure, provider failure, all benchmark profiles failed. |
| `2` | Invalid input or CLI usage | Missing input file, unsupported media type, invalid option. |
| `3` | Missing local dependency | Missing ffmpeg/ffprobe/local ASR dependency. |
| `4` | Missing model | Local model not installed. |
| `5` | Download/checksum/cache failure | Model or benchmark asset download failed, checksum mismatch. |

More specific causes should live in structured `error.code`, not in many more exit codes. This keeps shell behavior simple while preserving machine-readable detail.

Recommended structured error payload:

```json
{
  "ok": false,
  "error": {
    "code": "missing_model",
    "stage": "model",
    "message": "Model file is missing.",
    "action_hint": "Run `fast-sub models install whisper-small` or `fast-sub auto --yes`.",
    "details": {}
  }
}
```

Rules:

- `stdout` is normal command output.
- `stderr` is progress, warnings, and human-readable errors.
- In `--json` mode, stdout must be parseable JSON for both success and failure where the command supports JSON.
- API keys, tokens, and raw provider secrets must never appear in stdout, stderr, JSON payloads, or saved reports.

Acceptance:

- Common failure tests assert exit code and message.
- Missing local ASR dependency points to `uv sync --extra local-asr` / `pip install fast-sub[local-asr]`.
- Missing model points to `fast-sub models install <id>` or `fast-sub auto --yes`.
- API-related commands never print API keys.

### JSON Purity Matrix

Commands with `--json` support should have success and failure tests where practical:

| Command | Success JSON | Failure JSON | Notes |
| --- | --- | --- | --- |
| `doctor --json` | required | required when dependencies/cache fail | stdout must be JSON only. |
| `probe --json` | required | required for invalid/missing input | no rich error on stdout. |
| `analyze --json` | required | required for invalid/missing input or ffmpeg failure | warning details go inside JSON or stderr. |
| `models list --json` | required | unlikely | no progress output. |
| `models verify --json` | required | required for missing/hash mismatch | structured status or error. |
| `models install` | not supported in v0 unless added | not supported in v0 unless added | progress may be human-readable; if `--json` is added later, progress must move to stderr. |
| `providers list --json` | required | unlikely | no secrets. |
| `providers test --json` | required | required for unknown/missing provider | no API keys. |
| `transcribe --json` | required | required for missing dependency/model/worker failure | use structured transcribe errors. |
| `auto --json` / `auto --dry-run --json` | required | required for blocked/missing model/provider failure | dry-run missing model can be `ok=true` with blocked/planned steps if documented. |
| `bench --json` | required | required when all profiles fail | report object should still be parseable. |
| `refine --json` | required | required for invalid SRT/input | no rich error on stdout. |
| `translate --json` if supported | optional | required if option exists | placeholder should say not implemented in v0. |

Regression test principle:

```text
json.loads(stdout) succeeds whenever --json is used, even on non-zero exit.
stderr may contain human diagnostics, but stdout remains pure JSON.
```

## Workstream 3: Release Smoke Tests

Default automated tests:

- Keep all tests offline.
- Keep real model/media downloads out of CI.
- Add CLI smoke coverage around v0 command combinations.
- Add regression tests for JSON output purity where risk is high.

Manual smoke checklist:

| Command | Requires real model? | Expected exit | Expected result |
| --- | --- | ---: | --- |
| `uv run fast-sub --version` | no | `0` | Prints package version matching `pyproject.toml`. |
| `uv run fast-sub doctor` | no | `0` if dependencies are installed, otherwise documented non-zero | Shows ffmpeg/ffprobe/cache status without traceback. |
| `uv run fast-sub models list` | no | `0` | Lists known models and install status. |
| `uv run fast-sub providers list` | no | `0` | Lists local/API providers without secrets. |
| `uv run fast-sub analyze tests/fixtures/sample.wav --json` | no | `0` | stdout parses as JSON. |
| `uv run fast-sub auto tests/fixtures/sample.wav --dry-run --json` | no | `0` | stdout parses as JSON; model may be blocked/missing but no download/worker run occurs. |
| `uv run fast-sub transcribe <real-local-sample> --model whisper-small --device auto` | yes | `0` | Writes valid source-language `.srt`. |
| `uv run fast-sub auto <real-local-sample> --yes` | yes and network/cache if model missing | `0` | Produces final `.srt`; does not upload. |
| `uv run fast-sub <real-local-sample> --yes` | yes and network/cache if model missing | `0` | Same local behavior as `auto`. |
| `uv run fast-sub run <real-local-sample> --yes` | yes and network/cache if model missing | `0` | Same local behavior as `auto`; no legacy API upload. |
| `uv run fast-sub bench <real-local-sample> --repeat 1 --profile auto --json` | yes | `0` if at least one profile succeeds | stdout parses as JSON report. |

Optional machine baseline:

- Current machine CPU profile.
- Current machine auto/GPU profile if GPU is available.
- 3060 profile before public release.

Acceptance:

- Automated tests pass without network and without real models.
- Manual smoke checklist is documented with expected outputs.
- Real benchmark reports stay under `local_tests/reports/` and are not committed if they contain local paths or machine-specific details.

## Workstream 4: Docs And Release Notes

Docs to update:

```text
FAST_SUB_PLAN.md
FAST_SUB_TEST_ASSETS.md
mvp.md
mvp.zh.md
```

Add or verify:

- v0 feature list.
- v0 non-goals.
- Install instructions for base package and `local-asr` extra.
- First-run flow.
- Model download behavior.
- Privacy boundary for local vs API providers.
- Benchmark and benchmark asset workflow.
- Known limitations.
- `fast-sub --version` behavior.
- Package metadata matches v0 local-first positioning.
- `scripts/bench_assets.py` is documented as a developer/manual helper unless it is promoted in a separate decision.

Acceptance:

- A new user can understand the default local path without reading internal planning docs.
- Unfinished translation/UI/Web work is clearly marked as future work.
- Any API upload behavior is explicitly opt-in.

## Workstream 5: Packaging Readiness

Tasks:

- Verify `pyproject.toml` scripts and extras.
- Verify `pyproject.toml` description/readme no longer imply OpenAI-compatible/API-first behavior.
- Verify `fast-sub --version` works and matches package version.
- Confirm package data expectations for manifests/fixtures.
- Confirm `.gitignore` covers local benchmark media/reports.
- Confirm Windows path behavior for local cache/model/job directories.
- Confirm command help text does not promise unimplemented features.

Acceptance:

- `uv run fast-sub --help` and subcommand help are coherent.
- `uv run pytest` passes, or any skipped/manual tests are explicitly documented.
- No large local artifacts are staged.

## Translation Position For v0

Translation remains out of v0 hardening unless explicitly re-scoped.

Recommended v0 stance:

- Keep `translate` as a placeholder or documented preview command.
- `fast-sub translate ...` should exit non-zero and clearly say translation is not implemented in v0.
- If `--json` exists for translate, it should emit a structured `not_implemented` error.
- Do not block v0 on NLLB/API translation provider implementation.
- Plan translation as the next feature round after v0 hardening.

Reason:

- Translation touches provider contracts, local model memory pressure, batching, API privacy, and bilingual subtitle formatting.
- Mixing it into release hardening would make v0 less stable.
- Existing translation review findings, such as robust parsing of model JSON output and hard failure when all translation batches fail, are post-v0 translation hardening items and should not block Round 6 unless translation is explicitly re-scoped into v0.

## What Counts As Complete After Round 6

- The v0 default local subtitle path is clear in CLI behavior and docs.
- Common user errors do not produce tracebacks.
- JSON output is stable enough for scripts where `--json` is supported.
- Release smoke checklist exists and separates automated tests from manual real-model tests.
- v0 docs explain install, first run, model download, subtitle generation, benchmark, and privacy boundaries.
- Translation, UI, Web, and provider unification all have explicit post-v0 positions.

## Post-v0 Work

- Translation provider implementation: `local-nllb-ct2`, `api-openai-chat`, and later API/custom providers.
- Translation hardening: robust parser for model responses that contain reasoning/prefix text, and non-zero failure behavior when all translation batches fail.
- Full unification of the new provider registry and old legacy `run` provider path.
- Additional STT backends such as `whisper.cpp`, SenseVoice, Paraformer, Parakeet, ONNX, and TensorRT paths.
- Real benchmark baseline matrix across current machine, 3060, and additional machines.
- Electron desktop UI.
- Web version.

## Checklist

- [x] Document Round 6 as v0 hardening/release, not a feature-expansion round.
- [x] Document that translation, UI, Web, and new STT backends are out of Round 6.
- [x] Document the recommended future implementation branch.
- [x] Document expected completion state after Round 6.
- [x] Document post-v0 remaining work.
- [x] Document v0 command surface contract for bare command / `run` / `auto`.
- [x] Document v0 exit code contract and structured error payload.
- [x] Document JSON purity matrix.
- [x] Document manual smoke checklist with expected results.
- [x] Implement v0 behavior for bare command / `run` / `auto`.
- [x] Audit and align high-risk exit codes.
- [x] Audit JSON output purity for covered high-risk commands.
- [x] Harden common missing input, missing dependency, missing model, and translate-placeholder paths.
- [x] Add CLI smoke tests for route aliases, JSON purity, redaction, and common failures.
- [x] Add or update manual real-model smoke checklist.
- [x] Update install and first-run docs.
- [x] Update benchmark docs with current Round 5.5 state.
- [x] Verify `.gitignore` covers local benchmark media/reports.
- [x] Run focused tests.
- [x] Mark v0 remaining known limitations.
- [x] Run full `uv run pytest` on the release branch.

## Merge Criteria

- Default tests pass, or any skipped/manual tests are explicitly documented.
- v0 CLI behavior is documented/tested for `auto`, bare command, and `run`.
- Expected user errors do not traceback.
- `--json` stdout is parseable for covered success and failure paths.
- Docs clearly separate v0 features from post-v0 translation, provider unification, Electron UI, and Web work.
- No model files, media files, local benchmark reports, or unrelated generated artifacts are staged.
