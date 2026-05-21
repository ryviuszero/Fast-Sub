---
title: Burn Subtitles Into Video
description: Render subtitles into a new video file.
---

# Burn Subtitles Into Video

Burn-in creates a new video file with subtitles rendered into the video image.

## Requirements

Burn-in requires:

- FFmpeg.
- Input video file.
- Subtitle file.
- Writable output directory.

## Workflow

1. Select the burn-in tool.
2. Choose a video file.
3. Choose an SRT subtitle file.
4. Choose output settings.
5. Start the burn-in job.
6. Open the output video when complete.

## Before Burning In

Burn-in is usually the final step. Before burning:

- Open the subtitle file and check timing.
- Check spelling and names.
- Confirm line breaks are acceptable.
- Confirm translation or bilingual layout is correct.
- Use a short test clip if you are unsure about style or output size.

## Notes

- Burn-in creates a new video file.
- The original video is not modified.
- Output files can be large.
- FFmpeg errors usually indicate missing FFmpeg/FFprobe, unsupported input media, bad subtitle path, or output permission problems.

Diagnostics and logs must redact private credentials and should not expose raw daemon tokens or Authorization headers.

## Common Failures

| Problem | Likely cause |
| --- | --- |
| FFmpeg missing | FFmpeg/FFprobe is not installed or not visible to the packaged daemon. |
| Subtitle path error | Subtitle file was moved, deleted, or has an unsupported path. |
| Output write error | Output directory is not writable or file is locked. |
| Very large output | Burn-in re-encodes video and can create large files. |
