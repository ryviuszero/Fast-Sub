# Fast Sub Python Architecture

## Core Product Flow

Fast Sub is a CLI for generating and translating subtitles from media. The primary product path is:

```text
media input -> STT -> subtitles -> optional translation -> output
```

Support commands such as `doctor`, `models`, `providers`, `bench`, and `bench-translate` exist to inspect, prepare, or measure that path. They should depend on the core services, not become independent orchestration centers.

## Module Map

```text
fast_sub/
  cli/              Typer commands, JSON/stdout/stderr policy, redaction, exit codes
  pipeline/         auto/run orchestration for the product path
  managers/         cross-cutting coordination: providers, jobs, reports
  media/            probe/extract/analyze use cases and media input rules
  stt/              transcription service and STT provider boundary
  subtitles/        SRT parsing/rendering/refine/bilingual subtitle rules
  translation/      subtitle translation service and translation providers
  output/           output paths and burn-in video behavior
  benchmark/        transcription/translation benchmark tools, metrics, manifests
  model_store/      model manifest, cache, install, verify, download behavior
  infrastructure/   ffmpeg, worker subprocess, filesystem/network/runtime adapters
  contracts/        cross-language/process/version compatibility schemas
  compat/           legacy compatibility paths when they are extracted
```

## Manager Boundary

Managers coordinate repeated cross-cutting work. They should not own business rules.

- `cli/command_manager.py`: command execution shell, JSON purity, structured errors, redaction, exit codes.
- `managers/providers.py`: provider catalog, status, privacy, model/dependency availability, selection.
- `managers/jobs.py`: job paths, temp files, progress/checkpoint/error-file coordination.
- `managers/reports.py`: Markdown and human rendering from stable report contract models.
- `model_store/manager.py`: model cache, install, verify, checksum, download.

Avoid adding a generic `FastSubManager`, `SubtitleManager`, or `TranslationManager`. Domain actions should be named as services or orchestrators, such as `transcribe_media`, `translate_subtitles`, or `PipelineOrchestrator`.

## Contracts Boundary

`contracts/` is only for stable shapes that cross a public or semi-public boundary:

- CLI structured errors and exit-code semantics.
- Worker request/response/error JSON.
- Provider metadata/status/request/response schema.
- Benchmark report schema.
- Checkpoint schema used by resume behavior.

Do not put internal option dataclasses, display rows, temporary helper results, or one-function-only dataclasses in `contracts/`.

## Dependency Direction

```text
cli -> services/orchestrators
services/orchestrators -> managers
services/orchestrators -> domain helpers
managers -> infrastructure and contracts
providers -> infrastructure and contracts
domain helpers -> no Typer/Rich/network/process/model runtime
infrastructure -> contracts where JSON/process schemas are needed
```

