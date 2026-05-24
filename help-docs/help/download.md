---
title: Download Fast Sub
description: Current download and platform status for Fast Sub.
---

# Download Fast Sub

Fast Sub is currently at the desktop public-preview / release-candidate stage.

## Current Platform Status

| Platform | Status | Notes |
| --- | --- | --- |
| Windows x64 installer | Release candidate | `FastSub-Desktop-0.13.2-windows-x64.exe`; smoke tested as an unsigned build. |
| Windows x64 portable zip | Release candidate | `FastSub-Desktop-0.13.2-windows-x64.zip`; smoke tested as an unsigned build. |
| macOS arm64 dmg | Preview | `FastSub-Desktop-0.13.2-macos-arm64.dmg`; smoke tested as an ad-hoc signed, unnotarized build. |
| Linux desktop | Not packaged | No desktop release target yet. |
| Python CLI | Available from source | Intended for developers and existing CLI users. |
| Go CLI / daemon | Available from source | Used by the desktop app and local daemon workflows. |

## Before Installing

- Models are not bundled with the app.
- First run may download the default ASR and translation models.
- The default local NLLB translation model is license-sensitive and currently marked `CC-BY-NC-4.0`; review the model license before commercial use.
- Local providers keep media and subtitle text on your machine.
- Remote API or web providers upload media or subtitle text only when you explicitly select and confirm them.
- Windows builds are currently unsigned, so SmartScreen or antivirus reputation warnings may appear.
- macOS builds are currently ad-hoc signed and not notarized, so Gatekeeper may block the app until you follow the install steps.

## Where To Download

Download preview artifacts from the project [GitHub Releases](https://github.com/ryviuszero/Fast-Sub/releases) page after the maintainer publishes the release.

Use the release notes and checksums to confirm which artifacts have been validated before installing. If a release is still marked as draft, it is not yet available to normal public visitors.

## Checksums

SHA256 checksums for `0.13.2` are listed in the project release notes:

- [Release notes](release-notes.md)
- [Developer release record](https://github.com/ryviuszero/Fast-Sub/blob/master/dev-docs/release/v0.13.2.md)

## Package Size

The desktop packages are large because they include Electron/Chromium, the Go daemon, whisper.cpp runtime, and an app-private Python runtime for local ASR and translation bridge features. Model files are not included in the package and are installed after first run. Windows includes bundled aria2 for FFmpeg downloads; macOS uses the built-in HTTPS downloader by default.

## Related Pages

- [Install on Windows](install-windows.md)
- [Install on macOS](install-macos.md)
- [First run and model setup](first-run-models.md)
- [Release notes](release-notes.md)
