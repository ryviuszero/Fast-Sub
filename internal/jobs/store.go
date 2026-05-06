package jobs

import (
	"encoding/json"
	"os"
	"path/filepath"

	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/events"
)

func (m *Manager) recoverJobs() error {
	entries, err := os.ReadDir(m.root)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		id := entry.Name()
		job, err := readJob(filepath.Join(m.root, id, "job.json"))
		if err != nil {
			continue
		}
		m.jobs[id] = &job
		if job.Status == StatusRunning || job.Status == StatusCanceling {
			appErr := fserrors.New(
				"daemon_restarted",
				"daemon",
				"daemon restarted while job was active.",
				"Recreate the job.",
				nil,
			)
			m.finishLocked(m.jobs[id], StatusInterrupted, "done", nil, appErr)
			m.appendEvent(id, events.TypeInterrupted, map[string]any{"status": StatusInterrupted, "error": appErr})
			_ = m.saveJob(id)
			continue
		}
		if job.Status == StatusCreated || job.Status == StatusQueued {
			req, err := readCreateRequest(filepath.Join(m.root, id, "request.json"))
			if err != nil {
				appErr := fserrors.New(
					"daemon_restarted_missing_request",
					"daemon",
					"daemon restarted but the queued job request could not be recovered.",
					"Recreate the job.",
					nil,
				)
				m.finishLocked(m.jobs[id], StatusInterrupted, "done", nil, appErr)
				m.appendEvent(id, events.TypeInterrupted, map[string]any{"status": StatusInterrupted, "error": appErr})
				_ = m.saveJob(id)
				continue
			}
			m.requests[id] = req
			if job.Status == StatusCreated {
				m.jobs[id].Status = StatusQueued
				m.jobs[id].Stage = "queued"
				_ = m.saveJob(id)
			}
			if job.Status == StatusCreated || job.Status == StatusQueued {
				m.queue = append(m.queue, id)
			}
		}
	}
	return nil
}

func (m *Manager) ensureJobFiles(id string, req CreateRequest) error {
	if err := os.MkdirAll(filepath.Join(m.jobDir(id), "logs"), 0o700); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(m.jobDir(id), "tmp"), 0o700); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(m.jobDir(id), "outputs"), 0o700); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(m.jobDir(id), "worker"), 0o700); err != nil {
		return err
	}
	if err := writeJSON(filepath.Join(m.jobDir(id), "request.json"), sanitizeRequest(req)); err != nil {
		return err
	}
	return m.saveJob(id)
}

func (m *Manager) saveJob(id string) error {
	m.mu.Lock()
	job := m.jobs[id]
	m.mu.Unlock()
	if job == nil {
		return nil
	}
	return writeJSON(filepath.Join(m.jobDir(id), "job.json"), job)
}

func (m *Manager) eventStore(id string) (*events.Store, error) {
	m.mu.Lock()
	store := m.eventLogs[id]
	m.mu.Unlock()
	if store != nil {
		return store, nil
	}
	created, err := events.NewStore(id, filepath.Join(m.jobDir(id), "events.jsonl"), 128)
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	if existing := m.eventLogs[id]; existing != nil {
		m.mu.Unlock()
		return existing, nil
	}
	m.eventLogs[id] = created
	m.mu.Unlock()
	return created, nil
}

func (m *Manager) appendEvent(id, eventType string, data any) {
	store, err := m.eventStore(id)
	if err != nil {
		return
	}
	_, _ = store.Append(eventType, sanitizeAny(data))
}

func (m *Manager) jobDir(id string) string {
	return filepath.Join(m.root, id)
}

func readJob(path string) (Job, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Job{}, err
	}
	var job Job
	return job, json.Unmarshal(raw, &job)
}

func readCreateRequest(path string) (CreateRequest, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return CreateRequest{}, err
	}
	var req CreateRequest
	return req, json.Unmarshal(raw, &req)
}

func writeJSON(path string, value any) error {
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	return os.WriteFile(path, raw, 0o600)
}
