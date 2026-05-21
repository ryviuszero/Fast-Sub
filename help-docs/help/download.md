---
title: Download Fast Sub
description: Current download and platform status for Fast Sub.
---

# Download Fast Sub

Fast Sub is currently at the Windows desktop release-candidate stage.

## Current Platform Status

| Platform | Status | Notes |
| --- | --- | --- |
| Windows x64 installer | Release candidate | Smoke tested as an unsigned internal build. |
| Windows x64 portable zip | Release candidate | Smoke tested as an unsigned internal build. |
| macOS arm64 dmg | Planned | Must be packaged and tested on a macOS arm64 release machine. |
| Linux desktop | Not packaged | No desktop release target yet. |
| Python CLI | Available from source | Intended for developers and existing CLI users. |
| Go CLI / daemon | Available from source | Used by the desktop app and local daemon workflows. |

## Before Installing

- Models are not bundled with the app.
- First run may download the default ASR and translation models.
- Local providers keep media and subtitle text on your machine.
- Remote API or web providers upload media or subtitle text only when you explicitly select and confirm them.
- Windows builds are currently unsigned, so SmartScreen or antivirus reputation warnings may appear.

## Where Releases Will Appear

Public release artifacts should be attached to GitHub Releases once the project license and release process are finalized.

Until then, use the repository status and release notes to understand which artifacts have been validated.

## Related Pages

- [Install on Windows](install-windows.md)
- [Install on macOS](install-macos.md)
- [First run and model setup](first-run-models.md)
- [Release notes](release-notes.md)
