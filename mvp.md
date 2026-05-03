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

Web translation support uses the GPL-3.0 `translators` package and is kept as an
optional extra for packaging review:

```bash
uv sync --extra web-translate
```

Local NLLB translation support:

```bash
uv sync --extra local-translate
fast-sub models install nllb-200-distilled-600m-ct2-int8
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
It also does not silently install translation models.

## Translate

Round 7 adds real SRT translation:

```bash
fast-sub translate input.srt --provider web-bing --from en --to zh
fast-sub translate input.srt --provider web-google --from en --to zh
fast-sub translate input.srt --provider api-openai-chat --api-key $OPENAI_API_KEY --model <model> --to zh
fast-sub translate input.srt --provider local-nllb-ct2 --from en --to zh
```

`--provider` and `--to` are required unless a provider is explicitly configured.
Remote providers are never selected silently. `replace` mode writes translated text;
`bilingual` writes original and translated text while preserving cue order, timing,
and count. Partial failures keep the original cue text and write `.errors.json`.
All-cue failure exits non-zero and does not write a misleading final SRT.

Checkpoint/resume is enabled by default with:

```text
<output>.translate-progress.json
```

Pass `--no-resume` to force retranslation.

## JSON And Errors

Commands with `--json` keep stdout parseable with `json.loads(stdout)`. Progress, warnings, and human diagnostics go to stderr.

Fast Sub also reads a `.env` file from the current working directory at CLI startup.
Values from the real shell environment win; `.env` only fills variables that are not
already set. This is useful for API translation settings:

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
OPENAI_BASE_URL=https://api.openai.com/v1
```

`.env` loading is silent and does not print secrets.

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
- `fast-sub translate input.srt --provider <id> --to <lang>`
- `fast-sub models list/install/verify`
- `fast-sub providers list/test`
- `fast-sub bench input.mp4`

## Privacy Boundary

The v0 default provider is `local-faster-whisper`. Audio remains local.

Translation providers have explicit privacy classes:

- `local-nllb-ct2`: local; subtitle text is not uploaded.
- `web-bing` / `web-google`: remote web; subtitle text is sent to third-party web translation services, which may rate-limit, change behavior, or fail by region. Google may fail in mainland China; try `web-bing`.
- `api-openai-chat`: remote API; subtitle text is sent to the configured OpenAI-compatible API and requires an explicit API key plus explicit model.

API upload behavior must be explicit opt-in.

## Benchmark

`fast-sub bench` measures `transcribe_media_v1`:

```text
input media -> probe -> prepare_audio -> local-faster-whisper worker -> source SRT
```

Benchmark media and reports belong under ignored `local_tests/` paths. The helper `scripts/bench_assets.py` is a developer/manual asset preparation tool, not a public product CLI.

## Known Limits

- `auto` still generates source-language subtitles by default; translation is a separate explicit command.
- `local-nllb-ct2 --from auto` first uses lightweight subtitle language detection. If Fast Sub cannot reliably infer `en|zh|ja|ko`, pass `--from en|zh|ja|ko`. Internally NLLB uses FLORES-200 codes: `eng_Latn`, `zho_Hans`, `jpn_Jpan`, `kor_Hang`.
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
