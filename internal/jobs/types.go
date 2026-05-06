// Package jobs implements daemon job state, persistence, and scheduling.
package jobs

import (
	"context"
	"time"

	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/events"
)

const (
	StatusCreated     = "created"
	StatusQueued      = "queued"
	StatusRunning     = "running"
	StatusCanceling   = "canceling"
	StatusSucceeded   = "succeeded"
	StatusFailed      = "failed"
	StatusCanceled    = "canceled"
	StatusInterrupted = "interrupted"
)

type CreateRequest struct {
	SchemaVersion  int               `json:"schema_version"`
	Type           string            `json:"type"`
	InputPath      string            `json:"input_path"`
	OutputPath     string            `json:"output_path"`
	Provider       string            `json:"provider"`
	Model          string            `json:"model"`
	ModelPath      string            `json:"model_path"`
	Language       string            `json:"language"`
	WordTimestamps string            `json:"word_timestamps"`
	Options        map[string]any    `json:"options"`
	Extra          map[string]string `json:"-"`
}

type Progress struct {
	Percent *int `json:"percent,omitempty"`
	Current int  `json:"current,omitempty"`
	Total   int  `json:"total,omitempty"`
}

type Result struct {
	InputPath       string   `json:"input_path"`
	OutputPath      string   `json:"output_path"`
	Language        string   `json:"language"`
	Segments        int      `json:"segments"`
	ElapsedSec      float64  `json:"elapsed_sec"`
	Provider        string   `json:"provider,omitempty"`
	Model           string   `json:"model,omitempty"`
	APIUploadFormat string   `json:"api_upload_format,omitempty"`
	Warnings        []string `json:"warnings"`
}

type Job struct {
	SchemaVersion int                `json:"schema_version"`
	ID            string             `json:"job_id"`
	Type          string             `json:"type"`
	Status        string             `json:"status"`
	Stage         string             `json:"stage"`
	Progress      Progress           `json:"progress"`
	Provider      string             `json:"provider"`
	Model         string             `json:"model"`
	InputPath     string             `json:"input_path"`
	OutputPath    string             `json:"output_path"`
	CreatedAt     time.Time          `json:"created_at"`
	StartedAt     *time.Time         `json:"started_at"`
	FinishedAt    *time.Time         `json:"finished_at"`
	Result        *Result            `json:"result,omitempty"`
	Error         *fserrors.AppError `json:"error,omitempty"`
}

type Runner interface {
	RunTranscribe(ctx context.Context, job Job, req CreateRequest, emit func(Update)) (Result, *fserrors.AppError)
}

type LogSummary struct {
	Available bool     `json:"available"`
	Lines     []string `json:"lines"`
}

type ResultEnvelope struct {
	JobID  string             `json:"job_id"`
	Status string             `json:"status"`
	Result *Result            `json:"result,omitempty"`
	Error  *fserrors.AppError `json:"error,omitempty"`
}

func Terminal(status string) bool {
	switch status {
	case StatusSucceeded, StatusFailed, StatusCanceled, StatusInterrupted:
		return true
	default:
		return false
	}
}

type Update struct {
	Event   events.Event
	Stage   string
	Percent *int
}

func EventUpdate(eventType string, data any) Update {
	return Update{Event: events.Event{Type: eventType, Data: data}}
}

func ProgressUpdate(stage string, percent int) Update {
	return Update{
		Event: events.Event{
			Type: events.TypeProgress,
			Data: map[string]any{"stage": stage, "percent": percent},
		},
		Stage:   stage,
		Percent: &percent,
	}
}
