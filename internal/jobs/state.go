package jobs

import (
	"time"

	fserrors "fast-sub/internal/errors"
)

func (m *Manager) markRunningLocked(job *Job) {
	now := time.Now().UTC()
	job.Status = StatusRunning
	job.Stage = "starting"
	job.StartedAt = &now
}

func (m *Manager) finishLocked(job *Job, status, stage string, result *Result, appErr *fserrors.AppError) {
	now := time.Now().UTC()
	job.Status = status
	job.Stage = stage
	job.FinishedAt = &now
	job.Result = result
	job.Error = appErr
}

func (m *Manager) setStage(id, stage string) {
	m.mu.Lock()
	if job := m.jobs[id]; job != nil {
		job.Stage = stage
	}
	m.mu.Unlock()
}

func (m *Manager) setProgress(id string, percent int) {
	m.mu.Lock()
	if job := m.jobs[id]; job != nil {
		job.Progress.Percent = &percent
		job.Progress.Current = percent
		job.Progress.Total = 100
	}
	m.mu.Unlock()
}
