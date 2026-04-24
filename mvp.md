# MVP: OpenAI-Compatible Video Subtitle CLI

## Goal

Build a first CLI prototype that takes a local video/audio file or a local directory of video/audio files and generates subtitle files by using an OpenAI-compatible speech API and the `translators` Python package.

The first version should focus on a reliable command-line workflow:

```text
video.mp4/audio.wav or media directory -> audio preparation -> transcription -> optional translation -> subtitle file(s)
```

The tool command name is `sub-gen`.

The tool should work with OpenAI-compatible STT services such as Speaches, and should use `translators` services for translated and bilingual subtitles.

## Non-Goals

The first version will not include:

- GUI or web UI
- Video subtitle burn-in
- Recursive batch directory processing
- Speaker diarization
- Manual subtitle editing
- Realtime transcription
- Queue management
- Media server integration
- Advanced VAD-based segmentation

## Core Modes

### Original Subtitle

Generate subtitles in the source language.

Expected flow:

```text
video -> audio -> /audio/transcriptions -> original.srt
```

This mode uses `response_format=srt` by default when supported by the provider.

### Translated Subtitle

Generate subtitles only in the target language.

Expected flow:

```text
video -> audio -> verbose transcription segments -> translators package -> translated.srt
```

This mode requires timestamped segments from the STT provider.

The default target language is English when `--target-lang` is omitted.

### Bilingual Subtitle

Generate subtitles with both original and translated text.

Expected flow:

```text
video -> audio -> verbose transcription segments -> translators package -> bilingual.srt
```

Example output:

```srt
1
00:00:01,200 --> 00:00:04,500
Hello everyone.
大家好。
```

## Proposed CLI

```bash
sub-gen video.mp4 \
  --mode bilingual \
  --source-lang en \
  --target-lang zh \
  --stt-base-url http://localhost:8000/v1 \
  --stt-api-key dummy \
  --stt-model Systran/faster-whisper-small \
  --translator bing \
  --output video.en-zh.bilingual.srt
```

## Required Parameters

- `video`: input video or audio path
- `--mode`: `original`, `translated`, or `bilingual`
- `--stt-base-url`: OpenAI-compatible STT API base URL
- `--stt-api-key`: STT API key; local providers may use `dummy`
- `--stt-model`: STT model name
- `--source-lang`: optional source language hint for transcription; defaults to `auto`

Defaults:

- `--mode`: `original`
- `--source-lang`: `auto`
- `--stt-base-url`: `OPENAI_BASE_URL`, or `https://api.openai.com/v1`
- `--stt-api-key`: `OPENAI_API_KEY`
- `--stt-model`: `whisper-1` only when using official OpenAI; otherwise explicit value required
- `--stt-temperature`: `0`
- `--max-audio-mb`: `25` only when using official OpenAI; otherwise no client-side limit unless explicitly set

If `--output` is omitted, the CLI generates an output path automatically.

## Translation Parameters

Used for `translated` and `bilingual` modes:

- `--translator`: `translators` service name; defaults to `bing`
- `--target-lang`: target subtitle language; defaults to `en`

## Optional Parameters

- `--format`: subtitle format, initially `srt`; later `ass`
- `--stt-temperature`: STT sampling temperature, OpenAI range `0` to `1`
- `--max-audio-mb`: prepared audio upload size limit; official OpenAI default is `25`
- `--max-line-chars`: soft limit for subtitle line length
- `--bilingual-order`: `original-first` or `translated-first`
- `--original-only`: shortcut that forces `--mode original` for this run
- `--keep-temp`: keep temporary audio and intermediate JSON files
- `--config`: load options from a TOML config file

When the input path is a directory, the CLI processes supported video/audio files in that directory only. It does not recurse into nested directories in v0.1. If `--output` is provided for a directory input, it is treated as an output directory. Directory runs write `.sub-gen-progress.json` to the output directory, or to the input directory when `--output` is omitted, so interrupted runs can resume by skipping completed files.

## Config File

The CLI supports a TOML config file in v0.1. CLI arguments override config file values.

```toml
[stt]
base_url = "http://localhost:8000/v1"
api_key = "dummy"
model = "Systran/faster-whisper-small"

[translator]
service = "bing"

[subtitle]
mode = "bilingual"
source_lang = "auto"
target_lang = "zh"
format = "srt"
bilingual_order = "original-first"
```

## Internal Pipeline

1. Validate input path and output path.
2. Check that `ffmpeg` and `ffprobe` are available.
3. Prepare audio from the input video or audio file.
4. Transcribe audio with the STT endpoint.
5. Stop with a clear provider limit message if the audio exceeds the upload limit.
6. Normalize timestamped segments when needed.
7. Translate segments when required.
8. Validate translation output.
9. Generate subtitle file.
10. Write partial output and an error report when translation partially fails.
11. Clean up temporary files unless `--keep-temp` is set.

Long media chunking is not required in v0.1. The first version assumes the prepared audio fits the provider upload limit.

## Recommended Project Shape

Use Python with `uv`.

```text
pyproject.toml
uv.lock
src/sub_gen/
  cli.py
  config.py
  media.py
  stt.py
  translate.py
  subtitle.py
  models.py
```

Suggested runtime dependencies:

- `typer` or `click`
- `httpx`
- `pydantic`
- `pysubs2`
- `rich`
- `platformdirs`

Suggested development dependencies:

- `pytest`
- `ruff`
- `pyright`

## Provider Compatibility Rules

`original` mode:

- Prefer `response_format=srt` when supported.
- If unavailable, fall back to `verbose_json` and local SRT generation.

`translated` and `bilingual` modes:

- Require timestamped `segments`.
- Prefer `response_format=verbose_json`.
- Fail with a clear message if the provider returns plain text without timestamps.

OpenAI compatibility checks:

- Prepared audio is checked against `25 MB` only when using official OpenAI, or against `--max-audio-mb` when explicitly set.
- Language hints should look like ISO language codes, for example `en` or `zh`; `auto` omits OpenAI's optional `language` parameter and lets the STT provider detect the language.
- `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, and `gpt-4o-transcribe-diarize` are rejected in v0.1 because OpenAI currently documents them as supporting only `response_format=json`, while this tool needs `srt` or timestamped `verbose_json`.

## Translation Rules

Translation should be done per segment through the `translators` package so the STT timestamp alignment is preserved.

The CLI should retry if:

- Any translation is empty.

If a translation batch still fails after retries, the CLI should write partial output and a machine-readable error report instead of discarding the whole run.

## Temporary Files

Use a predictable job directory:

```text
.sub-gen/jobs/<video-hash>/
  audio.wav
  transcript.json
  translation.zh.json
  output.srt
  errors.json
```

The first version can implement `--keep-temp` and reserve the structure for future `--resume`.

## Output Naming

Recommended default naming:

```text
video.en.srt
video.zh.srt
video.en-zh.bilingual.srt
```

Only `.srt` output is required in v0.1. `.ass` is delayed to v0.2.

Bilingual SRT defaults to original text first, then translated text.

## MVP Acceptance Criteria

The first version is considered successful when these commands work:

```bash
sub-gen video.mp4 \
  --mode original \
  --source-lang en \
  --stt-base-url http://localhost:8000/v1 \
  --stt-api-key dummy \
  --stt-model Systran/faster-whisper-small
```

Audio input is also supported:

```bash
sub-gen audio.wav \
  --mode original \
  --source-lang en \
  --stt-base-url http://localhost:8000/v1 \
  --stt-api-key dummy \
  --stt-model Systran/faster-whisper-small
```

Directory input is supported for the files directly inside the directory:

```bash
sub-gen ./media \
  --mode original \
  --source-lang auto \
  --stt-base-url http://localhost:8000/v1 \
  --stt-api-key dummy \
  --stt-model Systran/faster-whisper-small \
  --output ./subtitles
```

Windows PowerShell can use UNC share paths directly. Quoting the path is recommended:

```powershell
uv run sub-gen "\\NAS\data\others\资料\others\sample-user\1" `
  --original-only `
  --source-lang auto `
  --stt-base-url http://localhost:8000/v1 `
  --stt-api-key dummy `
  --stt-model Systran/faster-whisper-small `
  --output "\\NAS\data\others\资料\others\sample-user\1\subtitles"
```

```bash
sub-gen video.mp4 \
  --mode bilingual \
  --source-lang en \
  --target-lang zh \
  --stt-base-url http://localhost:8000/v1 \
  --stt-api-key dummy \
  --stt-model Systran/faster-whisper-small \
  --translator bing \
  --output video.en-zh.bilingual.srt
```

## v0.1 Decisions

1. Command name: `sub-gen`.
2. `original` mode uses `response_format=srt` by default.
3. `translated` mode defaults to English when `--target-lang` is omitted.
4. Translation uses the `translators` package instead of an OpenAI-compatible chat endpoint.
5. `--source-lang` is optional in v0.1 and defaults to automatic detection.
6. v0.1 only needs `.srt`; `.ass` is delayed to v0.2.
7. v0.1 assumes audio fits the provider upload limit and reports a clear limit error when it does not.
8. Default extracted audio format is `wav`.
9. Temporary job files live in `.sub-gen/`.
10. v0.1 includes `--config config.toml`.
11. Translation is performed per timestamped segment.
12. Failed translation batches write partial output plus an error report.
13. Bilingual SRT defaults to original text first.
14. Output file names are generated automatically when `--output` is omitted.
15. Existing `.srt` input translation is not planned for v0.1.
16. Directory input processes supported files in the top-level directory only.
17. Directory input writes a progress file and resumes from completed items on rerun.

## Questions To Confirm

No open questions for v0.1.
