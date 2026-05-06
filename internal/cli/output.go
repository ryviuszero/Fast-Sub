package cli

import (
	"encoding/json"
	"fmt"
	"io"

	fserrors "fast-sub/internal/errors"
)

const schemaVersion = "fast_sub_cli_result_v1"

type successPayload struct {
	SchemaVersion string `json:"schema_version"`
	OK            bool   `json:"ok"`
	Command       string `json:"command"`
	Result        any    `json:"result"`
}

type errorPayload struct {
	SchemaVersion string             `json:"schema_version"`
	OK            bool               `json:"ok"`
	Command       string             `json:"command"`
	ExitCode      int                `json:"exit_code"`
	Error         *fserrors.AppError `json:"error"`
}

func writeJSON(w io.Writer, payload any) {
	encoder := json.NewEncoder(w)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	_ = encoder.Encode(payload)
}

func writeSuccessJSON(w io.Writer, command string, result any) {
	writeJSON(w, successPayload{
		SchemaVersion: schemaVersion,
		OK:            true,
		Command:       command,
		Result:        result,
	})
}

func writeErrorJSON(w io.Writer, command string, appErr *fserrors.AppError) int {
	exitCode := fserrors.ExitCode(appErr)
	writeJSON(w, errorPayload{
		SchemaVersion: schemaVersion,
		OK:            false,
		Command:       command,
		ExitCode:      exitCode,
		Error:         appErr,
	})
	return exitCode
}

func writeHumanError(stderr io.Writer, appErr *fserrors.AppError) {
	if appErr == nil {
		return
	}
	fmt.Fprintf(stderr, "Error: %s\n", appErr.Message)
	if appErr.ActionHint != "" {
		fmt.Fprintf(stderr, "Hint: %s\n", appErr.ActionHint)
	}
}
