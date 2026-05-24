# Changelog

All notable project milestones should be recorded here in user-facing language.

## Unreleased

## 0.13.2 - Native Dependency Readiness

- Improved Windows FFmpeg / FFprobe readiness flow so missing FFmpeg no longer blocks opening the desktop app.
- Added explicit FFmpeg directory selection, app-private download, and same-directory system `PATH` detection.
- Bundled aria2 for Windows FFmpeg downloads and documented deterministic native-dependency smoke coverage.
- Added safeguards so provider refresh and diagnostics checks do not repeatedly trigger FFmpeg installation.

## 0.13.1 - Web Translation Recovery Preview

- Documentation structure reorganized into `dev-docs/` for internal project docs and `help-docs/` for user help and GitHub Pages.
- Root project README, contribution notes, security policy, code of conduct, roadmap, release docs, issue templates, PR template, and AI-assisted workflow notes added.
- Generated API/reference docs added under `dev-docs/api/` for Go, Python, desktop, and JSON schema references.
- Restored no-key Bing/Google web translation in the packaged desktop app through an ASAR-outside JS helper, without reintroducing the old Python `translators/js2py` dependency chain.
- Documented the CI-equivalent local validation workflow and the feature-branch-to-fast-forward release practice.

## 0.13.0 - Windows Release Candidate

- Added Electron productization and release readiness work for Windows x64 and macOS arm64 preview packaging.
- Added `electron-builder` packaging with Windows installer and portable zip targets.
- Bundled the Go daemon, native whisper.cpp runtime, and app-private Python runtime outside ASAR for packaged Windows builds.
- Added packaged daemon smoke coverage for ready JSON, health, auth baseline, repair, SSE disconnect, and `events_lost`.
- Added release smoke records for local Faster Whisper ASR, whisper.cpp ASR, local NLLB translation, bilingual subtitles, burn-in, Unicode/space paths, and GPU long-task cancellation.
- Added first-start default model installation smoke from a clean model store.
- Added provider API key save/replace/delete coverage and redaction checks.
- Added generated third-party license inventory under `desktop-tests/licenses/`.
- Captured Round 13 screenshot baseline under `desktop-tests/pics/round13/`.

Known release state:

- Windows artifacts are unsigned release-candidate builds.
- macOS arm64 dmg is an ad-hoc signed, unnotarized preview build.
- Windows packaged Bing/Google web translation smoke has passed for a public short SRT; macOS arm64 web translation smoke still needs to be rerun on the macOS release machine. Real OpenAI external provider smoke is deferred; local loopback OpenAI-compatible smoke has passed.
