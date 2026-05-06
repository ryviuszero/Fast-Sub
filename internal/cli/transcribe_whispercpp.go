package cli

import (
	"context"
	"os"
	"path/filepath"
	"time"

	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/runtime/whispercpp"
	"fast-sub/internal/subtitle"
)

func transcribeWhisperCPP(ctx context.Context, cfg Config, command, input string, parsed transcribeArgs, started time.Time) (transcribeResult, *fserrors.AppError) {
	var empty transcribeResult
	modelPath, appErr := resolveWhisperCPPModelPath(parsed, command)
	if appErr != nil {
		return empty, appErr
	}
	if err := validateChoice("language", parsed.language, []string{"auto", "zh", "en", "ja", "ko"}); err != nil {
		return empty, fserrors.New(fserrors.CodeInvalidInput, command, err.Error(), "", nil)
	}
	if parsed.wordTimestamps != "" && parsed.wordTimestamps != "off" && parsed.wordTimestamps != "auto" {
		return empty, fserrors.New(fserrors.CodeInvalidInput, command, "--word-timestamps is not supported by local-whisper-cpp in this preview.", "Use --word-timestamps off or auto.", nil)
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
	jobDir, _, appErr := createJobDir()
	if appErr != nil {
		return empty, appErr
	}
	audioPath := filepath.Join(jobDir, "audio.wav")
	if _, appErr := cfg.Runner.ExtractAudio(ctx, input, audioPath, extractTimeout); appErr != nil {
		return empty, appErr
	}
	result, appErr := whispercpp.Transcribe(ctx, whispercpp.Options{
		Command:          parsed.whisperCommand,
		AudioPath:        audioPath,
		ModelPath:        modelPath,
		JobDir:           jobDir,
		Language:         parsed.language,
		ManagedBinaryDir: defaultManagedWhisperCPPBinaryDir(),
	})
	if appErr != nil {
		return empty, appErr
	}
	refinedSegments := subtitle.RefineSegments(result.Segments, subtitle.RefineOptions{Lang: result.Language})
	srt, err := subtitle.RenderSRT(refinedSegments)
	if err != nil {
		return empty, fserrors.New(fserrors.CodeWorkerProtocol, "rendering", err.Error(), "Check whisper.cpp segment timestamps and text.", nil)
	}
	if err := os.WriteFile(output, []byte(srt), 0o600); err != nil {
		return empty, classifyWriteError("rendering", "write SRT: "+err.Error())
	}
	if !parsed.keepTemp {
		_ = os.Remove(audioPath)
	}
	return transcribeResult{
		InputPath:  input,
		OutputPath: output,
		Language:   result.Language,
		Segments:   len(refinedSegments),
		ElapsedSec: time.Since(started).Seconds(),
		JobDir:     jobDir,
		Provider:   result.Provider,
		Model:      parsed.model,
		Warnings:   result.Warnings,
	}, nil
}
