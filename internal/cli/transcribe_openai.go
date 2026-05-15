package cli

import (
	"context"
	"os"
	"path/filepath"
	"time"

	appconfig "fast-sub/internal/config"
	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/ffmpeg"
	openairuntime "fast-sub/internal/runtime/openai"
	"fast-sub/internal/subtitle"
)

func transcribeOpenAI(ctx context.Context, cfg Config, command, input string, parsed transcribeArgs, started time.Time) (transcribeResult, *fserrors.AppError) {
	var empty transcribeResult
	if command != "transcribe" {
		return empty, fserrors.New(fserrors.CodeInvalidInput, command, "api-openai-transcription must be selected explicitly with transcribe.", "Run fast-sub-go transcribe with --provider api-openai-transcription.", nil)
	}
	cfgFile, appErr := loadCLIConfig(parsed.configPath, command)
	if appErr != nil {
		return empty, appErr
	}
	applyOpenAIConfig(&parsed, cfgFile.OpenAI)
	if parsed.model == "" {
		return empty, fserrors.New(fserrors.CodeInvalidInput, command, "--model is required for api-openai-transcription.", "Pass an explicit OpenAI-compatible transcription model or set model in the config file.", nil)
	}
	apiKey, appErr := resolveAPIKey(parsed)
	if appErr != nil {
		return empty, appErr
	}
	if err := validateChoice("language", parsed.language, []string{"auto", "zh", "en", "ja", "ko"}); err != nil {
		return empty, fserrors.New(fserrors.CodeInvalidInput, command, err.Error(), "", nil)
	}
	wordTimestamps, appErr := resolveWordTimestamps(parsed.wordTimestamps, command)
	if appErr != nil {
		return empty, appErr
	}
	format, appErr := resolveAPIUploadFormat(parsed.apiUploadFormat, parsed.baseURL)
	if appErr != nil {
		return empty, appErr
	}
	output := parsed.output
	if output == "" {
		output = defaultSRTPath(input)
	}
	if appErr := validateSRTOutput(output); appErr != nil {
		return empty, appErr
	}
	metadata, appErr := cfg.Runner.Probe(ctx, input, probeTimeout)
	if appErr != nil {
		return empty, appErr
	}
	jobDir, _, appErr := createJobDir()
	if appErr != nil {
		return empty, appErr
	}
	audioPath := filepath.Join(jobDir, "api-upload."+string(format))
	if _, appErr := cfg.Runner.PrepareAPIUploadAudio(ctx, input, audioPath, format, extractTimeout); appErr != nil {
		return empty, appErr
	}
	result, appErr := openairuntime.Client{BaseURL: parsed.baseURL}.Transcribe(ctx, openairuntime.TranscribeOptions{
		AudioPath:      audioPath,
		FileName:       filepath.Base(audioPath),
		Model:          parsed.model,
		APIKey:         apiKey,
		Language:       parsed.language,
		DurationSec:    metadata.DurationSec,
		WordTimestamps: wordTimestamps,
	})
	if appErr != nil {
		return empty, appErr
	}
	refinedSegments := subtitle.RefineSegments(result.Segments, subtitle.RefineOptions{Lang: result.Language})
	srt, err := subtitle.RenderSRT(refinedSegments)
	if err != nil {
		return empty, fserrors.New(fserrors.CodeAPIFailed, "rendering", err.Error(), "Check provider segment timestamps and text.", nil)
	}
	if err := os.WriteFile(output, []byte(srt), 0o600); err != nil {
		return empty, classifyWriteError("rendering", "write SRT: "+err.Error())
	}
	if !parsed.keepTemp {
		_ = os.Remove(audioPath)
	}
	return transcribeResult{
		InputPath:       input,
		OutputPath:      output,
		Language:        result.Language,
		Segments:        len(refinedSegments),
		ElapsedSec:      time.Since(started).Seconds(),
		JobDir:          jobDir,
		Provider:        result.Provider,
		Model:           result.Model,
		APIUploadFormat: string(format),
		Warnings:        result.Warnings,
	}, nil
}

func resolveAPIKey(parsed transcribeArgs) (string, *fserrors.AppError) {
	if parsed.apiKeyEnv == "" {
		return "", nil
	}
	apiKey := os.Getenv(parsed.apiKeyEnv)
	if apiKey == "" {
		return "", nil
	}
	return apiKey, nil
}

func loadCLIConfig(path, command string) (appconfig.AppConfig, *fserrors.AppError) {
	cfg, resolvedPath, err := appconfig.Load(path, os.Getenv)
	if err != nil {
		return appconfig.AppConfig{}, fserrors.New(
			fserrors.CodeInvalidInput,
			command,
			"read config file: "+err.Error(),
			"Check --config, FAST_SUB_GO_CONFIG, or fast-sub-go.toml. Supported OpenAI keys are model, api_key_env, base_url, api_upload_format, and words.",
			map[string]any{"config_path": resolvedPath},
		)
	}
	return cfg, nil
}

func applyOpenAIConfig(parsed *transcribeArgs, cfg appconfig.OpenAIProviderConfig) {
	if parsed.model == "" {
		parsed.model = cfg.Model
	}
	if parsed.apiKeyEnv == "" {
		parsed.apiKeyEnv = cfg.APIKeyEnv
	}
	if parsed.baseURL == "" {
		parsed.baseURL = cfg.BaseURL
	}
	if parsed.apiUploadFormat == "" {
		parsed.apiUploadFormat = cfg.APIUploadFormat
	}
	if !parsed.wordTimestampsSet && cfg.Words != nil {
		if *cfg.Words {
			parsed.wordTimestamps = "on"
		} else {
			parsed.wordTimestamps = "off"
		}
	}
}

func resolveAPIUploadFormat(value, baseURL string) (ffmpeg.APIUploadFormat, *fserrors.AppError) {
	switch value {
	case "", "auto":
		return ffmpeg.APIUploadM4A, nil
	case "wav":
		return ffmpeg.APIUploadWAV, nil
	case "m4a":
		return ffmpeg.APIUploadM4A, nil
	case "mp3":
		return ffmpeg.APIUploadMP3, nil
	default:
		return "", fserrors.New(fserrors.CodeInvalidInput, "api_openai_transcription", "--api-upload-format must be one of: auto, wav, m4a, mp3", "", map[string]any{"base_url_is_official_openai": openairuntime.IsOfficialBaseURL(baseURL)})
	}
}
