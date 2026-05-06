// Package worker implements file-based Python worker protocol calls.
package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/subtitle"
)

const (
	// STTSchemaVersion is the Python-compatible numeric STT worker schema version.
	STTSchemaVersion = 1
	defaultTailLimit = 8192
)

// STTRequest is the JSON request written for the Python faster-whisper worker.
type STTRequest struct {
	SchemaVersion  int    `json:"schema_version"`
	JobID          string `json:"job_id"`
	AudioPath      string `json:"audio_path"`
	ModelPath      string `json:"model_path"`
	Language       string `json:"language"`
	Device         string `json:"device"`
	ComputeType    string `json:"compute_type"`
	BatchSize      int    `json:"batch_size"`
	VAD            string `json:"vad"`
	Mode           string `json:"mode"`
	WordTimestamps bool   `json:"word_timestamps"`
}

// STTWorkerError is the error object returned by a worker response.
type STTWorkerError struct {
	Code       string         `json:"code"`
	Message    string         `json:"message"`
	Retryable  bool           `json:"retryable"`
	Details    map[string]any `json:"details"`
	StderrTail string         `json:"stderr_tail"`
}

// STTResponse is the JSON response read from the Python faster-whisper worker.
type STTResponse struct {
	SchemaVersion     int                `json:"schema_version"`
	Provider          string             `json:"provider"`
	Language          string             `json:"language"`
	ElapsedSec        float64            `json:"elapsed_sec"`
	ActualDevice      string             `json:"actual_device"`
	ActualComputeType string             `json:"actual_compute_type"`
	Segments          []subtitle.Segment `json:"segments"`
	Warnings          []string           `json:"warnings"`
	Error             *STTWorkerError    `json:"error"`
	OK                *bool              `json:"ok,omitempty"`
}

// Runner launches a one-shot STT worker process.
type Runner struct {
	Command       string
	ExtraArgs     []string
	Timeout       time.Duration
	TailLimit     int
	StderrLogPath string
}

// RunSTT writes a request, launches the worker, and validates the response.
func (r Runner) RunSTT(ctx context.Context, requestPath, responsePath string, request STTRequest) (STTResponse, *fserrors.AppError) {
	if r.TailLimit <= 0 {
		r.TailLimit = defaultTailLimit
	}
	command, appErr := r.resolveCommand()
	if appErr != nil {
		return STTResponse{}, appErr
	}
	request.SchemaVersion = STTSchemaVersion
	if request.VAD == "" {
		request.VAD = "normal"
	}
	if request.Mode == "" {
		request.Mode = "balanced"
	}
	if err := writeJSONFile(requestPath, request); err != nil {
		return STTResponse{}, classifyFileError("writing_worker_request", "write worker request: "+err.Error())
	}
	_ = os.Remove(responsePath)

	runCtx := ctx
	cancel := func() {}
	if r.Timeout > 0 {
		runCtx, cancel = context.WithTimeout(ctx, r.Timeout)
	}
	defer cancel()

	args := append([]string{}, r.ExtraArgs...)
	args = append(args, "--request", requestPath, "--response", responsePath)
	completed := runCommand(runCtx, command, args, r.TailLimit)
	stderrTail := fserrors.Redact(completed.Stderr)
	if stderrTail != "" && r.StderrLogPath != "" {
		_ = os.WriteFile(r.StderrLogPath, []byte(stderrTail), 0o600)
	}
	if runCtx.Err() != nil {
		code := fserrors.CodeWorkerCanceled
		message := "worker was canceled"
		if errors.Is(runCtx.Err(), context.DeadlineExceeded) {
			code = fserrors.CodeWorkerTimeout
			message = "worker timed out"
		}
		return STTResponse{}, fserrors.New(code, "transcribing", message, "Retry with a shorter input or inspect the worker logs.", map[string]any{"stderr_tail": stderrTail})
	}
	response, appErr := ReadSTTResponse(responsePath)
	if appErr != nil {
		if stderrTail != "" {
			appErr.Details["stderr_tail"] = stderrTail
		}
		if completed.Err != nil {
			return STTResponse{}, fserrors.New(
				fserrors.CodeWorkerFailed,
				"transcribing",
				"worker failed: "+processMessage(completed),
				"Check worker installation and model path.",
				map[string]any{"exit_code": completed.ExitCode, "stderr_tail": stderrTail},
			)
		}
		return STTResponse{}, appErr
	}
	if response.Error != nil {
		return STTResponse{}, workerErrorToApp(response.Error, stderrTail)
	}
	if completed.Err != nil {
		return STTResponse{}, fserrors.New(
			fserrors.CodeWorkerFailed,
			"transcribing",
			"worker failed: "+processMessage(completed),
			"Check worker installation and model path.",
			map[string]any{"exit_code": completed.ExitCode, "stderr_tail": stderrTail},
		)
	}
	if completed.Stdout != "" {
		response.Warnings = append(response.Warnings, "worker stdout was not empty and was ignored")
	}
	return response, nil
}

// ReadSTTResponse reads and validates a Python-compatible worker response.
func ReadSTTResponse(responsePath string) (STTResponse, *fserrors.AppError) {
	raw, err := os.ReadFile(responsePath)
	if err != nil {
		if os.IsNotExist(err) {
			return STTResponse{}, fserrors.New(fserrors.CodeWorkerProtocol, "transcribing", "worker response file is missing", "Check that the worker can write its response path.", nil)
		}
		return STTResponse{}, classifyFileError("transcribing", "read worker response: "+err.Error())
	}
	var response STTResponse
	if err := json.Unmarshal(raw, &response); err != nil {
		return STTResponse{}, fserrors.New(fserrors.CodeWorkerProtocol, "transcribing", "worker response is invalid JSON", "Check worker protocol compatibility.", nil)
	}
	if response.SchemaVersion != STTSchemaVersion {
		return STTResponse{}, fserrors.New(
			fserrors.CodeWorkerProtocol,
			"transcribing",
			"worker response schema_version is not supported",
			"Use a worker that supports numeric schema_version 1.",
			map[string]any{"schema_version": response.SchemaVersion},
		)
	}
	if response.Error != nil {
		return response, nil
	}
	if response.OK != nil && !*response.OK {
		return STTResponse{}, fserrors.New(fserrors.CodeWorkerFailed, "transcribing", "worker returned ok=false without an error payload", "Check worker logs and protocol compatibility.", nil)
	}
	if len(response.Segments) == 0 {
		return STTResponse{}, fserrors.New(fserrors.CodeWorkerFailed, "transcribing", "worker returned no subtitle segments", "Check that the input contains speech and the selected model is valid.", nil)
	}
	if _, err := subtitle.RenderSRT(response.Segments); err != nil {
		return STTResponse{}, fserrors.New(fserrors.CodeWorkerProtocol, "transcribing", "worker returned invalid subtitle segments: "+err.Error(), "Check worker protocol compatibility.", nil)
	}
	return response, nil
}

func (r Runner) resolveCommand() (string, *fserrors.AppError) {
	command := r.Command
	if command == "" {
		command = os.Getenv("FAST_SUB_STT_WORKER_COMMAND")
	}
	if command == "" {
		command = "fast-sub-worker-faster-whisper"
	}
	path, err := exec.LookPath(command)
	if err != nil {
		return "", fserrors.New(
			fserrors.CodeMissingWorker,
			"transcribing",
			"STT worker was not found.",
			"Install fast-sub-worker-faster-whisper or pass --worker-command.",
			map[string]any{"worker_command": command},
		)
	}
	return path, nil
}

type completedProcess struct {
	Stdout   string
	Stderr   string
	ExitCode int
	Err      error
}

func runCommand(ctx context.Context, name string, args []string, tailLimit int) completedProcess {
	cmd := exec.CommandContext(ctx, name, args...)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	exitCode := 0
	if err != nil {
		exitCode = 1
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			exitCode = exitErr.ExitCode()
		}
	}
	if ctx.Err() != nil {
		err = ctx.Err()
	}
	return completedProcess{
		Stdout:   tail(stdout.String(), tailLimit),
		Stderr:   tail(stderr.String(), tailLimit),
		ExitCode: exitCode,
		Err:      err,
	}
}

func writeJSONFile(path string, payload any) error {
	raw, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return os.WriteFile(path, raw, 0o600)
}

func workerErrorToApp(workerErr *STTWorkerError, stderrTail string) *fserrors.AppError {
	code := normalizeWorkerCode(workerErr.Code)
	message := workerErr.Message
	if message == "" {
		message = "worker returned an error"
	}
	details := map[string]any{"worker_code": workerErr.Code, "retryable": workerErr.Retryable}
	for key, value := range workerErr.Details {
		details[key] = value
	}
	if workerErr.StderrTail != "" {
		details["worker_stderr_tail"] = workerErr.StderrTail
	}
	if stderrTail != "" {
		details["stderr_tail"] = stderrTail
	}
	return fserrors.New(code, "transcribing", message, "Check worker installation and model path.", details)
}

func normalizeWorkerCode(code string) string {
	switch strings.ToUpper(code) {
	case "MODEL_NOT_FOUND":
		return fserrors.CodeMissingModel
	case "INVALID_REQUEST":
		return fserrors.CodeWorkerProtocol
	case "MISSING_DEPENDENCY":
		return fserrors.CodeMissingDependency
	case "TRANSCRIBE_FAILED", "EMPTY_SEGMENTS":
		return fserrors.CodeWorkerFailed
	default:
		return fserrors.CodeWorkerFailed
	}
}

func processMessage(completed completedProcess) string {
	message := strings.TrimSpace(completed.Stderr)
	if message == "" {
		message = strings.TrimSpace(completed.Stdout)
	}
	if message == "" {
		message = fmt.Sprintf("process exited with code %d", completed.ExitCode)
	}
	return fserrors.Redact(message)
}

func classifyFileError(stage, message string) *fserrors.AppError {
	code := fserrors.CodeInvalidInput
	lower := strings.ToLower(message)
	if strings.Contains(lower, "permission") || strings.Contains(lower, "access is denied") {
		code = fserrors.CodePermissionDenied
	}
	if strings.Contains(lower, "no space") || strings.Contains(lower, "disk full") {
		code = fserrors.CodeDiskFull
	}
	return fserrors.New(code, stage, message, "Check that Fast Sub can write the job directory.", nil)
}

func tail(value string, limit int) string {
	if limit <= 0 || len(value) <= limit {
		return value
	}
	return value[len(value)-limit:]
}
