package ffmpeg

import (
	"context"
	"os"
	"time"

	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/paths"
)

// ExtractResult describes a normalized WAV extraction.
type ExtractResult struct {
	InputPath   string  `json:"input_path"`
	OutputPath  string  `json:"output_path"`
	SampleRate  int     `json:"sample_rate"`
	Channels    int     `json:"channels"`
	Codec       string  `json:"codec"`
	ElapsedSec  float64 `json:"elapsed_sec"`
	AudioStream string  `json:"audio_stream"`
}

// ExtractAudio creates a 16kHz mono PCM WAV through ffmpeg.
func (r Runner) ExtractAudio(ctx context.Context, input, output string, timeout time.Duration) (ExtractResult, *fserrors.AppError) {
	var empty ExtractResult
	if err := paths.ValidateInputFile(input); err != nil {
		return empty, fserrors.New(fserrors.CodeInvalidInput, "input", err.Error(), "", nil)
	}
	if err := paths.ValidateOutputPath(output); err != nil {
		return empty, fserrors.New(fserrors.CodeInvalidInput, "extract", err.Error(), "", nil)
	}
	ffmpegPath, err := LookPath(r.FFmpegName)
	if err != nil {
		return empty, fserrors.MissingDependency("extract", "ffmpeg")
	}

	tmp := paths.TempOutputPath(output)
	_ = os.Remove(tmp)
	defer os.Remove(tmp)

	extractCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	started := time.Now()
	args := []string{
		"-y",
		"-i", input,
		"-map", "0:a:0",
		"-vn",
		"-ac", "1",
		"-ar", "16000",
		"-c:a", "pcm_s16le",
		"-f", "wav",
		tmp,
	}
	completed := runCommand(extractCtx, ffmpegPath, args, r.tailLimit())
	elapsed := time.Since(started).Seconds()
	if completed.Err != nil {
		details := map[string]any{"exit_code": completed.ExitCode}
		if completed.Stderr != "" {
			details["stderr_tail"] = completed.Stderr
		}
		return empty, fserrors.New(
			fserrors.CodeFFmpegFailed,
			"extract",
			"ffmpeg failed: "+processMessage(completed),
			"Check that the input has an audio stream and ffmpeg can write the output.",
			details,
		)
	}
	if err := os.Rename(tmp, output); err != nil {
		return empty, fserrors.New(fserrors.CodeInvalidInput, "extract", "rename extracted audio: "+err.Error(), "", nil)
	}
	return ExtractResult{
		InputPath:   input,
		OutputPath:  output,
		SampleRate:  16000,
		Channels:    1,
		Codec:       "pcm_s16le",
		ElapsedSec:  elapsed,
		AudioStream: "0:a:0",
	}, nil
}
