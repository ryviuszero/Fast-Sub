---
title: Providers
description: Configure local, API, and web providers in Fast Sub.
---

# Providers

Fast Sub uses providers for transcription and translation.

Providers are deliberately explicit. The app should not silently switch from a local provider to a remote provider just because a local model is missing.

## Local Providers

Local providers run on your machine.

Examples:

- `local-faster-whisper`
- `local-whisper-cpp`
- `local-nllb-ct2`

Local providers may require:

- App-private Python runtime.
- Native binaries.
- Installed models.
- FFmpeg/FFprobe.

Recommended local setup:

1. Install required models.
2. Recheck provider readiness.
3. Generate a small test subtitle.
4. Only then process long files.

The current default local NLLB translation model is marked `CC-BY-NC-4.0` in the model manifest. It is downloaded only after user action and is not bundled with the app. Review that model license before commercial or organizational use.

## API Providers

API providers connect to OpenAI-compatible endpoints.

Examples:

- `api-openai-transcription`
- `api-openai-chat`

They may require:

- Base URL.
- Model name.
- API key.

Local loopback OpenAI-compatible services may not require an API key. A 401 or 403 response usually means the endpoint requires credentials.

Connection check behavior:

- A reachable local endpoint without a key can be valid.
- A 401 or 403 response means credentials are probably required.
- A network error usually means the base URL is wrong or the service is not running.
- A successful connection does not guarantee the model can process every file type.

## Web Providers

Web translation providers are convenience options. They are less reliable than local models or explicit API providers and are better suited for small files.

Use web providers for quick tests or small files. For larger or repeatable jobs, prefer local NLLB or an explicit API provider.

## Secrets

Provider secrets are stored through the desktop app's safe storage flow. Renderer UI should not receive raw API keys. Config files should store aliases and non-secret settings, not raw keys.

## Upload Confirmation

Remote/API/web providers can send media or text outside your machine. Fast Sub should require explicit selection and confirmation before upload.

## Provider Selection Advice

| Need | Recommended provider type |
| --- | --- |
| Maximum privacy | Local ASR/local NLLB |
| Small installer and no local translation model | API provider |
| Quick small translation test | Web provider |
| GPU local transcription | Local ASR provider with GPU-capable runtime |
| Native ASR path | whisper.cpp |
