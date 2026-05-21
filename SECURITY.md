# Security Policy

## Supported Status

Fast Sub is currently at the Windows desktop release-candidate stage. Security-sensitive behavior is still being hardened before broad external distribution.

## Reporting

Do not open public issues containing secrets, API keys, private media paths, or private transcripts.

For now, report security concerns through the project owner or private development channel. Once the project has a public maintainer contact, add it here.

## Security Expectations

- Renderer code must not receive raw daemon ready tokens, raw provider secrets, Authorization headers, signed URLs, proxy credentials, or raw `secret_ref` values.
- Config files must store aliases and non-secret settings, not raw API keys.
- Daemon `secret_ref` values are transient and one-time.
- Logs, diagnostics, screenshots, and release records must redact secrets and private credentials.
- Remote/API/web providers must require explicit user selection and confirmation before upload.
- Default local workflows must not upload media or subtitles.

## Not In Scope

- Real media, private transcripts, local model files, local job stores, and API keys should not be attached to public reports.
- Unsigned internal builds may trigger OS or antivirus warnings; signing status is tracked separately in release docs.
