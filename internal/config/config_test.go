package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveAndLoadUIPreferences(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fast-sub-go.toml")
	cfg := AppConfig{
		UI: UIConfig{
			Language:                    "en",
			TargetLanguage:              "zh",
			OutputDirectory:             "source",
			OutputConflict:              "overwrite",
			OutputFormat:                "vtt",
			OutputType:                  "bilingual_srt",
			BurnInVideo:                 boolRef(true),
			Device:                      "cuda",
			DefaultASRProvider:          "local-faster-whisper",
			DefaultTranslationProvider:  "local-nllb-ct2",
			DefaultASRModel:             "whisper-small",
			DefaultTranslationModel:     "nllb-200-distilled-600m-ct2-int8",
			WordTimestamps:              boolRef(true),
			KeepTemp:                    boolRef(false),
			FolderScanIncludeSubfolders: boolRef(true),
			FolderScanMaxFiles:          200,
		},
		OpenAI: OpenAIProviderConfig{
			Model:           "gpt-4o-transcribe",
			APIKeyEnv:       "FAST_SUB_OPENAI_API_KEY",
			BaseURL:         "https://api.openai.com/v1",
			APIUploadFormat: "wav",
		},
	}

	if err := Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "api_key =") {
		t.Fatalf("config file must not contain raw api_key: %s", raw)
	}
	loaded, _, err := Load(path, nil)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.UI.OutputType != "bilingual_srt" || loaded.UI.OutputFormat != "vtt" || loaded.UI.TargetLanguage != "zh" {
		t.Fatalf("loaded UI config = %#v", loaded.UI)
	}
	if loaded.UI.WordTimestamps == nil || !*loaded.UI.WordTimestamps {
		t.Fatalf("word timestamps not persisted: %#v", loaded.UI.WordTimestamps)
	}
	if loaded.UI.FolderScanIncludeSubfolders == nil || !*loaded.UI.FolderScanIncludeSubfolders || loaded.UI.FolderScanMaxFiles != 200 {
		t.Fatalf("folder scan config not persisted: %#v", loaded.UI)
	}
	if loaded.OpenAI.Model != "gpt-4o-transcribe" || loaded.OpenAI.APIKeyEnv != "FAST_SUB_OPENAI_API_KEY" {
		t.Fatalf("loaded OpenAI config = %#v", loaded.OpenAI)
	}
}

func TestSaveAndLoadIndependentOpenAIProviderConfigs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fast-sub-go.toml")
	cfg := AppConfig{
		OpenAIProviders: map[string]OpenAIProviderConfig{
			"api-openai-transcription": {
				Model:           "gpt-4o-transcribe",
				APIKeyEnv:       "FAST_SUB_OPENAI_TRANSCRIPTION_API_KEY",
				BaseURL:         "https://api.openai.com/v1",
				APIUploadFormat: "wav",
			},
			"api-openai-chat": {
				Model:     "qwen/qwen3-4b-2507",
				APIKeyEnv: "FAST_SUB_OPENAI_CHAT_API_KEY",
				BaseURL:   "http://127.0.0.1:1234/v1",
			},
		},
	}

	if err := Save(path, cfg); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	if !strings.Contains(text, "[providers.api-openai-transcription]") || !strings.Contains(text, "[providers.api-openai-chat]") {
		t.Fatalf("provider sections not persisted independently: %s", text)
	}

	loaded, _, err := Load(path, nil)
	if err != nil {
		t.Fatal(err)
	}
	transcription := loaded.OpenAIProviders["api-openai-transcription"]
	chat := loaded.OpenAIProviders["api-openai-chat"]
	if transcription.Model != "gpt-4o-transcribe" || transcription.APIKeyEnv != "FAST_SUB_OPENAI_TRANSCRIPTION_API_KEY" {
		t.Fatalf("transcription config = %#v", transcription)
	}
	if chat.Model != "qwen/qwen3-4b-2507" || chat.BaseURL != "http://127.0.0.1:1234/v1" || chat.APIKeyEnv != "FAST_SUB_OPENAI_CHAT_API_KEY" {
		t.Fatalf("chat config = %#v", chat)
	}
}

func boolRef(value bool) *bool {
	return &value
}
