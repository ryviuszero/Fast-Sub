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

	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/ffmpeg"
	"fast-sub/internal/paths"
	"fast-sub/internal/subtitle"
	"fast-sub/internal/worker"
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
	case "transcribe":
		return runTranscribe(ctx, cfg, "transcribe", args[1:])
	case "auto":
		return runTranscribe(ctx, cfg, "auto", args[1:])
	case "--help", "-h", "help":
		printHelp(cfg.Stdout)
		return fserrors.ExitOK
	default:
		return usageError(cfg.Stdout, cfg.Stderr, args[0], false)
	}
}

func runTranscribe(ctx context.Context, cfg Config, command string, args []string) int {
	parsed, err := parseTranscribeArgs(args, command)
	if err != nil {
		return commandError(cfg, command, parsed.jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, command, err.Error(), "", nil))
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
	jsonOutput     bool
	output         string
	modelPath      string
	model          string
	language       string
	device         string
	computeType    string
	batchSize      int
	workerCommand  string
	workerArgs     []string
	wordTimestamps string
	keepTemp       bool
	yes            bool
	positionals    []string
}

type transcribeResult struct {
	InputPath         string   `json:"input_path"`
	OutputPath        string   `json:"output_path"`
	Language          string   `json:"language"`
	Segments          int      `json:"segments"`
	ElapsedSec        float64  `json:"elapsed_sec"`
	JobDir            string   `json:"job_dir"`
	Provider          string   `json:"provider,omitempty"`
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
			i = next
		case strings.HasPrefix(arg, "--word-timestamps="):
			parsed.wordTimestamps = strings.TrimPrefix(arg, "--word-timestamps=")
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
	if parsed.model != "" {
		return empty, fserrors.New(fserrors.CodeNotImplemented, command, "--model is not implemented in fast-sub-go Round 9 and will not download models.", "Pass --model-path to an existing local model directory.", nil)
	}
	if parsed.modelPath == "" {
		return empty, fserrors.New(fserrors.CodeMissingModel, command, "--model-path is required in fast-sub-go Round 9.", "Pass --model-path to an existing local model directory.", nil)
	}
	if err := validateModelPath(parsed.modelPath); err != nil {
		return empty, fserrors.New(fserrors.CodeMissingModel, command, err.Error(), "Pass --model-path to an existing local model directory.", nil)
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
		ModelPath:      parsed.modelPath,
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
		ActualDevice:      response.ActualDevice,
		ActualComputeType: response.ActualComputeType,
		Warnings:          response.Warnings,
	}, nil
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
	fmt.Fprintln(stdout, "  transcribe <input> --model-path <path> [--output <srt>] [--word-timestamps auto|on|off] [--json]")
	fmt.Fprintln(stdout, "  auto <input> --model-path <path> [--output <srt>] [--word-timestamps auto|on|off] [--json]")
}
