// Package cli implements the fast-sub-go command dispatcher.
package cli

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/ffmpeg"
	"fast-sub/internal/providers"
)

const (
	doctorTimeout               = 5 * time.Second
	probeTimeout                = 30 * time.Second
	extractTimeout              = 30 * time.Minute
	rawAPIKeyUnsupportedMessage = "raw --api-key is not supported; use --api-key-env"
)

type Config struct {
	Args      []string
	Stdout    io.Writer
	Stderr    io.Writer
	Version   string
	Runner    ffmpeg.Runner
	Providers providers.RuntimeConfig
}

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
	if cfg.Providers.Env == nil {
		cfg.Providers = providers.DefaultRuntimeConfig()
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
	case "transcribe":
		return runTranscribe(ctx, cfg, "transcribe", args[1:])
	case "auto":
		return runTranscribe(ctx, cfg, "auto", args[1:])
	case "models":
		return runModels(ctx, cfg, args[1:])
	case "providers":
		return runProviders(ctx, cfg, args[1:])
	case "serve", "daemon":
		return runServe(ctx, cfg, args[1:])
	case "--help", "-h", "help":
		printHelp(cfg.Stdout)
		return fserrors.ExitOK
	default:
		return usageError(cfg.Stdout, cfg.Stderr, args[0], false)
	}
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

func requireValue(args []string, index int, flag string) (string, int, error) {
	if index+1 >= len(args) {
		return "", index, fmt.Errorf("%s requires a value", flag)
	}
	return args[index+1], index + 1, nil
}

func hasString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func printHelp(stdout io.Writer) {
	fmt.Fprintln(stdout, "Fast Sub Go CLI")
	fmt.Fprintln(stdout, "")
	fmt.Fprintln(stdout, "Commands:")
	fmt.Fprintln(stdout, "  --version")
	fmt.Fprintln(stdout, "  doctor [--json]")
	fmt.Fprintln(stdout, "  probe <input> [--json]")
	fmt.Fprintln(stdout, "  extract <input> --output <wav> [--json]")
	fmt.Fprintln(stdout, "  models list [--json]")
	fmt.Fprintln(stdout, "  models verify <id> [--json]")
	fmt.Fprintln(stdout, "  models install <id> [--dry-run] [--json]")
	fmt.Fprintln(stdout, "  transcribe <input> --model-path <path> [--output <srt>] [--word-timestamps auto|on|off] [--json]")
	fmt.Fprintln(stdout, "  transcribe <input> --provider local-whisper-cpp (--model <id>|--model-path <path>) [--whisper-cpp-command <path>] [--json]")
	fmt.Fprintln(stdout, "  transcribe <input> --provider api-openai-transcription --model <model> [--api-key-env <env>] [--config <toml>] [--base-url <url>] [--api-upload-format auto|wav|m4a|mp3] [--json]")
	fmt.Fprintln(stdout, "  auto <input> --model-path <path> [--output <srt>] [--word-timestamps auto|on|off] [--json]")
	fmt.Fprintln(stdout, "  providers list [--json]")
	fmt.Fprintln(stdout, "  providers test <id> [--json]")
	printServeHelp(stdout)
}
