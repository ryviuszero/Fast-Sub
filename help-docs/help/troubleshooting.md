---
title: Troubleshooting
description: Fix common Fast Sub setup and job problems.
---

# Troubleshooting

Start with the diagnostics page. It should show app, daemon, platform, FFmpeg, model, provider, and recent error status without exposing secrets.

## The App Says FFmpeg Is Missing

FFmpeg/FFprobe is needed for media probing, audio extraction, and burn-in.

On Windows, the desktop app can install FFmpeg into app-private user data. If this fails:

- Retry from setup or diagnostics.
- Check your network.
- Use a package manager fallback if offered.
- Open diagnostics and review the redacted error.

## The ASR Model Is Missing

Install the default ASR model from the setup/model flow. Original subtitle generation with the default local provider is blocked until ASR is ready.

Check:

- Model store is writable.
- There is enough free disk space.
- Network is available.
- Verification completed after download.

## The Translation Model Is Missing

Install the default NLLB translation model. Local translation and bilingual output are blocked until translation is ready, but original subtitle generation can still work.

This is not an ASR failure. You can still generate original-language subtitles if the ASR provider and model are ready.

## API Provider Fails

Check:

- Base URL.
- Model name.
- Whether `/v1/models` is available.
- Whether the endpoint requires an API key.

Do not paste raw API keys into bug reports or screenshots.

If using a local OpenAI-compatible service, confirm the service is running and the configured port matches the app settings.

## Web Translation Times Out

Web providers are best for small files. For larger files, use local NLLB or an explicit API provider.

## The Job Is Stuck Or Cancel Does Not Finish

Open diagnostics. For packaged Windows builds, cancellation and app exit are expected to clean up daemon, Python worker, FFmpeg, and whisper.cpp child processes.

If a process remains, record:

- App version.
- Platform.
- Provider.
- Input type.
- Redacted diagnostics.

Do not include private media paths, transcripts, API keys, or daemon tokens.

## Output File Is Missing

Check:

- The job actually succeeded.
- The output directory exists.
- The app had permission to write there.
- The file was not removed by another process.
- The selected workflow was original subtitles, translation, bilingual, or burn-in.

## Translation Output Looks Wrong

Automatic translation is imperfect. Check:

- Source language and target language.
- Provider selection.
- Whether the input file is SRT or plain text.
- Whether long lines or unusual formatting confused the provider.
- Whether some cues failed and were left untranslated.

## Windows SmartScreen Warning

Current Windows builds are unsigned preview builds. SmartScreen warnings are expected until code signing is configured.

## What To Include In A Bug Report

Include:

- App version.
- Platform and architecture.
- Package type: installer, portable, development build, or packaged smoke.
- Provider and model names.
- Whether the input is audio, video, SRT, or text.
- Redacted diagnostics.
- Steps to reproduce.

Do not include:

- API keys.
- Authorization headers.
- Daemon tokens.
- Private media.
- Private transcripts.
- Full sensitive local paths.
