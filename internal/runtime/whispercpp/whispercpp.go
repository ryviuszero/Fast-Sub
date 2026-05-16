// Package whispercpp runs whisper.cpp as an external native binary.
package whispercpp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/procutil"
	"fast-sub/internal/subtitle"
)

const (
	defaultTimeout           = 6 * time.Hour
	defaultCapabilityTimeout = 10 * time.Second
	defaultTailLimit         = 8192
)

// Options describes one whisper.cpp transcription run.
type Options struct {
	Command           string
	AudioPath         string
	ModelPath         string
	JobDir            string
	Language          string
	Timeout           time.Duration
	CapabilityTimeout time.Duration
	TailLimit         int
	ManagedBinaryDir  string
}

// Result is the provider-native output normalized into Fast Sub segments.
type Result struct {
	Provider     string
	Language     string
	Segments     []subtitle.Segment
	Warnings     []string
	OutputFormat string
	BinaryPath   string
	ElapsedSec   float64
}

// Capabilities records the supported flags detected from --help / --version.
type Capabilities struct {
	SupportsJSON         bool
	SupportsSRT          bool
	SupportsOutputFile   bool
	SupportsNoPrints     bool
	SupportsLanguageAuto bool
	Version              string
}

// Transcribe runs whisper.cpp and parses its JSON output, falling back to SRT.
func Transcribe(ctx context.Context, opts Options) (Result, *fserrors.AppError) {
	var empty Result
	if opts.TailLimit <= 0 {
		opts.TailLimit = defaultTailLimit
	}
	if opts.Timeout <= 0 {
		opts.Timeout = defaultTimeout
	}
	binaryPath, appErr := DiscoverBinary(opts.Command, opts.ManagedBinaryDir)
	if appErr != nil {
		return empty, appErr
	}
	capabilityTimeout := opts.CapabilityTimeout
	if capabilityTimeout <= 0 {
		capabilityTimeout = defaultCapabilityTimeout
	}
	caps, appErr := DetectCapabilities(ctx, binaryPath, opts.TailLimit, capabilityTimeout)
	if appErr != nil {
		return empty, appErr
	}
	if !caps.SupportsOutputFile {
		return empty, fserrors.New(fserrors.CodeMissingDependency, "transcribing", "whisper.cpp binary does not support output-file mode.", "Use a whisper.cpp binary with --output-file support.", map[string]any{"binary": binaryPath})
	}
	if !caps.SupportsNoPrints {
		return empty, fserrors.New(fserrors.CodeMissingDependency, "transcribing", "whisper.cpp binary does not support quiet no-prints mode.", "Use a whisper.cpp binary with --no-prints support so JSON stdout stays pure.", map[string]any{"binary": binaryPath})
	}
	if !caps.SupportsJSON && !caps.SupportsSRT {
		return empty, fserrors.New(fserrors.CodeMissingDependency, "transcribing", "whisper.cpp binary does not support JSON or SRT output.", "Use a whisper.cpp binary with --output-json or --output-srt support.", map[string]any{"binary": binaryPath})
	}

	format := "json"
	if !caps.SupportsJSON {
		format = "srt"
	}
	base := filepath.Join(opts.JobDir, "whispercpp-output")
	_ = os.Remove(base + ".json")
	_ = os.Remove(base + ".srt")

	args := buildArgs(caps, opts, base, format)
	runCtx, cancel := context.WithTimeout(ctx, opts.Timeout)
	defer cancel()
	started := time.Now()
	completed := runCommand(runCtx, binaryPath, args, opts.TailLimit)
	if runCtx.Err() != nil {
		code := fserrors.CodeWorkerCanceled
		message := "whisper.cpp was canceled"
		if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
			code = fserrors.CodeWorkerTimeout
			message = "whisper.cpp timed out"
		}
		return empty, fserrors.New(code, "transcribing", message, "Retry with a shorter input or a smaller model.", map[string]any{"stderr_tail": fserrors.Redact(completed.Stderr)})
	}
	if completed.Err != nil {
		return empty, fserrors.New(
			fserrors.CodeWorkerFailed,
			"transcribing",
			"whisper.cpp failed: "+processMessage(completed),
			"Check the whisper.cpp binary, model path, and input audio.",
			map[string]any{"exit_code": completed.ExitCode, "stderr_tail": fserrors.Redact(completed.Stderr)},
		)
	}

	outputPath := base + "." + format
	segments, language, parseErr := parseOutput(outputPath, format)
	if parseErr != nil {
		return empty, fserrors.New(fserrors.CodeWorkerProtocol, "transcribing", parseErr.Error(), "Check whisper.cpp output compatibility.", nil)
	}
	if len(segments) == 0 {
		return empty, fserrors.New(fserrors.CodeWorkerFailed, "transcribing", "whisper.cpp returned no subtitle segments", "Check that the input contains speech and the selected model is valid.", nil)
	}
	if language == "" {
		language = opts.Language
	}
	if language == "" {
		language = "auto"
	}
	warnings := []string{}
	if completed.Stdout != "" {
		warnings = append(warnings, "whisper.cpp stdout was captured and ignored")
	}
	if completed.Stderr != "" {
		warnings = append(warnings, "whisper.cpp stderr was captured and ignored")
	}
	return Result{
		Provider:     "local-whisper-cpp",
		Language:     language,
		Segments:     segments,
		Warnings:     warnings,
		OutputFormat: format,
		BinaryPath:   binaryPath,
		ElapsedSec:   time.Since(started).Seconds(),
	}, nil
}

// DiscoverBinary resolves the whisper.cpp command in the required order.
func DiscoverBinary(cliCommand, managedBinaryDir string) (string, *fserrors.AppError) {
	candidates := []string{}
	if cliCommand != "" {
		candidates = append(candidates, cliCommand)
	} else if env := os.Getenv("FAST_SUB_WHISPER_CPP_COMMAND"); env != "" {
		candidates = append(candidates, env)
	} else {
		candidates = append(candidates, "whisper-cli", "main", "whisper-cpp")
		if managedBinaryDir != "" {
			candidates = append(candidates, managedBinaryCandidates(managedBinaryDir)...)
		}
	}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if strings.ContainsAny(candidate, `/\`) || filepath.IsAbs(candidate) {
			if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
				return candidate, nil
			}
			continue
		}
		if path, err := exec.LookPath(candidate); err == nil {
			return path, nil
		}
	}
	return "", fserrors.New(fserrors.CodeMissingDependency, "transcribing", "whisper.cpp binary was not found.", "Install whisper.cpp, set FAST_SUB_WHISPER_CPP_COMMAND, or pass --whisper-cpp-command.", nil)
}

// DetectCapabilities checks the binary help/version text for required flags.
func DetectCapabilities(ctx context.Context, binaryPath string, tailLimit int, timeout time.Duration) (Capabilities, *fserrors.AppError) {
	if timeout <= 0 {
		timeout = defaultCapabilityTimeout
	}
	helpCtx, helpCancel := context.WithTimeout(ctx, timeout)
	help := runCommand(helpCtx, binaryPath, []string{"--help"}, tailLimit)
	helpCancel()
	versionCtx, versionCancel := context.WithTimeout(ctx, timeout)
	version := runCommand(versionCtx, binaryPath, []string{"--version"}, tailLimit)
	versionCancel()
	text := strings.ToLower(help.Stdout + "\n" + help.Stderr + "\n" + version.Stdout + "\n" + version.Stderr)
	if errors.Is(help.Err, context.DeadlineExceeded) || errors.Is(version.Err, context.DeadlineExceeded) {
		return Capabilities{}, fserrors.New(fserrors.CodeWorkerTimeout, "transcribing", "whisper.cpp capability detection timed out.", "Check that the whisper.cpp binary can run --help or --version quickly.", map[string]any{"binary": binaryPath})
	}
	if help.Err != nil && version.Err != nil && strings.TrimSpace(text) == "" {
		return Capabilities{}, fserrors.New(fserrors.CodeMissingDependency, "transcribing", "whisper.cpp capability detection failed.", "Check that the whisper.cpp binary can run --help or --version.", map[string]any{"binary": binaryPath})
	}
	caps := Capabilities{
		SupportsJSON:         strings.Contains(text, "--output-json") || strings.Contains(text, "-oj") || strings.Contains(text, "output-json-full"),
		SupportsSRT:          strings.Contains(text, "--output-srt") || strings.Contains(text, "-osrt"),
		SupportsOutputFile:   strings.Contains(text, "--output-file") || strings.Contains(text, "-of"),
		SupportsNoPrints:     strings.Contains(text, "--no-prints") || strings.Contains(text, "-np"),
		SupportsLanguageAuto: strings.Contains(text, "language") && strings.Contains(text, "auto"),
		Version:              firstLine(version.Stdout),
	}
	return caps, nil
}

func buildArgs(caps Capabilities, opts Options, outputBase, format string) []string {
	args := []string{"-m", opts.ModelPath, "-f", opts.AudioPath, "-of", outputBase}
	if format == "json" {
		args = append(args, "-oj")
	} else {
		args = append(args, "-osrt")
	}
	if caps.SupportsNoPrints {
		args = append(args, "-np")
	}
	lang := opts.Language
	if lang == "" {
		lang = "auto"
	}
	if lang != "auto" || caps.SupportsLanguageAuto {
		args = append(args, "-l", lang)
	}
	return args
}

func parseOutput(path, format string) ([]subtitle.Segment, string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, "", fmt.Errorf("whisper.cpp %s output file is missing", format)
		}
		return nil, "", fmt.Errorf("read whisper.cpp output: %w", err)
	}
	if format == "json" {
		return ParseJSON(raw)
	}
	return ParseSRT(string(raw))
}

// ParseJSON accepts common whisper.cpp JSON shapes and returns subtitle segments.
func ParseJSON(raw []byte) ([]subtitle.Segment, string, error) {
	var payload any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, "", fmt.Errorf("whisper.cpp output is invalid JSON")
	}
	language := findLanguage(payload)
	items := findSegmentItems(payload)
	segments := make([]subtitle.Segment, 0, len(items))
	for index, rawItem := range items {
		item, ok := rawItem.(map[string]any)
		if !ok {
			return nil, language, fmt.Errorf("whisper.cpp JSON segment %d is invalid: segment must be an object", index+1)
		}
		segment, skip, err := segmentFromJSONItem(item)
		if err != nil {
			return nil, language, fmt.Errorf("whisper.cpp JSON segment %d is invalid: %w", index+1, err)
		}
		if !skip {
			segments = append(segments, segment)
		}
	}
	if len(segments) == 0 {
		return nil, language, fmt.Errorf("whisper.cpp JSON contains no valid subtitle segments")
	}
	if _, err := subtitle.RenderSRT(segments); err != nil {
		return nil, language, fmt.Errorf("whisper.cpp JSON contains invalid subtitle segments: %w", err)
	}
	return segments, language, nil
}

// ParseSRT parses SubRip text into normalized segments.
func ParseSRT(raw string) ([]subtitle.Segment, string, error) {
	blocks := strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n\n")
	segments := make([]subtitle.Segment, 0, len(blocks))
	for _, block := range blocks {
		lines := nonEmptyLines(block)
		if len(lines) < 2 {
			continue
		}
		timingIndex := 0
		if !strings.Contains(lines[0], "-->") && len(lines) >= 3 {
			timingIndex = 1
		}
		if !strings.Contains(lines[timingIndex], "-->") {
			continue
		}
		parts := strings.Split(lines[timingIndex], "-->")
		if len(parts) != 2 {
			return nil, "", fmt.Errorf("invalid SRT timestamp line: %s", lines[timingIndex])
		}
		start, err := parseSRTTime(parts[0])
		if err != nil {
			return nil, "", err
		}
		end, err := parseSRTTime(parts[1])
		if err != nil {
			return nil, "", err
		}
		text := strings.TrimSpace(strings.Join(lines[timingIndex+1:], "\n"))
		if text == "" {
			continue
		}
		segments = append(segments, subtitle.Segment{StartSec: start, EndSec: end, Text: text})
	}
	if len(segments) == 0 {
		return nil, "", fmt.Errorf("whisper.cpp SRT contains no valid subtitle segments")
	}
	if _, err := subtitle.RenderSRT(segments); err != nil {
		return nil, "", fmt.Errorf("whisper.cpp SRT contains invalid subtitle segments: %w", err)
	}
	return segments, "", nil
}

func findSegmentItems(value any) []any {
	switch typed := value.(type) {
	case []any:
		return typed
	case map[string]any:
		for _, key := range []string{"transcription", "segments"} {
			if rawItems, ok := typed[key].([]any); ok {
				return rawItems
			}
		}
		if result, ok := typed["result"].(map[string]any); ok {
			for _, key := range []string{"transcription", "segments"} {
				if rawItems, ok := result[key].([]any); ok {
					return rawItems
				}
			}
		}
	}
	return nil
}

func segmentFromJSONItem(item map[string]any) (subtitle.Segment, bool, error) {
	text, _ := item["text"].(string)
	text = strings.TrimSpace(text)
	if text == "" {
		return subtitle.Segment{}, true, nil
	}
	start, startOK := numericField(item, "start", "start_sec", "t0")
	end, endOK := numericField(item, "end", "end_sec", "t1")
	if !startOK || !endOK {
		if timestamps, ok := item["timestamps"].(map[string]any); ok {
			start, startOK = timestampField(timestamps, "from")
			end, endOK = timestampField(timestamps, "to")
		}
	}
	if !startOK || !endOK {
		if offsets, ok := item["offsets"].(map[string]any); ok {
			from, fromOK := numericAny(offsets["from"])
			to, toOK := numericAny(offsets["to"])
			if fromOK && toOK {
				start, end = from/1000.0, to/1000.0
				startOK, endOK = true, true
			}
		}
	}
	if !startOK || !endOK || !finite(start) || !finite(end) {
		return subtitle.Segment{}, false, fmt.Errorf("timestamps are missing or invalid")
	}
	return subtitle.Segment{StartSec: start, EndSec: end, Text: text}, false, nil
}

func numericField(item map[string]any, keys ...string) (float64, bool) {
	for _, key := range keys {
		if value, ok := numericAny(item[key]); ok {
			return value, true
		}
	}
	return 0, false
}

func numericAny(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case int:
		return float64(typed), true
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func timestampField(item map[string]any, key string) (float64, bool) {
	if raw, ok := item[key].(string); ok {
		sec, err := parseTimestamp(raw)
		return sec, err == nil
	}
	return numericAny(item[key])
}

func parseSRTTime(value string) (float64, error) {
	return parseTimestamp(strings.TrimSpace(value))
}

func parseTimestamp(value string) (float64, error) {
	value = strings.TrimSpace(strings.ReplaceAll(value, ",", "."))
	parts := strings.Split(value, ":")
	if len(parts) != 3 {
		return 0, fmt.Errorf("invalid timestamp: %s", value)
	}
	hours, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, fmt.Errorf("invalid timestamp: %s", value)
	}
	minutes, err := strconv.Atoi(parts[1])
	if err != nil {
		return 0, fmt.Errorf("invalid timestamp: %s", value)
	}
	seconds, err := strconv.ParseFloat(parts[2], 64)
	if err != nil {
		return 0, fmt.Errorf("invalid timestamp: %s", value)
	}
	return float64(hours*3600+minutes*60) + seconds, nil
}

func findLanguage(value any) string {
	switch typed := value.(type) {
	case map[string]any:
		if lang, ok := typed["language"].(string); ok {
			return lang
		}
		if result, ok := typed["result"].(map[string]any); ok {
			if lang, ok := result["language"].(string); ok {
				return lang
			}
		}
	}
	return ""
}

func nonEmptyLines(block string) []string {
	rawLines := strings.Split(strings.TrimSpace(block), "\n")
	lines := make([]string, 0, len(rawLines))
	for _, line := range rawLines {
		line = strings.TrimSpace(line)
		if line != "" {
			lines = append(lines, line)
		}
	}
	return lines
}

func runCommand(ctx context.Context, name string, args []string, tailLimit int) completedProcess {
	return procutil.Run(ctx, name, args, nil, tailLimit)
}

type completedProcess = procutil.CompletedProcess

func processMessage(completed completedProcess) string {
	message := strings.TrimSpace(completed.Stderr)
	if message == "" {
		message = strings.TrimSpace(completed.Stdout)
	}
	if message == "" {
		message = fmt.Sprintf("process exited with code %d", completed.ExitCode)
	}
	return fserrors.Redact(message)
}

func tail(value string, limit int) string {
	if limit <= 0 || len(value) <= limit {
		return value
	}
	return value[len(value)-limit:]
}

func firstLine(value string) string {
	lines := strings.Split(strings.TrimSpace(value), "\n")
	if len(lines) == 0 {
		return ""
	}
	return strings.TrimSpace(lines[0])
}

func finite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func managedBinaryCandidates(dir string) []string {
	name := "whisper-cli"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return []string{
		filepath.Join(dir, name),
		filepath.Join(dir, "bin", name),
	}
}
