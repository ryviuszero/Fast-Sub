package jobs

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	fserrors "fast-sub/internal/errors"
)

type translateCLIResult struct {
	SRTPath        string   `json:"srt_path"`
	Provider       string   `json:"provider"`
	SourceLanguage string   `json:"source_language"`
	TargetLanguage string   `json:"target_language"`
	CuesCount      int      `json:"cues_count"`
	Warnings       []string `json:"warnings"`
	Code           string   `json:"code"`
	Stage          string   `json:"stage"`
	Message        string   `json:"message"`
	ActionHint     string   `json:"action_hint"`
}

func (r DefaultRunner) runTranslateSRTBridge(ctx context.Context, req CreateRequest, emit func(Update)) (Result, *fserrors.AppError) {
	if strings.TrimSpace(req.InputPath) == "" {
		return Result{}, fserrors.New(fserrors.CodeInvalidInput, "translating", "input_path is required.", "Choose an SRT file.", nil)
	}
	provider := stringDefault(req.Provider, "local-nllb-ct2")
	if !hasString([]string{"local-nllb-ct2", "web-bing", "web-google", "api-openai-chat"}, provider) {
		return Result{}, fserrors.New(fserrors.CodeInvalidInput, "translating", "unsupported translation provider: "+provider, "Choose local-nllb-ct2, web-bing, web-google, or api-openai-chat.", nil)
	}
	if provider == "web-bing" || provider == "web-google" || provider == "api-openai-chat" {
		if !boolOption(req, "yes") {
			return Result{}, fserrors.New(fserrors.CodeInvalidInput, "translating", "remote translation requires explicit upload confirmation.", "Confirm that subtitle text may be uploaded before starting this job.", map[string]any{"provider": provider})
		}
	}
	sourceLanguage := language(req)
	if provider == "local-nllb-ct2" && sourceLanguage == "auto" {
		return Result{}, fserrors.New(fserrors.CodeInvalidInput, "translating", "local-nllb-ct2 requires explicit source language.", "Choose the subtitle source language instead of auto.", nil)
	}
	targetLanguage := req.TargetLanguage
	if targetLanguage == "" {
		targetLanguage = stringOption(req, "target_language")
	}
	if targetLanguage == "" {
		targetLanguage = "zh"
	}
	output := req.OutputPath
	if output == "" {
		output = strings.TrimSuffix(req.InputPath, filepath.Ext(req.InputPath)) + ".translated.srt"
	}
	if err := validateOutput(output, boolOption(req, "overwrite")); err != nil {
		return Result{}, err
	}
	emitProgress(emit, "validating", 10)
	command, baseArgs, appErr := r.resolveTranslateCLI()
	if appErr != nil {
		return Result{}, appErr
	}
	args, appErr := r.translateArgs(req, provider, sourceLanguage, targetLanguage, output)
	if appErr != nil {
		return Result{}, appErr
	}
	started := time.Now()
	cmd := exec.CommandContext(ctx, command, append(baseArgs, args...)...)
	cmd.Env = translateEnv(provider, r.env)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	emitProgress(emit, "translating", 35)
	err := cmd.Run()
	if errors.Is(ctx.Err(), context.Canceled) {
		return Result{}, fserrors.New(fserrors.CodeCanceled, "translating", "job was canceled.", "", nil)
	}
	parsed, parseErr := parseTranslateJSON(stdout.Bytes())
	if err != nil {
		if parsed.Code != "" {
			return Result{}, fserrors.New(mapTranslateErrorCode(parsed.Code), stringDefault(parsed.Stage, "translating"), parsed.Message, parsed.ActionHint, map[string]any{"provider": provider})
		}
		return Result{}, fserrors.New(fserrors.CodeProviderUnavailable, "translating", "translation CLI failed: "+redactedTail(stderr.String()), "Check provider configuration and retry.", map[string]any{"exit_error": fserrors.Redact(err.Error())})
	}
	if parseErr != nil {
		return Result{}, fserrors.New(fserrors.CodeWorkerProtocol, "translating", "translation CLI did not return valid JSON: "+parseErr.Error(), "Check fast-sub translate compatibility.", map[string]any{"stderr_tail": redactedTail(stderr.String())})
	}
	resultPath := stringDefault(parsed.SRTPath, output)
	emitProgress(emit, "finalizing", 95)
	return Result{
		InputPath:  req.InputPath,
		OutputPath: resultPath,
		Language:   sourceLanguage,
		Segments:   intDefault(parsed.CuesCount, countSRTCues(resultPath)),
		ElapsedSec: time.Since(started).Seconds(),
		Provider:   provider,
		Model:      req.Model,
		Warnings:   parsed.Warnings,
	}, nil
}

func (r DefaultRunner) translateArgs(req CreateRequest, provider, sourceLanguage, targetLanguage, output string) ([]string, *fserrors.AppError) {
	args := []string{"translate", req.InputPath, "--provider", provider, "--from", sourceLanguage, "--to", targetLanguage, "--mode", translateMode(req), "--output", output, "--json", "--no-resume"}
	if req.Model != "" && provider != "local-nllb-ct2" {
		args = append(args, "--model", req.Model)
	}
	if provider == "local-nllb-ct2" {
		modelID := stringDefault(req.Model, "nllb-200-distilled-600m-ct2-int8")
		modelPath, err := r.lookupModel(modelID, "local-nllb-ct2")
		if err != nil {
			return nil, fserrors.New(fserrors.CodeMissingModel, "translating", err.Error(), "Install the NLLB translation model or choose another translation provider.", nil)
		}
		args = append(args, "--model-path", modelPath)
	}
	if req.Provider == "api-openai-chat" && req.Model == "" {
		model := strings.TrimSpace(r.env("FAST_SUB_OPENAI_CHAT_MODEL"))
		if model == "" {
			model = strings.TrimSpace(r.env("OPENAI_MODEL"))
		}
		if model != "" {
			args = append(args, "--model", model)
		}
	}
	if batch := intOption(req, "batch_size"); batch > 0 {
		args = append(args, "--batch-size", strconv.Itoa(batch))
	}
	if sleep := stringOption(req, "sleep_seconds"); sleep != "" {
		args = append(args, "--sleep-seconds", sleep)
	}
	if baseURL := strings.TrimSpace(r.env("OPENAI_BASE_URL")); provider == "api-openai-chat" && baseURL != "" {
		args = append(args, "--base-url", baseURL)
	}
	return args, nil
}

func (r DefaultRunner) resolveTranslateCLI() (string, []string, *fserrors.AppError) {
	if configured := strings.TrimSpace(r.env("FAST_SUB_PYTHON_CLI")); configured != "" {
		parts := splitCommandLine(configured)
		if len(parts) == 0 {
			return "", nil, fserrors.New(fserrors.CodeMissingDependency, "translating", "FAST_SUB_PYTHON_CLI is empty.", "Set FAST_SUB_PYTHON_CLI to fast-sub or uv run fast-sub.", nil)
		}
		return parts[0], parts[1:], nil
	}
	if path, err := exec.LookPath("fast-sub"); err == nil {
		return path, nil, nil
	}
	if path, err := exec.LookPath("uv"); err == nil {
		return path, []string{"run", "fast-sub"}, nil
	}
	return "", nil, fserrors.New(fserrors.CodeMissingDependency, "translating", "fast-sub Python CLI was not found.", "Set FAST_SUB_PYTHON_CLI or install fast-sub on PATH.", nil)
}

func translateMode(req CreateRequest) string {
	if stringOption(req, "mode") == "bilingual" || req.OutputFormat == "bilingual" {
		return "bilingual"
	}
	return "replace"
}

func translateEnv(provider string, getenv func(string) string) []string {
	keep := []string{"PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "TEMP", "TMP", "VIRTUAL_ENV", "PYTHONPATH", "PYTHONHOME", "UV_CACHE_DIR", "GO_WANT_TRANSLATE_HELPER"}
	if provider == "api-openai-chat" {
		keep = append(keep, "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL")
	}
	env := make([]string, 0, len(keep))
	for _, key := range keep {
		if value := getenv(key); value != "" {
			env = append(env, key+"="+value)
		}
	}
	return env
}

func parseTranslateJSON(raw []byte) (translateCLIResult, error) {
	var out translateCLIResult
	text := strings.TrimSpace(string(raw))
	if text == "" {
		return out, errors.New("empty stdout")
	}
	start := strings.Index(text, "{")
	if start > 0 {
		text = text[start:]
	}
	if err := json.Unmarshal([]byte(text), &out); err != nil {
		return out, err
	}
	return out, nil
}

func mapTranslateErrorCode(code string) string {
	switch code {
	case "missing_model":
		return fserrors.CodeMissingModel
	case "missing_dependency":
		return fserrors.CodeMissingDependency
	case "missing_api_key":
		return fserrors.CodeMissingAPIKey
	case "invalid_options", "invalid_input":
		return fserrors.CodeInvalidInput
	default:
		return fserrors.CodeProviderUnavailable
	}
}

func redactedTail(value string) string {
	value = fserrors.Redact(value)
	if len(value) <= 600 {
		return value
	}
	return value[len(value)-600:]
}

func countSRTCues(path string) int {
	raw, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	return strings.Count(string(raw), " --> ")
}

func splitCommandLine(value string) []string {
	var parts []string
	var current strings.Builder
	inQuote := false
	for _, r := range value {
		switch r {
		case '"':
			inQuote = !inQuote
		case ' ', '\t':
			if inQuote {
				current.WriteRune(r)
				continue
			}
			if current.Len() > 0 {
				parts = append(parts, current.String())
				current.Reset()
			}
		default:
			current.WriteRune(r)
		}
	}
	if current.Len() > 0 {
		parts = append(parts, current.String())
	}
	return parts
}
