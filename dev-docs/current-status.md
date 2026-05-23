# Current Project Status

Last updated: 2026-05-23

## Summary

Fast Sub is currently at the desktop release-candidate / preview stage.

The original Python CLI remains available, the Go product core and daemon/job API are implemented, and the Electron desktop application has completed the Round 11 to Round 13 sequence:

- Round 11: Electron mock-first shell.
- Round 12: Electron integration with the Go daemon.
- Round 13: productization and release readiness for Windows x64 plus macOS arm64 preview packaging.

## Current Release State

- Windows x64 installer and portable zip have been built and smoke tested.
- macOS arm64 dmg has been built and smoke tested as an ad-hoc signed, unnotarized preview artifact.
- The packaged app includes the Go daemon, native whisper.cpp runtime, and an app-private Python runtime outside ASAR.
- Models are not bundled with the installer.
- First-start/default model installation was tested from a clean model store for `whisper-small` and the default NLLB model.
- Local Faster Whisper ASR, native whisper.cpp ASR, local NLLB translation, bilingual subtitles, burn-in, Unicode/space paths, and GPU long-task cancellation have Windows smoke records.
- Diagnostics, redaction, API key save/replace/delete, license inventory, and screenshot baselines have Round 13 records.
- Windows artifacts are currently unsigned preview builds. SmartScreen and antivirus reputation warnings are expected until signing is configured.
- macOS artifact is currently ad-hoc signed and not notarized. Gatekeeper warnings are expected until Developer ID signing and notarization are configured.

## Open Release Work

- macOS Developer ID signing/notarization remains deferred; current macOS preview follows the unsigned open-source app pattern with documented manual `xattr` and local ad-hoc `codesign` steps.
- macOS real long-running ASR / FFmpeg / whisper.cpp cancellation cleanup still needs manual smoke.
- Windows code signing remains deferred until a real certificate and publisher identity exist.
- Real OpenAI/Bing/Google external provider smoke is deferred by decision; local loopback OpenAI-compatible smoke has passed.
- Public GitHub readiness fixes now include MIT source licensing, baseline CI, Security reporting guidance, release checksum records, package-size notes, and explicit NLLB license-sensitive user docs.

## Documentation Map

- Current tracker: `ui-docs/project-tracker.md`
- User help: `../help-docs/help/README.md`
- Download and release status: `../help-docs/help/download.md` and `../help-docs/help/release-notes.md`
- v0 MVP summary: `product/mvp.md` and `product/mvp.zh.md`
- Round 13 release checklist: `../desktop-tests/round13-release-checklist.md`
- Round 13 release smoke: `../desktop-tests/round13-release-smoke.md`
- Release validation index: `release/validation.md`
- API reference index: `api/README.md`
- Electron specs: `ui-docs/specs/`
- Go specs: `go-docs/specs/`
- Historical Python planning rounds: `archive/python-rounds/`

## Near-Term Priorities

1. Publish preview artifacts only with explicit unsigned/ad-hoc installation instructions.
2. Decide Windows and macOS signing/notarization path before stable external distribution.
3. Enable or verify GitHub private vulnerability reporting before broad public distribution.
4. Continue slimming the installer, with highest attention on the app-private Python runtime.
5. Continue expanding user-facing help under `../help-docs/help/` based on real tester feedback.
6. Maintain generated API/reference docs under `api/` without replacing the hand-written daemon contract.
7. Plan a separate Go package layout cleanup after the documentation branch lands; keep it out of the current docs-only reorganization.
