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
- Windows preview release notes and SHA256 checksums are recorded in `dev-docs/release/v0.13.1.md`; macOS arm64 preview checksums remain recorded in `dev-docs/release/v0.13.0.md` until the next macOS release-machine build.
- README and user help now point to GitHub Releases and explicitly state unsigned/ad-hoc signing status.
- `master` branch protection is configured to require up-to-date `Go`, `Python`, and `Desktop` checks and conversation resolution; force pushes and branch deletion are disabled.
- GitHub private vulnerability reporting was requested through the repository API. Because the repository is still private and the API response does not expose a verification field, maintainers should recheck the setting in the GitHub UI after making the repository public.

## Still Required Before Public Binary Releases

- Decide whether Windows/macOS artifacts are allowed to remain unsigned for public releases.
- Recheck private vulnerability reporting in repository settings after changing repository visibility to public.
- Recheck FFmpeg/aria2 runtime-download license obligations before changing them from `download-only` to bundled.
