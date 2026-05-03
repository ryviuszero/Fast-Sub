# Fast Sub v0 MVP

## Goal

Fast Sub v0 is a local-first CLI for generating source-language `.srt` subtitles from a local video or audio file.

The recommended command is:

```bash
fast-sub auto input.mp4
```

Compatibility aliases:

```bash
fast-sub input.mp4
fast-sub run input.mp4
```

All three routes use the same v0 local pipeline. They do not silently upload audio, call OpenAI-compatible APIs, or use WhisperX.

## v0 Pipeline

```text
ffmpeg/ffprobe
-> probe
-> extract/analyze
-> provider/model resolution
-> local-faster-whisper worker
-> transcribe
-> refine
-> final .srt
```

The lower-level `fast-sub transcribe input.mp4` command runs source transcription only and is used by `bench`.

## Install

Base CLI:

```bash
pip install fast-sub
```

Local ASR support:

```bash
pip install "fast-sub[local-asr]"
```

For source checkouts:

```bash
uv sync --extra local-asr
```

`ffmpeg` and `ffprobe` must be available on PATH in v0 packaging.

## First Run

Inspect local readiness:

```bash
fast-sub doctor
fast-sub models list
fast-sub providers list
```

Install a model explicitly:

```bash
fast-sub models install whisper-small
```

Or allow the local model install during auto planning:

```bash
fast-sub auto input.mp4 --yes
```

`--yes` only authorizes local model download/install. It does not enable API upload.

## JSON And Errors

Commands with `--json` keep stdout parseable with `json.loads(stdout)`. Progress, warnings, and human diagnostics go to stderr.

Common v0 exit codes:

```text
0 success
1 command failed
2 invalid input or CLI usage
3 missing local dependency
4 missing model
5 download, checksum, or cache failure
```

Missing local ASR dependencies point to:

```text
uv sync --extra local-asr
pip install fast-sub[local-asr]
```

Missing models point to:

```text
fast-sub models install <id>
fast-sub auto --yes
```

API keys and tokens must not be printed to stdout, stderr, JSON payloads, or reports.

## v0 Commands

Stable v0:

- `fast-sub auto input.mp4`
- `fast-sub input.mp4`
- `fast-sub run input.mp4`
- `fast-sub transcribe input.mp4`
- `fast-sub probe input.mp4`
- `fast-sub extract input.mp4`
- `fast-sub analyze input.mp4`
- `fast-sub refine input.srt`
- `fast-sub burn input.mp4 input.srt`
- `fast-sub models list/install/verify`
- `fast-sub providers list/test`
- `fast-sub bench input.mp4`

Placeholder:

- `fast-sub translate input.srt` exits non-zero and reports that translation is not implemented in v0.

## Privacy Boundary

The v0 default provider is `local-faster-whisper`. Audio remains local.

API providers remain listed for future provider work, but they are not part of the default v0 subtitle workflow. Any future API upload behavior must be explicit opt-in.

## Benchmark

`fast-sub bench` measures `transcribe_media_v1`:

```text
input media -> probe -> prepare_audio -> local-faster-whisper worker -> source SRT
```

Benchmark media and reports belong under ignored `local_tests/` paths. The helper `scripts/bench_assets.py` is a developer/manual asset preparation tool, not a public product CLI.

## Known Limits

- v0 generates source-language subtitles only.
- Translation providers are post-v0.
- Provider unification and legacy API/WhisperX cleanup are post-v0.
- Electron UI and Web UI are post-v0.
- New STT backends such as whisper.cpp, SenseVoice, Paraformer, Parakeet, ONNX, and TensorRT are post-v0.
- v0 does not bundle real models or benchmark media.
- Real-model smoke tests are manual because they can require network, large downloads, and local hardware.

## Release Smoke

Default automated tests stay offline and do not download real models or media.

Manual real-model smoke:

```bash
uv run fast-sub --version
uv run fast-sub doctor
uv run fast-sub models list
uv run fast-sub providers list
uv run fast-sub auto tests/fixtures/sample.wav --dry-run --json
uv run fast-sub transcribe <real-local-sample> --model whisper-small --device auto
uv run fast-sub auto <real-local-sample> --yes
uv run fast-sub <real-local-sample> --yes
uv run fast-sub run <real-local-sample> --yes
uv run fast-sub bench <real-local-sample> --repeat 1 --profile auto --json
```

Generated model caches, media, benchmark outputs, and local reports should not be committed.
