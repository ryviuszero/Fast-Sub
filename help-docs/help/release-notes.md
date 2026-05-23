---
title: Release Notes
description: User-facing release status and known limitations for Fast Sub.
---

# Release Notes

## 0.13.0 Public Preview

Fast Sub `0.13.0` is prepared as a Windows x64 desktop release candidate and macOS arm64 preview build.

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

- Windows builds are unsigned. SmartScreen or antivirus reputation warnings may appear until code signing is configured.
- macOS builds are ad-hoc signed and not notarized. Gatekeeper may block them until the user removes quarantine and applies a local ad-hoc signature.
- Models are downloaded after installation and are not bundled with the app.
- The default local NLLB translation model is marked `CC-BY-NC-4.0`; users should review its non-commercial restriction before commercial or organizational use.
- Real OpenAI/Bing/Google provider smoke is not part of the default automated test suite.

## 0.13.0 Artifact Checksums

| Artifact | SHA256 |
| --- | --- |
| `FastSub-Desktop-0.13.0-windows-x64.exe` | `b6bfcfe1d38cf56d8dd6851f8a00f3eb0a90373b4c0a8f9ef9ad074b6701a8c9` |
| `FastSub-Desktop-0.13.0-windows-x64.exe.blockmap` | `c74e069c3657abdd8c3ba2eca41af105afb9034fe284b0f590c22a34fc304190` |
| `FastSub-Desktop-0.13.0-windows-x64.zip` | `be75a8d97f9cb93cbe6d4f427319c9dbd923012bafc780782a7d100611af83a5` |
| `FastSub-Desktop-0.13.0-macos-arm64.dmg` | `e588a07b94276bda4d1a02a4691018ba06884b0288d6c1a125c7c3f7302d6d19` |
| `FastSub-Desktop-0.13.0-macos-arm64.dmg.blockmap` | `1fea13f5719a6ece83aeacfd28f0fcdfb78f0a57eb644ae5c589f1bf9a88a44b` |

## Package Size

The Windows portable zip is large because it includes Electron/Chromium plus an app-private Python AI runtime. The package does not include ASR or translation model weights.

## Privacy Notes

Fast Sub defaults to local workflows. Remote API or web providers require explicit user selection and confirmation before media or subtitle text is uploaded.

## Related Pages

- [Download Fast Sub](download.md)
- [Privacy](privacy.md)
- [Troubleshooting](troubleshooting.md)
