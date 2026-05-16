package daemon

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"fast-sub/internal/contracts"
	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/events"
	"fast-sub/internal/jobs"
	"fast-sub/internal/providers"
)

type fakeRunner struct {
	block   chan struct{}
	started chan string
	secret  string
}

func (r fakeRunner) RunJob(ctx context.Context, job jobs.Job, req jobs.CreateRequest, emit func(jobs.Update)) (jobs.Result, *fserrors.AppError) {
	return r.RunTranscribe(ctx, job, req, emit)
}

type captureRunner struct {
	requests chan jobs.CreateRequest
}

func (r captureRunner) RunJob(ctx context.Context, job jobs.Job, req jobs.CreateRequest, emit func(jobs.Update)) (jobs.Result, *fserrors.AppError) {
	return r.RunTranscribe(ctx, job, req, emit)
}

func (r captureRunner) RunTranscribe(ctx context.Context, job jobs.Job, req jobs.CreateRequest, emit func(jobs.Update)) (jobs.Result, *fserrors.AppError) {
	r.requests <- req
	return jobs.Result{InputPath: req.InputPath, OutputPath: req.OutputPath, Provider: req.Provider, Model: req.Model, Warnings: []string{}}, nil
}

func (r fakeRunner) RunTranscribe(ctx context.Context, job jobs.Job, req jobs.CreateRequest, emit func(jobs.Update)) (jobs.Result, *fserrors.AppError) {
	if r.started != nil {
		r.started <- job.ID
	}
	emit(jobs.ProgressUpdate("transcribing", 40))
	if r.secret != "" {
		emit(jobs.EventUpdate(events.TypeLog, map[string]any{"message": "Authorization: Bearer " + r.secret}))
	}
	if r.block != nil {
		select {
		case <-ctx.Done():
			return jobs.Result{}, fserrors.New(fserrors.CodeCanceled, "cancel", "canceled", "", nil)
		case <-r.block:
		}
	}
	return jobs.Result{
		InputPath:  req.InputPath,
		OutputPath: req.OutputPath,
		Language:   "en",
		Segments:   1,
		Provider:   req.Provider,
		Model:      req.Model,
		Warnings:   []string{},
	}, nil
}

type shutdownRunner struct {
	started  chan struct{}
	canceled chan struct{}
}

func (r shutdownRunner) RunJob(ctx context.Context, job jobs.Job, req jobs.CreateRequest, emit func(jobs.Update)) (jobs.Result, *fserrors.AppError) {
	return r.RunTranscribe(ctx, job, req, emit)
}

func (r shutdownRunner) RunTranscribe(ctx context.Context, job jobs.Job, req jobs.CreateRequest, emit func(jobs.Update)) (jobs.Result, *fserrors.AppError) {
	close(r.started)
	<-ctx.Done()
	close(r.canceled)
	return jobs.Result{
		InputPath:  req.InputPath,
		OutputPath: req.OutputPath,
		Language:   "en",
		Segments:   1,
		Provider:   req.Provider,
		Warnings:   []string{},
	}, nil
}

func TestServer_AuthAndCORS(t *testing.T) {
	t.Parallel()
	srv := newTestHTTPServer(t, fakeRunner{})
	defer srv.Close()

	resp, body := request(t, srv.URL, http.MethodGet, "/v1/health", "", nil, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("health status = %d body=%s", resp.StatusCode, body)
	}
	if resp.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("CORS should be disabled by default")
	}

	resp, body = request(t, srv.URL, http.MethodGet, "/v1/jobs", "", nil, "")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("jobs without token status = %d body=%s", resp.StatusCode, body)
	}
	var decoded contracts.APIResponse
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Error == nil || decoded.Error.Code != "unauthorized" {
		t.Fatalf("error = %#v", decoded.Error)
	}
}

func TestServer_DeleteModelRemovesManagedModel(t *testing.T) {
	t.Setenv("FAST_SUB_MODEL_STORE_DIR", t.TempDir())
	srv := newTestHTTPServer(t, fakeRunner{})
	defer srv.Close()

	resp, body := request(t, srv.URL, http.MethodDelete, "/v1/models/whisper-base", "test-token", nil, "")
	if resp.StatusCode != http.StatusOK || !bytes.Contains(body, []byte(`"removed":true`)) || !bytes.Contains(body, []byte(`"status":"missing"`)) {
		t.Fatalf("delete model status=%d body=%s", resp.StatusCode, body)
	}
}

func TestServer_ConfigPatchPreservesPreviousValues(t *testing.T) {
	t.Parallel()
	srv := newTestHTTPServer(t, fakeRunner{})
	defer srv.Close()

	resp, body := request(t, srv.URL, http.MethodPatch, "/v1/config", "test-token", map[string]any{
		"schema_version": 1,
		"patch": map[string]any{
			"output_type": "bilingual_srt",
		},
	}, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch output_type status=%d body=%s", resp.StatusCode, body)
	}
	resp, body = request(t, srv.URL, http.MethodPatch, "/v1/config", "test-token", map[string]any{
		"schema_version": 1,
		"patch": map[string]any{
			"output_format": "vtt",
		},
	}, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch output_format status=%d body=%s", resp.StatusCode, body)
	}
	if !bytes.Contains(body, []byte(`"output_type":"bilingual_srt"`)) || !bytes.Contains(body, []byte(`"output_format":"vtt"`)) {
		t.Fatalf("config patch did not preserve previous values: %s", body)
	}
	resp, body = request(t, srv.URL, http.MethodGet, "/v1/config", "test-token", nil, "")
	if resp.StatusCode != http.StatusOK || !bytes.Contains(body, []byte(`"output_type":"bilingual_srt"`)) || !bytes.Contains(body, []byte(`"output_format":"vtt"`)) {
		t.Fatalf("get config did not preserve patches status=%d body=%s", resp.StatusCode, body)
	}
}

func TestServer_ConfigPatchPersistsToFile(t *testing.T) {
	t.Parallel()
	configPath := filepath.Join(t.TempDir(), "fast-sub-go.toml")
	server, err := New(Config{
		Token:      "test-token",
		JobRoot:    t.TempDir(),
		ConfigPath: configPath,
		Runner:     fakeRunner{},
	})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(server)
	defer srv.Close()

	resp, body := request(t, srv.URL, http.MethodPatch, "/v1/config", "test-token", map[string]any{
		"schema_version": 1,
		"patch": map[string]any{
			"language":                       "en",
			"target_language":                "zh",
			"output_type":                    "bilingual_srt",
			"output_format":                  "vtt",
			"folder_scan_include_subfolders": true,
			"folder_scan_max_files":          200,
		},
	}, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch config status=%d body=%s", resp.StatusCode, body)
	}
	raw, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(raw, []byte(`output_type = "bilingual_srt"`)) || !bytes.Contains(raw, []byte(`output_format = "vtt"`)) || !bytes.Contains(raw, []byte(`folder_scan_include_subfolders = true`)) || !bytes.Contains(raw, []byte(`folder_scan_max_files = 200`)) {
		t.Fatalf("config file did not persist patch: %s", raw)
	}

	restarted, err := New(Config{
		Token:      "test-token",
		JobRoot:    t.TempDir(),
		ConfigPath: configPath,
		Runner:     fakeRunner{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if restarted.runtimeConfig.OutputType != "bilingual_srt" || restarted.runtimeConfig.OutputFormat != "vtt" || restarted.runtimeConfig.Language != "en" || !restarted.runtimeConfig.FolderScanIncludeSubfolders || restarted.runtimeConfig.FolderScanMaxFiles != 200 {
		t.Fatalf("restarted config = %#v", restarted.runtimeConfig)
	}
}

func TestServer_ConfigPatchKeepsAPIProvidersIndependent(t *testing.T) {
	t.Parallel()
	configPath := filepath.Join(t.TempDir(), "fast-sub-go.toml")
	server, err := New(Config{
		Token:      "test-token",
		JobRoot:    t.TempDir(),
		ConfigPath: configPath,
		Runner:     fakeRunner{},
	})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(server)
	defer srv.Close()

	resp, body := request(t, srv.URL, http.MethodPatch, "/v1/config", "test-token", map[string]any{
		"schema_version": 1,
		"patch": map[string]any{
			"api_providers": map[string]any{
				"api-openai-transcription": map[string]any{
					"base_url":      "https://api.openai.com/v1",
					"model":         "gpt-4o-transcribe",
					"api_key_alias": "FAST_SUB_OPENAI_TRANSCRIPTION_API_KEY",
				},
				"api-openai-chat": map[string]any{
					"base_url":      "http://127.0.0.1:1234/v1",
					"model":         "qwen/qwen3-4b-2507",
					"api_key_alias": "FAST_SUB_OPENAI_CHAT_API_KEY",
				},
			},
		},
	}, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("patch config status=%d body=%s", resp.StatusCode, body)
	}
	if !bytes.Contains(body, []byte(`"api-openai-transcription":{"api_key_alias":"FAST_SUB_OPENAI_TRANSCRIPTION_API_KEY","api_key_status":"missing","base_url":"https://api.openai.com/v1","model":"gpt-4o-transcribe"`)) {
		t.Fatalf("transcription provider config missing from response: %s", body)
	}
	if !bytes.Contains(body, []byte(`"api-openai-chat":{"api_key_alias":"FAST_SUB_OPENAI_CHAT_API_KEY","api_key_status":"missing","base_url":"http://127.0.0.1:1234/v1","model":"qwen/qwen3-4b-2507"`)) {
		t.Fatalf("chat provider config missing from response: %s", body)
	}

	raw, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(raw, []byte(`[providers.api-openai-transcription]`)) || !bytes.Contains(raw, []byte(`[providers.api-openai-chat]`)) {
		t.Fatalf("provider sections were not persisted independently: %s", raw)
	}
	if !bytes.Contains(raw, []byte(`api_key_env = "FAST_SUB_OPENAI_TRANSCRIPTION_API_KEY"`)) || !bytes.Contains(raw, []byte(`api_key_env = "FAST_SUB_OPENAI_CHAT_API_KEY"`)) {
		t.Fatalf("provider key aliases were not persisted independently: %s", raw)
	}
	if !bytes.Contains(raw, []byte(`model = "gpt-4o-transcribe"`)) || !bytes.Contains(raw, []byte(`model = "qwen/qwen3-4b-2507"`)) {
		t.Fatalf("provider models were not persisted independently: %s", raw)
	}
}

func TestServer_RejectsNonLoopbackHost(t *testing.T) {
	t.Parallel()
	_, err := New(Config{
		Host:    "0.0.0.0",
		Token:   "test-token",
		JobRoot: t.TempDir(),
		Runner:  fakeRunner{},
	})
	if err == nil {
		t.Fatal("expected non-loopback host to be rejected")
	}
}

func TestServer_IPv6ReadyURLUsesBrackets(t *testing.T) {
	t.Parallel()
	server, err := New(Config{
		Host:    "::1",
		Token:   "test-token",
		JobRoot: t.TempDir(),
		Runner:  fakeRunner{},
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ready, err := server.ListenAndServe(ctx)
	if err != nil {
		t.Skipf("IPv6 loopback is unavailable: %v", err)
	}
	parsed, err := url.Parse(ready.BaseURL)
	if err != nil {
		t.Fatalf("ready base_url is invalid: %q: %v", ready.BaseURL, err)
	}
	if parsed.Hostname() != "::1" || !strings.HasPrefix(ready.BaseURL, "http://[::1]:") {
		t.Fatalf("ready base_url = %q", ready.BaseURL)
	}
}

func TestServer_ShutdownCancelsRunningJob(t *testing.T) {
	t.Parallel()
	started := make(chan struct{})
	canceled := make(chan struct{})
	server, err := New(Config{
		Token:   "test-token",
		JobRoot: t.TempDir(),
		Runner: shutdownRunner{
			started:  started,
			canceled: canceled,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	ready, err := server.ListenAndServe(ctx)
	if err != nil {
		t.Fatal(err)
	}
	jobID := createJob(t, ready.BaseURL, "input.mp4", "input.srt")
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		cancel()
		t.Fatal("timed out waiting for job start")
	}

	cancel()
	select {
	case <-canceled:
	case <-time.After(3 * time.Second):
		t.Fatal("runner did not receive daemon shutdown cancellation")
	}
	waitManagerStatus(t, server.manager, jobID, jobs.StatusCanceled)
	job, appErr := server.manager.Get(jobID)
	if appErr != nil {
		t.Fatal(appErr)
	}
	if job.Status == jobs.StatusSucceeded || job.Result != nil {
		t.Fatalf("shutdown job should not succeed: %#v", job)
	}
}

func TestServer_JobsLifecycle(t *testing.T) {
	t.Parallel()
	srv := newTestHTTPServer(t, fakeRunner{})
	defer srv.Close()

	req := jobs.CreateRequest{
		SchemaVersion: 1,
		Type:          "transcribe",
		InputPath:     "input.mp4",
		OutputPath:    "output.srt",
		Provider:      "local-faster-whisper",
		Model:         "whisper-small",
	}
	resp, body := request(t, srv.URL, http.MethodPost, "/v1/jobs", "test-token", req, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create status = %d body=%s", resp.StatusCode, body)
	}
	jobID := resultString(t, body, "job_id")
	waitForStatus(t, srv.URL, jobID, jobs.StatusSucceeded)

	resp, body = request(t, srv.URL, http.MethodGet, "/v1/jobs", "test-token", nil, "")
	if resp.StatusCode != http.StatusOK || !bytes.Contains(body, []byte(jobID)) {
		t.Fatalf("list status=%d body=%s", resp.StatusCode, body)
	}
	resp, body = request(t, srv.URL, http.MethodGet, "/v1/jobs/"+jobID, "test-token", nil, "")
	if resp.StatusCode != http.StatusOK || !bytes.Contains(body, []byte(jobs.StatusSucceeded)) {
		t.Fatalf("get status=%d body=%s", resp.StatusCode, body)
	}
	resp, body = request(t, srv.URL, http.MethodGet, "/v1/jobs/"+jobID+"/result", "test-token", nil, "")
	if resp.StatusCode != http.StatusOK || !bytes.Contains(body, []byte(`"segments":1`)) {
		t.Fatalf("result status=%d body=%s", resp.StatusCode, body)
	}
	resp, body = request(t, srv.URL, http.MethodGet, "/v1/jobs/"+jobID+"/logs", "test-token", nil, "")
	if resp.StatusCode != http.StatusOK || !bytes.Contains(body, []byte(`"available":false`)) {
		t.Fatalf("logs status=%d body=%s", resp.StatusCode, body)
	}
	resp, body = request(t, srv.URL, http.MethodDelete, "/v1/jobs/"+jobID, "test-token", nil, "")
	if resp.StatusCode != http.StatusOK || !bytes.Contains(body, []byte(`"deleted":true`)) {
		t.Fatalf("delete status=%d body=%s", resp.StatusCode, body)
	}
}

func TestServer_TransientSecretRefFeedsRunnerWithoutPersistence(t *testing.T) {
	t.Parallel()
	requests := make(chan jobs.CreateRequest, 1)
	srv, root := newTestHTTPServerWithRoot(t, captureRunner{requests: requests})
	defer srv.Close()

	resp, body := request(t, srv.URL, http.MethodPost, "/v1/secrets", "test-token", map[string]any{
		"schema_version": 1,
		"provider_id":    "api-openai-transcription",
		"secret":         "sk-test-transient-secret",
	}, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create secret status=%d body=%s", resp.StatusCode, body)
	}
	var envelope struct {
		Result struct {
			SecretRef string `json:"secret_ref"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Result.SecretRef == "" {
		t.Fatalf("missing secret ref in %s", body)
	}

	resp, body = request(t, srv.URL, http.MethodPost, "/v1/jobs", "test-token", jobs.CreateRequest{
		SchemaVersion: 1,
		Type:          "transcribe",
		InputPath:     "input.mp4",
		OutputPath:    "out.srt",
		Provider:      "api-openai-transcription",
		Model:         "gpt-4o-transcribe",
		Options:       map[string]any{"api_key_secret_ref": envelope.Result.SecretRef},
	}, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create job status=%d body=%s", resp.StatusCode, body)
	}
	var req jobs.CreateRequest
	select {
	case req = <-requests:
	case <-time.After(2 * time.Second):
		t.Fatal("runner did not receive request")
	}
	if req.Extra["openai_transcription_api_key"] != "sk-test-transient-secret" {
		t.Fatalf("runner did not receive transient secret: %#v", req.Extra)
	}
	raw, err := os.ReadFile(filepath.Join(root, firstJobID(t, root), "request.json"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("sk-test-transient-secret")) || bytes.Contains(raw, []byte(envelope.Result.SecretRef)) {
		t.Fatalf("request.json leaked secret/ref: %s", raw)
	}

	resp, body = request(t, srv.URL, http.MethodPost, "/v1/jobs", "test-token", jobs.CreateRequest{
		SchemaVersion: 1,
		Type:          "transcribe",
		InputPath:     "input-2.mp4",
		OutputPath:    "out-2.srt",
		Provider:      "api-openai-transcription",
		Model:         "gpt-4o-transcribe",
		Options:       map[string]any{"api_key_secret_ref": envelope.Result.SecretRef},
	}, "")
	if resp.StatusCode != http.StatusInternalServerError || !bytes.Contains(body, []byte("secret_ref_consumed")) {
		t.Fatalf("reused secret ref status=%d body=%s", resp.StatusCode, body)
	}
}

func TestServer_ProviderSecretRuntimeEnvIsScoped(t *testing.T) {
	t.Parallel()
	cfg := withProviderSecret(providers.RuntimeConfig{
		Env: func(key string) string {
			return "outer-" + key
		},
	}, "api-openai-chat", "sk-chat-secret")

	if got := cfg.Env("FAST_SUB_OPENAI_CHAT_API_KEY"); got != "sk-chat-secret" {
		t.Fatalf("chat key env = %q", got)
	}
	if got := cfg.Env("OPENAI_API_KEY"); got != "sk-chat-secret" {
		t.Fatalf("legacy openai key env = %q", got)
	}
	if got := cfg.Env("FAST_SUB_OPENAI_TRANSCRIPTION_API_KEY"); got != "outer-FAST_SUB_OPENAI_TRANSCRIPTION_API_KEY" {
		t.Fatalf("transcription key env should not receive chat secret, got %q", got)
	}
	if got := cfg.Env("FAST_SUB_DAEMON_TOKEN"); got != "outer-FAST_SUB_DAEMON_TOKEN" {
		t.Fatalf("unrelated token env should not receive provider secret, got %q", got)
	}
}

func TestServer_MaxRunningJobsAndCancelQueued(t *testing.T) {
	t.Parallel()
	block := make(chan struct{})
	started := make(chan string, 2)
	srv := newTestHTTPServer(t, fakeRunner{block: block, started: started})
	defer srv.Close()

	first := createJob(t, srv.URL, "a.mp4", "a.srt")
	second := createJob(t, srv.URL, "b.mp4", "b.srt")
	select {
	case got := <-started:
		if got != first {
			t.Fatalf("first started id = %s, want %s", got, first)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for first job start")
	}
	if status := getJobStatus(t, srv.URL, second); status != jobs.StatusQueued {
		t.Fatalf("second status = %s, want queued", status)
	}
	resp, body := request(t, srv.URL, http.MethodPost, "/v1/jobs/"+second+"/cancel", "test-token", nil, "")
	if resp.StatusCode != http.StatusOK || !bytes.Contains(body, []byte(jobs.StatusCanceled)) {
		t.Fatalf("cancel queued status=%d body=%s", resp.StatusCode, body)
	}
	close(block)
	waitForStatus(t, srv.URL, first, jobs.StatusSucceeded)
}

func TestServer_CancelRunningAndResultInvalidState(t *testing.T) {
	t.Parallel()
	block := make(chan struct{})
	srv := newTestHTTPServer(t, fakeRunner{block: block, started: make(chan string, 1)})
	defer srv.Close()
	jobID := createJob(t, srv.URL, "input.mp4", "input.srt")
	waitForStatus(t, srv.URL, jobID, jobs.StatusRunning)

	resp, body := request(t, srv.URL, http.MethodGet, "/v1/jobs/"+jobID+"/result", "test-token", nil, "")
	if resp.StatusCode != http.StatusConflict || !bytes.Contains(body, []byte("invalid_state")) {
		t.Fatalf("nonterminal result status=%d body=%s", resp.StatusCode, body)
	}
	resp, body = request(t, srv.URL, http.MethodPost, "/v1/jobs/"+jobID+"/cancel", "test-token", nil, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("cancel running status=%d body=%s", resp.StatusCode, body)
	}
	waitForStatus(t, srv.URL, jobID, jobs.StatusCanceled)

	resp, body = request(t, srv.URL, http.MethodGet, "/v1/jobs/"+jobID+"/result", "test-token", nil, "")
	if resp.StatusCode != http.StatusOK ||
		!bytes.Contains(body, []byte(`"status":"canceled"`)) ||
		!bytes.Contains(body, []byte(`"error"`)) {
		t.Fatalf("canceled result status=%d body=%s", resp.StatusCode, body)
	}
}

func TestServer_SSEReplayGapAndRedaction(t *testing.T) {
	t.Parallel()
	srv := newTestHTTPServer(t, fakeRunner{secret: "test-token"})
	defer srv.Close()
	jobID := createJob(t, srv.URL, "input.mp4", "input.srt")
	waitForStatus(t, srv.URL, jobID, jobs.StatusSucceeded)

	resp, body := request(t, srv.URL, http.MethodGet, "/v1/jobs/"+jobID+"/events", "test-token", nil, "1")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("events status=%d body=%s", resp.StatusCode, body)
	}
	text := readSSEPrefix(t, resp.Body, "completed")
	if strings.Contains(text, "test-token") {
		t.Fatalf("SSE leaked token: %s", text)
	}
	if !strings.Contains(text, `"stage":"transcribing"`) || strings.Contains(text, `"data":`) {
		t.Fatalf("SSE payload should be flattened: %s", text)
	}

	server := srv.Config.Handler.(*Server)
	store, appErr := server.manager.Events(jobID)
	if appErr != nil {
		t.Fatal(appErr)
	}
	store.DropReplayBefore(3)
	resp, body = request(t, srv.URL, http.MethodGet, "/v1/jobs/"+jobID+"/events", "test-token", nil, "1")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("events gap status=%d body=%s", resp.StatusCode, body)
	}
	text = readSSEPrefix(t, resp.Body, "events_lost")
	if !strings.Contains(text, "events_lost") {
		t.Fatalf("missing events_lost: %s", text)
	}
}

func TestServer_LogsExposeRunnerLogFiles(t *testing.T) {
	t.Parallel()
	srv, root := newTestHTTPServerWithRoot(t, fakeRunner{})
	defer srv.Close()
	jobID := createJob(t, srv.URL, "input.mp4", "input.srt")
	waitForStatus(t, srv.URL, jobID, jobs.StatusSucceeded)
	logPath := filepath.Join(root, jobID, "logs", "worker.stderr.log")
	if err := os.WriteFile(logPath, []byte("starting\nAuthorization: Bearer test-token\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	resp, body := request(t, srv.URL, http.MethodGet, "/v1/jobs/"+jobID+"/logs", "test-token", nil, "")
	if resp.StatusCode != http.StatusOK ||
		!bytes.Contains(body, []byte(`"available":true`)) ||
		!bytes.Contains(body, []byte("worker.stderr.log: starting")) {
		t.Fatalf("logs status=%d body=%s", resp.StatusCode, body)
	}
	if bytes.Contains(body, []byte("test-token")) {
		t.Fatalf("logs leaked token: %s", body)
	}
}

func TestServer_RestartMarksRunningInterrupted(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	block := make(chan struct{})
	manager, err := jobs.NewManager(root, 1, fakeRunner{block: block})
	if err != nil {
		t.Fatal(err)
	}
	job, appErr := manager.Create(jobs.CreateRequest{SchemaVersion: 1, Type: "transcribe", InputPath: "input.mp4", OutputPath: "out.srt", Provider: "local-faster-whisper"})
	if appErr != nil {
		t.Fatal(appErr)
	}
	waitManagerStatus(t, manager, job.ID, jobs.StatusRunning)

	recovered, err := jobs.NewManager(root, 1, fakeRunner{})
	if err != nil {
		t.Fatal(err)
	}
	recoveredJob, appErr := recovered.Get(job.ID)
	if appErr != nil {
		t.Fatal(appErr)
	}
	if recoveredJob.Status != jobs.StatusInterrupted || recoveredJob.FinishedAt == nil || recoveredJob.Error == nil {
		t.Fatalf("recovered job = %#v", recoveredJob)
	}
	close(block)
}

func TestServer_RestartRecoversQueuedJobs(t *testing.T) {
	t.Parallel()
	root := t.TempDir()
	block := make(chan struct{})
	started := make(chan string, 4)
	manager, err := jobs.NewManager(root, 1, fakeRunner{block: block, started: started})
	if err != nil {
		t.Fatal(err)
	}
	first, appErr := manager.Create(jobs.CreateRequest{SchemaVersion: 1, Type: "transcribe", InputPath: "first.mp4", OutputPath: "first.srt", Provider: "local-faster-whisper"})
	if appErr != nil {
		t.Fatal(appErr)
	}
	second, appErr := manager.Create(jobs.CreateRequest{SchemaVersion: 1, Type: "transcribe", InputPath: "second.mp4", OutputPath: "second.srt", Provider: "local-faster-whisper"})
	if appErr != nil {
		t.Fatal(appErr)
	}
	waitManagerStatus(t, manager, first.ID, jobs.StatusRunning)
	waitManagerStatus(t, manager, second.ID, jobs.StatusQueued)

	recovered, err := jobs.NewManager(root, 1, fakeRunner{})
	if err != nil {
		t.Fatal(err)
	}
	waitManagerStatus(t, recovered, second.ID, jobs.StatusSucceeded)
	recoveredFirst, appErr := recovered.Get(first.ID)
	if appErr != nil {
		t.Fatal(appErr)
	}
	if recoveredFirst.Status != jobs.StatusInterrupted {
		t.Fatalf("first status after recovery = %s, want interrupted", recoveredFirst.Status)
	}
	close(block)
	waitManagerStatus(t, manager, first.ID, jobs.StatusSucceeded)
}

func newTestHTTPServer(t *testing.T, runner fakeRunner) *httptest.Server {
	t.Helper()
	srv, _ := newTestHTTPServerWithRoot(t, runner)
	return srv
}

func newTestHTTPServerWithRoot(t *testing.T, runner jobs.Runner) (*httptest.Server, string) {
	t.Helper()
	root := t.TempDir()
	s, err := New(Config{
		Token:          "test-token",
		JobRoot:        root,
		MaxRunningJobs: 1,
		Runner:         runner,
	})
	if err != nil {
		t.Fatal(err)
	}
	return httptest.NewServer(s), root
}

func firstJobID(t *testing.T, root string) string {
	t.Helper()
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.IsDir() {
			return entry.Name()
		}
	}
	t.Fatal("no job directory")
	return ""
}

func request(t *testing.T, baseURL, method, path, token string, payload any, lastEventID string) (*http.Response, []byte) {
	t.Helper()
	var body io.Reader
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, baseURL+path, body)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if lastEventID != "" {
		req.Header.Set("Last-Event-ID", lastEventID)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(path, "/events") && resp.StatusCode == http.StatusOK {
		return resp, nil
	}
	raw, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	return resp, raw
}

func createJob(t *testing.T, baseURL, input, output string) string {
	t.Helper()
	req := jobs.CreateRequest{SchemaVersion: 1, Type: "transcribe", InputPath: input, OutputPath: output, Provider: "local-faster-whisper", Model: "whisper-small"}
	resp, body := request(t, baseURL, http.MethodPost, "/v1/jobs", "test-token", req, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("create status=%d body=%s", resp.StatusCode, body)
	}
	return resultString(t, body, "job_id")
}

func resultString(t *testing.T, body []byte, key string) string {
	t.Helper()
	var decoded struct {
		Result map[string]any `json:"result"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatal(err)
	}
	value, _ := decoded.Result[key].(string)
	if value == "" {
		t.Fatalf("missing result.%s in %s", key, body)
	}
	return value
}

func getJobStatus(t *testing.T, baseURL, jobID string) string {
	t.Helper()
	resp, body := request(t, baseURL, http.MethodGet, "/v1/jobs/"+jobID, "test-token", nil, "")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get job status=%d body=%s", resp.StatusCode, body)
	}
	var decoded struct {
		Result jobs.Job `json:"result"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatal(err)
	}
	return decoded.Result.Status
}

func waitForStatus(t *testing.T, baseURL, jobID, want string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if status := getJobStatus(t, baseURL, jobID); status == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", want)
}

func waitManagerStatus(t *testing.T, manager *jobs.Manager, jobID, want string) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		job, appErr := manager.Get(jobID)
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

func readSSEPrefix(t *testing.T, body io.Reader, untilEvent string) string {
	t.Helper()
	scanner := bufio.NewScanner(body)
	var out strings.Builder
	deadline := time.After(3 * time.Second)
	lines := make(chan string, 32)
	go func() {
		for scanner.Scan() {
			lines <- scanner.Text()
		}
		close(lines)
	}()
	for {
		select {
		case line, ok := <-lines:
			if !ok {
				return out.String()
			}
			out.WriteString(line)
			out.WriteByte('\n')
			if strings.Contains(line, "event: "+untilEvent) {
				return out.String()
			}
		case <-deadline:
			t.Fatalf("timed out reading SSE; got:\n%s", out.String())
		}
	}
}
