# Roadmap

Fast Sub is in active productization. This roadmap is intentionally short and user-facing; detailed implementation records live in `dev-docs/`.

## Current

- Windows x64 desktop release candidate.
- Windows installer and portable zip smoke records exist.
- macOS arm64 preview dmg smoke record exists.
- Go daemon and Electron desktop integration are implemented.
- Python CLI and worker ecosystem remain available.
- Models are downloaded after install instead of bundled with the app.

## Next

- Publish the `0.13.0` public preview only with clear unsigned/ad-hoc signing notes.
- Enable or verify GitHub private vulnerability reporting before broad public distribution.
- Decide Windows/macOS signing path for external distribution.
- Review commercial-use language for the default NLLB translation model.
- Improve first-run model setup and failure recovery copy.

## Later

- Reduce packaged app size, especially the app-private Python runtime.
- Expand real-world provider smoke coverage with redacted public records.
- Improve local model management and repair flows.
- Add generated API/reference refresh automation.
- Add automated release packaging after signing and notarization decisions are made.
- Plan a separate Go package layout cleanup after documentation reorganization is merged.

## Non-Goals For The Current Release Candidate

- Bundling ASR or translation model weights with the installer.
- Silent upload to remote transcription or translation providers.
- Replacing the Python CLI entrypoint.
- Treating generated API docs as the source of truth for daemon or provider contracts.
