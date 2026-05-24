---
title: macOS Release Notes
description: macOS arm64 release status and follow-up checklist.
---

# macOS Release Notes

## Current State

macOS arm64 dmg has been built and smoke-tested on a macOS arm64 release machine.

The repository now has cross-platform release helpers for the macOS follow-up:

- `desktop/scripts/prepare-python-runtime.mjs` supports `darwin-arm64` on a macOS arm64 host.
- `desktop/scripts/prepare-release-resources.mjs` builds `resources/bin/darwin-arm64/fast-sub-go` and makes it executable.
- `desktop/scripts/smoke-packaged-runtime.mjs` resolves macOS `Fast Sub.app` resources and validates the packaged daemon and app-private Python runtime.
- `desktop/scripts/smoke-translation-model-failure.mjs` uses the same packaged resource resolver for macOS and Windows.
- `desktop/scripts/smoke-native-dependencies.mjs` supports macOS FFmpeg/FFprobe first-install smoke with isolated userData.
- `desktop/scripts/prepare-whisper-cpp-runtime.mjs` builds pinned whisper.cpp for macOS arm64 release packages and places it in app resources.

This repository state contains a macOS preview artifact. Following the same practical approach used by unsigned open-source preview apps such as Subtitle Edit, the artifact can be shared with explicit manual Gatekeeper bypass instructions, but it must not be described as signed, notarized, or stable macOS distribution.

Current artifact:

```text
desktop/dist-release/FastSub-Desktop-0.13.0-macos-arm64.dmg
```

Current signing status:

- `codesign --verify --deep --strict --verbose=2 "desktop/dist-release/mac-arm64/Fast Sub.app"`: passed.
- `spctl --assess --type execute --verbose "desktop/dist-release/mac-arm64/Fast Sub.app"`: returned `internal error in Code Signing subsystem`.
- Electron Builder used ad-hoc signing and skipped notarization because notarization options were not configured.

Current native dependency behavior:

- macOS packaged app first checks the app-private FFmpeg directory, then complete system installs at `/opt/homebrew/bin`, `/usr/local/bin`, and `/usr/bin`.
- If FFmpeg or FFprobe is still missing, the app downloads `ffmpeg-darwin-<arch>.gz` and `ffprobe-darwin-<arch>.gz` from the GitHub `eugeneware/ffmpeg-static` release and installs them under userData `native-binaries/ffmpeg/bin`.
- The environment check page offers Homebrew as the macOS manual install action. Windows-only Scoop, Winget, and Chocolatey actions are hidden on macOS.
- aria2 is not downloaded on macOS. A system `aria2c` is reused when available; otherwise downloads fall back to ordinary HTTPS.
- whisper.cpp is bundled in the app package under `Contents/Resources/bin/darwin-arm64/whisper-cpp`. End users do not need Homebrew, CMake, Git, or Xcode to use `local-whisper-cpp`; only the GGML model is downloaded separately through the normal model store.

## Release Machine Commands

Run or rerun these from a clean macOS arm64 checkout:

```bash
go test ./...
cd desktop
npm run prepare:python-runtime
npm run prepare:whisper-cpp-runtime
npm run typecheck
npm test
npm run build
npm run smoke
npm run package:dir
npm run smoke:native-deps
npm run smoke:packaged
npm run smoke:web-translation
npm run smoke:translation-model-failure
npm run package
```

Expected key paths after `npm run package:dir`:

```text
desktop/dist-release/mac-arm64/Fast Sub.app
desktop/dist-release/mac-arm64/Fast Sub.app/Contents/Resources/bin/darwin-arm64/fast-sub-go
desktop/dist-release/mac-arm64/Fast Sub.app/Contents/Resources/python/darwin-arm64/bin/python
desktop/dist-release/mac-arm64/Fast Sub.app/Contents/Resources/web-translate-helper/cli.mjs
```

Expected dmg artifact after `npm run package`:

```text
desktop/dist-release/FastSub-Desktop-0.13.0-macos-arm64.dmg
```

## Completed

- Prepare app-private Python runtime for macOS arm64.
- Build macOS arm64 dmg.
- Verify packaged Go daemon and Python runtime resource paths.
- Verify app-private Python imports `fast_sub`, `faster_whisper`, `ctranslate2`, and `sentencepiece`.
- Verify app-private whisper.cpp runtime and dylibs are bundled without external symlinks or build-machine rpaths.
- Verify executable permissions inside the app bundle.
- Verify macOS FFmpeg/FFprobe app-private first install from an isolated userData directory.
- Record signing and notarization status.
- Record all results in `desktop-tests/round13-release-smoke.md` and `desktop-tests/round13-release-checklist.md`.

## Remaining Follow-Up

- Configure Developer ID signing and notarization before external distribution.
- Re-run Gatekeeper assessment after notarization.
- Verify app exit/cancel/repair cleanup with a real long-running ASR/GPU/FFmpeg/whisper.cpp task; current automated packaged smoke covers daemon repair/restart but not a real long task.
- Round 14 web translation packaged smoke still needs to be re-run on the macOS arm64 release machine after the helper packaging change: `npm run smoke:web-translation` should verify `web-bing` and `web-google` without API keys and confirm the helper lives outside ASAR.

## Preview Install Instructions

For unsigned preview testers:

1. Mount the dmg.
2. Drag `Fast Sub.app` into `/Applications`.
3. Run:

```bash
sudo xattr -rd com.apple.quarantine "/Applications/Fast Sub.app"
sudo codesign --force --deep --sign - "/Applications/Fast Sub.app"
```

4. Open Fast Sub again.

These commands remove the quarantine flag and apply a local ad-hoc signature. They are a temporary preview-build workaround, not a replacement for Developer ID signing and notarization.

## Manual Smoke Checklist

- Open the unpacked `.app` with `FAST_SUB_SMOKE=1` and confirm it exits successfully.
- Run `npm run smoke:packaged` against `dist-release/mac-arm64`.
- Run `npm run smoke:translation-model-failure` against `dist-release/mac-arm64`.
- Mount the generated dmg, copy the app to `/Applications` or a clean test directory, then repeat the packaged smoke with `FAST_SUB_PACKAGED_ROOT` pointing at that app location if needed.
- Check permissions:

```bash
test -x "desktop/dist-release/mac-arm64/Fast Sub.app/Contents/Resources/bin/darwin-arm64/fast-sub-go"
test -x "desktop/dist-release/mac-arm64/Fast Sub.app/Contents/Resources/python/darwin-arm64/bin/python"
```

- Check signing/notarization status:

```bash
codesign --verify --deep --strict --verbose=2 "desktop/dist-release/mac-arm64/Fast Sub.app"
spctl --assess --type execute --verbose "desktop/dist-release/mac-arm64/Fast Sub.app"
```

Unsigned internal builds may fail `spctl`; record the exact result and the user-facing installation risk.

## Distribution Rule

Do not mark a macOS artifact as signed, notarized, or stable until Developer ID signing/notarization/Gatekeeper status is complete. Current macOS artifacts may be shared only as unsigned/ad-hoc preview builds with the manual install risk documented.
