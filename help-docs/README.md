---
title: Help Documentation
description: Fast Sub user help and GitHub Pages source.
---

# Fast Sub Help Docs

This directory is the source for the public user help site and GitHub Pages deployment.

- `index.md`: help site landing page.
- `help/`: task guides for download status, installation, transcription, translation, model setup, settings, diagnostics, and release notes.
- `privacy.md`: user-facing privacy page.
- `troubleshooting.md`: troubleshooting entry point.
- `_config.yml`, `_layouts/`, and `assets/`: GitHub Pages site configuration, layout, and styles.

GitHub Pages is built by `../.github/workflows/docs-pages.yml` from `help-docs/`.

Project planning, architecture, implementation records, generated API/reference output, and internal release notes live in `../dev-docs/`.
