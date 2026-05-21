---
title: Translate Subtitles
description: Translate subtitle and text files with local, API, or web providers.
---

# Translate Subtitles

Use this workflow to translate existing subtitle or text files.

## Supported Inputs

Fast Sub is designed to translate subtitle files and plain text-style inputs such as:

- SRT subtitles.
- TXT files.
- Markdown/text files where line layout should be preserved.

## Provider Choices

Local provider:

- `local-nllb-ct2`
- Runs locally.
- Requires the default NLLB model or another compatible local translation model.

API provider:

- `api-openai-chat`
- Uses an OpenAI-compatible chat endpoint.
- May require a base URL, model name, and API key.

Web providers:

- `web-bing`
- `web-google`
- Convenience providers, not a reliability guarantee.
- Better suited for small files.

## Local Translation

Local NLLB translation keeps subtitle text on your machine. It requires the local translation model to be installed.

If the NLLB model is missing, translation should fail with a recoverable missing-model message. Original-language subtitle generation is not blocked by a missing translation model.

Recommended local workflow:

1. Install and verify the default NLLB model.
2. Select `local-nllb-ct2`.
3. Choose source and target languages.
4. Translate a small SRT file first.
5. Confirm cue count and line layout.
6. Use larger files after the small test succeeds.

For text files, Fast Sub should preserve physical line structure where possible. Empty lines should remain empty, and translated output should not collapse the entire document into one paragraph.

## API Or Web Translation

API and web translation can upload subtitle text to an external service. Fast Sub should require explicit provider selection and confirmation before upload.

Do not paste API keys into logs, screenshots, issues, or release records.

API provider checklist:

- Base URL is correct.
- Model name is correct.
- `/v1/models` is reachable when the provider supports it.
- API key is saved only if the endpoint requires it.
- Upload confirmation is shown before sending subtitle text.

## Large Files

For large files, prefer local translation or a reliable API provider. Web translation providers may time out or fail.

## Quality Review

Automatic translation is a first draft. Always review:

- Names and terminology.
- Line breaks.
- Speaker labels.
- CJK punctuation and spacing.
- Long lines.
- Failed or untranslated cues.

If translation quality matters, export the result and review it in a subtitle editor.
