package jobs

import (
	"context"
	"path/filepath"
	"time"

	appconfig "fast-sub/internal/config"
	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/events"
	"fast-sub/internal/ffmpeg"
	openairuntime "fast-sub/internal/runtime/openai"
)

func (r DefaultRunner) runOpenAI(
	ctx context.Context,
	job Job,
	req CreateRequest,
	emit func(Update),
) (Result, *fserrors.AppError) {
	started := time.Now()
	loaded, _, err := appconfig.Load(r.ConfigPath, r.env)
	if err != nil {
		return Result{}, fserrors.New(
			fserrors.CodeInvalidInput,
			"api_openai_transcription",
			err.Error(),
			"Fix the Go config file before selecting this provider.",
			nil,
		)
	}
	if req.Model == "" {
		req.Model = openAIProviderConfig(loaded, "api-openai-transcription").Model
	}
	if req.Model == "" {
		return Result{}, fserrors.New(
			fserrors.CodeInvalidInput,
			"api_openai_transcription",
			"--model is required for api-openai-transcription.",
			"Pass an explicit OpenAI-compatible transcription model.",
			nil,
		)
	}
	apiKeyEnv := r.openAIKeyEnv(req, loaded)
	apiKey := r.env(apiKeyEnv)
	baseURL := stringDefault(stringOption(req, "base_url"), openAIProviderConfig(loaded, "api-openai-transcription").BaseURL)
	format := apiUploadFormat(req)
	output := outputPath(req)
	if appErr := validateOutput(output, boolOption(req, "overwrite")); appErr != nil {
		return Result{}, appErr
	}
	runner := r.ffmpegRunner()
	emitProgress(emit, "probing_media", 5)
	metadata, appErr := runner.Probe(ctx, req.InputPath, probeTimeout)
	if appErr != nil {
		return Result{}, appErr
	}
	jobDir := r.jobDir(job.ID)
	audioPath := filepath.Join(jobDir, "tmp", "api-upload."+string(format))
	emitProgress(emit, "preparing_upload", 25)
	if _, appErr := runner.PrepareAPIUploadAudio(ctx, req.InputPath, audioPath, format, extractTimeout); appErr != nil {
		return Result{}, appErr
	}
	emit(EventUpdate(
		events.TypeLog,
		map[string]any{
			"stage":   "preparing_upload",
			"message": "remote API provider selected explicitly; prepared upload audio",
		},
	))
	client := r.OpenAI
	client.BaseURL = baseURL
	emitProgress(emit, "transcribing", 55)
	result, appErr := client.Transcribe(ctx, openairuntime.TranscribeOptions{
		AudioPath:   audioPath,
		FileName:    filepath.Base(audioPath),
		Model:       req.Model,
		APIKey:      apiKey,
		Language:    language(req),
		DurationSec: metadata.DurationSec,
	})
	if appErr != nil {
		return Result{}, appErr
	}
	return finishTranscribe(finishTranscribeInput{
		jobDir:   jobDir,
		req:      req,
		output:   output,
		language: result.Language,
		segments: result.Segments,
		result: Result{
			Provider:        result.Provider,
			Model:           result.Model,
			APIUploadFormat: string(format),
			Warnings:        result.Warnings,
			ElapsedSec:      time.Since(started).Seconds(),
		},
		emit: emit,
	})
}

func (r DefaultRunner) openAIKeyEnv(req CreateRequest, loaded appconfig.AppConfig) string {
	apiKeyEnv := stringOption(req, "api_key_env")
	if apiKeyEnv != "" {
		return apiKeyEnv
	}
	providerConfig := openAIProviderConfig(loaded, "api-openai-transcription")
	if providerConfig.APIKeyEnv != "" {
		if providerConfig.APIKeyEnv == "openai-default" {
			return "FAST_SUB_OPENAI_TRANSCRIPTION_API_KEY"
		}
		return providerConfig.APIKeyEnv
	}
	apiKeyEnv = "FAST_SUB_OPENAI_TRANSCRIPTION_API_KEY"
	if r.env(apiKeyEnv) == "" {
		apiKeyEnv = "FAST_SUB_OPENAI_API_KEY"
	}
	if r.env(apiKeyEnv) == "" {
		apiKeyEnv = "OPENAI_API_KEY"
	}
	return apiKeyEnv
}

func openAIProviderConfig(loaded appconfig.AppConfig, providerID string) appconfig.OpenAIProviderConfig {
	if providerConfig, ok := loaded.OpenAIProviders[providerID]; ok {
		return providerConfig
	}
	if providerID == "api-openai-transcription" {
		return loaded.OpenAI
	}
	return appconfig.OpenAIProviderConfig{}
}

func apiUploadFormat(req CreateRequest) ffmpeg.APIUploadFormat {
	value := stringOption(req, "api_upload_format")
	if value == "" || value == "auto" {
		return ffmpeg.APIUploadM4A
	}
	return ffmpeg.APIUploadFormat(value)
}
