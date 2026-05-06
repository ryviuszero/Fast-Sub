package cli

import (
	"context"
	"os"
	"path/filepath"
	"time"

	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/subtitle"
	"fast-sub/internal/worker"
)

func transcribeLocal(ctx context.Context, cfg Config, command, input string, parsed transcribeArgs) (transcribeResult, *fserrors.AppError) {
	var empty transcribeResult
	started := time.Now()
	if parsed.provider == "api-openai-transcription" {
		return transcribeOpenAI(ctx, cfg, command, input, parsed, started)
	}
	if parsed.provider == "local-whisper-cpp" {
		return transcribeWhisperCPP(ctx, cfg, command, input, parsed, started)
	}
	if parsed.provider != "" && parsed.provider != "local-faster-whisper" {
		return empty, fserrors.New(fserrors.CodeInvalidInput, command, "unsupported provider: "+parsed.provider, "Use local-faster-whisper, local-whisper-cpp, or api-openai-transcription.", nil)
	}
	modelPath, appErr := resolveFasterWhisperModelPath(parsed, command)
	if appErr != nil {
		return empty, appErr
	}
	if err := validateChoice("language", parsed.language, []string{"auto", "zh", "en", "ja", "ko"}); err != nil {
		return empty, fserrors.New(fserrors.CodeInvalidInput, command, err.Error(), "", nil)
	}
	if err := validateChoice("device", parsed.device, []string{"auto", "cuda", "cpu"}); err != nil {
		return empty, fserrors.New(fserrors.CodeInvalidInput, command, err.Error(), "", nil)
	}
	if err := validateChoice("compute-type", parsed.computeType, []string{"auto", "float16", "int8_float16", "int8"}); err != nil {
		return empty, fserrors.New(fserrors.CodeInvalidInput, command, err.Error(), "", nil)
	}
	wordTimestamps, appErr := resolveWordTimestamps(parsed.wordTimestamps, command)
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
	if _, appErr := cfg.Runner.Probe(ctx, input, probeTimeout); appErr != nil {
		return empty, appErr
	}
	jobDir, jobID, appErr := createJobDir()
	if appErr != nil {
		return empty, appErr
	}
	audioPath := filepath.Join(jobDir, "audio.wav")
	if _, appErr := cfg.Runner.ExtractAudio(ctx, input, audioPath, extractTimeout); appErr != nil {
		return empty, appErr
	}

	requestPath := filepath.Join(jobDir, "request.json")
	responsePath := filepath.Join(jobDir, "response.json")
	stderrPath := filepath.Join(jobDir, "worker.stderr.log")
	response, appErr := worker.Runner{
		Command:       parsed.workerCommand,
		ExtraArgs:     parsed.workerArgs,
		StderrLogPath: stderrPath,
	}.RunSTT(ctx, requestPath, responsePath, worker.STTRequest{
		JobID:          jobID,
		AudioPath:      audioPath,
		ModelPath:      modelPath,
		Language:       parsed.language,
		Device:         parsed.device,
		ComputeType:    parsed.computeType,
		BatchSize:      parsed.batchSize,
		WordTimestamps: wordTimestamps,
	})
	if appErr != nil {
		return empty, appErr
	}
	refinedSegments := subtitle.RefineSegments(response.Segments, subtitle.RefineOptions{Lang: response.Language})
	srt, err := subtitle.RenderSRT(refinedSegments)
	if err != nil {
		return empty, fserrors.New(fserrors.CodeWorkerProtocol, "rendering", err.Error(), "Check worker segment timestamps and text.", nil)
	}
	if err := os.WriteFile(output, []byte(srt), 0o600); err != nil {
		return empty, classifyWriteError("rendering", "write SRT: "+err.Error())
	}
	if !parsed.keepTemp {
		_ = os.Remove(audioPath)
	}
	return transcribeResult{
		InputPath:         input,
		OutputPath:        output,
		Language:          response.Language,
		Segments:          len(refinedSegments),
		ElapsedSec:        time.Since(started).Seconds(),
		JobDir:            jobDir,
		Provider:          response.Provider,
		Model:             parsed.model,
		ActualDevice:      response.ActualDevice,
		ActualComputeType: response.ActualComputeType,
		Warnings:          response.Warnings,
	}, nil
}
