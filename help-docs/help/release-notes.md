---
title: Release Notes
description: User-facing release status and known limitations for Fast Sub.
---

# Release Notes

## Current Release Candidate

Fast Sub is currently validated as a Windows x64 desktop release candidate and macOS arm64 preview build.

Validated areas:

- Windows x64 installer smoke.
- Windows x64 portable zip smoke.
- macOS arm64 dmg smoke.
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
- macOS builds are ad-hoc signed and not notarized. Gatekeeper may block them until the user removes quarantine and applies a local ad-hoc signature.
- Models are downloaded after installation and are not bundled with the app.
- The default local NLLB translation model is marked `CC-BY-NC-4.0`; users should review its non-commercial restriction before commercial or organizational use.
- Real OpenAI/Bing/Google provider smoke is not part of the default automated test suite.

## Privacy Notes

Fast Sub defaults to local workflows. Remote API or web providers require explicit user selection and confirmation before media or subtitle text is uploaded.

## Related Pages

- [Download Fast Sub](download.md)
- [Privacy](privacy.md)
- [Troubleshooting](troubleshooting.md)
