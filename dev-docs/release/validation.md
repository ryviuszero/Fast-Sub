# Release Validation

This page is the public-facing index for release validation evidence. It summarizes where to find proof that a release candidate was exercised without turning raw local logs into public artifacts.

## Current Evidence

- Windows release checklist: `../../desktop-tests/round13-release-checklist.md`
- Windows release smoke record: `../../desktop-tests/round13-release-smoke.md`
- Round 13 screenshots: `../../desktop-tests/pics/round13/README.md`
- License inventory summaries: `../../desktop-tests/licenses/`

## Current Status

- Windows x64 installer and portable zip have release-candidate smoke records.
- macOS arm64 dmg packaging is still pending on a macOS arm64 release machine.
- Windows builds are unsigned internal builds.
- Remote OpenAI/Bing/Google provider smoke is deferred; local loopback OpenAI-compatible smoke is recorded instead.

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
