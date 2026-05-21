---
title: Install On macOS
description: macOS arm64 release status and planned install notes.
---

# Install On macOS

macOS support is planned for Apple Silicon first.

Current status:

- Target artifact: macOS arm64 dmg.
- Build machine required: macOS arm64.
- Signing and notarization: not completed yet.
- Gatekeeper behavior: not verified yet.

## What Still Needs Testing

Before a macOS build can be marked as distributable, the release process must verify:

- The dmg builds on a macOS arm64 release machine.
- The app starts from the installed bundle.
- The packaged Go daemon is executable and can start.
- The app-private Python runtime is present and executable.
- Resource paths resolve correctly from the app bundle.
- Gatekeeper/quarantine behavior is documented.
- App exit, cancellation, and daemon repair do not leave child processes behind.
- Signing and notarization status is explicit.

## Internal Testing Only

Until these checks are complete, macOS builds should be treated as internal smoke builds, not external release builds.
