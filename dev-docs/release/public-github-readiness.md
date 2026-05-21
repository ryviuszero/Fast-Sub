# Public GitHub Readiness

This checklist tracks the minimum repository state before Fast Sub is promoted from
"source-visible" to a broadly announced public GitHub project.

## Resolved In This Branch

- Project source license is now MIT in `LICENSE`.
- `README.md`, `pyproject.toml`, and `desktop/package.json` identify the project license.
- Electron package resources include both `LICENSE` and `THIRD_PARTY_NOTICES.md`.
- `SECURITY.md` points reporters to GitHub private vulnerability reporting instead of public issues.
- User-facing docs call out that the default NLLB model is CC-BY-NC-4.0 and not bundled.
- `THIRD_PARTY_NOTICES.md` clarifies that generated license summaries cover bundled npm/Python/Go dependencies, while runtime downloads and model policies are tracked in the notice file.
- GitHub Actions CI now runs Go tests, Python lint/type/test, and desktop typecheck/test/build.

## Still Required Before Public Binary Releases

- Enable GitHub private vulnerability reporting in repository settings.
- Decide whether Windows/macOS artifacts are allowed to remain unsigned for public releases.
- Complete macOS arm64 dmg packaging and smoke on a macOS release machine.
- Add release checksums when attaching binary artifacts to GitHub Releases.
- Recheck FFmpeg/aria2 runtime-download license obligations before changing them from `download-only` to bundled.
