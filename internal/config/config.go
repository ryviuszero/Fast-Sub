// Package config loads small Go-side configuration files.
package config

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// AppConfig contains supported fast-sub-go settings.
type AppConfig struct {
	OpenAI          OpenAIProviderConfig
	OpenAIProviders map[string]OpenAIProviderConfig
	UI              UIConfig
}

// OpenAIProviderConfig contains non-secret OpenAI-compatible STT settings.
type OpenAIProviderConfig struct {
	Model           string
	APIKeyEnv       string
	BaseURL         string
	APIUploadFormat string
	Words           *bool
}

// UIConfig contains daemon-owned non-secret desktop preferences.
type UIConfig struct {
	Language                    string
	TargetLanguage              string
	OutputDirectory             string
	OutputConflict              string
	OutputFormat                string
	OutputType                  string
	BurnInVideo                 *bool
	Device                      string
	DefaultASRProvider          string
	DefaultTranslationProvider  string
	DefaultASRModel             string
	DefaultTranslationModel     string
	WordTimestamps              *bool
	KeepTemp                    *bool
	FolderScanIncludeSubfolders *bool
	FolderScanMaxFiles          int
}

// ResolvePath applies the Go config lookup order.
func ResolvePath(explicitPath string, env func(string) string) (string, error) {
	if env == nil {
		env = os.Getenv
	}
	if explicitPath != "" {
		return explicitPath, nil
	}
	if path := env("FAST_SUB_GO_CONFIG"); path != "" {
		return path, nil
	}
	defaultPath := filepath.Join(".", "fast-sub-go.toml")
	if _, err := os.Stat(defaultPath); err == nil {
		return defaultPath, nil
	} else if os.IsNotExist(err) {
		return "", nil
	} else {
		return "", fmt.Errorf("inspect default config file: %w", err)
	}
}

// Load reads the config file after applying the standard lookup order.
func Load(explicitPath string, env func(string) string) (AppConfig, string, error) {
	path, err := ResolvePath(explicitPath, env)
	if err != nil || path == "" {
		return AppConfig{}, path, err
	}
	cfg, err := ParseFile(path)
	return cfg, path, err
}

// ResolveWritePath returns the path that may be written by config APIs.
func ResolveWritePath(explicitPath string, env func(string) string) (string, error) {
	if env == nil {
		env = os.Getenv
	}
	if explicitPath != "" {
		return explicitPath, nil
	}
	if path := env("FAST_SUB_GO_CONFIG"); path != "" {
		return path, nil
	}
	defaultPath := filepath.Join(".", "fast-sub-go.toml")
	if _, err := os.Stat(defaultPath); err == nil {
		return defaultPath, nil
	} else if os.IsNotExist(err) {
		return "", nil
	} else {
		return "", fmt.Errorf("inspect default config file: %w", err)
	}
}

// Save writes supported non-secret config values.
func Save(path string, cfg AppConfig) error {
	if path == "" {
		return nil
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil && dir != "." {
		return fmt.Errorf("create config directory: %w", err)
	}
	var out strings.Builder
	writeUIConfig(&out, cfg.UI)
	if len(cfg.OpenAIProviders) == 0 {
		writeOpenAIConfig(&out, cfg.OpenAI)
	} else {
		if providerCfg, ok := cfg.OpenAIProviders["api-openai-transcription"]; ok {
			writeOpenAIProviderConfig(&out, "api-openai-transcription", providerCfg)
		} else {
			writeOpenAIConfig(&out, cfg.OpenAI)
		}
		if providerCfg, ok := cfg.OpenAIProviders["api-openai-chat"]; ok {
			writeOpenAIProviderConfig(&out, "api-openai-chat", providerCfg)
		}
	}
	file, err := os.CreateTemp(dir, ".fast-sub-go-*.toml")
	if err != nil {
		return fmt.Errorf("create temporary config file: %w", err)
	}
	tempPath := file.Name()
	defer func() { _ = os.Remove(tempPath) }()
	if _, err := file.WriteString(out.String()); err != nil {
		_ = file.Close()
		return fmt.Errorf("write temporary config file: %w", err)
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return fmt.Errorf("flush temporary config file: %w", err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close temporary config file: %w", err)
	}
	if err := os.Chmod(tempPath, 0o600); err != nil {
		return fmt.Errorf("set config file permissions: %w", err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		if removeErr := os.Remove(path); removeErr != nil && !os.IsNotExist(removeErr) {
			return fmt.Errorf("replace config file: %w", err)
		}
		if retryErr := os.Rename(tempPath, path); retryErr != nil {
			return fmt.Errorf("replace config file: %w", retryErr)
		}
	}
	return nil
}

// ParseFile reads one config file.
func ParseFile(path string) (AppConfig, error) {
	file, err := os.Open(path)
	if err != nil {
		return AppConfig{}, err
	}
	defer file.Close()

	var cfg AppConfig
	section := ""
	scanner := bufio.NewScanner(file)
	for lineNo := 1; scanner.Scan(); lineNo++ {
		line := stripComment(strings.TrimSpace(scanner.Text()))
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			section = strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(line, "["), "]"))
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			return AppConfig{}, fmt.Errorf("line %d: expected key = value", lineNo)
		}
		key = strings.TrimSpace(key)
		parsedValue, err := parseConfigValue(strings.TrimSpace(value))
		if err != nil {
			return AppConfig{}, fmt.Errorf("line %d: %w", lineNo, err)
		}
		if providerID, ok := openAISectionID(section); ok {
			if cfg.OpenAIProviders == nil {
				cfg.OpenAIProviders = map[string]OpenAIProviderConfig{}
			}
			providerCfg := cfg.OpenAIProviders[providerID]
			if err := applyOpenAIKey(&providerCfg, lineNo, key, parsedValue); err != nil {
				return AppConfig{}, err
			}
			cfg.OpenAIProviders[providerID] = providerCfg
			if providerID == "api-openai-transcription" {
				cfg.OpenAI = providerCfg
			}
		} else if isUISection(section) {
			if err := applyUIKey(&cfg.UI, lineNo, key, parsedValue); err != nil {
				return AppConfig{}, err
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return AppConfig{}, err
	}
	return cfg, nil
}

func applyOpenAIKey(cfg *OpenAIProviderConfig, lineNo int, key, value string) error {
	switch key {
	case "model":
		cfg.Model = value
	case "api_key_env":
		cfg.APIKeyEnv = value
	case "base_url":
		cfg.BaseURL = value
	case "api_upload_format":
		cfg.APIUploadFormat = value
	case "words":
		parsedBool, err := parseConfigBool(value)
		if err != nil {
			return fmt.Errorf("line %d: %w", lineNo, err)
		}
		cfg.Words = &parsedBool
	case "api_key":
		return fmt.Errorf("line %d: api_key is not supported in config files; use api_key_env", lineNo)
	default:
		return fmt.Errorf("line %d: unsupported OpenAI config key %q", lineNo, key)
	}
	return nil
}

func applyUIKey(cfg *UIConfig, lineNo int, key, value string) error {
	switch key {
	case "schema_version":
		if value != "1" {
			return fmt.Errorf("line %d: unsupported UI config schema_version %q", lineNo, value)
		}
	case "language":
		cfg.Language = value
	case "target_language":
		cfg.TargetLanguage = value
	case "output_directory":
		cfg.OutputDirectory = value
	case "output_conflict":
		cfg.OutputConflict = value
	case "output_format":
		cfg.OutputFormat = value
	case "output_type":
		cfg.OutputType = value
	case "burn_in_video":
		parsedBool, err := parseConfigBool(value)
		if err != nil {
			return fmt.Errorf("line %d: %w", lineNo, err)
		}
		cfg.BurnInVideo = &parsedBool
	case "device":
		cfg.Device = value
	case "default_asr_provider":
		cfg.DefaultASRProvider = value
	case "default_translation_provider":
		cfg.DefaultTranslationProvider = value
	case "default_asr_model":
		cfg.DefaultASRModel = value
	case "default_translation_model":
		cfg.DefaultTranslationModel = value
	case "word_timestamps":
		parsedBool, err := parseConfigBool(value)
		if err != nil {
			return fmt.Errorf("line %d: %w", lineNo, err)
		}
		cfg.WordTimestamps = &parsedBool
	case "keep_temp":
		parsedBool, err := parseConfigBool(value)
		if err != nil {
			return fmt.Errorf("line %d: %w", lineNo, err)
		}
		cfg.KeepTemp = &parsedBool
	case "folder_scan_include_subfolders":
		parsedBool, err := parseConfigBool(value)
		if err != nil {
			return fmt.Errorf("line %d: %w", lineNo, err)
		}
		cfg.FolderScanIncludeSubfolders = &parsedBool
	case "folder_scan_max_files":
		parsedInt, err := parseConfigInt(value)
		if err != nil {
			return fmt.Errorf("line %d: %w", lineNo, err)
		}
		cfg.FolderScanMaxFiles = parsedInt
	default:
		return fmt.Errorf("line %d: unsupported UI config key %q", lineNo, key)
	}
	return nil
}

func parseConfigInt(value string) (int, error) {
	if value == "" {
		return 0, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("expected integer")
	}
	return parsed, nil
}

func parseConfigBool(value string) (bool, error) {
	switch strings.ToLower(value) {
	case "true":
		return true, nil
	case "false":
		return false, nil
	default:
		return false, fmt.Errorf("expected true or false")
	}
}

func openAISectionID(section string) (string, bool) {
	switch section {
	case "providers.api-openai-transcription", "api-openai-transcription", "openai":
		return "api-openai-transcription", true
	case "providers.api-openai-chat", "api-openai-chat":
		return "api-openai-chat", true
	default:
		return "", false
	}
}

func isUISection(section string) bool {
	switch section {
	case "ui", "desktop", "daemon.ui":
		return true
	default:
		return false
	}
}

func writeUIConfig(out *strings.Builder, cfg UIConfig) {
	out.WriteString("[ui]\n")
	out.WriteString("schema_version = 1\n")
	writeStringValue(out, "language", cfg.Language)
	writeStringValue(out, "target_language", cfg.TargetLanguage)
	writeStringValue(out, "output_directory", cfg.OutputDirectory)
	writeStringValue(out, "output_conflict", cfg.OutputConflict)
	writeStringValue(out, "output_format", cfg.OutputFormat)
	writeStringValue(out, "output_type", cfg.OutputType)
	writeBoolValue(out, "burn_in_video", cfg.BurnInVideo)
	writeStringValue(out, "device", cfg.Device)
	writeStringValue(out, "default_asr_provider", cfg.DefaultASRProvider)
	writeStringValue(out, "default_translation_provider", cfg.DefaultTranslationProvider)
	writeStringValue(out, "default_asr_model", cfg.DefaultASRModel)
	writeStringValue(out, "default_translation_model", cfg.DefaultTranslationModel)
	writeBoolValue(out, "word_timestamps", cfg.WordTimestamps)
	writeBoolValue(out, "keep_temp", cfg.KeepTemp)
	writeBoolValue(out, "folder_scan_include_subfolders", cfg.FolderScanIncludeSubfolders)
	if cfg.FolderScanMaxFiles > 0 {
		out.WriteString("folder_scan_max_files = ")
		out.WriteString(fmt.Sprintf("%d\n", cfg.FolderScanMaxFiles))
	}
	out.WriteByte('\n')
}

func writeOpenAIConfig(out *strings.Builder, cfg OpenAIProviderConfig) {
	writeOpenAIProviderConfig(out, "api-openai-transcription", cfg)
}

func writeOpenAIProviderConfig(out *strings.Builder, providerID string, cfg OpenAIProviderConfig) {
	if cfg.Model == "" && cfg.APIKeyEnv == "" && cfg.BaseURL == "" && cfg.APIUploadFormat == "" && cfg.Words == nil {
		return
	}
	out.WriteString("[providers.")
	out.WriteString(providerID)
	out.WriteString("]\n")
	writeStringValue(out, "model", cfg.Model)
	writeStringValue(out, "api_key_env", cfg.APIKeyEnv)
	writeStringValue(out, "base_url", cfg.BaseURL)
	writeStringValue(out, "api_upload_format", cfg.APIUploadFormat)
	writeBoolValue(out, "words", cfg.Words)
	out.WriteByte('\n')
}

func writeStringValue(out *strings.Builder, key, value string) {
	if value == "" {
		return
	}
	out.WriteString(key)
	out.WriteString(" = ")
	out.WriteString(quoteConfigString(value))
	out.WriteByte('\n')
}

func writeBoolValue(out *strings.Builder, key string, value *bool) {
	if value == nil {
		return
	}
	out.WriteString(key)
	out.WriteString(" = ")
	if *value {
		out.WriteString("true\n")
	} else {
		out.WriteString("false\n")
	}
}

func quoteConfigString(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `\"`) + `"`
}

func stripComment(line string) string {
	inQuote := false
	for i, r := range line {
		switch r {
		case '"':
			inQuote = !inQuote
		case '#':
			if !inQuote {
				return strings.TrimSpace(line[:i])
			}
		}
	}
	return line
}

func parseConfigValue(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	if strings.HasPrefix(value, "\"") {
		if !strings.HasSuffix(value, "\"") || len(value) == 1 {
			return "", fmt.Errorf("unterminated quoted string")
		}
		return strings.ReplaceAll(value[1:len(value)-1], `\"`, `"`), nil
	}
	if strings.ContainsAny(value, " \t") {
		return "", fmt.Errorf("unquoted values must not contain whitespace")
	}
	return value, nil
}
