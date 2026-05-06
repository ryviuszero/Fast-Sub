// Package cli implements the fast-sub-go command dispatcher.
package cli

import (
	"context"
	"fmt"
	"os"
	"runtime"

	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/ffmpeg"
)

func runDoctor(ctx context.Context, cfg Config, args []string) int {
	jsonOutput, positionals, err := parseJSONFlag(args)
	if err != nil {
		return commandError(cfg, "doctor", jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "doctor", err.Error(), "", nil))
	}
	if len(positionals) != 0 {
		return commandError(cfg, "doctor", jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "doctor", "doctor does not accept positional arguments", "", nil))
	}

	result := map[string]any{
		"ffmpeg":  ffmpeg.CheckBinary(ctx, cfg.Runner.FFmpegName, doctorTimeout),
		"ffprobe": ffmpeg.CheckBinary(ctx, cfg.Runner.FFprobeName, doctorTimeout),
		"platform": map[string]any{
			"os":   runtime.GOOS,
			"arch": runtime.GOARCH,
		},
		"cwd": cwdStatus(),
	}
	ffmpegStatus := result["ffmpeg"].(ffmpeg.BinaryStatus)
	ffprobeStatus := result["ffprobe"].(ffmpeg.BinaryStatus)
	cwd := result["cwd"].(map[string]any)
	ok := ffmpegStatus.Available && ffprobeStatus.Available && cwd["readable"] == true

	if jsonOutput {
		if ok {
			writeSuccessJSON(cfg.Stdout, "doctor", result)
			return fserrors.ExitOK
		}
		return writeErrorJSON(cfg.Stdout, "doctor", fserrors.New(
			fserrors.CodeMissingDependency,
			"doctor",
			"ffmpeg or ffprobe was not found on PATH.",
			"Install ffmpeg and make sure ffmpeg and ffprobe are available on PATH.",
			map[string]any{"ffmpeg_available": ffmpegStatus.Available, "ffprobe_available": ffprobeStatus.Available},
		))
	}

	fmt.Fprintln(cfg.Stdout, "Fast Sub Go doctor")
	fmt.Fprintf(cfg.Stdout, "ffmpeg: %s\n", availability(ffmpegStatus.Available, ffmpegStatus.Path))
	fmt.Fprintf(cfg.Stdout, "ffprobe: %s\n", availability(ffprobeStatus.Available, ffprobeStatus.Path))
	fmt.Fprintf(cfg.Stdout, "platform: %s/%s\n", runtime.GOOS, runtime.GOARCH)
	if !ok {
		return fserrors.ExitMissingDependency
	}
	return fserrors.ExitOK
}

func cwdStatus() map[string]any {
	cwd, err := os.Getwd()
	if err != nil {
		return map[string]any{"readable": false, "error": err.Error()}
	}
	if _, err := os.Stat(cwd); err != nil {
		return map[string]any{"readable": false, "error": err.Error()}
	}
	return map[string]any{"readable": true}
}

func availability(ok bool, path string) string {
	if !ok {
		return "missing"
	}
	if path == "" {
		return "ok"
	}
	return "ok (" + path + ")"
}
