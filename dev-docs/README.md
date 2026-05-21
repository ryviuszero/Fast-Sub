---
title: Documentation Map
description: Fast Sub documentation map.
---

# Fast Sub Developer Documentation

This directory contains internal project, architecture, implementation, release, and historical planning documentation.

Do not put user-facing task guides here. User help for GitHub Pages lives under `../help-docs/`, and the Pages workflow builds from that directory instead of `dev-docs/`.

## Language Policy

- Public user help under `../help-docs/` is written in English.
- Public repository docs such as `../README.md`, `../CONTRIBUTING.md`, `../SECURITY.md`, and `../CHANGELOG.md` are English-first.
- Internal planning, PM review, implementation notes, and historical records under `dev-docs/` may be written in Chinese.
- API names, command names, JSON fields, provider ids, model ids, error codes, file paths, and CLI examples stay in English.
- Do not mix Chinese and English prose in the same paragraph unless quoting identifiers, commands, paths, schema fields, or source text.
- Historical archive files do not need bulk translation; update them only when they are directly relevant to current work.

## Current Status

- `current-status.md`: current project state, release readiness, and next work.
- `../README.md`: public repository entry point.
- `../CHANGELOG.md`: user-facing release history.
- `../ROADMAP.md`: public roadmap.
- `ui-docs/project-tracker.md`: detailed Electron/Desktop implementation tracker.
- `../desktop-tests/round13-release-checklist.md`: current Windows release candidate checklist.
- `../desktop-tests/round13-release-smoke.md`: release smoke records.

## Active Product And Engineering Docs

- `product/plan.md`: product and milestone plan.
- `product/go-migration-plan.md`: Go migration roadmap.
- `product/mvp.md`: English Fast Sub v0 MVP user-facing summary.
- `product/mvp.zh.md`: Chinese Fast Sub v0 MVP user-facing summary.
- `architecture/python-architecture.md`: Python architecture notes from the original CLI phase.
- `development.md`: Python development commands.
- `project-standards.md`: Python package and code style rules.
- `go-docs/README.md`: Go implementation overview.
- `go-docs/specs/daemon-api.md`: daemon API contract.
- `api/README.md`: generated API/reference documentation policy.
- `ui-docs/project-overview.md`: Electron product definition.
- `ui-docs/architecture.md`: Electron architecture.

## User Help

- `../help-docs/help/README.md`: user help, install, task guides, privacy, and troubleshooting.
- `../help-docs/privacy.md`: user-facing privacy entry point.
- `../help-docs/troubleshooting.md`: user-facing troubleshooting entry point.

## Release And QA Docs

- `release/windows.md`: Windows release notes.
- `release/macos.md`: macOS release follow-up notes.
- `release/validation.md`: release validation evidence index.
- `release/public-github-readiness.md`: public repository readiness checklist.
- `../desktop-tests/README.md`: desktop QA matrix.
- `../desktop-tests/round13-release-checklist.md`: release checklist.
- `../desktop-tests/round13-release-smoke.md`: release smoke record.
- `../desktop-tests/licenses/`: generated license inventories.
- `../THIRD_PARTY_NOTICES.md`: third-party notice and policy summary.

## Contributor Docs

- `../CONTRIBUTING.md`: contribution rules and validation commands.
- `../SECURITY.md`: security reporting and privacy-sensitive handling rules.
- `../CODE_OF_CONDUCT.md`: community behavior expectations.
- `agent-workflow.md`: AI-assisted development workflow.

## Archive

- `archive/python-rounds/`: historical Python CLI planning rounds and implementation notes.

Archived files are retained for context, but current implementation decisions should be taken from the active docs above.

## Generated API And Reference Docs

Future generated API/reference output should live under `api/` or a dedicated subdirectory such as:

```text
api/go/
api/python/
api/desktop/
```

This avoids conflicts with hand-written planning and status docs. Generated docs should be reproducible from source commands and should not replace `go-docs/specs/daemon-api.md`, which remains the hand-written daemon contract.

See `api/README.md` for generation, language, source-of-truth, and privacy rules for API/reference documentation.
