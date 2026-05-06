// Package providers owns the static provider registry used by fast-sub-go.
package providers

import (
	"context"
	"os"
	"os/exec"

	"fast-sub/internal/models"
)

const (
	// StatusAvailable means the provider can be selected by static checks.
	StatusAvailable = "available"
	// StatusMissingDependency means a required binary or worker was not found.
	StatusMissingDependency = "missing_dependency"
	// StatusMissingModel means the provider needs a local model path that is not configured or valid.
	StatusMissingModel = "missing_model"
	// StatusMissingAPIKey means an API provider has no configured API key.
	StatusMissingAPIKey = "missing_api_key"
	// StatusDisabled means the provider is intentionally disabled.
	StatusDisabled = "disabled"
	// StatusNotImplemented means metadata exists but runtime execution is not implemented.
	StatusNotImplemented = "not_implemented"

	CheckModeStatic = "static"
)

const (
	typeSTT = "stt"
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
		ModelResolver: resolveInstalledModel,
	}
}

// List returns all providers in stable UI order.
func List(ctx context.Context, cfg RuntimeConfig) []ListedProvider {
	cfg = normalizeConfig(cfg)
	registry := registry(cfg)
	ids := []string{"local-faster-whisper", "local-whisper-cpp", "api-openai-transcription"}
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
	cfg = normalizeConfig(cfg)
	registry := registry(cfg)
	provider, ok := registry[id]
	if !ok {
		return CheckResult{}, false
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
				RequiresAPIKey:         true,
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
	}
}

func checkFasterWhisper(_ context.Context, cfg RuntimeConfig, metadata Metadata) CheckResult {
	checks := []Check{
		checkCommand(cfg, "worker", envFirst(cfg, "FAST_SUB_STT_WORKER_COMMAND"), "fast-sub-worker-faster-whisper", "Set FAST_SUB_STT_WORKER_COMMAND or install fast-sub-worker-faster-whisper on PATH."),
		checkModel(cfg, metadata.ID, envFirst(cfg, "FAST_SUB_FASTER_WHISPER_MODEL_PATH", "FAST_SUB_MODEL_PATH"), false, "Install a compatible model with `fast-sub-go models install whisper-small`, or set FAST_SUB_FASTER_WHISPER_MODEL_PATH."),
	}
	return summarize(metadata, checks, nil)
}

func checkWhisperCPP(_ context.Context, cfg RuntimeConfig, metadata Metadata) CheckResult {
	checks := []Check{
		checkCommand(cfg, "binary", envFirst(cfg, "FAST_SUB_WHISPER_CPP_COMMAND"), "whisper-cli", "Set FAST_SUB_WHISPER_CPP_COMMAND or install whisper-cli on PATH."),
		checkModel(cfg, metadata.ID, envFirst(cfg, "FAST_SUB_WHISPER_CPP_MODEL_PATH", "FAST_SUB_MODEL_PATH"), true, "Install a compatible model with `fast-sub-go models install <id>`, or set FAST_SUB_WHISPER_CPP_MODEL_PATH."),
	}
	return summarize(metadata, checks, nil)
}

func checkOpenAI(_ context.Context, cfg RuntimeConfig, metadata Metadata) CheckResult {
	keyName := "OPENAI_API_KEY"
	if envFirst(cfg, "FAST_SUB_OPENAI_API_KEY") != "" {
		keyName = "FAST_SUB_OPENAI_API_KEY"
	}
	check := Check{
		Name:       "api_key",
		OK:         envFirst(cfg, "FAST_SUB_OPENAI_API_KEY", "OPENAI_API_KEY") != "",
		Status:     StatusAvailable,
		Message:    "API key is configured.",
		ActionHint: "",
	}
	if !check.OK {
		check.Status = StatusMissingAPIKey
		check.Message = "No OpenAI-compatible transcription API key is configured."
		check.ActionHint = "Set FAST_SUB_OPENAI_API_KEY or OPENAI_API_KEY before selecting this provider."
	}
	return summarize(metadata, []Check{check}, map[string]any{"api_key_env": keyName, "live_network": false})
}

func checkCommand(cfg RuntimeConfig, name, explicitCommand, pathName, actionHint string) Check {
	if explicitCommand != "" {
		if _, err := cfg.LookPath(explicitCommand); err == nil {
			return Check{Name: name, OK: true, Status: StatusAvailable, Message: name + " command is configured and resolvable."}
		}
		return Check{Name: name, OK: false, Status: StatusMissingDependency, Message: name + " command is configured but was not found.", ActionHint: actionHint}
	}
	if _, err := cfg.LookPath(pathName); err == nil {
		return Check{Name: name, OK: true, Status: StatusAvailable, Message: name + " was found on PATH."}
	}
	return Check{Name: name, OK: false, Status: StatusMissingDependency, Message: name + " was not found.", ActionHint: actionHint}
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
	details["static_only"] = true
	return CheckResult{
		ProviderID: metadata.ID,
		Status:     status,
		CheckMode:  CheckModeStatic,
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
