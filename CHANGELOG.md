# Changelog

All notable project milestones should be recorded here in user-facing language.

## Unreleased

- Documentation structure reorganized into `dev-docs/` for internal project docs and `help-docs/` for user help and GitHub Pages.
- Root project README, contribution notes, security policy, code of conduct, roadmap, release docs, issue templates, PR template, and AI-assisted workflow notes added.
- Generated API/reference docs added under `dev-docs/api/` for Go, Python, desktop, and JSON schema references.

## 0.13.0 - Windows Release Candidate

- Added Electron productization and release readiness work for Windows x64.
- Added `electron-builder` packaging with Windows installer and portable zip targets.
- Bundled the Go daemon and app-private Python runtime outside ASAR for packaged Windows builds.
- Added packaged daemon smoke coverage for ready JSON, health, auth baseline, repair, SSE disconnect, and `events_lost`.
- Added release smoke records for local Faster Whisper ASR, whisper.cpp ASR, local NLLB translation, bilingual subtitles, burn-in, Unicode/space paths, and GPU long-task cancellation.
- Added first-start default model installation smoke from a clean model store.
- Added provider API key save/replace/delete coverage and redaction checks.
- Added generated third-party license inventory under `desktop-tests/licenses/`.
- Captured Round 13 screenshot baseline under `desktop-tests/pics/round13/`.

Known release state:

- Windows artifacts are unsigned internal builds.
- macOS arm64 dmg build and smoke are deferred to a macOS arm64 release machine.
- Real OpenAI/Bing/Google external provider smoke is deferred; local loopback OpenAI-compatible smoke has passed.
