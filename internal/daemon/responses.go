package daemon

import (
	"encoding/json"
	"net/http"

	"fast-sub/internal/contracts"
	fserrors "fast-sub/internal/errors"
)

func writeOK(w http.ResponseWriter, result any) {
	writeJSON(w, http.StatusOK, contracts.Success(result))
}

func writeResultOrError(w http.ResponseWriter, result any, appErr *fserrors.AppError) {
	if appErr != nil {
		writeAppError(w, appErr)
		return
	}
	writeOK(w, result)
}

func writeAppError(w http.ResponseWriter, appErr *fserrors.AppError) {
	status := http.StatusInternalServerError
	switch appErr.Code {
	case fserrors.CodeInvalidInput, fserrors.CodeInvalidUsage:
		status = http.StatusBadRequest
	case "unauthorized":
		status = http.StatusUnauthorized
	case "unknown_job":
		status = http.StatusNotFound
	case "invalid_state", fserrors.CodeOutputExists:
		status = http.StatusConflict
	}
	writeError(w, status, appErr)
}

func writeError(w http.ResponseWriter, status int, appErr *fserrors.AppError) {
	writeJSON(w, status, contracts.Failure(appErr))
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	encoder := json.NewEncoder(w)
	encoder.SetEscapeHTML(false)
	_ = encoder.Encode(payload)
}

func unknownRoute() *fserrors.AppError {
	return fserrors.New(fserrors.CodeInvalidInput, "routing", "unknown route.", "", nil)
}
