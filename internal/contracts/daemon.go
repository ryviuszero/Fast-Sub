// Package contracts contains daemon-facing API schemas.
package contracts

import fserrors "fast-sub/internal/errors"

const DaemonSchemaVersion = 1

type APIResponse struct {
	SchemaVersion int                `json:"schema_version"`
	OK            bool               `json:"ok"`
	Result        any                `json:"result"`
	Error         *fserrors.AppError `json:"error"`
	Warnings      []string           `json:"warnings"`
}

type Ready struct {
	SchemaVersion int    `json:"schema_version"`
	Ready         bool   `json:"ready"`
	BaseURL       string `json:"base_url"`
	Token         string `json:"token"`
	PID           int    `json:"pid"`
}

func Success(result any) APIResponse {
	return APIResponse{
		SchemaVersion: DaemonSchemaVersion,
		OK:            true,
		Result:        result,
		Error:         nil,
		Warnings:      []string{},
	}
}

func Failure(err *fserrors.AppError) APIResponse {
	return APIResponse{
		SchemaVersion: DaemonSchemaVersion,
		OK:            false,
		Result:        nil,
		Error:         err,
		Warnings:      []string{},
	}
}
