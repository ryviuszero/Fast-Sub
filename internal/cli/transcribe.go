package cli

import (
	"context"
	"fmt"

	fserrors "fast-sub/internal/errors"
)

func runTranscribe(ctx context.Context, cfg Config, command string, args []string) int {
	parsed, err := parseTranscribeArgs(args, command)
	if err != nil {
		code := fserrors.CodeInvalidUsage
		if err.Error() == rawAPIKeyUnsupportedMessage {
			code = fserrors.CodeInvalidInput
		}
		return commandError(cfg, command, parsed.jsonOutput, fserrors.New(code, command, err.Error(), "", nil))
	}
	if len(parsed.positionals) != 1 {
		return commandError(cfg, command, parsed.jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, command, command+" requires exactly one input path", "", nil))
	}
	result, appErr := transcribeLocal(ctx, cfg, command, parsed.positionals[0], parsed)
	if appErr != nil {
		return commandError(cfg, command, parsed.jsonOutput, appErr)
	}
	if parsed.jsonOutput {
		writeSuccessJSON(cfg.Stdout, command, result)
		return fserrors.ExitOK
	}
	fmt.Fprintf(cfg.Stdout, "Wrote subtitles: %s\n", result.OutputPath)
	return fserrors.ExitOK
}

type transcribeResult struct {
	InputPath         string   `json:"input_path"`
	OutputPath        string   `json:"output_path"`
	Language          string   `json:"language"`
	Segments          int      `json:"segments"`
	ElapsedSec        float64  `json:"elapsed_sec"`
	JobDir            string   `json:"job_dir"`
	Provider          string   `json:"provider,omitempty"`
	Model             string   `json:"model,omitempty"`
	APIUploadFormat   string   `json:"api_upload_format,omitempty"`
	ActualDevice      string   `json:"actual_device,omitempty"`
	ActualComputeType string   `json:"actual_compute_type,omitempty"`
	Warnings          []string `json:"warnings,omitempty"`
}
