// Package providers owns the static provider registry used by fast-sub-go.
package providers

import (
	"context"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	appconfig "fast-sub/internal/config"
	"fast-sub/internal/models"
)

const (
	// StatusAvailable means the provider can be selected by static checks.
	StatusAvailable = "available"
	// StatusMissingDependency means a required binary or worker was not found.
	StatusMissingDependency = "missing_dependency"
	// StatusMissingModel means the provider needs a local model path that is not configured or valid.
	StatusMissingModel = "missing_model"
	// StatusMissingAPIKey means a live API request was rejected because authentication is required or invalid.
	StatusMissingAPIKey = "missing_api_key"
	// StatusInvalidConfig means a provider config file was requested but could not be loaded.
	StatusInvalidConfig = "invalid_config"
	// StatusDisabled means the provider is intentionally disabled.
	StatusDisabled = "disabled"
	// StatusNotImplemented means metadata exists but runtime execution is not implemented.
	StatusNotImplemented = "not_implemented"

	CheckModeStatic = "static"
	CheckModeLive   = "live"
)

const (
	typeSTT         = "stt"
	typeTranslation = "translation"
)

// Metadata is the UI-facing provider description.
type Metadata struct {
	ID                     string   `json:"id"`
	Type                   string   `json:"type"`
	Location               string   `json:"location"`
	Backend                string   `json:"backend"`
	Offline                bool     `json:"offline"`
	RequiresAPIKey         bool     `json:"requires_api_key"`
	RequiresModel          bool     `json:"requires_model"`
	PrivacyNote            string   `json:"privacy_note"`
	SupportedLanguages     []string `json:"supported_languages"`
	SupportsWordTimestamps bool     `json:"supports_word_timestamps"`
	SupportsBatch          bool     `json:"supports_batch"`
	Capabilities           []string `json:"capabilities"`
	CompatibleModelTypes   []string `json:"compatible_model_types"`
}

// ListedProvider combines provider metadata and current static status.
type ListedProvider struct {
	Metadata
	Status     string   `json:"status"`
	CheckMode  string   `json:"check_mode"`
	Warnings   []string `json:"warnings"`
	ActionHint string   `json:"action_hint,omitempty"`
}

// CheckResult is returned by providers test.
type CheckResult struct {
	ProviderID string         `json:"provider_id"`
	Status     string         `json:"status"`
	CheckMode  string         `json:"check_mode"`
	Available  bool           `json:"available"`
	Metadata   Metadata       `json:"metadata"`
	Checks     []Check        `json:"checks"`
	Warnings   []string       `json:"warnings"`
	ActionHint string         `json:"action_hint,omitempty"`
	Details    map[string]any `json:"details"`
}

// Check describes one redaction-safe static check.
type Check struct {
	Name       string `json:"name"`
	OK         bool   `json:"ok"`
	Status     string `json:"status"`
	Message    string `json:"message"`
	ActionHint string `json:"action_hint,omitempty"`
}

// RuntimeConfig supplies injectable static discovery hooks.
type RuntimeConfig struct {
	Env           func(string) string
	LookPath      func(string) (string, error)
	Stat          func(string) (os.FileInfo, error)
	RunCommand    func(context.Context, string, []string) error
	ModelResolver func(string) ModelResolution
	Providers     map[string]Provider
}

// ModelResolution describes whether a Go-managed model is installed for a provider.
type ModelResolution struct {
	OK         bool
	Path       string
	Message    string
	ActionHint string
}

// Provider is one statically registered provider.
type Provider struct {
	Metadata Metadata
	Check    func(context.Context, RuntimeConfig, Metadata) CheckResult
}

// DefaultRuntimeConfig reads process environment and PATH.
func DefaultRuntimeConfig() RuntimeConfig {
	return RuntimeConfig{
		Env:           os.Getenv,
		LookPath:      exec.LookPath,
		Stat:          os.Stat,
		RunCommand:    runCommand,
		ModelResolver: resolveInstalledModel,
	}
}

// List returns all providers in stable UI order.
func List(ctx context.Context, cfg RuntimeConfig) []ListedProvider {
	cfg = normalizeConfig(cfg)
	registry := registry(cfg)
	ids := []string{"local-faster-whisper", "local-whisper-cpp", "api-openai-transcription", "local-nllb-ct2", "web-bing", "web-google", "api-openai-chat"}
	items := make([]ListedProvider, 0, len(ids))
	for _, id := range ids {
		provider := registry[id]
		check := provider.Check(ctx, cfg, provider.Metadata)
		items = append(items, ListedProvider{
			Metadata:   provider.Metadata,
			Status:     check.Status,
			CheckMode:  check.CheckMode,
			Warnings:   check.Warnings,
			ActionHint: check.ActionHint,
		})
	}
	return items
}

// Test runs the static provider check for one provider.
func Test(ctx context.Context, cfg RuntimeConfig, id string) (CheckResult, bool) {
	return TestMode(ctx, cfg, id, CheckModeStatic)
}

// TestMode runs a provider check. Live mode is only used for providers with a safe,
// explicit connectivity check; other providers keep static checks.
func TestMode(ctx context.Context, cfg RuntimeConfig, id, mode string) (CheckResult, bool) {
	cfg = normalizeConfig(cfg)
	registry := registry(cfg)
	provider, ok := registry[id]
	if !ok {
		return CheckResult{}, false
	}
	if mode == CheckModeLive && (id == "api-openai-transcription" || id == "api-openai-chat") {
		return checkOpenAILive(ctx, cfg, provider.Metadata), true
	}
	return provider.Check(ctx, cfg, provider.Metadata), true
}

func registry(cfg RuntimeConfig) map[string]Provider {
	cfg = normalizeConfig(cfg)
	if cfg.Providers != nil {
		return cfg.Providers
	}
	return defaultRegistry()
}

func normalizeConfig(cfg RuntimeConfig) RuntimeConfig {
	if cfg.Env == nil {
		cfg.Env = os.Getenv
	}
	if cfg.LookPath == nil {
		cfg.LookPath = exec.LookPath
	}
	if cfg.Stat == nil {
		cfg.Stat = os.Stat
	}
	if cfg.RunCommand == nil {
		cfg.RunCommand = runCommand
	}
	if cfg.ModelResolver == nil {
		cfg.ModelResolver = resolveInstalledModel
	}
	return cfg
}

func defaultRegistry() map[string]Provider {
	return map[string]Provider{
		"local-faster-whisper": {
			Metadata: Metadata{
				ID:                     "local-faster-whisper",
				Type:                   typeSTT,
				Location:               "local",
				Backend:                "faster-whisper-python-worker",
				Offline:                true,
				RequiresAPIKey:         false,
				RequiresModel:          true,
				PrivacyNote:            "Runs transcription locally through the Python faster-whisper worker. Audio is not uploaded.",
				SupportedLanguages:     []string{"auto", "en", "zh", "ja", "ko"},
				SupportsWordTimestamps: true,
				SupportsBatch:          true,
				Capabilities:           []string{"transcribe", "srt", "word_timestamps"},
				CompatibleModelTypes:   []string{"asr"},
			},
			Check: checkFasterWhisper,
		},
		"local-whisper-cpp": {
			Metadata: Metadata{
				ID:                     "local-whisper-cpp",
				Type:                   typeSTT,
				Location:               "native",
				Backend:                "whisper.cpp",
				Offline:                true,
				RequiresAPIKey:         false,
				RequiresModel:          true,
				PrivacyNote:            "Runs transcription locally through a whisper.cpp binary. Audio is not uploaded.",
				SupportedLanguages:     []string{"auto", "en", "zh", "ja", "ko"},
				SupportsWordTimestamps: false,
				SupportsBatch:          false,
				Capabilities:           []string{"transcribe", "srt", "native_binary"},
				CompatibleModelTypes:   []string{"asr", "binary"},
			},
			Check: checkWhisperCPP,
		},
		"api-openai-transcription": {
			Metadata: Metadata{
				ID:                     "api-openai-transcription",
				Type:                   typeSTT,
				Location:               "api",
				Backend:                "openai-compatible-transcription",
				Offline:                false,
				RequiresAPIKey:         false,
				RequiresModel:          true,
				PrivacyNote:            "Uploads audio to the configured OpenAI-compatible transcription API only when explicitly selected.",
				SupportedLanguages:     []string{"auto", "en", "zh", "ja", "ko"},
				SupportsWordTimestamps: false,
				SupportsBatch:          false,
				Capabilities:           []string{"transcribe", "remote_api", "static_check_only"},
				CompatibleModelTypes:   []string{"api"},
			},
			Check: checkOpenAI,
		},
		"local-nllb-ct2": {
			Metadata: Metadata{
				ID:                     "local-nllb-ct2",
				Type:                   typeTranslation,
				Location:               "local",
				Backend:                "nllb-ct2",
				Offline:                true,
				RequiresAPIKey:         false,
				RequiresModel:          true,
				PrivacyNote:            "Runs subtitle translation locally through the NLLB CTranslate2 provider. Subtitle text is not uploaded.",
				SupportedLanguages:     []string{"en", "zh", "ja", "ko"},
				SupportsWordTimestamps: false,
				SupportsBatch:          true,
				Capabilities:           []string{"translate_srt", "offline"},
				CompatibleModelTypes:   []string{"translation"},
			},
			Check: checkLocalNLLB,
		},
		"web-bing": {
			Metadata: translationWebMetadata("web-bing", "bing-web-translate", "Uploads subtitle text to Bing web translation only when explicitly selected."),
			Check:    checkAlwaysAvailable,
		},
		"web-google": {
			Metadata: translationWebMetadata("web-google", "google-web-translate", "Uploads subtitle text to Google web translation only when explicitly selected."),
			Check:    checkAlwaysAvailable,
		},
		"api-openai-chat": {
			Metadata: Metadata{
				ID:                     "api-openai-chat",
				Type:                   typeTranslation,
				Location:               "api",
				Backend:                "openai-compatible-chat",
				Offline:                false,
				RequiresAPIKey:         false,
				RequiresModel:          true,
				PrivacyNote:            "Uploads subtitle text to the configured OpenAI-compatible chat API only when explicitly selected.",
				SupportedLanguages:     []string{"auto", "en", "zh", "ja", "ko"},
				SupportsWordTimestamps: false,
				SupportsBatch:          true,
				Capabilities:           []string{"translate_srt", "remote_api"},
				CompatibleModelTypes:   []string{"api"},
			},
			Check: checkOpenAIChat,
		},
	}
}

func translationWebMetadata(id, backend, note string) Metadata {
	return Metadata{
		ID:                     id,
		Type:                   typeTranslation,
		Location:               "web",
		Backend:                backend,
		Offline:                false,
		RequiresAPIKey:         false,
		RequiresModel:          false,
		PrivacyNote:            note,
		SupportedLanguages:     []string{"auto", "en", "zh", "ja", "ko"},
		SupportsWordTimestamps: false,
		SupportsBatch:          true,
		Capabilities:           []string{"translate_srt", "web"},
		CompatibleModelTypes:   []string{},
	}
}

func checkFasterWhisper(ctx context.Context, cfg RuntimeConfig, metadata Metadata) CheckResult {
	checks := []Check{
		checkFasterWhisperDependencies(ctx, cfg),
		checkSTTWorkerCommand(cfg),
		checkModel(cfg, metadata.ID, envFirst(cfg, "FAST_SUB_FASTER_WHISPER_MODEL_PATH", "FAST_SUB_MODEL_PATH"), false, "Install a compatible model with `fast-sub-go models install whisper-small`, or set FAST_SUB_FASTER_WHISPER_MODEL_PATH."),
	}
	return summarize(metadata, checks, nil)
}

func checkWhisperCPP(_ context.Context, cfg RuntimeConfig, metadata Metadata) CheckResult {
	checks := []Check{
		checkWhisperCPPCommand(cfg),
		checkModel(cfg, metadata.ID, envFirst(cfg, "FAST_SUB_WHISPER_CPP_MODEL_PATH", "FAST_SUB_MODEL_PATH"), true, "Install a compatible model with `fast-sub-go models install <id>`, or set FAST_SUB_WHISPER_CPP_MODEL_PATH."),
	}
	return summarize(metadata, checks, nil)
}

func checkOpenAI(_ context.Context, cfg RuntimeConfig, metadata Metadata) CheckResult {
	providerConfig, configPath, configErr := loadProviderConfig(cfg, metadata.ID)
	baseURL := openAIBaseURL(providerConfig)
	details := map[string]any{
		"config_path":                configPath,
		"live_network":               false,
		"base_url":                   baseURL,
		"auth_decided_by_live_check": true,
	}
	if configErr != nil {
		check := Check{
			Name:       "config",
			OK:         false,
			Status:     StatusInvalidConfig,
			Message:    "OpenAI config could not be read: " + configErr.Error(),
			ActionHint: "Fix FAST_SUB_GO_CONFIG or fast-sub-go.toml before selecting this provider.",
		}
		return summarize(metadata, []Check{check}, details)
	}
	keyName := openAIKeyName(cfg, metadata.ID, providerConfig)
	hasKey := keyName != "" && cfg.Env(keyName) != ""
	check := Check{
		Name:       "api_key",
		OK:         true,
		Status:     StatusAvailable,
		Message:    "OpenAI-compatible provider config is present. Live connectivity decides whether authentication is required.",
		ActionHint: "Use the live Provider check to verify the endpoint and credentials before running large jobs.",
	}
	if hasKey {
		check.Message = "OpenAI-compatible provider config and credential alias are present."
	}
	details["api_key_env"] = keyName
	details["api_key_configured"] = hasKey
	return summarize(metadata, []Check{check}, details)
}

func checkLocalNLLB(ctx context.Context, cfg RuntimeConfig, metadata Metadata) CheckResult {
	checks := []Check{
		checkLocalTranslateDependencies(ctx, cfg),
		checkModel(cfg, metadata.ID, envFirst(cfg, "FAST_SUB_NLLB_MODEL_PATH", "FAST_SUB_TRANSLATION_MODEL_PATH"), false, "Install a compatible model with `fast-sub-go models install nllb-200-distilled-600m-ct2-int8`, or set FAST_SUB_NLLB_MODEL_PATH."),
	}
	return summarize(metadata, checks, nil)
}

func checkOpenAIChat(ctx context.Context, cfg RuntimeConfig, metadata Metadata) CheckResult {
	return checkOpenAI(ctx, cfg, metadata)
}

func checkOpenAILive(ctx context.Context, cfg RuntimeConfig, metadata Metadata) CheckResult {
	providerConfig, configPath, configErr := loadProviderConfig(cfg, metadata.ID)
	baseURL := openAIBaseURL(providerConfig)
	details := map[string]any{
		"config_path":                configPath,
		"live_network":               true,
		"base_url":                   baseURL,
		"static_only":                false,
		"auth_decided_by_live_check": true,
	}
	if configErr != nil {
		check := Check{Name: "config", OK: false, Status: StatusInvalidConfig, Message: "OpenAI config could not be read: " + configErr.Error(), ActionHint: "Fix FAST_SUB_GO_CONFIG or fast-sub-go.toml before selecting this provider."}
		return summarizeWithMode(metadata, []Check{check}, details, CheckModeLive)
	}

	keyName := openAIKeyName(cfg, metadata.ID, providerConfig)
	keyValue := ""
	if keyName != "" {
		keyValue = cfg.Env(keyName)
	}
	details["api_key_env"] = keyName
	details["api_key_configured"] = keyValue != ""

	checkCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	endpoint := strings.TrimRight(baseURL, "/") + "/models"
	req, err := http.NewRequestWithContext(checkCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		check := Check{Name: "models_endpoint", OK: false, Status: StatusInvalidConfig, Message: "OpenAI-compatible Base URL is not valid.", ActionHint: "Check the Provider Base URL and retry."}
		return summarizeWithMode(metadata, []Check{check}, details, CheckModeLive)
	}
	if keyValue != "" {
		req.Header.Set("Authorization", "Bearer "+keyValue)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		check := Check{Name: "models_endpoint", OK: false, Status: StatusInvalidConfig, Message: "OpenAI-compatible endpoint could not be reached.", ActionHint: "Start the local API server or check the Base URL."}
		return summarizeWithMode(metadata, []Check{check}, details, CheckModeLive)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1024))
	details["http_status"] = resp.StatusCode
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		check := Check{Name: "api_key", OK: false, Status: StatusMissingAPIKey, Message: "OpenAI-compatible endpoint rejected the current API key.", ActionHint: "Save a valid key, or leave the key empty only if this local endpoint accepts unauthenticated requests."}
		return summarizeWithMode(metadata, []Check{check}, details, CheckModeLive)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		check := Check{Name: "models_endpoint", OK: false, Status: StatusInvalidConfig, Message: "OpenAI-compatible endpoint returned an unexpected status.", ActionHint: "Check the Base URL and model provider."}
		return summarizeWithMode(metadata, []Check{check}, details, CheckModeLive)
	}
	check := Check{Name: "models_endpoint", OK: true, Status: StatusAvailable, Message: "OpenAI-compatible endpoint responded successfully."}
	return summarizeWithMode(metadata, []Check{check}, details, CheckModeLive)
}

func checkAlwaysAvailable(_ context.Context, _ RuntimeConfig, metadata Metadata) CheckResult {
	return summarize(metadata, []Check{{Name: "static", OK: true, Status: StatusAvailable, Message: "Provider metadata is available. Live use requires explicit upload confirmation."}}, map[string]any{"live_network": false})
}

func loadProviderConfig(cfg RuntimeConfig, providerID string) (appconfig.OpenAIProviderConfig, string, error) {
	loaded, path, err := appconfig.Load("", cfg.Env)
	if err != nil {
		return appconfig.OpenAIProviderConfig{}, path, err
	}
	if providerConfig, ok := loaded.OpenAIProviders[providerID]; ok {
		return providerConfig, path, nil
	}
	if providerID != "api-openai-transcription" {
		return appconfig.OpenAIProviderConfig{}, path, nil
	}
	return loaded.OpenAI, path, nil
}

func openAIKeyName(cfg RuntimeConfig, providerID string, providerConfig appconfig.OpenAIProviderConfig) string {
	if providerConfig.APIKeyEnv != "" {
		return normalizeOpenAIKeyEnvForProvider(providerConfig.APIKeyEnv, providerID)
	}
	switch providerID {
	case "api-openai-chat":
		if envFirst(cfg, "FAST_SUB_OPENAI_CHAT_API_KEY") != "" {
			return "FAST_SUB_OPENAI_CHAT_API_KEY"
		}
	case "api-openai-transcription":
		if envFirst(cfg, "FAST_SUB_OPENAI_TRANSCRIPTION_API_KEY") != "" {
			return "FAST_SUB_OPENAI_TRANSCRIPTION_API_KEY"
		}
	}
	if envFirst(cfg, "FAST_SUB_OPENAI_API_KEY") != "" {
		return "FAST_SUB_OPENAI_API_KEY"
	}
	return "OPENAI_API_KEY"
}

func normalizeOpenAIKeyEnvForProvider(value string, providerID string) string {
	if value != "openai-default" {
		return value
	}
	switch providerID {
	case "api-openai-chat":
		return "FAST_SUB_OPENAI_CHAT_API_KEY"
	case "api-openai-transcription":
		return "FAST_SUB_OPENAI_TRANSCRIPTION_API_KEY"
	default:
		return "FAST_SUB_OPENAI_API_KEY"
	}
}

func openAIBaseURL(providerConfig appconfig.OpenAIProviderConfig) string {
	if providerConfig.BaseURL != "" {
		return providerConfig.BaseURL
	}
	return "https://api.openai.com/v1"
}

func checkCommand(cfg RuntimeConfig, name, explicitCommand, pathName, actionHint string) Check {
	if explicitCommand != "" {
		parts := splitCommandLine(explicitCommand)
		if len(parts) == 0 {
			return Check{Name: name, OK: false, Status: StatusMissingDependency, Message: name + " command is empty.", ActionHint: actionHint}
		}
		if _, err := cfg.LookPath(parts[0]); err == nil {
			return Check{Name: name, OK: true, Status: StatusAvailable, Message: name + " command is configured and resolvable."}
		}
		return Check{Name: name, OK: false, Status: StatusMissingDependency, Message: name + " command is configured but was not found.", ActionHint: actionHint}
	}
	if _, err := cfg.LookPath(pathName); err == nil {
		return Check{Name: name, OK: true, Status: StatusAvailable, Message: name + " was found on PATH."}
	}
	return Check{Name: name, OK: false, Status: StatusMissingDependency, Message: name + " was not found.", ActionHint: actionHint}
}

func checkWhisperCPPCommand(cfg RuntimeConfig) Check {
	actionHint := "Install whisper.cpp, set FAST_SUB_WHISPER_CPP_COMMAND, or install whisper-cli on PATH."
	if explicitCommand := envFirst(cfg, "FAST_SUB_WHISPER_CPP_COMMAND"); explicitCommand != "" {
		return checkCommand(cfg, "binary", explicitCommand, "whisper-cli", actionHint)
	}
	for _, pathName := range []string{"whisper-cli", "main", "whisper-cpp"} {
		if _, err := cfg.LookPath(pathName); err == nil {
			return Check{Name: "binary", OK: true, Status: StatusAvailable, Message: "whisper.cpp binary was found on PATH."}
		}
	}
	return Check{Name: "binary", OK: false, Status: StatusMissingDependency, Message: "whisper.cpp binary was not found.", ActionHint: actionHint}
}

func checkSTTWorkerCommand(cfg RuntimeConfig) Check {
	actionHint := "Install the local ASR extra with `uv sync --extra local-asr`, set FAST_SUB_STT_WORKER_COMMAND, or install fast-sub-worker-faster-whisper on PATH."
	if explicit := envFirst(cfg, "FAST_SUB_STT_WORKER_COMMAND"); explicit != "" {
		parts := splitCommandLine(explicit)
		if len(parts) == 0 {
			return Check{Name: "worker", OK: false, Status: StatusMissingDependency, Message: "STT worker command is empty.", ActionHint: actionHint}
		}
		if _, err := cfg.LookPath(parts[0]); err == nil {
			return Check{Name: "worker", OK: true, Status: StatusAvailable, Message: "STT worker command is configured and resolvable."}
		}
		return Check{Name: "worker", OK: false, Status: StatusMissingDependency, Message: "STT worker command is configured but was not found.", ActionHint: actionHint}
	}
	if _, err := cfg.LookPath("fast-sub-worker-faster-whisper"); err == nil {
		return Check{Name: "worker", OK: true, Status: StatusAvailable, Message: "fast-sub-worker-faster-whisper was found on PATH."}
	}
	if _, err := cfg.LookPath("uv"); err == nil {
		return Check{Name: "worker", OK: true, Status: StatusAvailable, Message: "uv can run fast-sub-worker-faster-whisper with the local-asr extra."}
	}
	return Check{Name: "worker", OK: false, Status: StatusMissingDependency, Message: "STT worker was not found.", ActionHint: actionHint}
}

func checkModel(cfg RuntimeConfig, providerID, modelPath string, allowFile bool, actionHint string) Check {
	if modelPath != "" {
		return checkModelPath(cfg, modelPath, allowFile, actionHint)
	}
	resolution := cfg.ModelResolver(providerID)
	if resolution.OK {
		return Check{Name: "model", OK: true, Status: StatusAvailable, Message: resolution.Message}
	}
	if resolution.ActionHint != "" {
		actionHint = resolution.ActionHint
	}
	message := resolution.Message
	if message == "" {
		message = "No compatible installed model was found."
	}
	return Check{Name: "model", OK: false, Status: StatusMissingModel, Message: message, ActionHint: actionHint}
}

func checkModelPath(cfg RuntimeConfig, modelPath string, allowFile bool, actionHint string) Check {
	if modelPath == "" {
		return Check{Name: "model", OK: false, Status: StatusMissingModel, Message: "No local model path is configured.", ActionHint: actionHint}
	}
	info, err := cfg.Stat(modelPath)
	if err != nil {
		return Check{Name: "model", OK: false, Status: StatusMissingModel, Message: "Configured local model path is not accessible.", ActionHint: actionHint}
	}
	if !info.IsDir() {
		if !allowFile {
			return Check{Name: "model", OK: false, Status: StatusMissingModel, Message: "Configured local model path is not a directory.", ActionHint: actionHint}
		}
		return Check{Name: "model", OK: true, Status: StatusAvailable, Message: "Configured local model file is accessible."}
	}
	return Check{Name: "model", OK: true, Status: StatusAvailable, Message: "Configured local model directory is accessible."}
}

func checkLocalTranslateDependencies(ctx context.Context, cfg RuntimeConfig) Check {
	command, args, ok := localTranslateDependencyCommand(cfg)
	actionHint := "Install the local translation extra with `uv sync --extra local-translate`, or choose a configured web/API translation Provider."
	if !ok {
		return Check{Name: "python_dependencies", OK: false, Status: StatusMissingDependency, Message: "Python runtime for local translation was not found.", ActionHint: actionHint}
	}
	checkCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	if err := cfg.RunCommand(checkCtx, command, args); err != nil {
		return Check{Name: "python_dependencies", OK: false, Status: StatusMissingDependency, Message: "local-nllb-ct2 requires ctranslate2 and sentencepiece.", ActionHint: actionHint}
	}
	return Check{Name: "python_dependencies", OK: true, Status: StatusAvailable, Message: "Local translation Python dependencies are available."}
}

func checkFasterWhisperDependencies(ctx context.Context, cfg RuntimeConfig) Check {
	command, args, ok := localASRDependencyCommand(cfg)
	actionHint := "Install the local ASR extra with `uv sync --extra local-asr`, or choose another ASR Provider."
	if !ok {
		return Check{Name: "python_dependencies", OK: false, Status: StatusMissingDependency, Message: "Python runtime for local ASR was not found.", ActionHint: actionHint}
	}
	checkCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	if err := cfg.RunCommand(checkCtx, command, args); err != nil {
		return Check{Name: "python_dependencies", OK: false, Status: StatusMissingDependency, Message: "local-faster-whisper requires the faster-whisper Python package.", ActionHint: actionHint}
	}
	return Check{Name: "python_dependencies", OK: true, Status: StatusAvailable, Message: "Local ASR Python dependencies are available."}
}

func localASRDependencyCommand(cfg RuntimeConfig) (string, []string, bool) {
	snippet := "import faster_whisper"
	if configured := strings.TrimSpace(cfg.Env("FAST_SUB_STT_WORKER_COMMAND")); configured != "" {
		parts := splitCommandLine(configured)
		if len(parts) == 0 {
			return "", nil, false
		}
		if isUVCommand(parts[0]) {
			args := replaceArg(parts[1:], "fast-sub-worker-faster-whisper", "python")
			args = withUVExtra(args, "local-asr")
			if !hasString(args, "python") {
				args = append(args, "python")
			}
			args = append(args, "-c", snippet)
			return parts[0], args, true
		}
		if strings.HasPrefix(strings.ToLower(filepath.Base(parts[0])), "python") || strings.EqualFold(filepath.Base(parts[0]), "py.exe") {
			return parts[0], append(parts[1:], "-c", snippet), true
		}
	}
	if uv, err := cfg.LookPath("uv"); err == nil {
		return uv, []string{"run", "--extra", "local-asr", "python", "-c", snippet}, true
	}
	if python, err := cfg.LookPath("python"); err == nil {
		return python, []string{"-c", snippet}, true
	}
	if py, err := cfg.LookPath("py"); err == nil {
		return py, []string{"-3", "-c", snippet}, true
	}
	return "", nil, false
}

func localTranslateDependencyCommand(cfg RuntimeConfig) (string, []string, bool) {
	snippet := "import ctranslate2, sentencepiece"
	if configured := strings.TrimSpace(cfg.Env("FAST_SUB_PYTHON_CLI")); configured != "" {
		parts := splitCommandLine(configured)
		if len(parts) == 0 {
			return "", nil, false
		}
		if strings.Contains(strings.ToLower(filepath.Base(parts[0])), "uv") {
			args := replaceArg(parts[1:], "fast-sub", "python")
			args = withUVExtra(args, "local-translate")
			if !hasString(args, "python") {
				args = append(args, "python")
			}
			args = append(args, "-c", snippet)
			return parts[0], args, true
		}
		if strings.HasPrefix(strings.ToLower(filepath.Base(parts[0])), "python") || strings.EqualFold(filepath.Base(parts[0]), "py.exe") {
			return parts[0], append(parts[1:], "-c", snippet), true
		}
	}
	if uv, err := cfg.LookPath("uv"); err == nil {
		return uv, []string{"run", "--extra", "local-translate", "python", "-c", snippet}, true
	}
	if python, err := cfg.LookPath("python"); err == nil {
		return python, []string{"-c", snippet}, true
	}
	if py, err := cfg.LookPath("py"); err == nil {
		return py, []string{"-3", "-c", snippet}, true
	}
	return "", nil, false
}

func withUVExtra(args []string, extra string) []string {
	out := append([]string(nil), args...)
	if hasUVExtra(out, extra) {
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

func isUVCommand(command string) bool {
	return strings.EqualFold(filepath.Base(command), "uv") || strings.EqualFold(filepath.Base(command), "uv.exe")
}

func replaceArg(values []string, oldValue, newValue string) []string {
	out := append([]string(nil), values...)
	for i := len(out) - 1; i >= 0; i-- {
		if out[i] == oldValue {
			out[i] = newValue
			return out
		}
	}
	return out
}

func resolveInstalledModel(providerID string) ModelResolution {
	manifest, err := models.LoadManifest("")
	if err != nil {
		return ModelResolution{Message: "Model manifest could not be loaded.", ActionHint: "Check FAST_SUB_GO_MODEL_MANIFEST or use the built-in manifest."}
	}
	store := models.DefaultStore()
	for _, entry := range manifest.Models {
		if !hasString(entry.CompatibleProviders, providerID) || !entry.SupportedOnCurrentPlatform() {
			continue
		}
		status := store.Verify(entry)
		if status.Installed {
			return ModelResolution{
				OK:      true,
				Path:    status.Path,
				Message: "Compatible Go-managed model is installed.",
			}
		}
	}
	return ModelResolution{
		Message:    "No compatible Go-managed model is installed.",
		ActionHint: "Install a compatible model with `fast-sub-go models install <id>`.",
	}
}

func hasString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func summarize(metadata Metadata, checks []Check, details map[string]any) CheckResult {
	return summarizeWithMode(metadata, checks, details, CheckModeStatic)
}

func summarizeWithMode(metadata Metadata, checks []Check, details map[string]any, mode string) CheckResult {
	status := StatusAvailable
	actionHint := ""
	warnings := []string{}
	for _, check := range checks {
		if check.OK {
			continue
		}
		if status == StatusAvailable {
			status = check.Status
			actionHint = check.ActionHint
		}
		warnings = append(warnings, check.Message)
	}
	if details == nil {
		details = map[string]any{}
	}
	if _, ok := details["static_only"]; !ok {
		details["static_only"] = mode != CheckModeLive
	}
	return CheckResult{
		ProviderID: metadata.ID,
		Status:     status,
		CheckMode:  mode,
		Available:  status == StatusAvailable,
		Metadata:   metadata,
		Checks:     checks,
		Warnings:   warnings,
		ActionHint: actionHint,
		Details:    details,
	}
}

func envFirst(cfg RuntimeConfig, keys ...string) string {
	for _, key := range keys {
		if value := cfg.Env(key); value != "" {
			return value
		}
	}
	return ""
}

func runCommand(ctx context.Context, command string, args []string) error {
	cmd := exec.CommandContext(ctx, command, args...)
	cmd.Env = os.Environ()
	if os.Getenv("UV_CACHE_DIR") == "" {
		cmd.Env = append(cmd.Env, "UV_CACHE_DIR=.uv-cache")
	}
	return cmd.Run()
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
