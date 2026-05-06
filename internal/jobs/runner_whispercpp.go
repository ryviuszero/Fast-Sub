package jobs

import (
	"context"
	"path/filepath"
	"time"

	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/models"
	"fast-sub/internal/runtime/whispercpp"
)

func (r DefaultRunner) runWhisperCPP(
	ctx context.Context,
	job Job,
	req CreateRequest,
	emit func(Update),
) (Result, *fserrors.AppError) {
	started := time.Now()
	modelPath, appErr := r.resolveWhisperCPPModel(req)
	if appErr != nil {
		return Result{}, appErr
	}
	if appErr := validateRequest(req, true); appErr != nil {
		return Result{}, appErr
	}
	output := outputPath(req)
	if appErr := validateOutput(output); appErr != nil {
		return Result{}, appErr
	}
	runner := r.ffmpegRunner()
	emitProgress(emit, "probing_media", 5)
	if _, appErr := runner.Probe(ctx, req.InputPath, probeTimeout); appErr != nil {
		return Result{}, appErr
	}
	jobDir := r.jobDir(job.ID)
	audioPath := filepath.Join(jobDir, "tmp", "audio.wav")
	emitProgress(emit, "extracting_audio", 20)
	if _, appErr := runner.ExtractAudio(ctx, req.InputPath, audioPath, extractTimeout); appErr != nil {
		return Result{}, appErr
	}
	emitProgress(emit, "transcribing", 55)
	result, appErr := whispercpp.Transcribe(ctx, whispercpp.Options{
		Command:          stringOption(req, "whisper_cpp_command"),
		AudioPath:        audioPath,
		ModelPath:        modelPath,
		JobDir:           jobDir,
		Language:         language(req),
		ManagedBinaryDir: filepath.Join(models.DefaultStore().Root, "whisper-cpp"),
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
			Provider:   result.Provider,
			Model:      req.Model,
			Warnings:   result.Warnings,
			ElapsedSec: time.Since(started).Seconds(),
		},
		emit: emit,
	})
}
