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
		req.Model = loaded.OpenAI.Model
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
	if apiKey == "" {
		return Result{}, fserrors.New(
			fserrors.CodeMissingAPIKey,
			"api_openai_transcription",
			"OpenAI transcription API key is required.",
			"Set an API key env var before selecting this provider.",
			nil,
		)
	}
	baseURL := stringDefault(stringOption(req, "base_url"), loaded.OpenAI.BaseURL)
	format := apiUploadFormat(req)
	output := outputPath(req)
	if appErr := validateOutput(output); appErr != nil {
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
	if loaded.OpenAI.APIKeyEnv != "" {
		return loaded.OpenAI.APIKeyEnv
	}
	apiKeyEnv = "FAST_SUB_OPENAI_API_KEY"
	if r.env(apiKeyEnv) == "" {
		apiKeyEnv = "OPENAI_API_KEY"
	}
	return apiKeyEnv
}

func apiUploadFormat(req CreateRequest) ffmpeg.APIUploadFormat {
	value := stringOption(req, "api_upload_format")
	if value == "" || value == "auto" {
		return ffmpeg.APIUploadM4A
	}
	return ffmpeg.APIUploadFormat(value)
}
