---
title: Download Fast Sub
description: Current download and platform status for Fast Sub.
---

# Download Fast Sub

Fast Sub is currently at the desktop release-candidate / preview stage.

## Current Platform Status

| Platform | Status | Notes |
| --- | --- | --- |
| Windows x64 installer | Release candidate | Smoke tested as an unsigned internal build. |
| Windows x64 portable zip | Release candidate | Smoke tested as an unsigned internal build. |
| macOS arm64 dmg | Preview | Smoke tested as an ad-hoc signed, unnotarized macOS arm64 build. |
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

## Where Releases Will Appear

Public preview artifacts can be attached to GitHub Releases once the project release notes clearly mark their signing status.

Until then, use the repository status and release notes to understand which artifacts have been validated.

## Related Pages

- [Install on Windows](install-windows.md)
- [Install on macOS](install-macos.md)
- [First run and model setup](first-run-models.md)
- [Release notes](release-notes.md)
