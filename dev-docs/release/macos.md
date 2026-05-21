---
title: macOS Release Notes
description: macOS arm64 release status and follow-up checklist.
---

# macOS Release Notes

## Current State

macOS arm64 dmg is planned but not yet built or smoked in this repository state.

The macOS release must be completed on a macOS arm64 release machine.

## Required Follow-Up

- Prepare app-private Python runtime for macOS arm64.
- Build macOS arm64 dmg.
- Verify packaged Go daemon and Python runtime resource paths.
- Verify executable permissions inside the app bundle.
- Verify Gatekeeper/quarantine behavior.
- Verify app exit/cancel/repair cleanup leaves no daemon, Python worker, FFmpeg, or whisper.cpp child processes.
- Record signing and notarization status.

## Distribution Rule

Do not mark a macOS artifact as externally distributable until signing/notarization/Gatekeeper status is explicit. Unsigned macOS builds can be used for internal smoke only if the risk is documented.
