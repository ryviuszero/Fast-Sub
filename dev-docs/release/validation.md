# Release Validation

This page is the public-facing index for release validation evidence. It summarizes where to find proof that a release candidate was exercised without turning raw local logs into public artifacts.

## Current Evidence

- Windows release checklist: `../../desktop-tests/round13-release-checklist.md`
- Windows release smoke record: `../../desktop-tests/round13-release-smoke.md`
- Release artifact checksums: `v0.13.1.md`
- Round 13 screenshots: `../../desktop-tests/pics/round13/README.md`
- License inventory summaries: `../../desktop-tests/licenses/`
- Round 14 web translation smoke record: `../../desktop-tests/round14-web-translation-smoke.md`

## Current Status

- Windows x64 installer and portable zip have release-candidate smoke records.
- macOS arm64 dmg has a preview packaged-runtime smoke record.
- Windows builds are unsigned release-candidate builds.
- macOS builds are ad-hoc signed and not notarized.
- Remote OpenAI provider smoke is deferred; local loopback OpenAI-compatible smoke is recorded instead.
- Windows x64 packaged Bing/Google web translation smoke has passed for a public short SRT. macOS arm64 web translation smoke still needs to run on a macOS release machine.

## Evidence Rules

- Do not commit real media, model files, raw benchmark output, API keys, ready tokens, signed URLs, Authorization headers, or machine-specific paths.
- Keep screenshots focused on product state and avoid showing private filenames where possible.
- Keep real provider tests manual unless a fake/mock path is explicitly documented.
- Automated tests should not require real network, real OpenAI, real models, real ffmpeg, real whisper.cpp, or GPU by default.

## Release Checklist Expectations

Every external release should have:

- Target platform and architecture.
- Build artifact names.
- Smoke command or manual checklist.
- Known limitations.
- Signing/notarization status.
- Installer/uninstaller behavior.
- First-run model setup behavior.
- Privacy and remote provider confirmation behavior.
- Redaction and diagnostics checks.
