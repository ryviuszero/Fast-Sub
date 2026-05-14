package errors

import (
	"regexp"
	"strings"
)

var sensitiveMarkers = []string{
	"authorization",
	"api_key",
	"apikey",
	"token",
	"secret",
}

var (
	authorizationPattern = regexp.MustCompile(`(?i)(authorization\s*:\s*bearer\s+)([^\s,;"}]+)`)
	bearerPattern        = regexp.MustCompile(`(?i)\b(bearer\s+)([A-Za-z0-9._~+/=-]{8,})`)
	openAIKeyPattern     = regexp.MustCompile(`sk-[A-Za-z0-9_-]{8,}`)
	secretFieldPattern   = regexp.MustCompile(`(?i)((?:api[_-]?key|apikey|token|secret|secret_ref|secretref)["']?\s*[:=]\s*)(["']?)([^"'\s,;&}]+)(["']?)`)
)

// Redact removes obvious secret-bearing values from text.
func Redact(value string) string {
	if value == "" {
		return value
	}
	redacted := authorizationPattern.ReplaceAllString(value, `${1}[redacted]`)
	redacted = bearerPattern.ReplaceAllString(redacted, `${1}[redacted]`)
	redacted = openAIKeyPattern.ReplaceAllString(redacted, `sk-[redacted]`)
	redacted = secretFieldPattern.ReplaceAllString(redacted, `${1}${2}[redacted]${4}`)
	return redacted
}

// RedactMap recursively redacts secret-looking detail values.
func RedactMap(values map[string]any) map[string]any {
	redacted := make(map[string]any, len(values))
	for key, value := range values {
		lowerKey := strings.ToLower(key)
		secretKey := false
		for _, marker := range sensitiveMarkers {
			if strings.Contains(lowerKey, marker) {
				secretKey = true
				break
			}
		}
		if secretKey {
			redacted[key] = "[redacted]"
			continue
		}
		switch typed := value.(type) {
		case string:
			redacted[key] = Redact(typed)
		case map[string]any:
			redacted[key] = RedactMap(typed)
		default:
			redacted[key] = value
		}
	}
	return redacted
}
