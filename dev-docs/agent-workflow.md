# AI-Assisted Development Workflow

Fast Sub uses AI-assisted development, but generated changes still need normal engineering review and validation.

## Agent Context

Read these first for implementation work:

1. `../AGENTS.md`
2. `README.md`
3. `current-status.md`
4. Relevant specs under `go-docs/specs/` or `ui-docs/specs/`
5. Relevant API reference under `api/`

## Rules For Agent Changes

- Keep changes scoped to the requested task.
- Do not silently change CLI flags, JSON schemas, exit codes, daemon REST/SSE shapes, provider ids, model ids, worker schemas, or desktop IPC contracts.
- Update the hand-written contract before updating generated API/reference docs.
- Do not commit secrets, ready tokens, signed URLs, raw local paths, real media, model files, or unapproved benchmark output.
- Use fake/mock dependencies for automated tests unless the task explicitly asks for real provider or native runtime smoke.
- Respect dirty worktrees and do not revert unrelated user changes.

## Review Expectations

Agent-produced PRs should include:

- Clear scope summary.
- Contract safety notes.
- Privacy/redaction notes.
- Validation commands or manual smoke evidence.
- Documentation updates when behavior, setup, or contracts change.

## Documentation Expectations

- Public user help belongs in `../help-docs/` and should be English.
- Internal planning belongs in `dev-docs/` and may be Chinese.
- API/reference docs belong in `api/` and should be English-first.
- Historical archive docs do not need bulk translation.
