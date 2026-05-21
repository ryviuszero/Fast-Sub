---
title: Privacy
description: Local-first privacy behavior and remote provider rules.
---

# Privacy

Fast Sub is local-first by default.

## Local Workflows

These workflows are designed to run on your machine:

- Local Faster Whisper transcription.
- whisper.cpp transcription.
- Local NLLB translation.
- FFmpeg burn-in.

Models, job outputs, logs, native binaries, and settings are stored locally.

## Remote Workflows

Remote workflows include:

- OpenAI-compatible speech-to-text.
- OpenAI-compatible chat translation.
- Web translation providers.

These can upload media or subtitle text to an external service. Fast Sub should require explicit provider selection and confirmation before upload.

## Secrets

Fast Sub should not show raw API keys in the renderer UI after saving.

Sensitive values that must be redacted:

- API keys.
- Authorization headers.
- Daemon ready tokens.
- `secret_ref` values.
- Signed URLs.
- Proxy credentials.
- Raw secrets.

## Diagnostics

Diagnostics should help explain failures without exposing credentials. Do not share screenshots or logs that contain private media names, private transcripts, API keys, or full sensitive paths.
