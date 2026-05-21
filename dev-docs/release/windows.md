---
title: Windows Release Notes
description: Windows package status, build, smoke, and runtime notes.
---

# Windows Release Notes

## Current State

Windows x64 is the current release-candidate platform.

Artifacts:

- Installer: `FastSub-Desktop-0.13.0-windows-x64.exe`
- Portable zip: `FastSub-Desktop-0.13.0-windows-x64.zip`

Current artifacts are unsigned internal builds. Users may see SmartScreen or antivirus reputation prompts until code signing is configured.

## Build And Smoke

```powershell
cd desktop
npm run package:dir
npm run smoke:packaged
```

Full package:

```powershell
cd desktop
npm run package
```

Additional release smoke records are tracked in:

- `../../desktop-tests/round13-release-checklist.md`
- `../../desktop-tests/round13-release-smoke.md`

## Runtime Distribution

- Go daemon is packaged under app resources.
- App-private Python runtime is packaged under app resources.
- Models are not bundled.
- FFmpeg, aria2, and whisper.cpp native binaries are app-private userData downloads, not bundled in the Windows installer.

## Cleanup

Uninstalling the app does not remove all user data by default. User data may include config, encrypted provider key records, job logs, native binaries, model store references, and UI state.
