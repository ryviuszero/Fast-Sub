---
title: First Run And Model Setup
description: How Fast Sub installs and verifies local ASR and translation models.
---

# First Run And Model Setup

Fast Sub does not bundle speech or translation models with the installer.

Models are downloaded into a local model store when you choose to install them.

## Why Models Are Separate

Models can be large, hardware-dependent, and license-sensitive. Keeping them outside the installer helps:

- Keep the installer smaller.
- Let users choose what to download.
- Avoid bundling model files with special license requirements.
- Make model updates independent of app updates.

## Default ASR Model

The default ASR setup prioritizes a small local model for first-run readiness.

If the default ASR model is missing:

- Local transcription is not ready.
- Original subtitle generation with the default local provider is blocked until the model is installed.
- The app should offer install, retry, diagnostics, or skip actions.

Recommended first-run behavior:

1. Check the setup screen.
2. If local transcription is not ready, open the model install action.
3. Confirm available disk space.
4. Start the model download.
5. Wait for verification to finish.
6. Generate a short test subtitle before processing large files.

Do not mark local ASR as ready until the model is installed and verified.

## Default Translation Model

The default local translation provider uses the default NLLB manifest.

If the default NLLB model is missing:

- Local translation is not ready.
- Translation and bilingual subtitle workflows are blocked for the local NLLB provider.
- Original-language subtitle generation can still work if ASR is ready.

Local NLLB is useful when you want subtitle text to remain on your machine. It may require more disk space and memory than small ASR models.

If you only need original-language subtitles, you can skip translation setup at first.

## Disk Space And Network

Before installing models:

- Make sure the model store is writable.
- Make sure there is enough free disk space.
- Keep the app open until verification completes.
- Prefer a stable network connection.

If the download is interrupted, retry from the model setup screen. Verification should catch incomplete or corrupted downloads.

## Failed Downloads

Common causes:

- Network interruption.
- Not enough disk space.
- Model store is not writable.
- Download was cancelled.
- Verification failed.

Use retry or diagnostics. Do not manually copy random model files into the store unless you are following a documented development or recovery process.

## Model Store Cleanup

Fast Sub should not delete models without explicit user action. If you need to reclaim disk space, use a documented model removal flow when available. Manual deletion can make providers appear broken until models are reinstalled or verified.
