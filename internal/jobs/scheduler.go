package jobs

import (
	"context"

	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/events"
)

func (m *Manager) enqueue(id string) {
	m.mu.Lock()
	if job := m.jobs[id]; job != nil {
		job.Status = StatusQueued
		job.Stage = "queued"
		m.queue = append(m.queue, id)
	}
	m.mu.Unlock()
	m.appendEvent(id, events.TypeQueued, map[string]any{"status": StatusQueued})
	_ = m.saveJob(id)
	m.schedule()
}

func (m *Manager) schedule() {
	for {
		m.mu.Lock()
		if m.ctx.Err() != nil || len(m.queue) == 0 || len(m.running) >= m.maxRunning {
			m.mu.Unlock()
			return
		}
		id := m.queue[0]
		m.queue = m.queue[1:]
		job := m.jobs[id]
		req := m.requests[id]
		ctx, cancel := context.WithCancel(m.ctx)
		m.running[id] = cancel
		m.markRunningLocked(job)
		m.mu.Unlock()
		m.appendEvent(id, events.TypeStarted, map[string]any{"status": StatusRunning})
		_ = m.saveJob(id)
		go m.run(ctx, id, req)
	}
}

func (m *Manager) run(ctx context.Context, id string, req CreateRequest) {
	job, _ := m.Get(id)
	result, appErr := m.runner.RunTranscribe(ctx, *job, req, func(update Update) {
		m.appendEvent(id, update.Event.Type, update.Event.Data)
		if update.Stage != "" {
			m.setStage(id, update.Stage)
		}
		if update.Percent != nil {
			m.setProgress(id, *update.Percent)
		}
	})
	m.mu.Lock()
	current := m.jobs[id]
	if current == nil {
		m.mu.Unlock()
		return
	}
	delete(m.running, id)
	status, eventType, appErr := terminalState(ctx, current, appErr)
	if status == StatusSucceeded {
		m.finishLocked(current, status, "done", &result, nil)
	} else {
		m.finishLocked(current, status, "done", nil, appErr)
	}
	m.mu.Unlock()
	if status == StatusSucceeded {
		m.appendEvent(id, eventType, result)
	} else {
		m.appendEvent(id, eventType, map[string]any{"status": status, "error": appErr})
	}
	_ = m.saveJob(id)
	m.schedule()
}

func terminalState(ctx context.Context, job *Job, appErr *fserrors.AppError) (string, string, *fserrors.AppError) {
	if ctx.Err() != nil || job.Status == StatusCanceling {
		return StatusCanceled,
			events.TypeCanceled,
			fserrors.New(fserrors.CodeCanceled, "cancel", "job was canceled.", "", nil)
	}
	if appErr == nil {
		return StatusSucceeded, events.TypeCompleted, nil
	}
	return StatusFailed, events.TypeFailed, appErr
}

func (m *Manager) removeQueuedLocked(id string) {
	filtered := make([]string, 0, len(m.queue))
	for _, queuedID := range m.queue {
		if queuedID != id {
			filtered = append(filtered, queuedID)
		}
	}
	m.queue = filtered
}
