# Generated API And Reference Docs

This directory is reserved for generated API/reference documentation.

Current checked-in reference sets:

- `go/README.md`: Go CLI, daemon, job, provider, model, worker, and runtime reference.
- `python/README.md`: Python CLI/service/provider/worker reference.
- `desktop/README.md`: Electron preload, IPC bridge, client, and shared TypeScript contract reference.
- `schemas/README.md`: JSON shape index for daemon responses, jobs, providers, models, worker protocol, and desktop view models.

## Purpose

Use this directory for generated or tool-assisted reference output, such as:

- Go package documentation.
- Python API references.
- Desktop TypeScript reference docs.
- OpenAPI-style exports.
- Schema snapshots derived from source code.

Do not use this directory for product planning, release notes, user help, or hand-written workflow guides.

## Recommended Layout

```text
go/
python/
desktop/
schemas/
```

Suggested ownership:

- `go/`: generated reference docs for `cmd/fast-sub-go/` and Go `internal/` packages when useful.
- `python/`: generated reference docs for Python CLI, provider, worker, benchmark, and model-store modules.
- `desktop/`: generated reference docs for Electron main, preload, shared contracts, renderer client types, and IPC-facing TypeScript.
- `schemas/`: generated or exported JSON schema/OpenAPI-style snapshots.

## Source Of Truth

Do not use generated output as the source of truth for product contracts. Hand-written contracts stay in:

- `../go-docs/specs/daemon-api.md`
- `../ui-docs/architecture.md`
- `../ui-docs/specs/`

If generated API docs disagree with hand-written contracts, treat that as a contract drift issue. Update the source code, the hand-written contract, or both before relying on the generated output.

## Language Policy

Generated API/reference docs should be English-first.

Keep identifiers exactly as implemented:

- API paths.
- CLI commands and flags.
- JSON fields.
- Provider ids.
- Model ids.
- Error codes.
- Event names.
- Type names.

Chinese notes are acceptable only in short maintainer-only context blocks. Do not mix Chinese and English prose in generated reference descriptions.

## Generation Rules

If generated docs are committed, record the generation command in this README or in the corresponding subdirectory README.

Each generated doc set should state:

- Source commit or source path.
- Tool name and version when practical.
- Exact command used to regenerate.
- Whether output is checked in or produced only for local review.
- Any known omissions, private APIs, or unstable internal packages.

Do not commit generated docs that contain:

- API keys, access tokens, ready tokens, signed URLs, or Authorization headers.
- Local absolute paths.
- Real user media paths.
- Model files or generated model metadata that is not intended for the public repository.
- Real benchmark outputs unless they were explicitly approved as public release evidence.

## Update Requirements

When code changes affect public or semi-public behavior, update the hand-written contract first and then regenerate reference docs if needed.

Contract-sensitive changes include:

- CLI command names, flags, defaults, stdout/stderr behavior, JSON output, and exit codes.
- Daemon REST endpoints, SSE event shapes, job states, request/response bodies, and auth behavior.
- Provider ids, model ids, model manifest fields, availability states, and error codes.
- Worker request/response/error schemas.
- Electron IPC names, preload API shape, and shared client contract types.

Generated docs are useful for navigation and review, but they do not approve contract changes by themselves.
