---
title: Install On macOS
description: Install notes for the macOS arm64 preview build.
---

# Install On macOS

Fast Sub currently provides a macOS arm64 preview dmg for Apple Silicon.

Current status:

- Artifact: `FastSub-Desktop-0.13.0-macos-arm64.dmg`.
- Architecture: Apple Silicon / arm64.
- Signing: ad-hoc signed.
- Notarization: not completed.
- Distribution status: preview/internal smoke build, not a fully notarized public macOS release.

## Install

1. Download the macOS arm64 dmg.
2. Open the dmg.
3. Drag `Fast Sub.app` into `Applications`.
4. If macOS blocks the app because it is from an unidentified developer, run:

```bash
sudo xattr -rd com.apple.quarantine "/Applications/Fast Sub.app"
sudo codesign --force --deep --sign - "/Applications/Fast Sub.app"
```

Then open Fast Sub again from Applications.

## Why This Is Needed

The current macOS build is not signed with an Apple Developer ID certificate and is not notarized by Apple. macOS Gatekeeper may block the app until you explicitly allow it.

This is the same unsigned preview-style distribution approach used by some open-source desktop projects. It is acceptable for early testers, but a future public release should use Developer ID signing and notarization.

## Tested In This Preview

- The dmg builds on a macOS arm64 release machine.
- The app starts from the packaged bundle in smoke mode.
- The packaged Go daemon is executable and can start.
- The app-private Python runtime is present and executable.
- Packaged daemon repair, SSE reconnect, and missing translation model smoke checks pass.
- The dmg mounts and contains `Fast Sub.app`.

## Still To Improve

- Developer ID signing and notarization.
- Gatekeeper assessment after notarization.
- Real long-running ASR / FFmpeg / whisper.cpp cancellation cleanup on macOS.
