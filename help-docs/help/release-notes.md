---
title: Release Notes
description: User-facing release status and known limitations for Fast Sub.
---

# Release Notes

## Current Release Candidate

Fast Sub is currently validated as a Windows x64 desktop release candidate.

Validated areas:

- Windows x64 installer smoke.
- Windows x64 portable zip smoke.
- First-run setup checks.
- Default model installation flow.
- Local Faster Whisper transcription.
- Native whisper.cpp transcription.
- Local NLLB translation.
- Bilingual subtitle output.
- Subtitle burn-in.
- Diagnostics and redaction checks.
- Basic desktop screenshots.

## Known Limitations

- Windows builds are unsigned internal builds.
- macOS arm64 dmg packaging still needs to run on a macOS arm64 release machine.
- macOS signing and notarization are not complete.
- Models are downloaded after installation and are not bundled with the app.
- Real OpenAI/Bing/Google provider smoke is not part of the default automated test suite.

## Privacy Notes

Fast Sub defaults to local workflows. Remote API or web providers require explicit user selection and confirmation before media or subtitle text is uploaded.

## Related Pages

- [Download Fast Sub](download.md)
- [Privacy](privacy.md)
- [Troubleshooting](troubleshooting.md)
