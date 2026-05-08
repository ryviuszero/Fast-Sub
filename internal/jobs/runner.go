package jobs

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/ffmpeg"
	"fast-sub/internal/models"
	openairuntime "fast-sub/internal/runtime/openai"
	"fast-sub/internal/subtitle"
)

const (
	probeTimeout   = 30 * time.Second
	extractTimeout = 30 * time.Minute
)

type DefaultRunner struct {
	FFmpeg      ffmpeg.Runner
	OpenAI      openairuntime.Client
	JobRoot     string
	ConfigPath  string
	Env         func(string) string
	ModelStore  models.Store
	ModelLookup func(string, string) (string, error)
}

func (r DefaultRunner) RunJob(ctx context.Context, job Job, req CreateRequest, emit func(Update)) (Result, *fserrors.AppError) {
	switch req.Type {
	case "transcribe", "":
		return r.RunTranscribe(ctx, job, req, emit)
	case "model_install":
		return r.runModelInstall(ctx, req, emit)
	case "translate_srt":
		return r.runTranslateSRT(ctx, req, emit)
	case "burn_in":
		return r.runBurnIn(ctx, req, emit)
	default:
		return Result{}, fserrors.New(fserrors.CodeInvalidInput, "create_job", "unsupported job type: "+req.Type, "", nil)
	}
}

func (r DefaultRunner) RunTranscribe(ctx context.Context, job Job, req CreateRequest, emit func(Update)) (Result, *fserrors.AppError) {
	switch req.Provider {
	case "", "local-faster-whisper":
		return r.runFasterWhisper(ctx, job, req, emit)
	case "local-whisper-cpp":
		return r.runWhisperCPP(ctx, job, req, emit)
	case "api-openai-transcription":
		return r.runOpenAI(ctx, job, req, emit)
	default:
		return Result{}, fserrors.New(fserrors.CodeInvalidInput, "transcribing", "unsupported provider: "+req.Provider, "Use local-faster-whisper, local-whisper-cpp, or api-openai-transcription.", nil)
	}
}

func (r DefaultRunner) runModelInstall(ctx context.Context, req CreateRequest, emit func(Update)) (Result, *fserrors.AppError) {
	modelID := stringDefault(req.ModelID, req.Model)
	if modelID == "" {
		return Result{}, fserrors.New(fserrors.CodeInvalidInput, "installing_model", "model_id is required.", "Choose a model and retry.", nil)
	}
	manifest, err := models.LoadManifest("")
	if err != nil {
		return Result{}, fserrors.New(fserrors.CodeInvalidInput, "installing_model", "model manifest could not be loaded: "+err.Error(), "Check the model manifest.", map[string]any{"model_id": modelID})
	}
	entry, ok := manifest.Get(modelID)
	if !ok {
		return Result{}, fserrors.New("unknown_model", "installing_model", "unknown model: "+modelID, "Choose a model from the model list.", map[string]any{"model_id": modelID})
	}
	store := r.ModelStore
	if store.Root == "" {
		store = models.DefaultStore()
	}
	emitProgress(emit, "validating", 5)
	installResult, appErr := store.Install(ctx, entry, models.InstallOptions{
		Progress: func(progress models.Progress) {
			percent := 10
			if progress.OverallTotal > 0 {
				percent = 10 + int((progress.OverallBytes*80)/progress.OverallTotal)
			}
			if percent > 90 {
				percent = 90
			}
			emit(ProgressUpdate("installing_model", percent))
		},
	})
	if appErr != nil {
		return Result{}, appErr
	}
	emitProgress(emit, "finalizing", 95)
	return Result{
		InputPath:  modelID,
		OutputPath: installResult.Status.Path,
		Provider:   req.Provider,
		Model:      modelID,
		Warnings:   []string{},
	}, nil
}

func (r DefaultRunner) runTranslateSRT(ctx context.Context, req CreateRequest, emit func(Update)) (Result, *fserrors.AppError) {
	return r.runTranslateSRTBridge(ctx, req, emit)
}

func (r DefaultRunner) runBurnIn(ctx context.Context, req CreateRequest, emit func(Update)) (Result, *fserrors.AppError) {
	if strings.TrimSpace(req.InputPath) == "" || strings.TrimSpace(req.SubtitlePath) == "" {
		return Result{}, fserrors.New(fserrors.CodeInvalidInput, "burning_in", "input_path and subtitle_path are required.", "Choose a video and subtitle file.", nil)
	}
	output := req.OutputPath
	if output == "" {
		output = strings.TrimSuffix(req.InputPath, filepath.Ext(req.InputPath)) + ".burned.mp4"
	}
	if err := validateOutput(output, boolOption(req, "overwrite")); err != nil {
		return Result{}, err
	}
	emitProgress(emit, "burning_in", 40)
	if ctx.Err() != nil {
		return Result{}, fserrors.New(fserrors.CodeCanceled, "burning_in", "job was canceled.", "", nil)
	}
	if err := os.WriteFile(output, []byte("Fast Sub burn-in bridge placeholder\n"), 0o600); err != nil {
		return Result{}, classifyWriteError("rendering", err.Error())
	}
	emitProgress(emit, "finalizing", 95)
	return Result{InputPath: req.InputPath, OutputPath: output, Provider: req.Provider, Model: req.Model, Warnings: []string{"burn_in CLI bridge placeholder used"}}, nil
}

func finishTranscribe(input finishTranscribeInput) (Result, *fserrors.AppError) {
	jobDir := input.jobDir
	req := input.req
	result := input.result
	emit := input.emit
	emitProgress(emit, "rendering", 85)
	refined := subtitle.RefineSegments(input.segments, subtitle.RefineOptions{Lang: input.language})
	srt, err := subtitle.RenderSRT(refined)
	if err != nil {
		return Result{}, fserrors.New(fserrors.CodeWorkerProtocol, "rendering", err.Error(), "Check provider segment timestamps and text.", nil)
	}
	if err := os.WriteFile(input.output, []byte(srt), 0o600); err != nil {
		return Result{}, classifyWriteError("rendering", "write SRT: "+err.Error())
	}
	if !boolOption(req, "keep_temp") {
		_ = os.RemoveAll(filepath.Join(jobDir, "tmp"))
	}
	emitProgress(emit, "finalizing", 95)
	result.InputPath = req.InputPath
	result.OutputPath = input.output
	result.Language = input.language
	result.Segments = len(refined)
	if result.Warnings == nil {
		result.Warnings = []string{}
	}
	return result, nil
}

type finishTranscribeInput struct {
	jobDir   string
	req      CreateRequest
	output   string
	language string
	segments []subtitle.Segment
	result   Result
	emit     func(Update)
}

func (r DefaultRunner) resolveFasterWhisperModel(req CreateRequest) (string, *fserrors.AppError) {
	if req.ModelPath != "" {
		return req.ModelPath, nil
	}
	if req.Model == "" {
		return "", fserrors.New(fserrors.CodeMissingModel, "transcribing", "--model or --model-path is required for local-faster-whisper.", "Pass a local model path or install a compatible model.", nil)
	}
	path, err := r.lookupModel(req.Model, "local-faster-whisper")
	if err != nil {
		return "", fserrors.New(fserrors.CodeMissingModel, "transcribing", err.Error(), "Install the model or pass --model-path.", nil)
	}
	return path, nil
}

func (r DefaultRunner) resolveWhisperCPPModel(req CreateRequest) (string, *fserrors.AppError) {
	if req.ModelPath != "" {
		return req.ModelPath, nil
	}
	if req.Model == "" {
		return "", fserrors.New(fserrors.CodeMissingModel, "transcribing", "--model or --model-path is required for local-whisper-cpp.", "Pass a whisper.cpp model file or install a compatible model.", nil)
	}
	path, err := r.lookupModel(req.Model, "local-whisper-cpp")
	if err != nil {
		return "", fserrors.New(fserrors.CodeMissingModel, "transcribing", err.Error(), "Install the model or pass --model-path.", nil)
	}
	return path, nil
}

func (r DefaultRunner) lookupModel(modelID, providerID string) (string, error) {
	if r.ModelLookup != nil {
		return r.ModelLookup(modelID, providerID)
	}
	manifest, err := models.LoadManifest("")
	if err != nil {
		return "", fmt.Errorf("model manifest could not be loaded: %w", err)
	}
	entry, ok := manifest.Get(modelID)
	if !ok || !hasString(entry.CompatibleProviders, providerID) {
		return "", fmt.Errorf("model is not compatible with %s: %s", providerID, modelID)
	}
	status := models.DefaultStore().Verify(entry)
	if !status.Installed {
		return "", fmt.Errorf("model is not installed: %s", modelID)
	}
	return status.Path, nil
}

func (r DefaultRunner) ffmpegRunner() ffmpeg.Runner {
	if r.FFmpeg.FFmpegName == "" {
		return ffmpeg.NewRunner()
	}
	return r.FFmpeg
}

func (r DefaultRunner) jobDir(id string) string {
	root := r.JobRoot
	if root == "" {
		root = filepath.Join(".fast-sub", "jobs")
	}
	return filepath.Join(root, id)
}

func (r DefaultRunner) env(key string) string {
	if r.Env != nil {
		return r.Env(key)
	}
	return os.Getenv(key)
}

func validateRequest(req CreateRequest, whisperCPP bool) *fserrors.AppError {
	if !hasString([]string{"auto", "zh", "en", "ja", "ko"}, language(req)) {
		return fserrors.New(fserrors.CodeInvalidInput, "transcribing", "--language must be one of: auto, zh, en, ja, ko", "", nil)
	}
	if whisperCPP && req.WordTimestamps != "" && req.WordTimestamps != "off" && req.WordTimestamps != "auto" {
		return fserrors.New(fserrors.CodeInvalidInput, "transcribing", "--word-timestamps is not supported by local-whisper-cpp in this preview.", "", nil)
	}
	return nil
}

func validateOutput(output string, overwrite bool) *fserrors.AppError {
	if output == "" {
		return fserrors.New(fserrors.CodeInvalidInput, "rendering", "output_path is required or input must have an extension.", "", nil)
	}
	if _, err := os.Stat(output); err == nil {
		if overwrite {
			return nil
		}
		return fserrors.New(fserrors.CodeOutputExists, "rendering", "output already exists: "+output, "Choose a different output_path.", nil)
	}
	if err := os.MkdirAll(filepath.Dir(output), 0o700); err != nil && filepath.Dir(output) != "." {
		return classifyWriteError("rendering", err.Error())
	}
	return nil
}

func outputPath(req CreateRequest) string {
	if req.OutputPath != "" {
		return req.OutputPath
	}
	ext := filepath.Ext(req.InputPath)
	if ext == "" {
		return req.InputPath + ".srt"
	}
	return strings.TrimSuffix(req.InputPath, ext) + ".srt"
}

func language(req CreateRequest) string {
	if req.Language == "" {
		return "auto"
	}
	return req.Language
}

func wordTimestamps(value string) (bool, *fserrors.AppError) {
	switch value {
	case "", "off", "auto":
		return false, nil
	case "on":
		return true, nil
	default:
		return false, fserrors.New(fserrors.CodeInvalidInput, "transcribing", "--word-timestamps must be one of: auto, on, off", "", nil)
	}
}

func emitProgress(emit func(Update), stage string, percent int) {
	emit(ProgressUpdate(stage, percent))
}

func stringOption(req CreateRequest, key string) string {
	if req.Options == nil {
		return ""
	}
	if value, ok := req.Options[key].(string); ok {
		return value
	}
	return ""
}

func boolOption(req CreateRequest, key string) bool {
	if req.Options == nil {
		return false
	}
	value, _ := req.Options[key].(bool)
	return value
}

func intOption(req CreateRequest, key string) int {
	if req.Options == nil {
		return 0
	}
	switch typed := req.Options[key].(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	default:
		return 0
	}
}

func stringDefault(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func intDefault(value, fallback int) int {
	if value == 0 {
		return fallback
	}
	return value
}

func classifyWriteError(stage, message string) *fserrors.AppError {
	code := fserrors.CodeInvalidInput
	lower := strings.ToLower(message)
	if strings.Contains(lower, "permission") || strings.Contains(lower, "access is denied") {
		code = fserrors.CodePermissionDenied
	}
	if strings.Contains(lower, "no space") || strings.Contains(lower, "disk full") {
		code = fserrors.CodeDiskFull
	}
	return fserrors.New(code, stage, message, "Check that Fast Sub can write the target path.", nil)
}

func hasString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
