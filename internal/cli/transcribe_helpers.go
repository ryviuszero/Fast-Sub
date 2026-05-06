package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/paths"
)

func resolveWordTimestamps(value, command string) (bool, *fserrors.AppError) {
	switch value {
	case "", "off":
		return false, nil
	case "on":
		return true, nil
	case "auto":
		return false, nil
	default:
		return false, fserrors.New(fserrors.CodeInvalidInput, command, "--word-timestamps must be one of: auto, on, off", "", nil)
	}
}

func validateChoice(name, value string, allowed []string) error {
	for _, item := range allowed {
		if value == item {
			return nil
		}
	}
	return fmt.Errorf("--%s must be one of: %s", name, strings.Join(allowed, ", "))
}

func validateSRTOutput(output string) *fserrors.AppError {
	if err := paths.ValidateOutputPath(output); err != nil {
		code := fserrors.CodeInvalidInput
		if strings.Contains(err.Error(), "already exists") {
			code = fserrors.CodeOutputExists
		}
		return fserrors.New(code, "rendering", err.Error(), "Choose a different --output path.", nil)
	}
	return nil
}

func defaultSRTPath(input string) string {
	ext := filepath.Ext(input)
	if ext == "" {
		return input + ".srt"
	}
	return strings.TrimSuffix(input, ext) + ".srt"
}

func createJobDir() (string, string, *fserrors.AppError) {
	jobID := fmt.Sprintf("job_%d", time.Now().UnixNano())
	jobDir := filepath.Join(".fast-sub", "jobs", jobID)
	if err := os.MkdirAll(jobDir, 0o700); err != nil {
		return "", "", classifyWriteError("creating_job", "create job directory: "+err.Error())
	}
	return jobDir, jobID, nil
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
