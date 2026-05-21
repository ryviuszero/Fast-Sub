# Roadmap

Fast Sub is in active productization. This roadmap is intentionally short and user-facing; detailed implementation records live in `dev-docs/`.

## Current

- Windows x64 desktop release candidate.
- Windows installer and portable zip smoke records exist.
- Go daemon and Electron desktop integration are implemented.
- Python CLI and worker ecosystem remain available.
- Models are downloaded after install instead of bundled with the app.

## Next

- Complete macOS arm64 dmg packaging on a macOS arm64 release machine.
- Record macOS smoke results, Gatekeeper behavior, and signing/notarization decisions.
- Decide the project license before public GitHub release.
- Decide Windows/macOS signing path for external distribution.
- Improve first-run model setup and failure recovery copy.

## Later

- Reduce packaged app size, especially the app-private Python runtime.
- Expand real-world provider smoke coverage with redacted public records.
- Improve local model management and repair flows.
- Add generated API/reference refresh automation.
- Plan a separate Go package layout cleanup after documentation reorganization is merged.

## Non-Goals For The Current Release Candidate

- Bundling ASR or translation model weights with the installer.
- Silent upload to remote transcription or translation providers.
- Replacing the Python CLI entrypoint.
- Treating generated API docs as the source of truth for daemon or provider contracts.
