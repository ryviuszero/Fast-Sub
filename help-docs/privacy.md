---
title: Privacy
description: Project privacy and secret-handling policy.
---

# Privacy

Fast Sub is designed as a local-first subtitle tool.

## Defaults

- Local ASR and local translation workflows run on the user's machine.
- Models are stored in the local model store and are not bundled with the app.
- Job outputs, logs, native binaries, and user settings live in local app/user data paths.

## Remote Providers

Remote/API/web providers are never used implicitly. The user must explicitly select and confirm remote or web/API provider usage before media or subtitle text is uploaded.

Examples include:

- OpenAI-compatible STT or chat providers.
- Web translation providers.
- Any future cloud provider.

Web translation providers (`web-bing` and `web-google`) do not require an API key in the packaged desktop app, but they still send subtitle text to third-party web translation services. They are experimental, best-effort providers and may fail because of rate limits, regional access, network errors, or upstream page changes.

## Secrets

- Renderer code must not receive raw API keys.
- Config files store provider settings and key aliases, not raw keys.
- Electron main process stores provider keys through safe storage.
- Go daemon receives short-lived, one-time `secret_ref` values when a job needs a secret.

## Diagnostics

Diagnostics and logs must redact:

- API keys.
- Authorization headers.
- Daemon ready tokens.
- `secret_ref` values.
- Signed URLs.
- Proxy credentials.
- Raw secrets.

Screenshots and release records must not include real customer media names, private paths, transcripts, or credentials.
