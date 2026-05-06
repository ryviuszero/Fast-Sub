// Package config loads small Go-side configuration files.
package config

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// AppConfig contains supported fast-sub-go settings.
type AppConfig struct {
	OpenAI OpenAIProviderConfig
}

// OpenAIProviderConfig contains non-secret OpenAI-compatible STT settings.
type OpenAIProviderConfig struct {
	Model           string
	APIKeyEnv       string
	BaseURL         string
	APIUploadFormat string
	Words           *bool
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
		if isOpenAISection(section) {
			if err := applyOpenAIKey(&cfg.OpenAI, lineNo, key, parsedValue); err != nil {
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

func isOpenAISection(section string) bool {
	switch section {
	case "providers.api-openai-transcription", "api-openai-transcription", "openai":
		return true
	default:
		return false
	}
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
