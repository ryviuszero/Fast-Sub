package jobs

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/events"
)

type testRunner struct{}

type blockingRunner struct {
	started chan struct{}
	done    chan struct{}
}

func (r testRunner) RunJob(ctx context.Context, job Job, req CreateRequest, emit func(Update)) (Result, *fserrors.AppError) {
	return r.RunTranscribe(ctx, job, req, emit)
}

func (testRunner) RunTranscribe(ctx context.Context, job Job, req CreateRequest, emit func(Update)) (Result, *fserrors.AppError) {
	return Result{
		InputPath:  req.InputPath,
		OutputPath: req.OutputPath,
		Language:   "en",
		Segments:   1,
		Provider:   req.Provider,
		Model:      req.Model,
		Warnings:   []string{},
	}, nil
}

func (r blockingRunner) RunJob(ctx context.Context, job Job, req CreateRequest, emit func(Update)) (Result, *fserrors.AppError) {
	return r.RunTranscribe(ctx, job, req, emit)
}

func (r blockingRunner) RunTranscribe(ctx context.Context, job Job, req CreateRequest, emit func(Update)) (Result, *fserrors.AppError) {
	if r.started != nil {
		close(r.started)
	}
	<-ctx.Done()
	time.Sleep(150 * time.Millisecond)
	if r.done != nil {
		close(r.done)
	}
	return Result{}, nil
}

func TestSanitizeRequestDoesNotMutateOptions(t *testing.T) {
	req := CreateRequest{
		Options: map[string]any{
			"api_key_env": "FAST_SUB_OPENAI_API_KEY",
			"base_url":    "http://127.0.0.1:8080",
		},
	}

	sanitized := sanitizeRequest(req)

	if req.Options["api_key_env"] != "FAST_SUB_OPENAI_API_KEY" {
		t.Fatalf("live request option was mutated: %#v", req.Options)
	}
	if sanitized.Options["api_key_env"] != "[redacted]" {
		t.Fatalf("sanitized option was not redacted: %#v", sanitized.Options)
	}
	if sanitized.Options["base_url"] != "http://127.0.0.1:8080" {
		t.Fatalf("non-secret option changed: %#v", sanitized.Options)
	}
}

func TestValidateOutputAllowsExplicitOverwrite(t *testing.T) {
	output := filepath.Join(t.TempDir(), "existing.srt")
	if err := os.WriteFile(output, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	if appErr := validateOutput(output, false); appErr == nil || appErr.Code != fserrors.CodeOutputExists {
		t.Fatalf("validateOutput without overwrite = %#v, want output_exists", appErr)
	}
	if appErr := validateOutput(output, true); appErr != nil {
		t.Fatalf("validateOutput with overwrite = %#v, want nil", appErr)
	}
}

func TestRecoverRequeuesCreatedJob(t *testing.T) {
	root := t.TempDir()
	id := "job_created"
	manager := &Manager{
		ctx:        context.Background(),
		cancel:     func() {},
		root:       root,
		maxRunning: 1,
		runner:     testRunner{},
		jobs: map[string]*Job{
			id: {
				SchemaVersion: 1,
				ID:            id,
				Type:          "transcribe",
				Status:        StatusCreated,
				Stage:         "validating",
				CreatedAt:     time.Now().UTC(),
				InputPath:     "input.mp4",
				OutputPath:    "output.srt",
				Provider:      "local-faster-whisper",
			},
		},
		eventLogs: map[string]*events.Store{},
		requests:  map[string]CreateRequest{},
		queue:     []string{},
		running:   map[string]context.CancelFunc{},
	}
	req := CreateRequest{
		SchemaVersion: 1,
		Type:          "transcribe",
		InputPath:     "input.mp4",
		OutputPath:    "output.srt",
		Provider:      "local-faster-whisper",
	}
	if err := manager.ensureJobFiles(id, req); err != nil {
		t.Fatal(err)
	}

	recovered, err := NewManager(root, 1, testRunner{})
	if err != nil {
		t.Fatal(err)
	}
	waitStatus(t, recovered, id, StatusSucceeded)
}

func TestShutdownWaitsForRunningJobsToExit(t *testing.T) {
	started := make(chan struct{})
	done := make(chan struct{})
	manager, err := NewManager(t.TempDir(), 1, blockingRunner{started: started, done: done})
	if err != nil {
		t.Fatal(err)
	}
	_, appErr := manager.Create(CreateRequest{
		SchemaVersion: 1,
		Type:          "transcribe",
		InputPath:     "input.mp4",
		OutputPath:    "output.srt",
		Provider:      "local-faster-whisper",
	})
	if appErr != nil {
		t.Fatal(appErr)
	}
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for job start")
	}

	shutdownStarted := time.Now()
	manager.Shutdown()
	if time.Since(shutdownStarted) < 150*time.Millisecond {
		t.Fatalf("shutdown returned before runner exit cleanup completed: %s", time.Since(shutdownStarted))
	}

	select {
	case <-done:
	case <-time.After(500 * time.Millisecond):
		t.Fatal("shutdown returned before running job exited")
	}
}

func waitStatus(t *testing.T, manager *Manager, id, want string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		job, appErr := manager.Get(id)
		if appErr != nil {
			t.Fatal(appErr)
		}
		if job.Status == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", want)
}
