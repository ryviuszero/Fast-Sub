// Package cli implements the fast-sub-go command dispatcher.
package cli

import (
	"context"
	"fmt"
	"io"
	"os"
	"runtime"
	"strings"
	"time"

	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/ffmpeg"
)

const (
	doctorTimeout  = 5 * time.Second
	probeTimeout   = 30 * time.Second
	extractTimeout = 30 * time.Minute
)

// Config carries command inputs and injectable writers.
type Config struct {
	Args    []string
	Stdout  io.Writer
	Stderr  io.Writer
	Version string
	Runner  ffmpeg.Runner
}

// Run dispatches fast-sub-go and returns a process exit code.
func Run(ctx context.Context, cfg Config) int {
	if cfg.Stdout == nil {
		cfg.Stdout = io.Discard
	}
	if cfg.Stderr == nil {
		cfg.Stderr = io.Discard
	}
	if cfg.Version == "" {
		cfg.Version = "0.1.0-dev"
	}
	if cfg.Runner.FFmpegName == "" {
		cfg.Runner = ffmpeg.NewRunner()
	}
	args := cfg.Args
	if len(args) == 0 {
		return usageError(cfg.Stdout, cfg.Stderr, "", false)
	}
	if args[0] == "--version" || args[0] == "version" {
		fmt.Fprintln(cfg.Stdout, cfg.Version)
		return fserrors.ExitOK
	}

	switch args[0] {
	case "doctor":
		return runDoctor(ctx, cfg, args[1:])
	case "probe":
		return runProbe(ctx, cfg, args[1:])
	case "extract":
		return runExtract(ctx, cfg, args[1:])
	case "--help", "-h", "help":
		printHelp(cfg.Stdout)
		return fserrors.ExitOK
	default:
		return usageError(cfg.Stdout, cfg.Stderr, args[0], false)
	}
}

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

func runProbe(ctx context.Context, cfg Config, args []string) int {
	jsonOutput, positionals, err := parseJSONFlag(args)
	if err != nil {
		return commandError(cfg, "probe", jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "probe", err.Error(), "", nil))
	}
	if len(positionals) != 1 {
		return commandError(cfg, "probe", jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "probe", "probe requires exactly one input path", "", nil))
	}
	metadata, appErr := cfg.Runner.Probe(ctx, positionals[0], probeTimeout)
	if appErr != nil {
		return commandError(cfg, "probe", jsonOutput, appErr)
	}
	if jsonOutput {
		writeSuccessJSON(cfg.Stdout, "probe", metadata)
		return fserrors.ExitOK
	}
	fmt.Fprintf(cfg.Stdout, "path: %s\n", metadata.Path)
	if metadata.DurationSec != nil {
		fmt.Fprintf(cfg.Stdout, "duration_sec: %v\n", *metadata.DurationSec)
	} else {
		fmt.Fprintln(cfg.Stdout, "duration_sec: ")
	}
	fmt.Fprintf(cfg.Stdout, "container: %v\n", metadata.Container)
	fmt.Fprintf(cfg.Stdout, "audio_streams: %d\n", len(metadata.AudioStreams))
	fmt.Fprintf(cfg.Stdout, "video_streams: %d\n", len(metadata.VideoStreams))
	return fserrors.ExitOK
}

func runExtract(ctx context.Context, cfg Config, args []string) int {
	parsed, err := parseExtractArgs(args)
	if err != nil {
		return commandError(cfg, "extract", parsed.jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "extract", err.Error(), "", nil))
	}
	if len(parsed.positionals) != 1 {
		return commandError(cfg, "extract", parsed.jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "extract", "extract requires exactly one input path", "", nil))
	}
	result, appErr := cfg.Runner.ExtractAudio(ctx, parsed.positionals[0], parsed.output, extractTimeout)
	if appErr != nil {
		return commandError(cfg, "extract", parsed.jsonOutput, appErr)
	}
	if parsed.jsonOutput {
		writeSuccessJSON(cfg.Stdout, "extract", result)
		return fserrors.ExitOK
	}
	fmt.Fprintf(cfg.Stdout, "Wrote audio: %s\n", result.OutputPath)
	return fserrors.ExitOK
}

func commandError(cfg Config, command string, jsonOutput bool, appErr *fserrors.AppError) int {
	if jsonOutput {
		return writeErrorJSON(cfg.Stdout, command, appErr)
	}
	writeHumanError(cfg.Stderr, appErr)
	return fserrors.ExitCode(appErr)
}

func usageError(stdout, stderr io.Writer, command string, jsonOutput bool) int {
	message := "unknown command"
	if command == "" {
		message = "missing command"
	}
	appErr := fserrors.New(fserrors.CodeInvalidUsage, "cli", message, "Run `fast-sub-go --help`.", nil)
	if jsonOutput {
		return writeErrorJSON(stdout, "cli", appErr)
	}
	writeHumanError(stderr, appErr)
	return fserrors.ExitInvalidInput
}

type extractArgs struct {
	jsonOutput  bool
	output      string
	positionals []string
}

func parseJSONFlag(args []string) (bool, []string, error) {
	jsonOutput := false
	positionals := make([]string, 0, len(args))
	for _, arg := range args {
		switch arg {
		case "--json":
			jsonOutput = true
		default:
			if strings.HasPrefix(arg, "-") {
				return jsonOutput, nil, fmt.Errorf("unknown flag: %s", arg)
			}
			positionals = append(positionals, arg)
		}
	}
	return jsonOutput, positionals, nil
}

func parseExtractArgs(args []string) (extractArgs, error) {
	parsed := extractArgs{positionals: make([]string, 0, len(args))}
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--json":
			parsed.jsonOutput = true
		case arg == "--output" || arg == "-o":
			if i+1 >= len(args) {
				return parsed, fmt.Errorf("%s requires a value", arg)
			}
			i++
			parsed.output = args[i]
		case strings.HasPrefix(arg, "--output="):
			parsed.output = strings.TrimPrefix(arg, "--output=")
		case strings.HasPrefix(arg, "-"):
			return parsed, fmt.Errorf("unknown flag: %s", arg)
		default:
			parsed.positionals = append(parsed.positionals, arg)
		}
	}
	return parsed, nil
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

func printHelp(stdout io.Writer) {
	fmt.Fprintln(stdout, "Fast Sub Go CLI")
	fmt.Fprintln(stdout, "")
	fmt.Fprintln(stdout, "Commands:")
	fmt.Fprintln(stdout, "  --version")
	fmt.Fprintln(stdout, "  doctor [--json]")
	fmt.Fprintln(stdout, "  probe <input> [--json]")
	fmt.Fprintln(stdout, "  extract <input> --output <wav> [--json]")
}
