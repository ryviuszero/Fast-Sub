---
title: Windows Release Notes
description: Windows package status, build, smoke, and runtime notes.
---

# Windows Release Notes

## Current State

Windows x64 is the current release-candidate platform.

Artifacts:

- Installer: `FastSub-Desktop-0.13.1-windows-x64.exe`
- Portable zip: `FastSub-Desktop-0.13.1-windows-x64.zip`

Current artifacts are unsigned preview builds. Users may see SmartScreen or antivirus reputation prompts until code signing is configured.

## Build And Smoke

```powershell
cd desktop
npm run package:dir
npm run smoke:packaged
npm run smoke:web-translation
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
- Web translation helper source and production dependencies are packaged outside ASAR under `resources/web-translate-helper`; `web-bing` and `web-google` use the packaged Electron executable as Node with no API key and no system Node requirement.
- Models are not bundled.
- FFmpeg and aria2 are app-private userData downloads. The pinned whisper.cpp native runtime is bundled under app resources for packaged native transcription.

Round 14 Windows packaged web translation smoke should verify `web-bing` and `web-google` on a public short SRT, helper outside ASAR, no API key requirement, and no packaged `js2py` / `translators` / `ai-cloudscraper` metadata.

Packaged resource regression guard:

- Do not treat `desktop/resources` or repo-local `dist-release/win-unpacked` execution as sufficient proof that helper dependencies are bundled. A repo-local unpacked app can accidentally resolve missing packages from parent `desktop/node_modules`.
- `npm run smoke:packaged` must assert the final packaged `resources/web-translate-helper/node_modules` contains the production provider dependencies, including `bing-translate-api` and `@vitalets/google-translate-api`.
- For installer and portable zip validation, inspect or run from the final artifact layout, not only the staging directory.

## Cleanup

Uninstalling the app does not remove all user data by default. User data may include config, encrypted provider key records, job logs, native binaries, model store references, and UI state.
