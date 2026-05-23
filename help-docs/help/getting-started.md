---
title: Getting Started
description: Start using Fast Sub for local subtitle generation and translation.
---

# Getting Started

Fast Sub helps you create subtitles from local video or audio files.

The desktop app is designed for local-first workflows:

- Generate original-language subtitles from a local media file.
- Translate subtitles with a local model, web provider, or API provider.
- Create bilingual subtitles.
- Burn subtitles into a video.
- Keep local workflows private by default.

## Current Release Status

The current validated desktop build is Windows x64.

- Windows installer: supported for internal release-candidate testing.
- Windows portable zip: supported for internal release-candidate testing.
- macOS arm64 dmg: planned, but must be built and tested on a macOS arm64 release machine.

Windows builds are currently unsigned preview builds. Windows may show SmartScreen or antivirus reputation warnings until code signing is configured.

## What Fast Sub Is Good At

Use Fast Sub when you want to:

- Create an SRT subtitle file from a local audio or video file.
- Translate an existing subtitle or text file.
- Generate original and translated subtitles in one workflow.
- Burn subtitles into a new video file.
- Keep media and subtitle text local unless you explicitly choose a remote provider.

Fast Sub is not currently a full subtitle editor like Subtitle Edit. It does not yet focus on hand-editing every cue, waveform editing, visual synchronization, manual spell-checking, or subtitle format conversion across dozens of formats. If you need manual timing correction or detailed line-by-line subtitle editing, use a dedicated subtitle editor after Fast Sub generates the first draft.

## What Is Local And What Is Remote

Local workflows:

- Local Faster Whisper transcription.
- whisper.cpp transcription.
- Local NLLB translation.
- FFmpeg burn-in.

Remote or external workflows:

- OpenAI-compatible speech-to-text.
- OpenAI-compatible chat translation.
- Web translation providers.

Remote providers are never used silently. You must explicitly select and confirm them before media or subtitle text is uploaded.

## Main Screens

The desktop app is organized around a few practical areas:

| Area | Use it for |
| --- | --- |
| Setup / environment check | Confirm FFmpeg, models, local providers, and diagnostics. |
| Generate subtitles | Add media and create original-language subtitles. |
| Translate subtitles / text | Translate existing SRT/TXT/Markdown-like text inputs. |
| Models | Install or verify ASR and translation models. |
| Providers | Configure local, API, and web providers. |
| Queue / history | Review running, completed, failed, or cancelled jobs. |
| Diagnostics | Inspect redacted app, daemon, model, and dependency status. |

## First Run Overview

On first run, check:

1. FFmpeg/FFprobe availability.
2. Local ASR provider readiness.
3. Default ASR model availability.
4. Local translation provider readiness.
5. Default NLLB translation model availability.

Models are not included in the installer. The app downloads models into the local model store when you choose to install them.

## Recommended First Task

Start with a short audio or video file and generate original-language subtitles first. After that succeeds, try translation or bilingual subtitles.

Recommended first test:

1. Open the app.
2. Confirm the setup screen does not show blocking dependency errors.
3. Install the default small ASR model if prompted.
4. Add a short audio or video file.
5. Generate original-language subtitles.
6. Open the generated SRT.
7. Only after this works, install the translation model or configure an API provider.

## Output Files

Fast Sub writes new output files instead of modifying your input media. Depending on the workflow, outputs may include:

- Original-language `.srt`.
- Translated `.srt`.
- Bilingual `.srt`.
- Translated `.txt`.
- Burned-in video output.

If a workflow fails, open the job details and diagnostics instead of retrying blindly. Most failures are caused by missing models, missing FFmpeg, provider configuration, or output path permissions.
