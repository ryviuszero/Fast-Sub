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
npm run smoke:native-deps
```

`npm run smoke:native-deps` uses deterministic offline scenarios by default. It validates missing/custom/app-private/system-PATH FFmpeg sources and packaged native resources without contacting FFmpeg download hosts.

Manual FFmpeg download validation is separate:

```powershell
cd desktop
npm run package:dir
npm run smoke:native-deps -- ffmpeg-install
```

The `ffmpeg-install` scenario performs a real network download from the approved FFmpeg source and must not be part of default PR CI. Release validation should confirm the final status is `source=app-private`, `aria2.source=bundled`, and the logs show aria2 reached the expected size, then completed verification, before extraction starts.

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
- FFmpeg / FFprobe are not bundled. Round 15 supports three ready sources: user-selected directory, app-private explicit download, and same-directory system `PATH` pair discovered by Electron main. Detection and Provider refresh must not download FFmpeg, FFprobe, or aria2.
- aria2 is bundled as `resources/bin/win32-x64/aria2/aria2c.exe` from aria2 1.37.0 Windows x64. Release validation must confirm the executable exists in `win-unpacked/resources/bin/win32-x64/aria2/`, `THIRD_PARTY_NOTICES.md` includes GPL-2.0-or-later notice/source access, and `desktop/vendor/aria2/win32-x64/SOURCE.txt` records the exact version and SHA256. FFmpeg download still falls back to ordinary HTTPS if aria2 cannot run.
- The pinned whisper.cpp native runtime is bundled under app resources for packaged native transcription.
- FFmpeg explicit download writes `userData/native-binaries/ffmpeg/download-manifest.json` with platform, arch, source URL, computed archive SHA256, version, license evidence note, and extracted bin layout. Public release must verify the upstream license/SHA256 evidence before treating this path as release-ready.

Round 14 Windows packaged web translation smoke should verify `web-bing` and `web-google` on a public short SRT, helper outside ASAR, no API key requirement, and no packaged `js2py` / `translators` / `ai-cloudscraper` metadata.

Packaged resource regression guard:

- Do not treat `desktop/resources` or repo-local `dist-release/win-unpacked` execution as sufficient proof that helper dependencies are bundled. A repo-local unpacked app can accidentally resolve missing packages from parent `desktop/node_modules`.
- `npm run smoke:packaged` must assert the final packaged `resources/web-translate-helper/node_modules` contains the production provider dependencies, including `bing-translate-api` and `@vitalets/google-translate-api`.
- For installer and portable zip validation, inspect or run from the final artifact layout, not only the staging directory.
- Round 15 native-dependency smoke must use clean userData and controlled PATH. It should cover `missing`, `custom`, `app-private`, and `system-path` FFmpeg / FFprobe sources, and verify Provider page refresh/static checks do not create native-binary staging directories or trigger downloads.
- Round 15 FFmpeg real-download smoke must not treat file size alone as download completion. aria2 can preallocate the full target size before the archive is verified and closed; extraction may only start after aria2 exits with code 0 and the target passes the writable-file check. If aria2 stalls after reaching the expected size, fail that path and use the ordinary HTTPS fallback instead of extracting a partial/preallocated archive.

## Cleanup

Uninstalling the app does not remove all user data by default. User data may include config, encrypted provider key records, job logs, native binaries, model store references, and UI state.
