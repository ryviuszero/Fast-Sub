package jobs

import (
	"context"
	"path/filepath"
	"time"

	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/worker"
)

func (r DefaultRunner) runFasterWhisper(
	ctx context.Context,
	job Job,
	req CreateRequest,
	emit func(Update),
) (Result, *fserrors.AppError) {
	started := time.Now()
	modelPath, appErr := r.resolveFasterWhisperModel(req)
	if appErr != nil {
		return Result{}, appErr
	}
	if appErr := validateRequest(req, false); appErr != nil {
		return Result{}, appErr
	}
	output := outputPath(req)
	if appErr := validateOutput(output, boolOption(req, "overwrite")); appErr != nil {
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
	wordTimestamps, appErr := wordTimestamps(req.WordTimestamps)
	if appErr != nil {
		return Result{}, appErr
	}
	emitProgress(emit, "transcribing", 55)
	workerDir := filepath.Join(jobDir, "worker")
	response, appErr := worker.Runner{
		Command:       stringOption(req, "worker_command"),
		StderrLogPath: filepath.Join(jobDir, "logs", "worker.stderr.log"),
	}.RunSTT(ctx, filepath.Join(workerDir, "request.json"), filepath.Join(workerDir, "response.json"), worker.STTRequest{
		JobID:          job.ID,
		AudioPath:      audioPath,
		ModelPath:      modelPath,
		Language:       language(req),
		Device:         stringDefault(stringOption(req, "device"), "auto"),
		ComputeType:    stringDefault(stringOption(req, "compute_type"), "auto"),
		BatchSize:      intDefault(intOption(req, "batch_size"), 8),
		WordTimestamps: wordTimestamps,
	})
	if appErr != nil {
		return Result{}, appErr
	}
	return finishTranscribe(finishTranscribeInput{
		jobDir:   jobDir,
		req:      req,
		output:   output,
		language: response.Language,
		segments: response.Segments,
		result: Result{
			Provider:   stringDefault(response.Provider, "local-faster-whisper"),
			Model:      req.Model,
			Warnings:   response.Warnings,
			ElapsedSec: time.Since(started).Seconds(),
		},
		emit: emit,
	})
}
