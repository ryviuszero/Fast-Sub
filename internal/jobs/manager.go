package jobs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/events"
)

type Manager struct {
	mu         sync.Mutex
	ctx        context.Context
	cancel     context.CancelFunc
	root       string
	maxRunning int
	runner     Runner
	jobs       map[string]*Job
	eventLogs  map[string]*events.Store
	requests   map[string]CreateRequest
	queue      []string
	running    map[string]context.CancelFunc
}

func NewManager(root string, maxRunning int, runner Runner) (*Manager, error) {
	if root == "" {
		root = filepath.Join(".fast-sub", "jobs")
	}
	if maxRunning <= 0 {
		maxRunning = 1
	}
	if runner == nil {
		runner = DefaultRunner{JobRoot: root}
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, err
	}
	managerCtx, cancel := context.WithCancel(context.Background())
	m := &Manager{
		ctx:        managerCtx,
		cancel:     cancel,
		root:       root,
		maxRunning: maxRunning,
		runner:     runner,
		jobs:       map[string]*Job{},
		eventLogs:  map[string]*events.Store{},
		requests:   map[string]CreateRequest{},
		queue:      []string{},
		running:    map[string]context.CancelFunc{},
	}
	if err := m.recoverJobs(); err != nil {
		return nil, err
	}
	m.schedule()
	return m, nil
}

func (m *Manager) Shutdown() {
	m.cancel()
	m.mu.Lock()
	cancels := make([]context.CancelFunc, 0, len(m.running))
	for _, cancel := range m.running {
		cancels = append(cancels, cancel)
	}
	m.mu.Unlock()
	for _, cancel := range cancels {
		cancel()
	}
}

func (m *Manager) Create(req CreateRequest) (*Job, *fserrors.AppError) {
	if req.SchemaVersion != 0 && req.SchemaVersion != 1 {
		return nil, fserrors.New(fserrors.CodeInvalidInput, "create_job", "unsupported schema_version", "", nil)
	}
	if req.Type != "transcribe" {
		return nil, fserrors.New(fserrors.CodeInvalidInput, "create_job", "only transcribe jobs are supported in this daemon gate.", "", nil)
	}
	if strings.TrimSpace(req.InputPath) == "" {
		return nil, fserrors.New(fserrors.CodeInvalidInput, "create_job", "input_path is required.", "", nil)
	}
	if req.Provider == "" {
		req.Provider = "local-faster-whisper"
	}
	if req.Language == "" {
		req.Language = "auto"
	}
	if req.WordTimestamps == "" {
		req.WordTimestamps = "off"
	}

	id := newJobID()
	now := time.Now().UTC()
	job := &Job{
		SchemaVersion: 1,
		ID:            id,
		Type:          req.Type,
		Status:        StatusCreated,
		Stage:         "validating",
		Progress:      Progress{},
		Provider:      req.Provider,
		Model:         req.Model,
		InputPath:     req.InputPath,
		OutputPath:    req.OutputPath,
		CreatedAt:     now,
	}
	m.mu.Lock()
	m.jobs[id] = job
	m.requests[id] = req
	m.mu.Unlock()
	if err := m.ensureJobFiles(id, req); err != nil {
		return nil, fserrors.New(fserrors.CodeInvalidInput, "create_job", err.Error(), "", nil)
	}
	m.appendEvent(id, events.TypeCreated, map[string]any{"status": StatusCreated})
	m.enqueue(id)
	return m.Get(id)
}

func (m *Manager) List() []Job {
	m.mu.Lock()
	defer m.mu.Unlock()
	items := make([]Job, 0, len(m.jobs))
	for _, job := range m.jobs {
		items = append(items, *job)
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].CreatedAt.Before(items[j].CreatedAt)
	})
	return items
}

func (m *Manager) Get(id string) (*Job, *fserrors.AppError) {
	m.mu.Lock()
	defer m.mu.Unlock()
	job, ok := m.jobs[id]
	if !ok {
		return nil, unknownJob(id)
	}
	copy := *job
	return &copy, nil
}

func (m *Manager) Result(id string) (*ResultEnvelope, *fserrors.AppError) {
	job, appErr := m.Get(id)
	if appErr != nil {
		return nil, appErr
	}
	if !Terminal(job.Status) {
		return nil, fserrors.New("invalid_state", "job_result", "job is not terminal.", "", map[string]any{"job_id": id, "status": job.Status})
	}
	return &ResultEnvelope{
		JobID:  job.ID,
		Status: job.Status,
		Result: job.Result,
		Error:  job.Error,
	}, nil
}

func (m *Manager) Logs(id string) (LogSummary, *fserrors.AppError) {
	if _, appErr := m.Get(id); appErr != nil {
		return LogSummary{}, appErr
	}
	logDir := filepath.Join(m.jobDir(id), "logs")
	entries, err := os.ReadDir(logDir)
	if err != nil {
		if os.IsNotExist(err) {
			return LogSummary{Available: false, Lines: []string{}}, nil
		}
		return LogSummary{}, fserrors.New(fserrors.CodeInvalidInput, "job_logs", err.Error(), "", nil)
	}
	lines := []string{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".log") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(logDir, entry.Name()))
		if err != nil {
			return LogSummary{}, fserrors.New(fserrors.CodeInvalidInput, "job_logs", err.Error(), "", nil)
		}
		for _, line := range strings.Split(strings.TrimSpace(string(raw)), "\n") {
			line = strings.TrimSpace(fserrors.Redact(line))
			if line != "" {
				lines = append(lines, entry.Name()+": "+line)
			}
		}
	}
	if len(lines) > 200 {
		lines = lines[len(lines)-200:]
	}
	return LogSummary{Available: len(lines) > 0, Lines: lines}, nil
}

func (m *Manager) Cancel(id string) (*Job, *fserrors.AppError) {
	m.mu.Lock()
	job, ok := m.jobs[id]
	if !ok {
		m.mu.Unlock()
		return nil, unknownJob(id)
	}
	switch job.Status {
	case StatusQueued, StatusCreated:
		m.removeQueuedLocked(id)
		m.finishLocked(job, StatusCanceled, "done", nil, fserrors.New(fserrors.CodeCanceled, "cancel", "job was canceled before it started.", "", nil))
		m.mu.Unlock()
		m.appendEvent(id, events.TypeCanceled, map[string]any{"status": StatusCanceled})
		_ = m.saveJob(id)
		return m.Get(id)
	case StatusRunning:
		job.Status = StatusCanceling
		job.Stage = "canceling"
		cancel := m.running[id]
		m.mu.Unlock()
		m.appendEvent(id, "canceling", map[string]any{"status": StatusCanceling})
		if cancel != nil {
			cancel()
		}
		_ = m.saveJob(id)
		return m.Get(id)
	case StatusCanceling:
		m.mu.Unlock()
		return m.Get(id)
	default:
		m.mu.Unlock()
		return nil, fserrors.New("invalid_state", "cancel", "terminal job cannot be canceled.", "", map[string]any{"job_id": id, "status": job.Status})
	}
}

func (m *Manager) Delete(id string) *fserrors.AppError {
	m.mu.Lock()
	job, ok := m.jobs[id]
	if !ok {
		m.mu.Unlock()
		return unknownJob(id)
	}
	if !Terminal(job.Status) {
		m.mu.Unlock()
		return fserrors.New("invalid_state", "delete_job", "only terminal jobs can be deleted.", "", map[string]any{"job_id": id, "status": job.Status})
	}
	delete(m.jobs, id)
	delete(m.eventLogs, id)
	delete(m.requests, id)
	m.mu.Unlock()
	if err := os.RemoveAll(m.jobDir(id)); err != nil {
		return fserrors.New(fserrors.CodeInvalidInput, "delete_job", err.Error(), "", nil)
	}
	return nil
}

func (m *Manager) Events(id string) (*events.Store, *fserrors.AppError) {
	if _, appErr := m.Get(id); appErr != nil {
		return nil, appErr
	}
	store, err := m.eventStore(id)
	if err != nil {
		return nil, fserrors.New(fserrors.CodeInvalidInput, "job_events", err.Error(), "", nil)
	}
	return store, nil
}

func unknownJob(id string) *fserrors.AppError {
	return fserrors.New("unknown_job", "job", "unknown job: "+id, "", map[string]any{"job_id": id})
}

func newJobID() string {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "job_" + strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return "job_" + hex.EncodeToString(raw[:])
}
