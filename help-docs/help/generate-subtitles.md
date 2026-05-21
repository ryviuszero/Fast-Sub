---
title: Generate Subtitles
description: Create original-language subtitles from video or audio files.
---

# Generate Subtitles

Use this workflow to create original-language subtitles from a local media file.

## Before You Start

Check that:

- FFmpeg/FFprobe is available or installable.
- A local ASR provider is ready.
- The selected ASR model is installed.
- Your input file is readable.
- The output directory is writable.

## Basic Workflow

1. Open Fast Sub.
2. Add a video or audio file.
3. Choose the transcription provider.
4. Choose output options.
5. Start the job.
6. Wait for progress to complete.
7. Open the generated subtitle or output folder.

## Detailed Workflow

### 1. Add Media

Add one local audio or video file for your first test. Fast Sub probes the file with FFmpeg/FFprobe, extracts or reads audio as needed, and sends the transcription request to the selected provider.

Good first inputs:

- Short `.wav`, `.mp3`, `.m4a`, or `.mp4` files.
- Files stored in a simple local path.
- Files without unusual permissions.

Avoid for first tests:

- Very long videos.
- Network drives.
- Locked files opened by another program.
- Files with private customer names if you plan to share screenshots.

### 2. Choose Provider

For a local-only workflow, choose a local ASR provider:

- Faster Whisper: good general local ASR path.
- whisper.cpp: native ASR path when configured and model is available.

Avoid API providers unless you intentionally want remote processing.

### 3. Choose Output

For the first run, create original-language subtitles only. This keeps the test focused on media probing, model readiness, transcription, and output writing.

After original subtitles work, add translation, bilingual output, or burn-in.

### 4. Watch Progress

The queue/history view should show the job moving through states such as queued, running, completed, failed, or cancelled. Completed jobs should show 100%.

### 5. Review Results

Open the generated subtitle file and check:

- The file exists.
- The subtitle format is readable.
- Timing roughly follows speech.
- The output path is where you expected.

## Recommended First Test

Use a short audio or video file first. A one-minute clip is enough to verify:

- Media probing.
- Audio extraction.
- ASR provider readiness.
- Subtitle output path.
- Result view.

## Output

Fast Sub can generate subtitle files such as SRT. Depending on the selected workflow, it can also produce translated, bilingual, or burned-in outputs.

## Batch And Folder Inputs

If folder or multi-file input is enabled, start with a small batch. Confirm one-file output behavior first, then increase the batch size.

When using many files:

- Keep them in a local folder.
- Avoid mixing unrelated media types.
- Check queue/history for failed items.
- Retry failed items individually when possible.

## If The Job Fails

Open the failure details and diagnostics. Common causes include:

- Missing ASR model.
- Missing FFmpeg/FFprobe.
- Unsupported media file.
- Output directory permission issue.
- Cancelled job.
- Provider dependency failure.

Diagnostics should not expose API keys, daemon tokens, Authorization headers, or raw secret references.

## Next Steps

After original subtitle generation works:

- Use [Translate subtitles](translate-subtitles.html) to translate an existing SRT or text file.
- Use [Bilingual subtitles](bilingual-subtitles.html) to create original + translated output.
- Use [Burn-in subtitles](burn-in-subtitles.html) to render subtitles into a video.
