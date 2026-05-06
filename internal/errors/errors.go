// Package errors defines Fast Sub CLI exit codes and structured errors.
package errors

import "fmt"

const (
	// ExitOK means the command succeeded.
	ExitOK = 0
	// ExitGeneral means a non-specific failure occurred.
	ExitGeneral = 1
	// ExitInvalidInput means user input or usage was invalid.
	ExitInvalidInput = 2
	// ExitMissingDependency means a required local binary is missing.
	ExitMissingDependency = 3
	// ExitProcessFailed means ffmpeg or ffprobe returned a failure.
	ExitProcessFailed = 7
	// ExitWorkerFailed means a worker process or worker protocol failed.
	ExitWorkerFailed = 8
)

const (
	CodeInvalidInput        = "invalid_input"
	CodeInvalidUsage        = "invalid_usage"
	CodeMissingDependency   = "missing_dependency"
	CodeMissingWorker       = "missing_worker"
	CodeMissingModel        = "missing_model"
	CodeMissingAPIKey       = "missing_api_key"
	CodeNotImplemented      = "not_implemented"
	CodeProviderUnavailable = "provider_unavailable"
	CodeDownloadFailed      = "download_failed"
	CodeHashMismatch        = "hash_mismatch"
	CodeOutputExists        = "output_exists"
	CodeFFmpegFailed        = "ffmpeg_failed"
	CodeFFprobeFailed       = "ffprobe_failed"
	CodeWorkerFailed        = "worker_failed"
	CodeWorkerTimeout       = "worker_timeout"
	CodeWorkerCanceled      = "worker_canceled"
	CodeWorkerProtocol      = "worker_protocol_error"
	CodeCanceled            = "canceled"
	CodePermissionDenied    = "permission_denied"
	CodeDiskFull            = "disk_full"
)

// AppError is the stable error payload used by JSON CLI output.
type AppError struct {
	Code       string         `json:"code"`
	Stage      string         `json:"stage"`
	Message    string         `json:"message"`
	ActionHint string         `json:"action_hint,omitempty"`
	Details    map[string]any `json:"details"`
}

func (e *AppError) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

// New creates a structured CLI error.
func New(code, stage, message, actionHint string, details map[string]any) *AppError {
	if details == nil {
		details = map[string]any{}
	}
	return &AppError{
		Code:       code,
		Stage:      stage,
		Message:    Redact(message),
		ActionHint: Redact(actionHint),
		Details:    RedactMap(details),
	}
}

// Wrap creates a structured CLI error while preserving contextual text.
func Wrap(code, stage, actionHint string, err error) *AppError {
	return New(code, stage, err.Error(), actionHint, nil)
}

// ExitCode maps a structured error to the process exit code contract.
func ExitCode(err *AppError) int {
	if err == nil {
		return ExitOK
	}
	switch err.Code {
	case CodeInvalidInput, CodeInvalidUsage, CodeOutputExists, CodeNotImplemented:
		return ExitInvalidInput
	case CodeMissingDependency, CodeMissingWorker:
		return ExitMissingDependency
	case CodeMissingModel:
		return 4
	case CodeDiskFull, CodeMissingAPIKey, CodeProviderUnavailable:
		return 5
	case CodePermissionDenied:
		return 6
	case CodeFFmpegFailed, CodeFFprobeFailed:
		return ExitProcessFailed
	case CodeWorkerProtocol, CodeWorkerTimeout, CodeWorkerCanceled, CodeCanceled:
		return ExitWorkerFailed
	default:
		return ExitGeneral
	}
}

// MissingDependency returns a consistent missing binary error.
func MissingDependency(stage, tool string) *AppError {
	return New(
		CodeMissingDependency,
		stage,
		fmt.Sprintf("%s was not found on PATH.", tool),
		fmt.Sprintf("Install ffmpeg and make sure %s is available on PATH.", tool),
		map[string]any{"tool": tool},
	)
}
