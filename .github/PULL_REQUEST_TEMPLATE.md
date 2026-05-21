# Summary

Describe the change and the user/developer problem it solves.

## Scope

- [ ] Code change
- [ ] Documentation change
- [ ] Tests or smoke record update
- [ ] Packaging/release change

## Contract Safety

- [ ] CLI command names, flags, JSON output, and exit codes are unchanged or explicitly documented.
- [ ] Daemon REST/SSE schema changes are reflected in `dev-docs/go-docs/specs/daemon-api.md`.
- [ ] Desktop shared contract changes are reflected in `dev-docs/ui-docs/architecture.md` or related specs.
- [ ] Provider/model/worker contract changes are reflected in docs and tests.

## Privacy Safety

- [ ] No API keys, ready tokens, Authorization headers, signed URLs, real media, model files, or machine-specific paths are committed.
- [ ] Remote provider behavior remains explicit and visible to the user.
- [ ] Logs and diagnostics are redacted where needed.

## Validation

List the commands or manual smoke checks you ran:

```text

```

## Notes

Known limitations, follow-up work, or reviewer focus areas:
