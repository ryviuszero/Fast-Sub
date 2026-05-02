# Fast Sub Parallel Round 5.5: Benchmark Asset Downloader

## Summary

Round 5 has added `fast-sub bench`, but reliable benchmark results still depend on stable, legal, repeatable test data. Round 5.5 fills that gap with a manifest-controlled benchmark asset downloader.

This round is intentionally small and should use one branch:

```text
codex/fast-sub-bench-assets
```

The downloader is not a crawler, search tool, or generic media downloader. It only downloads assets explicitly listed in Fast Sub benchmark manifests or built-in source definitions, with source URL, license, redistributable flag, and download policy recorded up front.

Round 5.5 separates two concepts:

- `asset`: the original official downloadable file, such as an OpenSLR `.tar.gz` archive or a single upstream audio file.
- `sample`: the deterministic Fast Sub benchmark item prepared from an asset, such as one `.flac` plus one reference transcript file.

The expected flow is:

```text
download asset
-> verify original checksum
-> prepare deterministic sample
-> verify prepared media/reference
-> run fast-sub bench
```

## Goals

- Prepare real benchmark data for local STT performance testing.
- Keep all large media files out of git.
- Use official or clearly licensed sources only.
- Make benchmark samples reproducible across machines through manifest metadata and checksums.
- Provide a clean local data layout that `fast-sub bench` can consume directly.
- Keep default tests offline by mocking download behavior.

## Non-Goals

- Do not download from YouTube, Bilibili, podcast platforms, or arbitrary user URLs in this round.
- Do not scrape pages to discover files.
- Do not commit real 5-10 minute benchmark media files.
- Do not require real model downloads or real media downloads in CI.
- Do not implement WER/CER scoring yet unless the needed reference transcript flow is already trivial.
- Do not add aria2 in this round unless the implementation naturally leaves a downloader backend seam for it later.

## Branch Plan

Use one branch:

```text
codex/fast-sub-bench-assets
```

Reason:

- The work is centered on one command group, one manifest shape, and one local directory convention.
- Splitting this into multiple branches would likely create conflicts in CLI wiring, docs, and test fixtures.
- It is small enough to review as one focused change.

## Proposed CLI

Add a new command group:

```bash
fast-sub bench-assets sources
fast-sub bench-assets init
fast-sub bench-assets download <asset-id>
fast-sub bench-assets prepare <sample-id>
fast-sub bench-assets verify <sample-id>
fast-sub bench-assets verify --all
```

Optional later additions:

```bash
fast-sub bench-assets show <sample-id>
fast-sub bench-assets clean <sample-id>
```

### `sources`

Lists supported source families and whether they are automatically downloadable.

Output fields:

```text
id
name
languages
domain
license
source_url
download_policy: automatic|manual|unsupported
notes
```

### `init`

Creates local benchmark directories and a manifest template.

Default layout:

```text
local_tests/
  media/
  downloads/
  extracted/
  audio/
  references/
  manifests/
  reports/
```

Expected behavior:

- Safe to run repeatedly.
- Does not overwrite existing manifests unless `--overwrite` is provided.
- Prints the manifest path it created.
- Creates `downloads/` for original upstream assets and `extracted/` for safe temporary extraction. Both directories stay under ignored `local_tests/`.

### `download <asset-id>`

Downloads one manifest-controlled original asset.

Rules:

- Only accepts known asset IDs from a manifest or built-in source map.
- Requires `download_url` to be explicitly present.
- Requires `license`, `source_url`, `redistributable`, and `download_policy`.
- Rejects `license=unknown`.
- Rejects `download_policy=manual` unless the command is only showing instructions.
- Writes to `local_tests/downloads/` by default.
- Verifies official checksum when available.
- Computes SHA-256 after download, even when the official source only provides MD5.
- Does not silently redownload when checksum already matches.
- Without `--yes`, shows the download plan and exits without network access.
- With `--overwrite`, may replace an existing mismatched asset; without it, checksum mismatch is a hard error.

Useful options:

```bash
--manifest local_tests/manifests/benchmark-assets.json
--output-dir local_tests/downloads
--yes
--overwrite
--json
```

### `prepare <sample-id>`

Prepares a deterministic benchmark sample from a downloaded asset.

Rules:

- Only accepts known sample IDs from a manifest.
- Requires `source_asset_id`.
- Requires a deterministic prepare method.
- Never randomly chooses an utterance or clip.
- Writes prepared media to `local_tests/media/`.
- Writes reference transcript/subtitle to `local_tests/references/` when available.
- Computes SHA-256 for prepared media and reference files.
- If output already exists and checksum matches, skips.
- If output already exists and checksum differs, fails unless `--overwrite` is provided.

Supported prepare methods for v1:

```text
copy_file
copy_archive_member
extract_archive_member_with_transcript
```

Examples of deterministic selectors:

```json
{
  "archive_member": "LibriSpeech/dev-clean-2/1272/128104/1272-128104-0000.flac",
  "transcript_member": "LibriSpeech/dev-clean-2/1272/128104/1272-128104.trans.txt",
  "transcript_utterance_id": "1272-128104-0000"
}
```

Archive extraction safety:

- Reject absolute archive member paths.
- Reject `..` path segments.
- Reject symlinks and hard links.
- Reject any extracted path that resolves outside the intended `extract_dir`.
- Only extract listed members, not the full archive, when possible.

### `verify`

Verifies local sample readiness.

Checks:

- Manifest schema is valid.
- Required source/license fields are present.
- Original asset exists when required.
- Original asset is readable.
- Original asset checksum matches when provided.
- Prepared media exists when required.
- Prepared media is readable.
- Prepared media SHA-256 matches when provided.
- Reference transcript/subtitle exists when required.
- `source_url` and `download_url` use allowed schemes.
- `download_url` host is allowed for the selected source family.
- `asset_path`, `extract_dir`, `prepared_media_path`, `reference_transcript_path`, and `reference_subtitle_path` stay inside the intended local benchmark directory.

Possible statuses:

```text
raw_ready
prepared_ready
bench_ready
missing
checksum_mismatch
inaccessible
invalid_manifest
manual_required
unsupported
unsafe_archive
```

## Manifest Design

Manifest v1 should model assets and samples separately.

Example asset entry:

```json
{
  "id": "mini-librispeech-dev-clean-2",
  "kind": "asset",
  "asset_type": "archive",
  "source_dataset": "LibriSpeech",
  "source_url": "https://openslr.org/31/",
  "download_url": "https://openslr.trmal.net/resources/31/dev-clean-2.tar.gz",
  "allowed_hosts": ["openslr.org", "openslr.trmal.net", "openslr.elda.org"],
  "license": "CC BY 4.0",
  "redistributable": true,
  "download_policy": "automatic",
  "checksums": {
    "md5": null,
    "sha256": null
  },
  "size_bytes": null,
  "asset_path": "local_tests/downloads/mini-librispeech-dev-clean-2.tar.gz",
  "extract_dir": "local_tests/extracted/mini-librispeech-dev-clean-2",
  "source_accessed_at": "2026-05-02"
}
```

Example sample entry:

```json
{
  "id": "mini-librispeech-dev-clean-sample-001",
  "kind": "sample",
  "source_asset_id": "mini-librispeech-dev-clean-2",
  "benchmark_family": "fast_sub_local",
  "source_dataset": "LibriSpeech",
  "language": "en",
  "domain": "audiobook",
  "speaking_style": "read",
  "noise_profile": "clean_speech",
  "duration_target_sec": 600,
  "prepare_version": 1,
  "prepare_method": "extract_archive_member_with_transcript",
  "archive_member": "LibriSpeech/dev-clean-2/1272/128104/1272-128104-0000.flac",
  "transcript_member": "LibriSpeech/dev-clean-2/1272/128104/1272-128104.trans.txt",
  "transcript_utterance_id": "1272-128104-0000",
  "prepared_media_path": "local_tests/media/mini-librispeech-dev-clean-sample-001.flac",
  "prepared_media_checksum_sha256": null,
  "reference_transcript_path": "local_tests/references/mini-librispeech-dev-clean-sample-001.txt",
  "reference_transcript_checksum_sha256": null,
  "source_accessed_at": "2026-05-02"
}
```

Required before automatic download:

- `id`
- `kind=asset`
- `asset_type`
- `source_dataset`
- `source_url`
- `download_url`
- `license`
- `redistributable`
- `download_policy`
- `allowed_hosts`
- `asset_path`

Required before sample preparation:

- `id`
- `kind=sample`
- `source_asset_id`
- `prepare_version`
- `prepare_method`
- `prepared_media_path`

Required for archive member preparation:

- `archive_member`
- `transcript_member` when a reference transcript should be extracted.
- `transcript_utterance_id` when the transcript file contains multiple utterances.

Reference transcript normalization:

- Write UTF-8.
- Use LF newlines.
- Strip UTF-8 BOM.
- End with one trailing newline.
- Preserve source text unless the manifest later adds an explicit normalization rule.

## Initial Source Policy

Round 5.5 should prefer sources that are common in ASR benchmarking and have official download locations.

### Automatic Candidates

| Source | Language | Domain | Initial Use | Policy |
| --- | --- | --- | --- | --- |
| Mini LibriSpeech (OpenSLR SLR31) | en | audiobook | small clean English regression baseline | first automatic candidate |
| LibriSpeech (OpenSLR SLR12) | en | audiobook | clean English baseline | automatic if official file URL is pinned, but larger than SLR31 |
| AISHELL-1 | zh | Mandarin speech | clean Chinese baseline | automatic if official file URL is pinned |
| TED-LIUM 3 | en | TED talks | long-form oratory | automatic if official file URL is pinned |
| Common Voice | multi | read speech | multilingual coverage | automatic only for explicit locale/file links |

### Manual Or Deferred Candidates

| Source | Reason |
| --- | --- |
| GigaSpeech | large size and dataset workflow should be handled separately |
| KsponSpeech | access conditions need confirmation |
| ReazonSpeech | useful for Japanese, but size and source workflow need separate validation |
| YouTube/Bilibili/podcast clips | copyright and URL stability risks; keep manual only |

## Implementation Scope

Suggested files:

```text
src/fast_sub/bench_assets.py
src/fast_sub/cli.py
tests/test_bench_assets.py
FAST_SUB_TEST_ASSETS.md
FAST_SUB_PLAN.md
```

Recommended structure:

- Keep source definitions in plain Python data structures for v1.
- Add a small manifest parser/validator.
- Use streaming download with timeout and clear errors.
- Compute checksums in chunks.
- Support checksum objects with at least `md5` and `sha256`.
- Add deterministic prepare operations for file copy and safe archive member extraction.
- Keep `download` and `prepare` separate in the internal API.
- Keep network tests mocked.
- Reuse existing CLI JSON output conventions.
- In `--json` mode, stdout must contain only JSON; progress, warnings, and human-readable logs go to stderr.

Downloader backend:

- Use the current project dependency set if possible.
- If a new HTTP dependency is needed, prefer one already used in the project.
- Keep the backend replaceable so `aria2c` can be added later without changing CLI semantics.

JSON output shape:

```json
{
  "ok": true,
  "schema_version": 1,
  "command": "bench-assets verify",
  "items": [],
  "warnings": []
}
```

## Test Plan

Default tests must not hit the network.

Unit tests:

- `sources` lists known sources.
- `init` creates expected directories.
- Valid manifest passes schema checks.
- Asset id and sample id are distinct.
- Missing license fails validation.
- Unknown license fails validation.
- Missing download URL fails automatic download.
- Download URL host outside `allowed_hosts` fails validation.
- Manual-only asset returns `manual_required`.
- Fake download writes a file and records checksum.
- Checksum mismatch returns structured failure.
- Prepared sample checksum mismatch returns structured failure.
- `asset_path`, `extract_dir`, and prepared/reference paths escaping outside `local_tests/` are rejected.
- Unsafe archive entries with absolute paths, `..`, symlinks, or hard links are rejected.
- Existing matching output is skipped.
- Existing mismatched output fails unless `--overwrite` is passed.
- Reference transcript output is UTF-8/LF with one trailing newline.
- Inaccessible local file returns structured failure instead of traceback.

Manual tests:

```powershell
uv run fast-sub bench-assets sources
uv run fast-sub bench-assets init
uv run fast-sub bench-assets verify --all --json
```

After official URLs are pinned:

```powershell
uv run fast-sub bench-assets download <asset-id> --yes
uv run fast-sub bench-assets prepare <sample-id>
uv run fast-sub bench-assets verify <sample-id>
uv run fast-sub bench local_tests/media/<sample> --sample-id <sample-id>
```

## Acceptance Criteria

- `fast-sub bench-assets sources` works without network access.
- `fast-sub bench-assets init` creates the expected ignored local directory structure.
- `fast-sub bench-assets verify --all` produces structured human and JSON output.
- Automatic downloads are only allowed for manifest-approved URLs.
- Automatic downloads are only allowed for approved hosts in the selected source family.
- Downloaded assets get checksums recorded or displayed.
- Prepared samples get SHA-256 recorded or displayed.
- `download` and `prepare` are separate operations.
- Archive extraction is deterministic and path-safe.
- `verify` can distinguish `raw_ready`, `prepared_ready`, and `bench_ready`.
- No real benchmark media is committed.
- Tests cover manifest validation and fake download behavior.
- `FAST_SUB_TEST_ASSETS.md` documents which sources are automatic, manual, or deferred.

## Checklist

- [ ] Add `bench-assets` command group.
- [ ] Add source list output.
- [ ] Add local directory initializer.
- [ ] Add manifest validation.
- [ ] Add controlled download flow.
- [ ] Add deterministic prepare flow.
- [ ] Add safe archive member extraction.
- [ ] Add checksum verification.
- [ ] Add raw/prepared/bench readiness statuses.
- [ ] Add offline unit tests with mocked download.
- [ ] Update benchmark asset docs.
- [ ] Confirm no media files are staged.
