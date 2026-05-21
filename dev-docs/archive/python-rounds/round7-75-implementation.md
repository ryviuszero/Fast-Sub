# Fast Sub Round 7.75 Implementation Notes

## Project Shape

This is a `src/` layout Python CLI package managed by `pyproject.toml`. The public entry point remains `fast-sub = fast_sub.cli:main`.

## Current CLI Families And Side Effects

- `models`: reads model manifests, checks model cache, installs model files through the model manager.
- `providers`: inspects provider registry and environment-derived availability without running real providers.
- `doctor`, `probe`, `extract`, `analyze`, `burn`: call filesystem, ffmpeg/ffprobe, and media helpers.
- `bench`, `bench-translate`: assemble report options, progress output, JSON/Markdown report behavior, and benchmark exit-code policy.
- `transcribe`, `translate`, `auto`, `run`, bare command: main user flows with worker processes, model/runtime dependencies, subtitle writes, checkpoint/errors files, and JSON/human output policy.

## Behavior Locked Before Moving

- Existing CLI JSON and exit-code tests cover models, providers, media commands, transcribe, translate, bench, bench-translate, auto, and v0 release smoke paths.
- Added `tests/test_cli_help_contract.py` to lock root help command visibility and key help options for `transcribe`, `translate`, `bench`, and `bench-translate`.

## Layers Introduced

- `fast_sub.cli.app`: compatibility entrypoint and remaining high-coupling command shell.
- `fast_sub.cli.commands`: moved low-risk command shell for `models`, `providers`, and media utility commands.
- `fast_sub.cli.context`, `fast_sub.cli.errors`, `fast_sub.cli.redaction`, `fast_sub.cli.io`: shared CLI contract for consoles, JSON/error policy, exit-code mapping, and secret redaction.
- `fast_sub.application.model_service`: Typer-free model use cases for listing, verifying, and installing models.
- `fast_sub.contracts`: stable re-export boundary for errors, provider models, worker models, and report option shapes that Go migration must keep compatible.
- `fast_sub.domain` and `fast_sub.infrastructure`: compatibility boundaries that identify existing pure helpers and side-effect adapters without moving their implementation yet.

## Stop Points

- `bench` and `bench-translate` command bodies were not moved in this round. They are still tightly coupled to progress logging, inferred markdown paths, config/env fallback, failed report exit policy, and report rendering helpers. Moving them safely should happen after adding narrower golden tests for report command-line assembly and progress stderr/stdout behavior.
- `transcribe`, `translate`, `auto`, `run`, and bare-command routing were not moved. These are the highest-risk product paths and already have worker/process/checkpoint/provider side effects. They should be split only after benchmark command extraction lands cleanly or after Go compatibility fixtures are added.
- Provider/worker deep infrastructure moves were limited to boundary re-export modules. The concrete implementations stay in place to avoid changing model install, remote upload, redaction, or JSON purity behavior.

