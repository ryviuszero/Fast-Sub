---
title: Release Notes
description: User-facing release status and known limitations for Fast Sub.
---

# Release Notes

## 0.13.2 Public Preview

Fast Sub `0.13.2` is a Windows x64 desktop release candidate focused on FFmpeg / FFprobe readiness.

Changes since `0.13.1`:

- Missing FFmpeg / FFprobe no longer blocks opening the desktop app.
- Transcription and burn-in now ask for FFmpeg / FFprobe only when a job actually needs them.
- Users can choose an existing FFmpeg / FFprobe directory, explicitly download app-private FFmpeg, or use a same-directory system `PATH` pair.
- Windows packages include bundled aria2 for FFmpeg downloads, with normal HTTPS fallback.
- Diagnostics and provider refresh should not repeatedly retry FFmpeg installation.

Validated areas:

- Windows x64 installer build.
- Windows x64 portable zip build.
- Packaged runtime smoke.
- Native dependency smoke for missing, custom, app-private, and system `PATH` FFmpeg sources.

## 0.13.1 Public Preview

Fast Sub `0.13.1` is a Windows x64 desktop release candidate focused on restoring packaged no-key web translation and tightening public project documentation.

Changes since `0.13.0`:

- Restored no-key Bing/Google web translation in the packaged desktop app through an ASAR-outside JS helper.
- Kept the old Python `translators/js2py` dependency chain removed from the Python lock file and packaged Python runtime.
- Added generated API/reference documentation under `dev-docs/api/`.
- Added and reorganized public repository docs, contribution guidance, security policy, roadmap, issue templates, and AI-assisted workflow notes.
- Documented the CI-equivalent local validation workflow for future release branches.

Validated areas:

- Windows x64 installer smoke.
- Windows x64 portable zip smoke.
- No-key Bing/Google web translation for short subtitles in the packaged desktop app.
- Python, Go, and Desktop CI checks.

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
- No-key Bing/Google web translation for short subtitles in the packaged desktop app.
- Bilingual subtitle output.
- Subtitle burn-in.
- Diagnostics and redaction checks.
- Basic desktop screenshots.

## Known Limitations

- Windows builds are unsigned. SmartScreen or antivirus reputation warnings may appear until code signing is configured.
- macOS builds are ad-hoc signed and not notarized. Gatekeeper may block them until the user removes quarantine and applies a local ad-hoc signature.
- Models are downloaded after installation and are not bundled with the app.
- The default local NLLB translation model is marked `CC-BY-NC-4.0`; users should review its non-commercial restriction before commercial or organizational use.
- Real OpenAI provider smoke is not part of the default automated test suite.
- Bing/Google web translation is experimental and best-effort; Windows x64 packaged short-SRT smoke has passed, and macOS arm64 web translation smoke still needs to run on a macOS release machine.

## 0.13.2 Artifact Checksums

| Artifact | SHA256 |
| --- | --- |
| `FastSub-Desktop-0.13.2-windows-x64.exe` | `12f8622b6d5f978fcdf0c47ceefaccad31dabba2a81626f080ff7a8c29494c8a` |
| `FastSub-Desktop-0.13.2-windows-x64.exe.blockmap` | `4d6d723ce519fabe0f97f42a73321e5af0d0e1c47f1acc36811b16e6e28cd21e` |
| `FastSub-Desktop-0.13.2-windows-x64.zip` | `ae5d69a3c67f8b41e5476ff523d5ccd8db1423f85bd42f8aea53cf89fa46c847` |

## 0.13.1 Artifact Checksums

| Artifact | SHA256 |
| --- | --- |
| `FastSub-Desktop-0.13.1-windows-x64.exe` | `801227c3a599f7b0b921030b3faba2a4b5b91c43fd7ac89c2b7330099dcf8c1a` |
| `FastSub-Desktop-0.13.1-windows-x64.exe.blockmap` | `897e1c93f5eb20ad5e0bb1713e5a12ca8cdfd71cdca9db6cae1295a16ddc78d5` |
| `FastSub-Desktop-0.13.1-windows-x64.zip` | `b62d3f5bdd74bbe8c747883b176dce94e71f1161c095eda105c00bfaa5100340` |

## 0.13.0 Artifact Checksums

| Artifact | SHA256 |
| --- | --- |
| `FastSub-Desktop-0.13.0-windows-x64.exe` | `7d2df9d6aa49140f59c113cef2e7972d4cb46dd65ed2802c3e6710eed53d1e54` |
| `FastSub-Desktop-0.13.0-windows-x64.exe.blockmap` | `1cac770ce39cbdda72053ae9bad35b520dd4f9f807fa549f5785ed6865b93196` |
| `FastSub-Desktop-0.13.0-windows-x64.zip` | `78006e32a52c54300b4621f24977fedeceaab61f17ddf26a665441b19486260b` |
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
