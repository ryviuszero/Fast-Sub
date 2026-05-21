---
title: Troubleshooting
description: User-facing troubleshooting entry point.
---

# Troubleshooting

This page is a user-facing starting point. Detailed release smoke evidence remains in `desktop-tests/`.

## Windows SmartScreen Or Antivirus Warning

Current Windows artifacts are unsigned internal builds. SmartScreen or antivirus reputation prompts are expected until code signing is configured.

## Missing FFmpeg Or FFprobe

The desktop app can install FFmpeg/FFprobe into app-private user data on Windows. If installation fails:

- Retry from the environment check or diagnostics page.
- Check network access.
- Try a package manager fallback if available.

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
