// Package cli implements the fast-sub-go command dispatcher.
package cli

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	appconfig "fast-sub/internal/config"
	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/ffmpeg"
	"fast-sub/internal/models"
	"fast-sub/internal/paths"
	"fast-sub/internal/providers"
	openairuntime "fast-sub/internal/runtime/openai"
	"fast-sub/internal/runtime/whispercpp"
	"fast-sub/internal/subtitle"
	"fast-sub/internal/worker"
)

const (
	doctorTimeout               = 5 * time.Second
	probeTimeout                = 30 * time.Second
	extractTimeout              = 30 * time.Minute
	rawAPIKeyUnsupportedMessage = "raw --api-key is not supported; use --api-key-env"
)

// Config carries command inputs and injectable writers.
type Config struct {
	Args      []string
	Stdout    io.Writer
	Stderr    io.Writer
	Version   string
	Runner    ffmpeg.Runner
	Providers providers.RuntimeConfig
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
	case "--help", "-h", "help":
		printHelp(cfg.Stdout)
		return fserrors.ExitOK
	default:
		return usageError(cfg.Stdout, cfg.Stderr, args[0], false)
	}
}

func runProviders(ctx context.Context, cfg Config, args []string) int {
	if len(args) == 0 {
		return commandError(cfg, "providers", false, fserrors.New(fserrors.CodeInvalidUsage, "providers", "providers requires a subcommand", "Run `fast-sub-go providers list --json` or `fast-sub-go providers test <id> --json`.", nil))
	}
	switch args[0] {
	case "list":
		return runProvidersList(ctx, cfg, args[1:])
	case "test":
		return runProvidersTest(ctx, cfg, args[1:])
	default:
		jsonOutput, _, _ := parseJSONFlag(args[1:])
		return commandError(cfg, "providers", jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "providers", "unknown providers subcommand: "+args[0], "Run `fast-sub-go providers list --json` or `fast-sub-go providers test <id> --json`.", nil))
	}
}

func runProvidersList(ctx context.Context, cfg Config, args []string) int {
	jsonOutput, positionals, err := parseJSONFlag(args)
	if err != nil {
		return commandError(cfg, "providers list", jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "providers list", err.Error(), "", nil))
	}
	if len(positionals) != 0 {
		return commandError(cfg, "providers list", jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "providers list", "providers list does not accept positional arguments", "", nil))
	}
	result := providers.List(ctx, cfg.Providers)
	if jsonOutput {
		writeSuccessJSON(cfg.Stdout, "providers list", map[string]any{"providers": result})
		return fserrors.ExitOK
	}
	for _, provider := range result {
		fmt.Fprintf(cfg.Stdout, "%s\t%s\t%s\t%s\n", provider.ID, provider.Type, provider.Location, provider.Status)
	}
	return fserrors.ExitOK
}

func runProvidersTest(ctx context.Context, cfg Config, args []string) int {
	jsonOutput, positionals, err := parseJSONFlag(args)
	if err != nil {
		return commandError(cfg, "providers test", jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "providers test", err.Error(), "", nil))
	}
	if len(positionals) != 1 {
		return commandError(cfg, "providers test", jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "providers test", "providers test requires exactly one provider id", "", nil))
	}
	result, ok := providers.Test(ctx, cfg.Providers, positionals[0])
	if !ok {
		return commandError(cfg, "providers test", jsonOutput, fserrors.New(fserrors.CodeInvalidInput, "providers test", "unknown provider: "+positionals[0], "Run `fast-sub-go providers list --json` to see supported providers.", map[string]any{"provider_id": positionals[0]}))
	}
	if result.Available {
		if jsonOutput {
			writeSuccessJSON(cfg.Stdout, "providers test", result)
			return fserrors.ExitOK
		}
		fmt.Fprintf(cfg.Stdout, "%s: %s (%s)\n", result.ProviderID, result.Status, result.CheckMode)
		return fserrors.ExitOK
	}
	return commandError(cfg, "providers test", jsonOutput, providerUnavailableError(result))
}

func providerUnavailableError(result providers.CheckResult) *fserrors.AppError {
	code := fserrors.CodeProviderUnavailable
	switch result.Status {
	case providers.StatusMissingDependency:
		code = fserrors.CodeMissingDependency
	case providers.StatusMissingModel:
		code = fserrors.CodeMissingModel
	case providers.StatusMissingAPIKey:
		code = fserrors.CodeMissingAPIKey
	case providers.StatusInvalidConfig:
		code = fserrors.CodeInvalidInput
	case providers.StatusNotImplemented:
		code = fserrors.CodeNotImplemented
	}
	return fserrors.New(
		code,
		"providers test",
		fmt.Sprintf("provider %s is %s", result.ProviderID, result.Status),
		result.ActionHint,
		map[string]any{
			"provider_id": result.ProviderID,
			"status":      result.Status,
			"check_mode":  result.CheckMode,
			"checks":      result.Checks,
			"warnings":    result.Warnings,
			"details":     result.Details,
		},
	)
}

func runTranscribe(ctx context.Context, cfg Config, command string, args []string) int {
	parsed, err := parseTranscribeArgs(args, command)
	if err != nil {
		code := fserrors.CodeInvalidUsage
		if err.Error() == rawAPIKeyUnsupportedMessage {
			code = fserrors.CodeInvalidInput
		}
		return commandError(cfg, command, parsed.jsonOutput, fserrors.New(code, command, err.Error(), "", nil))
	}
	if len(parsed.positionals) != 1 {
		return commandError(cfg, command, parsed.jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, command, command+" requires exactly one input path", "", nil))
	}
	result, appErr := transcribeLocal(ctx, cfg, command, parsed.positionals[0], parsed)
	if appErr != nil {
		return commandError(cfg, command, parsed.jsonOutput, appErr)
	}
	if parsed.jsonOutput {
		writeSuccessJSON(cfg.Stdout, command, result)
		return fserrors.ExitOK
	}
	fmt.Fprintf(cfg.Stdout, "Wrote subtitles: %s\n", result.OutputPath)
	return fserrors.ExitOK
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

type transcribeArgs struct {
	jsonOutput        bool
	output            string
	modelPath         string
	model             string
	provider          string
	whisperCommand    string
	language          string
	device            string
	computeType       string
	batchSize         int
	workerCommand     string
	workerArgs        []string
	wordTimestamps    string
	wordTimestampsSet bool
	apiKeyEnv         string
	baseURL           string
	apiUploadFormat   string
	configPath        string
	keepTemp          bool
	yes               bool
	positionals       []string
}

type transcribeResult struct {
	InputPath         string   `json:"input_path"`
	OutputPath        string   `json:"output_path"`
	Language          string   `json:"language"`
	Segments          int      `json:"segments"`
	ElapsedSec        float64  `json:"elapsed_sec"`
	JobDir            string   `json:"job_dir"`
	Provider          string   `json:"provider,omitempty"`
	Model             string   `json:"model,omitempty"`
	APIUploadFormat   string   `json:"api_upload_format,omitempty"`
	ActualDevice      string   `json:"actual_device,omitempty"`
	ActualComputeType string   `json:"actual_compute_type,omitempty"`
	Warnings          []string `json:"warnings,omitempty"`
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

func parseTranscribeArgs(args []string, command string) (transcribeArgs, error) {
	parsed := transcribeArgs{
		language:       "auto",
		device:         "auto",
		computeType:    "auto",
		batchSize:      8,
		wordTimestamps: "off",
		positionals:    make([]string, 0, len(args)),
	}
	for _, arg := range args {
		if arg == "--json" {
			parsed.jsonOutput = true
			break
		}
	}
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--json":
			parsed.jsonOutput = true
		case arg == "--keep-temp":
			parsed.keepTemp = true
		case arg == "--yes":
			parsed.yes = true
		case arg == "--output" || arg == "-o":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.output = value
			i = next
		case strings.HasPrefix(arg, "--output="):
			parsed.output = strings.TrimPrefix(arg, "--output=")
		case arg == "--model-path":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.modelPath = value
			i = next
		case strings.HasPrefix(arg, "--model-path="):
			parsed.modelPath = strings.TrimPrefix(arg, "--model-path=")
		case arg == "--model":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.model = value
			i = next
		case strings.HasPrefix(arg, "--model="):
			parsed.model = strings.TrimPrefix(arg, "--model=")
		case arg == "--provider":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.provider = value
			i = next
		case strings.HasPrefix(arg, "--provider="):
			parsed.provider = strings.TrimPrefix(arg, "--provider=")
		case arg == "--whisper-cpp-command":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.whisperCommand = value
			i = next
		case strings.HasPrefix(arg, "--whisper-cpp-command="):
			parsed.whisperCommand = strings.TrimPrefix(arg, "--whisper-cpp-command=")
		case arg == "--language":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.language = value
			i = next
		case strings.HasPrefix(arg, "--language="):
			parsed.language = strings.TrimPrefix(arg, "--language=")
		case arg == "--device":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.device = value
			i = next
		case strings.HasPrefix(arg, "--device="):
			parsed.device = strings.TrimPrefix(arg, "--device=")
		case arg == "--compute-type":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.computeType = value
			i = next
		case strings.HasPrefix(arg, "--compute-type="):
			parsed.computeType = strings.TrimPrefix(arg, "--compute-type=")
		case arg == "--batch-size":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			if _, scanErr := fmt.Sscanf(value, "%d", &parsed.batchSize); scanErr != nil || parsed.batchSize <= 0 {
				return parsed, fmt.Errorf("--batch-size must be a positive integer")
			}
			i = next
		case strings.HasPrefix(arg, "--batch-size="):
			value := strings.TrimPrefix(arg, "--batch-size=")
			if _, scanErr := fmt.Sscanf(value, "%d", &parsed.batchSize); scanErr != nil || parsed.batchSize <= 0 {
				return parsed, fmt.Errorf("--batch-size must be a positive integer")
			}
		case arg == "--worker-command":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.workerCommand = value
			i = next
		case strings.HasPrefix(arg, "--worker-command="):
			parsed.workerCommand = strings.TrimPrefix(arg, "--worker-command=")
		case arg == "--worker-arg":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.workerArgs = append(parsed.workerArgs, value)
			i = next
		case strings.HasPrefix(arg, "--worker-arg="):
			parsed.workerArgs = append(parsed.workerArgs, strings.TrimPrefix(arg, "--worker-arg="))
		case arg == "--word-timestamps":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.wordTimestamps = value
			parsed.wordTimestampsSet = true
			i = next
		case strings.HasPrefix(arg, "--word-timestamps="):
			parsed.wordTimestamps = strings.TrimPrefix(arg, "--word-timestamps=")
			parsed.wordTimestampsSet = true
		case arg == "--api-key" || strings.HasPrefix(arg, "--api-key="):
			return parsed, fmt.Errorf(rawAPIKeyUnsupportedMessage)
		case arg == "--api-key-env":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.apiKeyEnv = value
			i = next
		case strings.HasPrefix(arg, "--api-key-env="):
			parsed.apiKeyEnv = strings.TrimPrefix(arg, "--api-key-env=")
		case arg == "--base-url":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.baseURL = value
			i = next
		case strings.HasPrefix(arg, "--base-url="):
			parsed.baseURL = strings.TrimPrefix(arg, "--base-url=")
		case arg == "--api-upload-format":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.apiUploadFormat = value
			i = next
		case strings.HasPrefix(arg, "--api-upload-format="):
			parsed.apiUploadFormat = strings.TrimPrefix(arg, "--api-upload-format=")
		case arg == "--config":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.configPath = value
			i = next
		case strings.HasPrefix(arg, "--config="):
			parsed.configPath = strings.TrimPrefix(arg, "--config=")
		case strings.HasPrefix(arg, "-"):
			return parsed, fmt.Errorf("unknown flag: %s", arg)
		default:
			parsed.positionals = append(parsed.positionals, arg)
		}
	}
	if command != "auto" && parsed.yes {
		return parsed, fmt.Errorf("--yes is only accepted by auto in the Go preview")
	}
	return parsed, nil
}

func requireValue(args []string, index int, flag string) (string, int, error) {
	if index+1 >= len(args) {
		return "", index, fmt.Errorf("%s requires a value", flag)
	}
	return args[index+1], index + 1, nil
}

func transcribeLocal(ctx context.Context, cfg Config, command, input string, parsed transcribeArgs) (transcribeResult, *fserrors.AppError) {
	var empty transcribeResult
	started := time.Now()
	if parsed.provider == "api-openai-transcription" {
		return transcribeOpenAI(ctx, cfg, command, input, parsed, started)
	}
	if parsed.provider == "local-whisper-cpp" {
		return transcribeWhisperCPP(ctx, cfg, command, input, parsed, started)
	}
	if parsed.provider != "" && parsed.provider != "local-faster-whisper" {
		return empty, fserrors.New(fserrors.CodeInvalidInput, command, "unsupported provider: "+parsed.provider, "Use local-faster-whisper, local-whisper-cpp, or api-openai-transcription.", nil)
	}
	modelPath, appErr := resolveFasterWhisperModelPath(parsed, command)
	if appErr != nil {
		return empty, appErr
	}
	if err := validateChoice("language", parsed.language, []string{"auto", "zh", "en", "ja", "ko"}); err != nil {
		return empty, fserrors.New(fserrors.CodeInvalidInput, command, err.Error(), "", nil)
	}
	if err := validateChoice("device", parsed.device, []string{"auto", "cuda", "cpu"}); err != nil {
		return empty, fserrors.New(fserrors.CodeInvalidInput, command, err.Error(), "", nil)
	}
	if err := validateChoice("compute-type", parsed.computeType, []string{"auto", "float16", "int8_float16", "int8"}); err != nil {
		return empty, fserrors.New(fserrors.CodeInvalidInput, command, err.Error(), "", nil)
	}
	wordTimestamps, appErr := resolveWordTimestamps(parsed.wordTimestamps, command)
	if appErr != nil {
		return empty, appErr
	}

	output := parsed.output
	if output == "" {
		output = defaultSRTPath(input)
	}
	if appErr := validateSRTOutput(output); appErr != nil {
		return empty, appErr
	}
	if _, appErr := cfg.Runner.Probe(ctx, input, probeTimeout); appErr != nil {
		return empty, appErr
	}
	jobDir, jobID, appErr := createJobDir()
	if appErr != nil {
		return empty, appErr
	}
	audioPath := filepath.Join(jobDir, "audio.wav")
	if _, appErr := cfg.Runner.ExtractAudio(ctx, input, audioPath, extractTimeout); appErr != nil {
		return empty, appErr
	}

	requestPath := filepath.Join(jobDir, "request.json")
	responsePath := filepath.Join(jobDir, "response.json")
	stderrPath := filepath.Join(jobDir, "worker.stderr.log")
	response, appErr := worker.Runner{
		Command:       parsed.workerCommand,
		ExtraArgs:     parsed.workerArgs,
		StderrLogPath: stderrPath,
	}.RunSTT(ctx, requestPath, responsePath, worker.STTRequest{
		JobID:          jobID,
		AudioPath:      audioPath,
		ModelPath:      modelPath,
		Language:       parsed.language,
		Device:         parsed.device,
		ComputeType:    parsed.computeType,
		BatchSize:      parsed.batchSize,
		WordTimestamps: wordTimestamps,
	})
	if appErr != nil {
		return empty, appErr
	}
	refinedSegments := subtitle.RefineSegments(response.Segments, subtitle.RefineOptions{Lang: response.Language})
	srt, err := subtitle.RenderSRT(refinedSegments)
	if err != nil {
		return empty, fserrors.New(fserrors.CodeWorkerProtocol, "rendering", err.Error(), "Check worker segment timestamps and text.", nil)
	}
	if err := os.WriteFile(output, []byte(srt), 0o600); err != nil {
		return empty, classifyWriteError("rendering", "write SRT: "+err.Error())
	}
	if !parsed.keepTemp {
		_ = os.Remove(audioPath)
	}
	return transcribeResult{
		InputPath:         input,
		OutputPath:        output,
		Language:          response.Language,
		Segments:          len(refinedSegments),
		ElapsedSec:        time.Since(started).Seconds(),
		JobDir:            jobDir,
		Provider:          response.Provider,
		Model:             parsed.model,
		ActualDevice:      response.ActualDevice,
		ActualComputeType: response.ActualComputeType,
		Warnings:          response.Warnings,
	}, nil
}

func transcribeOpenAI(ctx context.Context, cfg Config, command, input string, parsed transcribeArgs, started time.Time) (transcribeResult, *fserrors.AppError) {
	var empty transcribeResult
	if command != "transcribe" {
		return empty, fserrors.New(fserrors.CodeInvalidInput, command, "api-openai-transcription must be selected explicitly with transcribe.", "Run fast-sub-go transcribe with --provider api-openai-transcription.", nil)
	}
	cfgFile, appErr := loadCLIConfig(parsed.configPath, command)
	if appErr != nil {
		return empty, appErr
	}
	applyOpenAIConfig(&parsed, cfgFile.OpenAI)
	if parsed.model == "" {
		return empty, fserrors.New(fserrors.CodeInvalidInput, command, "--model is required for api-openai-transcription.", "Pass an explicit OpenAI-compatible transcription model or set model in the config file.", nil)
	}
	apiKey, appErr := resolveAPIKey(parsed)
	if appErr != nil {
		return empty, appErr
	}
	if err := validateChoice("language", parsed.language, []string{"auto", "zh", "en", "ja", "ko"}); err != nil {
		return empty, fserrors.New(fserrors.CodeInvalidInput, command, err.Error(), "", nil)
	}
	wordTimestamps, appErr := resolveWordTimestamps(parsed.wordTimestamps, command)
	if appErr != nil {
		return empty, appErr
	}
	format, appErr := resolveAPIUploadFormat(parsed.apiUploadFormat, parsed.baseURL)
	if appErr != nil {
		return empty, appErr
	}
	output := parsed.output
	if output == "" {
		output = defaultSRTPath(input)
	}
	if appErr := validateSRTOutput(output); appErr != nil {
		return empty, appErr
	}
	metadata, appErr := cfg.Runner.Probe(ctx, input, probeTimeout)
	if appErr != nil {
		return empty, appErr
	}
	jobDir, _, appErr := createJobDir()
	if appErr != nil {
		return empty, appErr
	}
	audioPath := filepath.Join(jobDir, "api-upload."+string(format))
	if _, appErr := cfg.Runner.PrepareAPIUploadAudio(ctx, input, audioPath, format, extractTimeout); appErr != nil {
		return empty, appErr
	}
	result, appErr := openairuntime.Client{BaseURL: parsed.baseURL}.Transcribe(ctx, openairuntime.TranscribeOptions{
		AudioPath:      audioPath,
		FileName:       filepath.Base(audioPath),
		Model:          parsed.model,
		APIKey:         apiKey,
		Language:       parsed.language,
		DurationSec:    metadata.DurationSec,
		WordTimestamps: wordTimestamps,
	})
	if appErr != nil {
		return empty, appErr
	}
	refinedSegments := subtitle.RefineSegments(result.Segments, subtitle.RefineOptions{Lang: result.Language})
	srt, err := subtitle.RenderSRT(refinedSegments)
	if err != nil {
		return empty, fserrors.New(fserrors.CodeAPIFailed, "rendering", err.Error(), "Check provider segment timestamps and text.", nil)
	}
	if err := os.WriteFile(output, []byte(srt), 0o600); err != nil {
		return empty, classifyWriteError("rendering", "write SRT: "+err.Error())
	}
	if !parsed.keepTemp {
		_ = os.Remove(audioPath)
	}
	return transcribeResult{
		InputPath:       input,
		OutputPath:      output,
		Language:        result.Language,
		Segments:        len(refinedSegments),
		ElapsedSec:      time.Since(started).Seconds(),
		JobDir:          jobDir,
		Provider:        result.Provider,
		Model:           result.Model,
		APIUploadFormat: string(format),
		Warnings:        result.Warnings,
	}, nil
}

func transcribeWhisperCPP(ctx context.Context, cfg Config, command, input string, parsed transcribeArgs, started time.Time) (transcribeResult, *fserrors.AppError) {
	var empty transcribeResult
	modelPath, appErr := resolveWhisperCPPModelPath(parsed, command)
	if appErr != nil {
		return empty, appErr
	}
	if err := validateChoice("language", parsed.language, []string{"auto", "zh", "en", "ja", "ko"}); err != nil {
		return empty, fserrors.New(fserrors.CodeInvalidInput, command, err.Error(), "", nil)
	}
	if parsed.wordTimestamps != "" && parsed.wordTimestamps != "off" && parsed.wordTimestamps != "auto" {
		return empty, fserrors.New(fserrors.CodeInvalidInput, command, "--word-timestamps is not supported by local-whisper-cpp in this preview.", "Use --word-timestamps off or auto.", nil)
	}
	output := parsed.output
	if output == "" {
		output = defaultSRTPath(input)
	}
	if appErr := validateSRTOutput(output); appErr != nil {
		return empty, appErr
	}
	if _, appErr := cfg.Runner.Probe(ctx, input, probeTimeout); appErr != nil {
		return empty, appErr
	}
	jobDir, _, appErr := createJobDir()
	if appErr != nil {
		return empty, appErr
	}
	audioPath := filepath.Join(jobDir, "audio.wav")
	if _, appErr := cfg.Runner.ExtractAudio(ctx, input, audioPath, extractTimeout); appErr != nil {
		return empty, appErr
	}
	result, appErr := whispercpp.Transcribe(ctx, whispercpp.Options{
		Command:          parsed.whisperCommand,
		AudioPath:        audioPath,
		ModelPath:        modelPath,
		JobDir:           jobDir,
		Language:         parsed.language,
		ManagedBinaryDir: defaultManagedWhisperCPPBinaryDir(),
	})
	if appErr != nil {
		return empty, appErr
	}
	refinedSegments := subtitle.RefineSegments(result.Segments, subtitle.RefineOptions{Lang: result.Language})
	srt, err := subtitle.RenderSRT(refinedSegments)
	if err != nil {
		return empty, fserrors.New(fserrors.CodeWorkerProtocol, "rendering", err.Error(), "Check whisper.cpp segment timestamps and text.", nil)
	}
	if err := os.WriteFile(output, []byte(srt), 0o600); err != nil {
		return empty, classifyWriteError("rendering", "write SRT: "+err.Error())
	}
	if !parsed.keepTemp {
		_ = os.Remove(audioPath)
	}
	return transcribeResult{
		InputPath:  input,
		OutputPath: output,
		Language:   result.Language,
		Segments:   len(refinedSegments),
		ElapsedSec: time.Since(started).Seconds(),
		JobDir:     jobDir,
		Provider:   result.Provider,
		Model:      parsed.model,
		Warnings:   result.Warnings,
	}, nil
}

func resolveAPIKey(parsed transcribeArgs) (string, *fserrors.AppError) {
	if parsed.apiKeyEnv == "" {
		return "", fserrors.New(fserrors.CodeMissingAPIKey, "api_openai_transcription", "--api-key-env is required for api-openai-transcription.", "Pass --api-key-env with an environment variable that contains the API key.", nil)
	}
	apiKey := os.Getenv(parsed.apiKeyEnv)
	if apiKey == "" {
		return "", fserrors.New(fserrors.CodeMissingAPIKey, "api_openai_transcription", "API key environment variable is not set.", "Set "+parsed.apiKeyEnv+" or pass a different --api-key-env.", map[string]any{"api_key_env": parsed.apiKeyEnv})
	}
	return apiKey, nil
}

func loadCLIConfig(path, command string) (appconfig.AppConfig, *fserrors.AppError) {
	cfg, resolvedPath, err := appconfig.Load(path, os.Getenv)
	if err != nil {
		return appconfig.AppConfig{}, fserrors.New(
			fserrors.CodeInvalidInput,
			command,
			"read config file: "+err.Error(),
			"Check --config, FAST_SUB_GO_CONFIG, or fast-sub-go.toml. Supported OpenAI keys are model, api_key_env, base_url, api_upload_format, and words.",
			map[string]any{"config_path": resolvedPath},
		)
	}
	return cfg, nil
}

func applyOpenAIConfig(parsed *transcribeArgs, cfg appconfig.OpenAIProviderConfig) {
	if parsed.model == "" {
		parsed.model = cfg.Model
	}
	if parsed.apiKeyEnv == "" {
		parsed.apiKeyEnv = cfg.APIKeyEnv
	}
	if parsed.baseURL == "" {
		parsed.baseURL = cfg.BaseURL
	}
	if parsed.apiUploadFormat == "" {
		parsed.apiUploadFormat = cfg.APIUploadFormat
	}
	if !parsed.wordTimestampsSet && cfg.Words != nil {
		if *cfg.Words {
			parsed.wordTimestamps = "on"
		} else {
			parsed.wordTimestamps = "off"
		}
	}
}

func resolveAPIUploadFormat(value, baseURL string) (ffmpeg.APIUploadFormat, *fserrors.AppError) {
	switch value {
	case "", "auto":
		return ffmpeg.APIUploadM4A, nil
	case "wav":
		return ffmpeg.APIUploadWAV, nil
	case "m4a":
		return ffmpeg.APIUploadM4A, nil
	case "mp3":
		return ffmpeg.APIUploadMP3, nil
	default:
		return "", fserrors.New(fserrors.CodeInvalidInput, "api_openai_transcription", "--api-upload-format must be one of: auto, wav, m4a, mp3", "", map[string]any{"base_url_is_official_openai": openairuntime.IsOfficialBaseURL(baseURL)})
	}
}

func resolveFasterWhisperModelPath(parsed transcribeArgs, command string) (string, *fserrors.AppError) {
	if parsed.modelPath != "" {
		if err := validateModelPath(parsed.modelPath); err != nil {
			return "", fserrors.New(fserrors.CodeMissingModel, command, err.Error(), "Pass --model-path to an existing local model directory.", nil)
		}
		return parsed.modelPath, nil
	}
	if parsed.model == "" {
		envPath := os.Getenv("FAST_SUB_FASTER_WHISPER_MODEL_PATH")
		if envPath == "" {
			envPath = os.Getenv("FAST_SUB_MODEL_PATH")
		}
		if envPath != "" {
			if err := validateModelPath(envPath); err != nil {
				return "", fserrors.New(fserrors.CodeMissingModel, command, err.Error(), "Fix FAST_SUB_FASTER_WHISPER_MODEL_PATH or pass --model-path.", nil)
			}
			return envPath, nil
		}
		return "", fserrors.New(fserrors.CodeMissingModel, command, "--model or --model-path is required for local-faster-whisper.", "Pass --model-path to an existing local model directory or install the requested model id.", nil)
	}
	modelPath, err := resolveInstalledProviderModelPath(parsed.model, "local-faster-whisper")
	if err != nil {
		return "", fserrors.New(fserrors.CodeMissingModel, command, err.Error(), "Install the model or pass --model-path to an existing local model directory.", nil)
	}
	if err := validateModelPath(modelPath); err != nil {
		return "", fserrors.New(fserrors.CodeMissingModel, command, err.Error(), "Repair or reinstall the model, or pass --model-path.", nil)
	}
	return modelPath, nil
}

func resolveWhisperCPPModelPath(parsed transcribeArgs, command string) (string, *fserrors.AppError) {
	if parsed.modelPath != "" {
		modelPath, err := resolveModelFileOrDir(parsed.modelPath)
		if err != nil {
			return "", fserrors.New(fserrors.CodeMissingModel, command, err.Error(), "Pass --model-path to an existing whisper.cpp model file.", nil)
		}
		return modelPath, nil
	}
	if parsed.model == "" {
		envPath := os.Getenv("FAST_SUB_WHISPER_CPP_MODEL_PATH")
		if envPath == "" {
			envPath = os.Getenv("FAST_SUB_MODEL_PATH")
		}
		if envPath != "" {
			modelPath, err := resolveModelFileOrDir(envPath)
			if err != nil {
				return "", fserrors.New(fserrors.CodeMissingModel, command, err.Error(), "Fix FAST_SUB_WHISPER_CPP_MODEL_PATH or pass --model-path.", nil)
			}
			return modelPath, nil
		}
		return "", fserrors.New(fserrors.CodeMissingModel, command, "--model or --model-path is required for local-whisper-cpp.", "Pass --model-path to a whisper.cpp model file or install the requested model id.", nil)
	}
	modelPath, err := resolveInstalledWhisperCPPModelPath(parsed.model)
	if err != nil {
		return "", fserrors.New(fserrors.CodeMissingModel, command, err.Error(), "Install the model or pass --model-path to an existing whisper.cpp model file.", nil)
	}
	return modelPath, nil
}

func resolveInstalledWhisperCPPModelPath(modelID string) (string, error) {
	if manifest, err := models.LoadManifest(""); err == nil {
		if entry, ok := manifest.Get(modelID); ok {
			if !hasString(entry.CompatibleProviders, "local-whisper-cpp") {
				return "", fmt.Errorf("model is not compatible with local-whisper-cpp: %s", modelID)
			}
			status := models.DefaultStore().Verify(entry)
			if !status.Installed {
				return "", fmt.Errorf("model is not installed: %s", modelID)
			}
			return resolveModelFileOrDir(status.Path)
		}
	}
	candidates := []string{}
	if legacyStore := os.Getenv("FAST_SUB_MODEL_STORE"); legacyStore != "" {
		candidates = append(candidates, filepath.Join(legacyStore, modelID))
	}
	candidates = append(candidates,
		filepath.Join(models.DefaultStore().Root, modelID),
		filepath.Join(".fast-sub", "models", modelID),
	)
	for _, candidate := range candidates {
		modelPath, ok := existingModelCandidate(candidate)
		if ok {
			return modelPath, nil
		}
	}
	return "", fmt.Errorf("model is not installed: %s", modelID)
}

func resolveInstalledProviderModelPath(modelID, providerID string) (string, error) {
	manifest, err := models.LoadManifest("")
	if err != nil {
		return "", fmt.Errorf("model manifest could not be loaded: %w", err)
	}
	entry, ok := manifest.Get(modelID)
	if !ok || !hasString(entry.CompatibleProviders, providerID) {
		return "", fmt.Errorf("model is not compatible with %s: %s", providerID, modelID)
	}
	status := models.DefaultStore().Verify(entry)
	if !status.Installed {
		return "", fmt.Errorf("model is not installed: %s", modelID)
	}
	return status.Path, nil
}

func existingModelCandidate(path string) (string, bool) {
	info, err := os.Stat(path)
	if err != nil {
		return "", false
	}
	if !info.IsDir() {
		return path, true
	}
	for _, name := range []string{"model.bin", "ggml-model.bin", "model.gguf"} {
		candidate := filepath.Join(path, name)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, true
		}
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return "", false
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		lower := strings.ToLower(entry.Name())
		if strings.HasSuffix(lower, ".bin") || strings.HasSuffix(lower, ".gguf") {
			return filepath.Join(path, entry.Name()), true
		}
	}
	return "", false
}

func resolveModelFileOrDir(modelPath string) (string, error) {
	info, err := os.Stat(modelPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("model path does not exist: %s", filepath.Clean(modelPath))
		}
		return "", fmt.Errorf("inspect model path: %w", err)
	}
	if info.IsDir() {
		if candidate, ok := existingModelCandidate(modelPath); ok && candidate != "" {
			return candidate, nil
		}
		return "", fmt.Errorf("model directory contains no .bin or .gguf model file: %s", filepath.Clean(modelPath))
	}
	return modelPath, nil
}

func defaultManagedWhisperCPPBinaryDir() string {
	if legacyStore := os.Getenv("FAST_SUB_MODEL_STORE"); legacyStore != "" {
		return filepath.Join(legacyStore, "whisper-cpp")
	}
	return filepath.Join(models.DefaultStore().Root, "whisper-cpp")
}

func resolveWordTimestamps(value, command string) (bool, *fserrors.AppError) {
	switch value {
	case "", "off":
		return false, nil
	case "on":
		return true, nil
	case "auto":
		return false, nil
	default:
		return false, fserrors.New(fserrors.CodeInvalidInput, command, "--word-timestamps must be one of: auto, on, off", "", nil)
	}
}

func validateModelPath(modelPath string) error {
	info, err := os.Stat(modelPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("model path does not exist: %s", filepath.Clean(modelPath))
		}
		return fmt.Errorf("inspect model path: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("model path is not a directory: %s", filepath.Clean(modelPath))
	}
	return nil
}

func validateChoice(name, value string, allowed []string) error {
	for _, item := range allowed {
		if value == item {
			return nil
		}
	}
	return fmt.Errorf("--%s must be one of: %s", name, strings.Join(allowed, ", "))
}

func validateSRTOutput(output string) *fserrors.AppError {
	if err := paths.ValidateOutputPath(output); err != nil {
		code := fserrors.CodeInvalidInput
		if strings.Contains(err.Error(), "already exists") {
			code = fserrors.CodeOutputExists
		}
		return fserrors.New(code, "rendering", err.Error(), "Choose a different --output path.", nil)
	}
	return nil
}

func defaultSRTPath(input string) string {
	ext := filepath.Ext(input)
	if ext == "" {
		return input + ".srt"
	}
	return strings.TrimSuffix(input, ext) + ".srt"
}

func createJobDir() (string, string, *fserrors.AppError) {
	jobID := fmt.Sprintf("job_%d", time.Now().UnixNano())
	jobDir := filepath.Join(".fast-sub", "jobs", jobID)
	if err := os.MkdirAll(jobDir, 0o700); err != nil {
		return "", "", classifyWriteError("creating_job", "create job directory: "+err.Error())
	}
	return jobDir, jobID, nil
}

func classifyWriteError(stage, message string) *fserrors.AppError {
	code := fserrors.CodeInvalidInput
	lower := strings.ToLower(message)
	if strings.Contains(lower, "permission") || strings.Contains(lower, "access is denied") {
		code = fserrors.CodePermissionDenied
	}
	if strings.Contains(lower, "no space") || strings.Contains(lower, "disk full") {
		code = fserrors.CodeDiskFull
	}
	return fserrors.New(code, stage, message, "Check that Fast Sub can write the target path.", nil)
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
	fmt.Fprintln(stdout, "  models list [--json]")
	fmt.Fprintln(stdout, "  models verify <id> [--json]")
	fmt.Fprintln(stdout, "  models install <id> [--dry-run] [--json]")
	fmt.Fprintln(stdout, "  transcribe <input> --model-path <path> [--output <srt>] [--word-timestamps auto|on|off] [--json]")
	fmt.Fprintln(stdout, "  transcribe <input> --provider local-whisper-cpp (--model <id>|--model-path <path>) [--whisper-cpp-command <path>] [--json]")
	fmt.Fprintln(stdout, "  transcribe <input> --provider api-openai-transcription --model <model> [--api-key-env <env>] [--config <toml>] [--base-url <url>] [--api-upload-format auto|wav|m4a|mp3] [--json]")
	fmt.Fprintln(stdout, "  auto <input> --model-path <path> [--output <srt>] [--word-timestamps auto|on|off] [--json]")
	fmt.Fprintln(stdout, "  providers list [--json]")
	fmt.Fprintln(stdout, "  providers test <id> [--json]")
}

func runModels(ctx context.Context, cfg Config, args []string) int {
	if len(args) == 0 {
		return commandError(cfg, "models", false, fserrors.New(fserrors.CodeInvalidUsage, "models", "models requires a subcommand", "Run `fast-sub-go models list --json`.", nil))
	}
	switch args[0] {
	case "list":
		return runModelsList(cfg, args[1:])
	case "verify":
		return runModelsVerify(cfg, args[1:])
	case "install":
		return runModelsInstall(ctx, cfg, args[1:])
	default:
		jsonOutput, _, _ := parseJSONFlag(args[1:])
		return commandError(cfg, "models "+args[0], jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "models", "unknown models subcommand: "+args[0], "Use list, verify, or install.", nil))
	}
}

func runModelsList(cfg Config, args []string) int {
	jsonOutput, positionals, err := parseJSONFlag(args)
	if err != nil {
		return commandError(cfg, "models list", jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "models list", err.Error(), "", nil))
	}
	if len(positionals) != 0 {
		return commandError(cfg, "models list", jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "models list", "models list does not accept positional arguments", "", nil))
	}
	manifest, appErr := loadModelsManifest("models list")
	if appErr != nil {
		return commandError(cfg, "models list", jsonOutput, appErr)
	}
	rows := models.DefaultStore().List(manifest)
	if jsonOutput {
		writeSuccessJSON(cfg.Stdout, "models list", map[string]any{"models": rows})
		return fserrors.ExitOK
	}
	writeModelsListTable(cfg.Stdout, rows)
	return fserrors.ExitOK
}

func writeModelsListTable(stdout io.Writer, rows []models.ListRow) {
	idWidth := len("MODEL")
	typeWidth := len("TYPE")
	statusWidth := len("STATUS")
	for _, row := range rows {
		idWidth = maxInt(idWidth, len(row.ID))
		typeWidth = maxInt(typeWidth, len(row.Type))
		statusWidth = maxInt(statusWidth, len(row.Status))
	}
	fmt.Fprintf(stdout, "%-*s  %-*s  %-*s  %s\n", idWidth, "MODEL", typeWidth, "TYPE", statusWidth, "STATUS", "PATH")
	for _, row := range rows {
		fmt.Fprintf(stdout, "%-*s  %-*s  %-*s  %s\n", idWidth, row.ID, typeWidth, row.Type, statusWidth, row.Status, row.Path)
	}
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func runModelsVerify(cfg Config, args []string) int {
	jsonOutput, positionals, err := parseJSONFlag(args)
	if err != nil {
		return commandError(cfg, "models verify", jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "models verify", err.Error(), "", nil))
	}
	if len(positionals) != 1 {
		return commandError(cfg, "models verify", jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "models verify", "models verify requires exactly one model id", "", nil))
	}
	manifest, appErr := loadModelsManifest("models verify")
	if appErr != nil {
		return commandError(cfg, "models verify", jsonOutput, appErr)
	}
	entry, ok := manifest.Get(positionals[0])
	if !ok {
		return commandError(cfg, "models verify", jsonOutput, unknownModelError("models verify", manifest, positionals[0]))
	}
	status := models.DefaultStore().Verify(entry)
	if jsonOutput {
		if status.Installed {
			writeSuccessJSON(cfg.Stdout, "models verify", status)
			return fserrors.ExitOK
		}
		return writeErrorJSON(cfg.Stdout, "models verify", models.ClassifyStatusError("models verify", status))
	}
	if status.Installed {
		fmt.Fprintf(cfg.Stdout, "%s: installed (%s)\n", status.ID, status.Path)
		return fserrors.ExitOK
	}
	return commandError(cfg, "models verify", false, models.ClassifyStatusError("models verify", status))
}

type modelsInstallArgs struct {
	jsonOutput  bool
	dryRun      bool
	positionals []string
}

func runModelsInstall(ctx context.Context, cfg Config, args []string) int {
	parsed, err := parseModelsInstallArgs(args)
	if err != nil {
		return commandError(cfg, "models install", parsed.jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "models install", err.Error(), "", nil))
	}
	if len(parsed.positionals) != 1 {
		return commandError(cfg, "models install", parsed.jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "models install", "models install requires exactly one model id", "", nil))
	}
	manifest, appErr := loadModelsManifest("models install")
	if appErr != nil {
		return commandError(cfg, "models install", parsed.jsonOutput, appErr)
	}
	entry, ok := manifest.Get(parsed.positionals[0])
	if !ok {
		return commandError(cfg, "models install", parsed.jsonOutput, unknownModelError("models install", manifest, parsed.positionals[0]))
	}
	opts := models.InstallOptions{DryRun: parsed.dryRun}
	if !parsed.jsonOutput && !parsed.dryRun {
		opts.Progress = newInstallProgressWriter(cfg.Stderr).Update
	}
	result, installErr := models.DefaultStore().Install(ctx, entry, opts)
	if installErr != nil {
		return commandError(cfg, "models install", parsed.jsonOutput, installErr)
	}
	if parsed.jsonOutput {
		writeSuccessJSON(cfg.Stdout, "models install", result)
		return fserrors.ExitOK
	}
	if parsed.dryRun {
		fmt.Fprintf(cfg.Stdout, "Would install %s to %s (%d bytes)\n", result.ModelID, result.Plan.TargetDir, result.Plan.TotalSizeBytes)
		return fserrors.ExitOK
	}
	fmt.Fprintf(cfg.Stdout, "Installed %s: %s\n", result.ModelID, result.Status.Path)
	return fserrors.ExitOK
}

func parseModelsInstallArgs(args []string) (modelsInstallArgs, error) {
	parsed := modelsInstallArgs{positionals: make([]string, 0, len(args))}
	for _, arg := range args {
		switch arg {
		case "--json":
			parsed.jsonOutput = true
		case "--dry-run":
			parsed.dryRun = true
		default:
			if strings.HasPrefix(arg, "-") {
				return parsed, fmt.Errorf("unknown flag: %s", arg)
			}
			parsed.positionals = append(parsed.positionals, arg)
		}
	}
	return parsed, nil
}

func loadModelsManifest(command string) (models.Manifest, *fserrors.AppError) {
	manifest, err := models.LoadManifest("")
	if err != nil {
		return models.Manifest{}, fserrors.New(fserrors.CodeInvalidInput, command, err.Error(), "Check FAST_SUB_GO_MODEL_MANIFEST or use the built-in manifest.", nil)
	}
	return manifest, nil
}

func unknownModelError(command string, manifest models.Manifest, id string) *fserrors.AppError {
	ids := make([]string, 0, len(manifest.Models))
	for _, entry := range manifest.Models {
		ids = append(ids, entry.ID)
	}
	return fserrors.New(fserrors.CodeMissingModel, command, "unknown model id: "+id, "Choose one of: "+strings.Join(ids, ", "), map[string]any{"model_id": id})
}

func hasString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

type installProgressWriter struct {
	stderr      io.Writer
	lastPercent map[string]int
	currentFile string
}

func newInstallProgressWriter(stderr io.Writer) *installProgressWriter {
	return &installProgressWriter{
		stderr:      stderr,
		lastPercent: map[string]int{},
	}
}

func (w *installProgressWriter) Update(progress models.Progress) {
	if w == nil || w.stderr == nil {
		return
	}
	if progress.Stage == "verified" {
		fmt.Fprintf(w.stderr, "\r%s\rVerified %s (%d/%d)\n", clearLine(), progress.FilePath, progress.FileIndex, progress.FileCount)
		w.currentFile = ""
		return
	}
	percent := progressPercent(progress.FileBytes, progress.FileTotal)
	if last, ok := w.lastPercent[progress.FilePath]; ok && percent >= 0 && percent < 100 && percent/5 == last/5 {
		return
	}
	w.lastPercent[progress.FilePath] = percent
	if w.currentFile != "" && w.currentFile != progress.FilePath {
		fmt.Fprint(w.stderr, "\n")
	}
	w.currentFile = progress.FilePath
	if percent >= 0 {
		fmt.Fprintf(
			w.stderr,
			"\r%s\rDownloading %s (%d/%d): %d%% (%s/%s)",
			clearLine(),
			progress.FilePath,
			progress.FileIndex,
			progress.FileCount,
			percent,
			formatBytes(progress.FileBytes),
			formatBytes(progress.FileTotal),
		)
		return
	}
	fmt.Fprintf(
		w.stderr,
		"\r%s\rDownloading %s (%d/%d): %s",
		clearLine(),
		progress.FilePath,
		progress.FileIndex,
		progress.FileCount,
		formatBytes(progress.FileBytes),
	)
}

func clearLine() string {
	return strings.Repeat(" ", 120)
}

func progressPercent(done, total int64) int {
	if total <= 0 {
		return -1
	}
	if done >= total {
		return 100
	}
	return int(done * 100 / total)
}

func formatBytes(value int64) string {
	const unit = 1024
	if value < unit {
		return fmt.Sprintf("%d B", value)
	}
	units := []string{"KiB", "MiB", "GiB", "TiB"}
	size := float64(value)
	for _, suffix := range units {
		size /= unit
		if size < unit {
			return fmt.Sprintf("%.1f %s", size, suffix)
		}
	}
	return fmt.Sprintf("%.1f PiB", size/unit)
}
