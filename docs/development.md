# Fast Sub Development Notes

## Source Layout

The Python package lives under `src/fast_sub`.

- `cli/` owns Typer app registration, command modules, CLI JSON errors, and redaction.
- `clients/` owns network and external-service request clients.
- `providers/` owns provider definitions, registry construction, and STT provider resolution.
- `stt/` owns transcription options, worker orchestration, and legacy STT adapters.
- `translation/` owns translation options, language mapping, parsing, and translation orchestration.
- `subtitles/` owns subtitle models, SRT rendering, and refinement.
- `model_store/` owns local model manifests, install/verify flows, and download choices.
- `benchmark/` owns transcription and translation benchmark workflows.
- `infrastructure/` owns local runtime helpers such as ffmpeg and worker process execution.

## Checks

Run lint and tests before committing:

```bash
uv run ruff check src\fast_sub tests
uv run pytest
```

Current full test status after the CLI refactor:

```text
236 passed, 31 skipped
```

`pytest` may warn that `.pytest_cache` cannot be written on Windows when the cache
directory is locked or permission-restricted. That warning does not affect test results.

## Type Checking

`mypy` is available in the dev dependency group:

```bash
uv run mypy src
```

The current mypy configuration skips third-party import bodies so the command focuses on
project source files and avoids local `.venv` stub permission issues.

Current baseline:

```text
Success: no issues found in 85 source files
```

Treat future type cleanup as separate, focused commits rather than mixing it with
behavioral refactors.

## Project Standards

See `docs/project-standards.md` for the Chinese framework and code style
standards covering package ownership, layering, imports, models, constants,
errors, clients, CLI, docstrings, and tests.
