package jobs

import (
	"encoding/json"
	"strings"

	fserrors "fast-sub/internal/errors"
)

func sanitizeRequest(req CreateRequest) CreateRequest {
	req.Extra = nil
	options := map[string]any{}
	for key, value := range req.Options {
		options[key] = value
		if secretKey(key) {
			options[key] = "[redacted]"
		}
	}
	req.Options = options
	return req
}

func sanitizeAny(value any) any {
	raw, err := json.Marshal(value)
	if err != nil {
		return value
	}
	text := fserrors.Redact(string(raw))
	if text == "[redacted]" {
		return map[string]any{"message": "[redacted]"}
	}
	var decoded any
	if err := json.Unmarshal([]byte(text), &decoded); err != nil {
		return value
	}
	return decoded
}

func secretKey(key string) bool {
	lower := strings.ToLower(key)
	return strings.Contains(lower, "token") ||
		strings.Contains(lower, "secret") ||
		strings.Contains(lower, "api_key") ||
		strings.Contains(lower, "authorization")
}
