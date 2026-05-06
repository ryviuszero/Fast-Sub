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
	Warnings      []any  `json:"warnings"`
	Error         any    `json:"error"`
	ActionHint    string `json:"action_hint"`
}

type errorPayload struct {
	SchemaVersion string             `json:"schema_version"`
	OK            bool               `json:"ok"`
	Command       string             `json:"command"`
	ExitCode      int                `json:"exit_code"`
	Result        any                `json:"result"`
	Error         *fserrors.AppError `json:"error"`
	Warnings      []any              `json:"warnings"`
	ActionHint    string             `json:"action_hint"`
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
		Warnings:      []any{},
		Error:         nil,
		ActionHint:    "",
	})
}

func writeErrorJSON(w io.Writer, command string, appErr *fserrors.AppError) int {
	exitCode := fserrors.ExitCode(appErr)
	writeJSON(w, errorPayload{
		SchemaVersion: schemaVersion,
		OK:            false,
		Command:       command,
		ExitCode:      exitCode,
		Result:        nil,
		Error:         appErr,
		Warnings:      []any{},
		ActionHint:    appErr.ActionHint,
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
