package ffmpeg

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"time"

	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/paths"
)

// BurnInOptions controls the ffmpeg subtitle burn-in pass.
type BurnInOptions struct {
	Preset  string
	Timeout time.Duration
}

// BurnIn renders hard subtitles into a video with ffmpeg.
func (r Runner) BurnIn(ctx context.Context, input, subtitlePath, output string, options BurnInOptions) (ExtractResult, *fserrors.AppError) {
	var empty ExtractResult
	if err := paths.ValidateInputFile(input); err != nil {
		return empty, fserrors.New(fserrors.CodeInvalidInput, "input", err.Error(), "", nil)
	}
	if err := paths.ValidateInputFile(subtitlePath); err != nil {
		return empty, fserrors.New(fserrors.CodeInvalidInput, "burning_in", err.Error(), "Choose an existing subtitle file.", nil)
	}
	if output == "" {
		return empty, fserrors.New(fserrors.CodeInvalidInput, "rendering", "output_path is required.", "", nil)
	}
	ffmpegPath, err := LookPath(r.FFmpegName)
	if err != nil {
		return empty, fserrors.MissingDependency("burning_in", "ffmpeg")
	}

	timeout := options.Timeout
	if timeout <= 0 {
		timeout = 6 * time.Hour
	}
	tmp := paths.TempOutputPath(output)
	_ = os.Remove(tmp)
	defer os.Remove(tmp)

	burnCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	started := time.Now()
	args := burnInArgs(input, subtitlePath, tmp, burnPreset(options.Preset))
	completed := runCommand(burnCtx, ffmpegPath, args, r.tailLimit())
	elapsed := time.Since(started).Seconds()
	if completed.Err != nil {
		details := map[string]any{"exit_code": completed.ExitCode}
		if completed.Stderr != "" {
			details["stderr_tail"] = completed.Stderr
		}
		return empty, fserrors.New(
			fserrors.CodeFFmpegFailed,
			"burning_in",
			"ffmpeg failed: "+processMessage(completed),
			"Check that the video, subtitle file, and output path are valid.",
			details,
		)
	}
	if err := os.Rename(tmp, output); err != nil {
		return empty, fserrors.New(fserrors.CodeInvalidInput, "rendering", "rename burned video: "+err.Error(), "", nil)
	}
	return ExtractResult{
		InputPath:  input,
		OutputPath: output,
		ElapsedSec: elapsed,
	}, nil
}

func subtitleFilter(path string) string {
	return "subtitles=filename='" + escapeFilterValue(filepath.ToSlash(path)) + "'"
}

func burnInArgs(input, subtitlePath, output, preset string) []string {
	return []string{
		"-y",
		"-hide_banner",
		"-nostdin",
		"-loglevel", "error",
		"-i", input,
		"-vf", subtitleFilter(subtitlePath),
		"-map", "0:v:0",
		"-map", "0:a?",
		"-c:v", "libx264",
		"-preset", preset,
		"-crf", "23",
		"-c:a", "copy",
		"-movflags", "+faststart",
		"-f", "mp4",
		output,
	}
}

func escapeFilterValue(value string) string {
	replacer := strings.NewReplacer(
		"\\", "\\\\",
		"'", "\\'",
		":", "\\:",
		",", "\\,",
		"[", "\\[",
		"]", "\\]",
		";", "\\;",
	)
	return replacer.Replace(value)
}

func burnPreset(value string) string {
	switch value {
	case "fast", "veryfast":
		return "veryfast"
	case "quality", "slow":
		return "slow"
	default:
		return "medium"
	}
}
