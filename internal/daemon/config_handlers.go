package daemon

import (
	"encoding/json"
	"net/http"

	appconfig "fast-sub/internal/config"
	fserrors "fast-sub/internal/errors"
)

type configView struct {
	ConfigSchemaVersion         int            `json:"config_schema_version"`
	Language                    string         `json:"language"`
	TargetLanguage              string         `json:"target_language"`
	OutputDirectory             string         `json:"output_directory"`
	OutputConflict              string         `json:"output_conflict"`
	OutputFormat                string         `json:"output_format"`
	OutputType                  string         `json:"output_type"`
	BurnInVideo                 bool           `json:"burn_in_video"`
	Device                      string         `json:"device"`
	DefaultASRProvider          string         `json:"default_asr_provider"`
	DefaultTranslationProvider  string         `json:"default_translation_provider"`
	DefaultASRModel             string         `json:"default_asr_model"`
	DefaultTranslationModel     string         `json:"default_translation_model"`
	WordTimestamps              bool           `json:"word_timestamps"`
	KeepTemp                    bool           `json:"keep_temp"`
	FolderScanIncludeSubfolders bool           `json:"folder_scan_include_subfolders"`
	FolderScanMaxFiles          int            `json:"folder_scan_max_files"`
	OpenAICompatible            map[string]any `json:"openai_compatible"`
	APIProviders                map[string]any `json:"api_providers"`
}

type configPatchRequest struct {
	SchemaVersion int            `json:"schema_version"`
	Patch         map[string]any `json:"patch"`
}

func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeOK(w, s.currentConfigView())
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
		s.configMu.Lock()
		s.runtimeConfig = mergeConfigView(s.runtimeConfig, req.Patch)
		view := s.runtimeConfig
		s.configMu.Unlock()
		if err := s.persistConfigView(view); err != nil {
			writeError(w, http.StatusInternalServerError, fserrors.New("config_write_failed", "config", "configuration could not be saved.", "Check the config file permissions and retry.", map[string]any{
				"diagnostic": err.Error(),
			}))
			return
		}
		writeOK(w, view)
	default:
		writeError(w, http.StatusNotFound, unknownRoute())
	}
}

func (s *Server) currentConfigView() configView {
	s.configMu.Lock()
	defer s.configMu.Unlock()
	return s.runtimeConfig
}

func (s *Server) defaultConfigView() configView {
	loaded, _, _ := appconfig.Load(s.cfg.ConfigPath, nil)
	openai := openAIProviderView("api-openai-transcription", loaded.OpenAI)
	apiProviders := map[string]any{
		"api-openai-transcription": openai,
		"api-openai-chat":          openAIProviderView("api-openai-chat", openAIProviderConfig(loaded, "api-openai-chat")),
	}
	for providerID, providerCfg := range loaded.OpenAIProviders {
		apiProviders[providerID] = openAIProviderView(providerID, providerCfg)
	}
	view := configView{
		ConfigSchemaVersion:         1,
		Language:                    "auto",
		TargetLanguage:              "zh",
		OutputDirectory:             "source",
		OutputConflict:              "ask",
		OutputFormat:                "srt",
		OutputType:                  "original_srt",
		BurnInVideo:                 false,
		Device:                      "auto",
		DefaultASRProvider:          "local-faster-whisper",
		DefaultTranslationProvider:  "local-nllb-ct2",
		DefaultASRModel:             "whisper-small",
		DefaultTranslationModel:     "nllb-200-distilled-600m-ct2-int8",
		WordTimestamps:              false,
		KeepTemp:                    false,
		FolderScanIncludeSubfolders: false,
		FolderScanMaxFiles:          100,
		OpenAICompatible:            openai,
		APIProviders:                apiProviders,
	}
	return applyLoadedUIConfig(view, loaded.UI)
}

func openAIProviderConfig(loaded appconfig.AppConfig, providerID string) appconfig.OpenAIProviderConfig {
	if providerCfg, ok := loaded.OpenAIProviders[providerID]; ok {
		return providerCfg
	}
	if providerID == "api-openai-transcription" {
		return loaded.OpenAI
	}
	return appconfig.OpenAIProviderConfig{}
}

func openAIProviderView(providerID string, cfg appconfig.OpenAIProviderConfig) map[string]any {
	openai := map[string]any{
		"base_url":       stringDefault(cfg.BaseURL, "https://api.openai.com/v1"),
		"model":          cfg.Model,
		"upload_format":  stringDefault(cfg.APIUploadFormat, "wav"),
		"api_key_alias":  stringDefault(normalizeOpenAIKeyAliasForProvider(cfg.APIKeyEnv, providerID), defaultOpenAIKeyAlias(providerID)),
		"api_key_status": "missing",
	}
	if cfg.APIKeyEnv != "" {
		openai["api_key_status"] = "configured"
	}
	return openai
}

func defaultOpenAIKeyAlias(providerID string) string {
	switch providerID {
	case "api-openai-chat":
		return "FAST_SUB_OPENAI_CHAT_API_KEY"
	case "api-openai-transcription":
		return "FAST_SUB_OPENAI_TRANSCRIPTION_API_KEY"
	default:
		return "FAST_SUB_OPENAI_API_KEY"
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
	if value, ok := patch["output_format"].(string); ok {
		switch value {
		case "srt", "vtt", "txt", "json":
		default:
			return fserrors.New("invalid_config", "config", "configuration patch is invalid.", "Review the highlighted settings and try again.", map[string]any{
				"fields": []map[string]string{{"path": "output_format", "code": "unsupported_value", "message": "output_format must be one of srt, vtt, txt, json."}},
			})
		}
	}
	if value, ok := patch["output_type"].(string); ok {
		switch value {
		case "original_srt", "translated_srt", "bilingual_srt", "burned_video":
		default:
			return fserrors.New("invalid_config", "config", "configuration patch is invalid.", "Review the highlighted settings and try again.", map[string]any{
				"fields": []map[string]string{{"path": "output_type", "code": "unsupported_value", "message": "output_type must be one of original_srt, translated_srt, bilingual_srt, burned_video."}},
			})
		}
	}
	if openai, ok := patch["openai_compatible"].(map[string]any); ok {
		if _, hasRaw := openai["api_key"]; hasRaw {
			return fserrors.New("invalid_config", "config", "raw api_key is not accepted in config.", "Save API keys with the desktop secret storage.", nil)
		}
	}
	if providers, ok := patch["api_providers"].(map[string]any); ok {
		for providerID, raw := range providers {
			openai, ok := raw.(map[string]any)
			if !ok {
				return fserrors.New("invalid_config", "config", "configuration patch is invalid.", "Review the highlighted settings and try again.", map[string]any{
					"fields": []map[string]string{{"path": "api_providers." + providerID, "code": "unsupported_value", "message": "provider config must be an object."}},
				})
			}
			if _, hasRaw := openai["api_key"]; hasRaw {
				return fserrors.New("invalid_config", "config", "raw api_key is not accepted in config.", "Save API keys with the desktop secret storage.", nil)
			}
		}
	}
	if _, exists := patch["folder_scan_include_subfolders"]; exists {
		if _, ok := patch["folder_scan_include_subfolders"].(bool); !ok {
			return fserrors.New("invalid_config", "config", "configuration patch is invalid.", "Review the highlighted settings and try again.", map[string]any{
				"fields": []map[string]string{{"path": "folder_scan_include_subfolders", "code": "unsupported_value", "message": "folder_scan_include_subfolders must be boolean."}},
			})
		}
	}
	if value, ok := patch["folder_scan_max_files"].(float64); ok {
		if value < 1 || value > 500 || value != float64(int(value)) {
			return fserrors.New("invalid_config", "config", "configuration patch is invalid.", "Review the highlighted settings and try again.", map[string]any{
				"fields": []map[string]string{{"path": "folder_scan_max_files", "code": "unsupported_value", "message": "folder_scan_max_files must be an integer from 1 to 500."}},
			})
		}
	}
	if _, exists := patch["folder_scan_max_files"]; exists {
		if _, ok := patch["folder_scan_max_files"].(float64); !ok {
			return fserrors.New("invalid_config", "config", "configuration patch is invalid.", "Review the highlighted settings and try again.", map[string]any{
				"fields": []map[string]string{{"path": "folder_scan_max_files", "code": "unsupported_value", "message": "folder_scan_max_files must be an integer from 1 to 500."}},
			})
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
		case "target_language":
			if typed, ok := value.(string); ok {
				view.TargetLanguage = typed
			}
		case "output_directory":
			if typed, ok := value.(string); ok {
				view.OutputDirectory = typed
			}
		case "output_conflict":
			if typed, ok := value.(string); ok {
				view.OutputConflict = typed
			}
		case "output_format":
			if typed, ok := value.(string); ok {
				view.OutputFormat = typed
			}
		case "output_type":
			if typed, ok := value.(string); ok {
				view.OutputType = typed
			}
		case "burn_in_video":
			if typed, ok := value.(bool); ok {
				view.BurnInVideo = typed
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
		case "folder_scan_include_subfolders":
			if typed, ok := value.(bool); ok {
				view.FolderScanIncludeSubfolders = typed
			}
		case "folder_scan_max_files":
			if typed, ok := value.(float64); ok {
				view.FolderScanMaxFiles = int(typed)
			}
		case "openai_compatible":
			if typed, ok := value.(map[string]any); ok {
				if view.OpenAICompatible == nil {
					view.OpenAICompatible = map[string]any{}
				}
				for openAIKey, openAIValue := range typed {
					if openAIValue != nil && openAIKey != "api_key" {
						view.OpenAICompatible[openAIKey] = openAIValue
					}
				}
			}
		case "api_providers":
			if typed, ok := value.(map[string]any); ok {
				if view.APIProviders == nil {
					view.APIProviders = map[string]any{}
				}
				for providerID, raw := range typed {
					providerPatch, ok := raw.(map[string]any)
					if !ok {
						continue
					}
					current, _ := view.APIProviders[providerID].(map[string]any)
					if current == nil {
						current = map[string]any{}
					}
					for openAIKey, openAIValue := range providerPatch {
						if openAIValue != nil && openAIKey != "api_key" {
							current[openAIKey] = openAIValue
						}
					}
					view.APIProviders[providerID] = current
				}
			}
		}
	}
	return view
}

func (s *Server) persistConfigView(view configView) error {
	path, err := appconfig.ResolveWritePath(s.cfg.ConfigPath, nil)
	if err != nil || path == "" {
		return err
	}
	loaded, _, _ := appconfig.Load(s.cfg.ConfigPath, nil)
	loaded.UI = uiConfigFromView(view)
	loaded.OpenAI = openAIConfigFromView(view, loaded.OpenAI)
	loaded.OpenAIProviders = openAIProviderConfigsFromView(view, loaded)
	return appconfig.Save(path, loaded)
}

func applyLoadedUIConfig(view configView, cfg appconfig.UIConfig) configView {
	if cfg.Language != "" {
		view.Language = cfg.Language
	}
	if cfg.TargetLanguage != "" {
		view.TargetLanguage = cfg.TargetLanguage
	}
	if cfg.OutputDirectory != "" {
		view.OutputDirectory = cfg.OutputDirectory
	}
	if cfg.OutputConflict != "" {
		view.OutputConflict = cfg.OutputConflict
	}
	if cfg.OutputFormat != "" {
		view.OutputFormat = cfg.OutputFormat
	}
	if cfg.OutputType != "" {
		view.OutputType = cfg.OutputType
	}
	if cfg.BurnInVideo != nil {
		view.BurnInVideo = *cfg.BurnInVideo
	}
	if cfg.Device != "" {
		view.Device = cfg.Device
	}
	if cfg.DefaultASRProvider != "" {
		view.DefaultASRProvider = cfg.DefaultASRProvider
	}
	if cfg.DefaultTranslationProvider != "" {
		view.DefaultTranslationProvider = cfg.DefaultTranslationProvider
	}
	if cfg.DefaultASRModel != "" {
		view.DefaultASRModel = cfg.DefaultASRModel
	}
	if cfg.DefaultTranslationModel != "" {
		view.DefaultTranslationModel = cfg.DefaultTranslationModel
	}
	if cfg.WordTimestamps != nil {
		view.WordTimestamps = *cfg.WordTimestamps
	}
	if cfg.KeepTemp != nil {
		view.KeepTemp = *cfg.KeepTemp
	}
	if cfg.FolderScanIncludeSubfolders != nil {
		view.FolderScanIncludeSubfolders = *cfg.FolderScanIncludeSubfolders
	}
	if cfg.FolderScanMaxFiles > 0 {
		view.FolderScanMaxFiles = cfg.FolderScanMaxFiles
	}
	return view
}

func uiConfigFromView(view configView) appconfig.UIConfig {
	return appconfig.UIConfig{
		Language:                    view.Language,
		TargetLanguage:              view.TargetLanguage,
		OutputDirectory:             view.OutputDirectory,
		OutputConflict:              view.OutputConflict,
		OutputFormat:                view.OutputFormat,
		OutputType:                  view.OutputType,
		BurnInVideo:                 boolPtr(view.BurnInVideo),
		Device:                      view.Device,
		DefaultASRProvider:          view.DefaultASRProvider,
		DefaultTranslationProvider:  view.DefaultTranslationProvider,
		DefaultASRModel:             view.DefaultASRModel,
		DefaultTranslationModel:     view.DefaultTranslationModel,
		WordTimestamps:              boolPtr(view.WordTimestamps),
		KeepTemp:                    boolPtr(view.KeepTemp),
		FolderScanIncludeSubfolders: boolPtr(view.FolderScanIncludeSubfolders),
		FolderScanMaxFiles:          view.FolderScanMaxFiles,
	}
}

func openAIConfigFromView(view configView, fallback appconfig.OpenAIProviderConfig) appconfig.OpenAIProviderConfig {
	openai := view.OpenAICompatible
	if openai == nil {
		return fallback
	}
	if value, ok := openai["base_url"].(string); ok {
		fallback.BaseURL = value
	}
	if value, ok := openai["model"].(string); ok {
		fallback.Model = value
	}
	if value, ok := openai["upload_format"].(string); ok {
		fallback.APIUploadFormat = value
	}
	if value, ok := openai["api_key_alias"].(string); ok {
		fallback.APIKeyEnv = normalizeOpenAIKeyAliasForProvider(value, "api-openai-transcription")
	}
	return fallback
}

func openAIProviderConfigsFromView(view configView, loaded appconfig.AppConfig) map[string]appconfig.OpenAIProviderConfig {
	next := map[string]appconfig.OpenAIProviderConfig{}
	for providerID, providerCfg := range loaded.OpenAIProviders {
		next[providerID] = providerCfg
	}
	if _, ok := next["api-openai-transcription"]; !ok {
		next["api-openai-transcription"] = loaded.OpenAI
	}
	for providerID, raw := range view.APIProviders {
		providerView, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		fallback := next[providerID]
		next[providerID] = openAIProviderConfigFromMap(providerID, providerView, fallback)
	}
	if view.OpenAICompatible != nil {
		if _, hasSpecific := view.APIProviders["api-openai-transcription"]; hasSpecific {
			return next
		}
		next["api-openai-transcription"] = openAIConfigFromView(view, next["api-openai-transcription"])
	}
	return next
}

func openAIProviderConfigFromMap(providerID string, openai map[string]any, fallback appconfig.OpenAIProviderConfig) appconfig.OpenAIProviderConfig {
	if value, ok := openai["base_url"].(string); ok {
		fallback.BaseURL = value
	}
	if value, ok := openai["model"].(string); ok {
		fallback.Model = value
	}
	if value, ok := openai["upload_format"].(string); ok {
		fallback.APIUploadFormat = value
	}
	if value, ok := openai["api_key_alias"].(string); ok {
		fallback.APIKeyEnv = normalizeOpenAIKeyAliasForProvider(value, providerID)
	}
	return fallback
}

func normalizeOpenAIKeyAliasForProvider(value string, providerID string) string {
	if value != "openai-default" {
		return value
	}
	return defaultOpenAIKeyAlias(providerID)
}

func boolPtr(value bool) *bool {
	return &value
}

func stringDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
