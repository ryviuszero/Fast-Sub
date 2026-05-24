# Contributing

Fast Sub is currently in active productization. Keep changes scoped and preserve public contracts unless a contract change is explicitly approved.

## Start Here

Read:

1. `README.md`
2. `dev-docs/current-status.md`
3. `AGENTS.md`
4. `dev-docs/README.md`
5. `dev-docs/agent-workflow.md`
6. Relevant specs under `dev-docs/go-docs/specs/` or `dev-docs/ui-docs/specs/`

## Development Rules

- Do not silently change CLI command names, flags, JSON schemas, exit codes, provider contracts, worker contracts, or daemon API schemas.
- Do not commit model files, large media, real benchmark outputs, API keys, local task outputs, or machine-specific paths.
- Remote/API/web provider behavior must remain explicit and visible to the user.
- Keep generated API/reference docs under `dev-docs/api/`.
- Follow `dev-docs/api/README.md` when adding generated API docs, schema snapshots, or reference output.
- Update `dev-docs/ui-docs/project-tracker.md` after meaningful Electron implementation changes.
- Update `dev-docs/release/validation.md` or release smoke records when changing packaged release behavior.

## Documentation Language

- Write public user help under `help-docs/` in English.
- Keep public repository docs English-first.
- Internal planning and implementation notes under `dev-docs/` may be written in Chinese.
- Keep API names, command names, JSON fields, provider ids, model ids, error codes, file paths, and CLI examples in English.
- Avoid mixed Chinese and English prose in the same paragraph unless the English text is an identifier, command, path, schema field, or quote.
- Do not bulk-translate historical archive docs unless a current task needs it.

## Validation

Run the smallest relevant checks for your change. Common baselines:

```powershell
$env:GOCACHE=(Join-Path (Get-Location) '.gocache')
go test ./...
```

```powershell
$env:UV_CACHE_DIR='.uv-cache'
uv run ruff format --check src\fast_sub tests
uv run ruff check src\fast_sub tests
uv run mypy src
uv run pytest
```

```powershell
cd desktop
npm run typecheck
npm test
npm run build
npm run smoke
```

Before pushing to `master`, prefer validating on a feature branch first. Keep the
branch green, squash or amend small fixups there, then fast-forward merge into
`master`:

```powershell
git switch master
git merge --ff-only <feature-branch>
git push origin master
```

This avoids pushing formatting-only CI failures to the public default branch.
Local validation should mirror CI where practical; in particular, do not treat
`uv run pytest` alone as the full Python gate because CI also runs Ruff format,
Ruff lint, and mypy before pytest.

For Windows packaged desktop changes, also run:

```powershell
cd desktop
npm run package:dir
npm run smoke:packaged
```

## Pull Request Checklist

- Scope is clear and limited.
- Public behavior and contracts are preserved or explicitly documented.
- Tests or smoke records match the risk of the change.
- Docs, specs, and tracker entries are updated where needed.
- No secrets, local media, model files, local outputs, or machine-specific paths are committed.
