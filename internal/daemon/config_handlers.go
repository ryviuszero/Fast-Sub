package daemon

import (
	"encoding/json"
	"net/http"

	appconfig "fast-sub/internal/config"
	fserrors "fast-sub/internal/errors"
)

type configView struct {
	ConfigSchemaVersion        int            `json:"config_schema_version"`
	Language                   string         `json:"language"`
	OutputDirectory            string         `json:"output_directory"`
	OutputConflict             string         `json:"output_conflict"`
	Device                     string         `json:"device"`
	DefaultASRProvider         string         `json:"default_asr_provider"`
	DefaultTranslationProvider string         `json:"default_translation_provider"`
	DefaultASRModel            string         `json:"default_asr_model"`
	DefaultTranslationModel    string         `json:"default_translation_model"`
	WordTimestamps             bool           `json:"word_timestamps"`
	KeepTemp                   bool           `json:"keep_temp"`
	OpenAICompatible           map[string]any `json:"openai_compatible"`
}

type configPatchRequest struct {
	SchemaVersion int            `json:"schema_version"`
	Patch         map[string]any `json:"patch"`
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeOK(w, s.configView())
	case http.MethodPatch:
		var req configPatchRequest
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
		if err := decoder.Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, fserrors.New(fserrors.CodeInvalidInput, "config", "request body is invalid JSON.", "", nil))
			return
		}
		if appErr := validateConfigPatch(req.Patch); appErr != nil {
			writeAppError(w, appErr)
			return
		}
		// Round 12 exposes the daemon-owned config boundary. Persistence remains
		// backed by the existing Go config loader until the broader config writer lands.
		writeOK(w, mergeConfigView(s.configView(), req.Patch))
	default:
		writeError(w, http.StatusNotFound, unknownRoute())
	}
}

func (s *Server) configView() configView {
	loaded, _, _ := appconfig.Load("", nil)
	openai := map[string]any{
		"base_url":       stringDefault(loaded.OpenAI.BaseURL, "https://api.openai.com/v1"),
		"model":          loaded.OpenAI.Model,
		"upload_format":  stringDefault(loaded.OpenAI.APIUploadFormat, "wav"),
		"api_key_alias":  stringDefault(loaded.OpenAI.APIKeyEnv, "openai-default"),
		"api_key_status": "missing",
	}
	if loaded.OpenAI.APIKeyEnv != "" {
		openai["api_key_status"] = "configured"
	}
	return configView{
		ConfigSchemaVersion:        1,
		Language:                   "auto",
		OutputDirectory:            "source",
		OutputConflict:             "ask",
		Device:                     "auto",
		DefaultASRProvider:         "local-faster-whisper",
		DefaultTranslationProvider: "local-nllb-ct2",
		DefaultASRModel:            "whisper-small",
		DefaultTranslationModel:    "nllb-ct2-base",
		WordTimestamps:             false,
		KeepTemp:                   false,
		OpenAICompatible:           openai,
	}
}

func validateConfigPatch(patch map[string]any) *fserrors.AppError {
	if patch == nil {
		return nil
	}
	if value, ok := patch["device"].(string); ok {
		switch value {
		case "auto", "cpu", "cuda", "gpu":
		default:
			return fserrors.New("invalid_config", "config", "configuration patch is invalid.", "Review the highlighted settings and try again.", map[string]any{
				"fields": []map[string]string{{"path": "device", "code": "unsupported_value", "message": "device must be one of auto, cpu, cuda."}},
			})
		}
	}
	if openai, ok := patch["openai_compatible"].(map[string]any); ok {
		if _, hasRaw := openai["api_key"]; hasRaw {
			return fserrors.New("invalid_config", "config", "raw api_key is not accepted in config.", "Save API keys with the desktop secret storage.", nil)
		}
	}
	return nil
}

func mergeConfigView(view configView, patch map[string]any) configView {
	for key, value := range patch {
		switch key {
		case "language":
			if typed, ok := value.(string); ok {
				view.Language = typed
			}
		case "output_directory":
			if typed, ok := value.(string); ok {
				view.OutputDirectory = typed
			}
		case "output_conflict":
			if typed, ok := value.(string); ok {
				view.OutputConflict = typed
			}
		case "device":
			if typed, ok := value.(string); ok {
				view.Device = typed
			}
		case "default_asr_provider":
			if typed, ok := value.(string); ok {
				view.DefaultASRProvider = typed
			}
		case "default_translation_provider":
			if typed, ok := value.(string); ok {
				view.DefaultTranslationProvider = typed
			}
		case "default_asr_model":
			if typed, ok := value.(string); ok {
				view.DefaultASRModel = typed
			}
		case "default_translation_model":
			if typed, ok := value.(string); ok {
				view.DefaultTranslationModel = typed
			}
		case "word_timestamps":
			if typed, ok := value.(bool); ok {
				view.WordTimestamps = typed
			}
		case "keep_temp":
			if typed, ok := value.(bool); ok {
				view.KeepTemp = typed
			}
		case "openai_compatible":
			if typed, ok := value.(map[string]any); ok {
				for openAIKey, openAIValue := range typed {
					if openAIValue != nil && openAIKey != "api_key" {
						view.OpenAICompatible[openAIKey] = openAIValue
					}
				}
			}
		}
	}
	return view
}

func stringDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
