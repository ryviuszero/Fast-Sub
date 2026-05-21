---
title: Bilingual Subtitles
description: Create original and translated subtitles in one output.
---

# Bilingual Subtitles

Bilingual subtitles combine original-language text and translated text in one output.

## Requirements

To create bilingual subtitles from media, you need:

- A working ASR provider and installed ASR model.
- A working translation provider.
- A writable output directory.

For local-only bilingual subtitles:

- Local Faster Whisper or whisper.cpp handles transcription.
- Local NLLB handles translation.
- No remote provider is needed.

## Workflow

1. Add a media file.
2. Enable translated or bilingual output.
3. Choose source and target languages.
4. Select a translation provider.
5. Start the job.
6. Review the generated bilingual subtitle file.

## Recommended Order

For the first bilingual test:

1. Generate original subtitles only.
2. Translate the generated SRT.
3. Then run the combined bilingual workflow.

This makes it easier to identify whether failures come from ASR, translation, or output rendering.

## If Translation Is Not Ready

If the translation model or provider is missing:

- Original subtitle generation can still work.
- Bilingual output is blocked until translation readiness is fixed.

Install the local translation model or switch to an explicitly selected API/web provider.

## Review Checklist

After generation, check:

- Original text is present.
- Translated text is present.
- The two languages are paired on the expected cues.
- Timing still follows the original speech.
- Long bilingual cues are readable.

For final publishing, review the bilingual file manually before burning it into video.
