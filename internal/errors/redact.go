package errors

import "strings"

var sensitiveMarkers = []string{
	"authorization",
	"api_key",
	"apikey",
	"token",
	"secret",
}

// Redact removes obvious secret-bearing values from text.
func Redact(value string) string {
	if value == "" {
		return value
	}
	lower := strings.ToLower(value)
	for _, marker := range sensitiveMarkers {
		if strings.Contains(lower, marker) {
			return "[redacted]"
		}
	}
	return value
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
