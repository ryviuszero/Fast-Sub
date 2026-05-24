package jobs

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	appconfig "fast-sub/internal/config"
	fserrors "fast-sub/internal/errors"
)

type translateCLIResult struct {
	SRTPath        string   `json:"srt_path"`
	OutputPath     string   `json:"output_path"`
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

type translateCLIEnvelope struct {
	OK     *bool              `json:"ok"`
	Result translateCLIResult `json:"result"`
	Error  *struct {
		Code       string `json:"code"`
		Stage      string `json:"stage"`
		Message    string `json:"message"`
		ActionHint string `json:"action_hint"`
	} `json:"error"`
}

const webTranslationJobTimeout = 3 * time.Minute

const (
	webTranslateHelperCommandEnv = "FAST_SUB_WEB_TRANSLATE_HELPER_COMMAND"
	webTranslateHelperArgsEnv    = "FAST_SUB_WEB_TRANSLATE_HELPER_ARGS"
)

const (
	defaultLocalTranslationBatchSize = 32
	defaultAPITranslationBatchSize   = 16
	defaultWebTranslationBatchSize   = 1
)

func (r DefaultRunner) runTranslateSRTBridge(ctx context.Context, req CreateRequest, emit func(Update)) (Result, *fserrors.AppError) {
	if strings.TrimSpace(req.InputPath) == "" {
		return Result{}, fserrors.New(fserrors.CodeInvalidInput, "translating", "input_path is required.", "Choose an SRT or text file.", nil)
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
	if appErr := r.validateWebTranslationHelper(provider); appErr != nil {
		return Result{}, appErr
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
		output = defaultTranslateOutputPath(req.InputPath)
	}
	if err := validateOutput(output, boolOption(req, "overwrite")); err != nil {
		return Result{}, err
	}
	bridgeInput := req.InputPath
	bridgeOutput := output
	plainTextInput := isPlainTextTranslationInput(req.InputPath)
	var cleanupDir string
	var plainTextLayout []plainTextLineLayout
	if plainTextInput {
		var appErr *fserrors.AppError
		bridgeInput, bridgeOutput, cleanupDir, plainTextLayout, appErr = preparePlainTextTranslateBridge(req.InputPath, output)
		if cleanupDir != "" {
			defer os.RemoveAll(cleanupDir)
		}
		if appErr != nil {
			return Result{}, appErr
		}
	}
	emitProgress(emit, "validating", 10)
	command, baseArgs, appErr := r.resolveTranslateCLI(provider)
	if appErr != nil {
		return Result{}, appErr
	}
	args, appErr := r.translateArgs(req, bridgeInput, provider, sourceLanguage, targetLanguage, bridgeOutput)
	if appErr != nil {
		return Result{}, appErr
	}
	started := time.Now()
	execCtx := ctx
	cancelExec := func() {}
	if isWebTranslationProvider(provider) {
		execCtx, cancelExec = context.WithTimeout(ctx, webTranslationJobTimeout)
	}
	defer cancelExec()
	cmd := exec.CommandContext(execCtx, command, append(baseArgs, args...)...)
	cmd.Env = translateEnvForRunner(provider, req, r)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	emitProgress(emit, "translating", 35)
	err := cmd.Run()
	if errors.Is(ctx.Err(), context.Canceled) {
		return Result{}, fserrors.New(fserrors.CodeCanceled, "translating", "job was canceled.", "", nil)
	}
	if isWebTranslationProvider(provider) && errors.Is(execCtx.Err(), context.DeadlineExceeded) {
		return Result{}, fserrors.New(
			fserrors.CodeProviderUnavailable,
			"translating",
			providerDisplayName(provider)+" web translation timed out after 3 minutes.",
			"Web translation is intended for small files. Try a smaller file, split the text, or use local/API translation instead.",
			map[string]any{
				"provider":        provider,
				"timeout_seconds": int(webTranslationJobTimeout.Seconds()),
			},
		)
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
	resultPath := stringDefault(stringDefault(parsed.SRTPath, parsed.OutputPath), bridgeOutput)
	if plainTextInput && isPlainTextTranslationInput(output) {
		if appErr := writeTranslatedPlainText(resultPath, output, plainTextLayout); appErr != nil {
			return Result{}, appErr
		}
		resultPath = output
	}
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

func (r DefaultRunner) translateArgs(req CreateRequest, input, provider, sourceLanguage, targetLanguage, output string) ([]string, *fserrors.AppError) {
	args := []string{"translate", input, "--provider", provider, "--from", sourceLanguage, "--to", targetLanguage, "--mode", translateMode(req), "--output", output, "--json", "--no-resume"}
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
	if provider == "api-openai-chat" && req.Model == "" {
		model := strings.TrimSpace(openAIProviderConfigFromRunner(r, "api-openai-chat").Model)
		if model == "" {
			model = strings.TrimSpace(r.env("FAST_SUB_OPENAI_CHAT_MODEL"))
		}
		if model == "" {
			model = strings.TrimSpace(r.env("OPENAI_MODEL"))
		}
		if model != "" {
			args = append(args, "--model", model)
		}
	}
	args = append(args, "--batch-size", strconv.Itoa(translationBatchSize(req, provider)))
	if timeout := floatOption(req, "timeout"); timeout > 0 {
		args = append(args, "--timeout", strconv.FormatFloat(timeout, 'f', -1, 64))
	} else {
		args = append(args, "--timeout", "60")
	}
	if sleep := stringOption(req, "sleep_seconds"); sleep != "" {
		args = append(args, "--sleep-seconds", sleep)
	}
	if provider == "api-openai-chat" {
		baseURL := strings.TrimSpace(openAIProviderConfigFromRunner(r, "api-openai-chat").BaseURL)
		if baseURL == "" {
			baseURL = strings.TrimSpace(r.env("OPENAI_BASE_URL"))
		}
		if baseURL != "" {
			args = append(args, "--base-url", baseURL)
		}
	}
	return args, nil
}

func defaultTranslateOutputPath(inputPath string) string {
	stem := strings.TrimSuffix(inputPath, filepath.Ext(inputPath))
	if isPlainTextTranslationInput(inputPath) {
		return stem + ".translated.txt"
	}
	return stem + ".translated.srt"
}

func isWebTranslationProvider(provider string) bool {
	return provider == "web-bing" || provider == "web-google"
}

func translationBatchSize(req CreateRequest, provider string) int {
	if batch := intOption(req, "batch_size"); batch > 0 {
		return batch
	}
	switch provider {
	case "local-nllb-ct2":
		return defaultLocalTranslationBatchSize
	case "api-openai-chat":
		return defaultAPITranslationBatchSize
	case "web-bing", "web-google":
		return defaultWebTranslationBatchSize
	default:
		return 8
	}
}

func providerDisplayName(provider string) string {
	switch provider {
	case "web-google":
		return "Google"
	case "web-bing":
		return "Bing"
	default:
		return provider
	}
}

func isPlainTextTranslationInput(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".txt", ".text", ".md", ".markdown":
		return true
	default:
		return false
	}
}

type plainTextLineLayout struct {
	Text         string
	Translatable bool
}

func preparePlainTextTranslateBridge(inputPath, outputPath string) (string, string, string, []plainTextLineLayout, *fserrors.AppError) {
	raw, err := os.ReadFile(inputPath)
	if err != nil {
		return "", "", "", nil, fserrors.New(fserrors.CodeInvalidInput, "translating", "text input could not be read: "+err.Error(), "Choose a readable text file.", nil)
	}
	tmpDir, err := os.MkdirTemp("", "fast-sub-translate-*")
	if err != nil {
		return "", "", "", nil, fserrors.New(fserrors.CodePermissionDenied, "translating", "temporary translation workspace could not be created: "+err.Error(), "Check disk permissions and retry.", nil)
	}
	bridgeInput := filepath.Join(tmpDir, "input.srt")
	bridgeOutput := filepath.Join(tmpDir, "output.srt")
	if !isPlainTextTranslationInput(outputPath) {
		bridgeOutput = outputPath
	}
	layout := plainTextLayout(string(raw))
	if err := os.WriteFile(bridgeInput, []byte(plainTextLayoutToSyntheticSRT(layout)), 0o600); err != nil {
		_ = os.RemoveAll(tmpDir)
		return "", "", "", nil, fserrors.New(fserrors.CodePermissionDenied, "translating", "temporary SRT could not be written: "+err.Error(), "Check disk permissions and retry.", nil)
	}
	return bridgeInput, bridgeOutput, tmpDir, layout, nil
}

func plainTextToSyntheticSRT(text string) string {
	return plainTextLayoutToSyntheticSRT(plainTextLayout(text))
}

func plainTextLayout(text string) []plainTextLineLayout {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	lines := strings.Split(text, "\n")
	layout := make([]plainTextLineLayout, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		layout = append(layout, plainTextLineLayout{
			Text:         trimmed,
			Translatable: trimmed != "",
		})
	}
	return layout
}

func plainTextLayoutToSyntheticSRT(layout []plainTextLineLayout) string {
	var out strings.Builder
	cueIndex := 0
	for _, line := range layout {
		if !line.Translatable {
			continue
		}
		start := cueIndex * 2
		end := start + 2
		fmt.Fprintf(&out, "%d\n%s --> %s\n%s\n\n", cueIndex+1, srtTimestamp(start), srtTimestamp(end), line.Text)
		cueIndex++
	}
	if cueIndex == 0 {
		fmt.Fprintf(&out, "1\n%s --> %s\n\n\n", srtTimestamp(0), srtTimestamp(2))
	}
	return out.String()
}

func srtTimestamp(seconds int) string {
	hours := seconds / 3600
	minutes := (seconds % 3600) / 60
	secs := seconds % 60
	return fmt.Sprintf("%02d:%02d:%02d,000", hours, minutes, secs)
}

func writeTranslatedPlainText(srtPath, outputPath string, layout []plainTextLineLayout) *fserrors.AppError {
	raw, err := os.ReadFile(srtPath)
	if err != nil {
		return fserrors.New(fserrors.CodePermissionDenied, "translating", "translated SRT could not be read: "+err.Error(), "Check output permissions and retry.", nil)
	}
	translations := translatedSRTCueTexts(string(raw))
	text := translatedCueTextsToPlainText(translations, layout)
	if err := os.MkdirAll(filepath.Dir(outputPath), 0o755); err != nil {
		return fserrors.New(fserrors.CodePermissionDenied, "translating", "output directory could not be created: "+err.Error(), "Check output permissions and retry.", nil)
	}
	if err := os.WriteFile(outputPath, []byte(text), 0o600); err != nil {
		return fserrors.New(fserrors.CodePermissionDenied, "translating", "translated text could not be written: "+err.Error(), "Check output permissions and retry.", nil)
	}
	return nil
}

func translatedSRTToPlainText(srt string) string {
	return strings.TrimSpace(strings.Join(translatedSRTCueTexts(srt), "\n\n"))
}

func translatedSRTCueTexts(srt string) []string {
	srt = strings.ReplaceAll(srt, "\r\n", "\n")
	srt = strings.ReplaceAll(srt, "\r", "\n")
	var blocks []string
	var current []string
	flush := func() {
		if len(current) > 0 {
			blocks = append(blocks, strings.Join(current, "\n"))
			current = nil
		}
	}
	for _, line := range strings.Split(srt, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			flush()
			continue
		}
		if _, err := strconv.Atoi(trimmed); err == nil {
			continue
		}
		if strings.Contains(trimmed, " --> ") {
			continue
		}
		current = append(current, trimmed)
	}
	flush()
	return blocks
}

func translatedCueTextsToPlainText(translations []string, layout []plainTextLineLayout) string {
	if len(layout) == 0 {
		return strings.TrimSpace(strings.Join(translations, "\n\n"))
	}
	lines := make([]string, 0, len(layout))
	translationIndex := 0
	for _, line := range layout {
		if !line.Translatable {
			lines = append(lines, "")
			continue
		}
		if translationIndex < len(translations) {
			lines = append(lines, normalizeTranslatedPlainTextLine(translations[translationIndex]))
			translationIndex++
			continue
		}
		lines = append(lines, line.Text)
	}
	return strings.Join(lines, "\n")
}

func normalizeTranslatedPlainTextLine(text string) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	parts := strings.Split(text, "\n")
	normalized := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		normalized = append(normalized, trimmed)
	}
	return strings.TrimSpace(strings.Join(normalized, " "))
}

func openAIProviderConfigFromRunner(r DefaultRunner, providerID string) appconfig.OpenAIProviderConfig {
	loaded, _, err := appconfig.Load(r.ConfigPath, r.env)
	if err != nil {
		return appconfig.OpenAIProviderConfig{}
	}
	return openAIProviderConfig(loaded, providerID)
}

func (r DefaultRunner) resolveTranslateCLI(provider string) (string, []string, *fserrors.AppError) {
	if configured := strings.TrimSpace(r.env("FAST_SUB_PYTHON_CLI")); configured != "" {
		parts := splitCommandLine(configured)
		if len(parts) == 0 {
			return "", nil, fserrors.New(fserrors.CodeMissingDependency, "translating", "FAST_SUB_PYTHON_CLI is empty.", "Set FAST_SUB_PYTHON_CLI to fast-sub or uv run fast-sub.", nil)
		}
		if isUVCommand(parts[0]) {
			return parts[0], withUVExtra(parts[1:], translateExtra(provider)), nil
		}
		return parts[0], parts[1:], nil
	}
	if r.env("FAST_SUB_PACKAGED_RUNTIME_ONLY") == "1" {
		return "", nil, fserrors.New(fserrors.CodeMissingDependency, "translating", "App-private Python CLI is not configured.", "Reinstall Fast Sub or repair the packaged runtime.", nil)
	}
	if path, err := exec.LookPath("fast-sub"); err == nil {
		return path, nil, nil
	}
	if path, err := exec.LookPath("uv"); err == nil {
		return path, withUVExtra([]string{"run", "fast-sub"}, translateExtra(provider)), nil
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
	if isWebTranslationProvider(provider) {
		keep = append(keep, webTranslateHelperCommandEnv, webTranslateHelperArgsEnv, "ELECTRON_RUN_AS_NODE")
	}
	if provider == "api-openai-chat" {
		keep = append(keep, "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL")
	}
	env := make([]string, 0, len(keep))
	for _, key := range keep {
		if value := getenv(key); value != "" {
			env = append(env, key+"="+value)
		}
	}
	if getenv("UV_CACHE_DIR") == "" {
		env = append(env, "UV_CACHE_DIR=.uv-cache")
	}
	env = appendPythonUTF8Env(env)
	return env
}

func translateEnvForRunner(provider string, req CreateRequest, r DefaultRunner) []string {
	env := translateEnv(provider, r.env)
	if provider != "api-openai-chat" {
		return env
	}
	if value := strings.TrimSpace(req.Extra["openai_chat_api_key"]); value != "" {
		return upsertEnv(env, "OPENAI_API_KEY", value)
	}
	providerConfig := openAIProviderConfigFromRunner(r, "api-openai-chat")
	keyEnv := normalizeOpenAIKeyEnv(providerConfig.APIKeyEnv)
	if keyEnv == "" {
		keyEnv = "FAST_SUB_OPENAI_CHAT_API_KEY"
	}
	if value := strings.TrimSpace(r.env(keyEnv)); value != "" {
		return upsertEnv(env, "OPENAI_API_KEY", value)
	}
	if value := strings.TrimSpace(r.env("FAST_SUB_OPENAI_API_KEY")); value != "" {
		return upsertEnv(env, "OPENAI_API_KEY", value)
	}
	return env
}

func upsertEnv(env []string, key, value string) []string {
	prefix := key + "="
	for idx, item := range env {
		if strings.HasPrefix(item, prefix) {
			env[idx] = prefix + value
			return env
		}
	}
	return append(env, prefix+value)
}

func normalizeOpenAIKeyEnv(value string) string {
	if value == "openai-default" {
		return ""
	}
	return value
}

func appendPythonUTF8Env(env []string) []string {
	return append(env,
		"PYTHONUTF8=1",
		"PYTHONIOENCODING=utf-8:replace",
		"PYTHONLEGACYWINDOWSSTDIO=0",
	)
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
	var envelope translateCLIEnvelope
	if err := json.Unmarshal([]byte(text), &envelope); err == nil && (envelope.OK != nil || envelope.Error != nil) {
		if envelope.Error != nil {
			out.Code = envelope.Error.Code
			out.Stage = envelope.Error.Stage
			out.Message = envelope.Error.Message
			out.ActionHint = envelope.Error.ActionHint
			return out, nil
		}
		return envelope.Result, nil
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
	case "missing_dependency", "missing_helper", "missing_node_runtime", "helper_start_failed":
		return fserrors.CodeMissingDependency
	case "missing_api_key":
		return fserrors.CodeMissingAPIKey
	case "invalid_options", "invalid_input":
		return fserrors.CodeInvalidInput
	case "provider_timeout", "rate_limited", "region_blocked", "provider_response_changed", "provider_failed":
		return fserrors.CodeProviderUnavailable
	default:
		return fserrors.CodeProviderUnavailable
	}
}

func (r DefaultRunner) validateWebTranslationHelper(provider string) *fserrors.AppError {
	if !isWebTranslationProvider(provider) {
		return nil
	}
	command := strings.TrimSpace(r.env(webTranslateHelperCommandEnv))
	if command == "" {
		return fserrors.New(
			fserrors.CodeMissingDependency,
			"translating",
			"Packaged web translation helper is not configured.",
			"Repair or reinstall Fast Sub, or choose local/API translation.",
			map[string]any{"provider": provider},
		)
	}
	if filepath.IsAbs(command) {
		if _, err := os.Stat(command); err != nil {
			return fserrors.New(
				fserrors.CodeMissingDependency,
				"translating",
				"Packaged Node/Electron helper runtime is missing.",
				"Repair or reinstall Fast Sub, or choose local/API translation.",
				map[string]any{"provider": provider},
			)
		}
	}
	argsRaw := strings.TrimSpace(r.env(webTranslateHelperArgsEnv))
	if argsRaw == "" {
		return fserrors.New(
			fserrors.CodeMissingDependency,
			"translating",
			"Web translation helper args are missing.",
			"Repair or reinstall Fast Sub, or choose local/API translation.",
			map[string]any{"provider": provider},
		)
	}
	var args []string
	if err := json.Unmarshal([]byte(argsRaw), &args); err != nil {
		return fserrors.New(
			fserrors.CodeMissingDependency,
			"translating",
			"Web translation helper args are invalid.",
			"Repair or reinstall Fast Sub, or choose local/API translation.",
			map[string]any{"provider": provider},
		)
	}
	if len(args) == 0 {
		return fserrors.New(
			fserrors.CodeMissingDependency,
			"translating",
			"Web translation helper args are empty.",
			"Repair or reinstall Fast Sub, or choose local/API translation.",
			map[string]any{"provider": provider},
		)
	}
	for _, arg := range args {
		ext := strings.ToLower(filepath.Ext(arg))
		if filepath.IsAbs(arg) && (ext == ".js" || ext == ".mjs" || ext == ".cjs") {
			if _, err := os.Stat(arg); err != nil {
				return fserrors.New(
					fserrors.CodeMissingDependency,
					"translating",
					"Packaged web translation helper file is missing.",
					"Repair or reinstall Fast Sub, or choose local/API translation.",
					map[string]any{"provider": provider},
				)
			}
		}
	}
	return nil
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

func translateExtra(provider string) string {
	switch provider {
	case "local-nllb-ct2":
		return "local-translate"
	case "web-bing", "web-google":
		return "web-translate"
	default:
		return ""
	}
}

func isUVCommand(command string) bool {
	return strings.EqualFold(filepath.Base(command), "uv") || strings.EqualFold(filepath.Base(command), "uv.exe")
}

func withUVExtra(args []string, extra string) []string {
	out := append([]string(nil), args...)
	if extra == "" || hasUVExtra(out, extra) {
		return out
	}
	insert := 0
	if len(out) > 0 && out[0] == "run" {
		insert = 1
	}
	next := append([]string{}, out[:insert]...)
	next = append(next, "--extra", extra)
	next = append(next, out[insert:]...)
	return next
}

func hasUVExtra(args []string, extra string) bool {
	for i, arg := range args {
		if arg == "--extra" && i+1 < len(args) && args[i+1] == extra {
			return true
		}
		if strings.HasPrefix(arg, "--extra=") && strings.TrimPrefix(arg, "--extra=") == extra {
			return true
		}
	}
	return false
}
