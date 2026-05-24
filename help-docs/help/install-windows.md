---
title: Install On Windows
description: Windows installer and portable package guide for Fast Sub.
---

# Install On Windows

Fast Sub currently provides two Windows x64 package types:

- Installer: `FastSub-Desktop-0.13.1-windows-x64.exe`
- Portable zip: `FastSub-Desktop-0.13.1-windows-x64.zip`

## Installer

Use the installer if you want Fast Sub to behave like a normal desktop app.

Expected behavior:

- Installs the app into a standard application directory.
- Uses user data directories for config, logs, native binaries, model store references, and secrets.
- Does not remove all user data automatically when uninstalling.

Recommended path:

1. Download the installer from the trusted project release location.
2. Run the installer.
3. Start Fast Sub.
4. Complete the setup checks.
5. Install the default ASR model when prompted.
6. Generate subtitles from a short test file.

## Portable Zip

Use the portable zip if you want to unpack and run the app without installing.

Expected behavior:

- The app can run from the unpacked folder.
- User data still goes to the normal app user data location.
- Do not store private media, model files, or job outputs inside the app package folder unless you intentionally choose that location.

Recommended path:

1. Extract the zip to a normal user-writable folder.
2. Run `Fast Sub.exe`.
3. Complete the setup checks.
4. Keep the extracted folder intact. Do not delete files from `resources`.

## SmartScreen Or Antivirus Warnings

Current Windows builds are unsigned preview builds. Windows SmartScreen or antivirus tools may warn about the app until a code-signing certificate is configured.

If you are testing an internal build, confirm that the artifact came from the expected project release process before running it.

## Runtime Components

The Windows package includes:

- Electron desktop app.
- Go daemon.
- Native whisper.cpp runtime for the packaged native transcription provider.
- App-private Python runtime for local ASR and local translation bridge.

The Windows package does not include:

- Whisper/NLLB model files.
- FFmpeg/FFprobe.
- aria2.

These are installed or downloaded into app-private user data paths when needed.

## Where Data Is Stored

The app uses user data locations for runtime data. The exact path depends on Windows and Electron user data rules, but it may contain:

- App config.
- Provider settings.
- Encrypted provider key records.
- Job logs.
- Native binaries downloaded at runtime.
- UI state.
- Model store references.

Uninstalling the app does not necessarily remove all user data. Remove user data only if you understand that this may delete local configuration, logs, and downloaded runtime components.

## After Installation

Run these checks in the app:

- Environment check is healthy.
- FFmpeg/FFprobe is ready or installable.
- Default ASR model is installed.
- Local transcription provider is ready.
- Optional: default NLLB model is installed if you plan to translate locally.
