---
title: Troubleshooting
description: User-facing troubleshooting entry point.
---

# Troubleshooting

This page is a user-facing starting point. Detailed release smoke evidence remains in `desktop-tests/`.

## Windows SmartScreen Or Antivirus Warning

Current Windows artifacts are unsigned preview builds. SmartScreen or antivirus reputation prompts are expected until code signing is configured.

## Missing FFmpeg Or FFprobe

FFmpeg / FFprobe are needed for transcription media handling and burn-in, but their absence should not block opening the app. Subtitle/text translation, model installation, Provider settings, and diagnostics can still be used.

On Windows, choose an existing directory that contains both `ffmpeg.exe` and `ffprobe.exe`, or explicitly start the app-private FFmpeg download. A system `PATH` source is accepted only when both binaries resolve to the same directory.

If installation fails:

- Retry only from the explicit FFmpeg download action.
- Check network access.
- Prefer choosing an existing FFmpeg directory if you already have one.
- Report a bug if status refresh or Provider checks keep retrying downloads automatically.

## Missing Models

Models are not bundled with the installer. If local ASR or local translation is not ready:

- Open the model/provider setup flow.
- Install the default ASR model or default NLLB translation model.
- Retry after installation and verification complete.

## Local Python Runtime

Packaged Windows builds use an app-private Python runtime. Users should not need system Python, `uv`, or a global `fast-sub` CLI.

If Python dependency checks fail in a packaged build, use diagnostics and provider dependency recheck. Do not fix it by installing random global Python packages unless debugging a development checkout.

## Remote Provider Fails

For OpenAI-compatible providers:

- Check base URL.
- Check model name.
- Run connection check.
- Confirm whether the endpoint requires an API key.

Raw API keys should not be pasted into logs, issues, screenshots, or release records.

For web translation providers (`web-bing` and `web-google`):

- No API key is required in the packaged desktop app.
- Retry later if the service is rate limited or blocked in your region.
- Use smaller subtitle files.
- Switch to local translation or an API provider if reliability matters.
- If the app reports the web translation helper is missing, repair or reinstall Fast Sub rather than installing global Python or npm packages.
