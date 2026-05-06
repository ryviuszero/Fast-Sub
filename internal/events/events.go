// Package events implements per-job append-only events and fanout.
package events

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	TypeCreated     = "created"
	TypeQueued      = "queued"
	TypeStarted     = "started"
	TypeProgress    = "progress"
	TypeLog         = "log"
	TypeCompleted   = "completed"
	TypeFailed      = "failed"
	TypeCanceled    = "canceled"
	TypeInterrupted = "interrupted"
	TypeEventsLost  = "events_lost"
	TypeHeartbeat   = "heartbeat"
)

type Event struct {
	ID            int64     `json:"id"`
	Type          string    `json:"type"`
	JobID         string    `json:"job_id"`
	SchemaVersion int       `json:"schema_version"`
	CreatedAt     time.Time `json:"created_at"`
	Data          any       `json:"data"`
}

type Store struct {
	mu          sync.Mutex
	path        string
	jobID       string
	nextID      int64
	buffer      []Event
	bufferLimit int
	subscribers map[chan Event]struct{}
}

func NewStore(jobID, path string, bufferLimit int) (*Store, error) {
	if bufferLimit <= 0 {
		bufferLimit = 128
	}
	store := &Store{
		path:        path,
		jobID:       jobID,
		nextID:      1,
		buffer:      []Event{},
		bufferLimit: bufferLimit,
		subscribers: map[chan Event]struct{}{},
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	events, err := readEvents(path)
	if err != nil {
		return nil, err
	}
	store.buffer = trim(events, store.bufferLimit)
	if len(events) > 0 {
		store.nextID = events[len(events)-1].ID + 1
	}
	return store, nil
}

func (s *Store) Append(eventType string, data any) (Event, error) {
	s.mu.Lock()
	event := Event{
		ID:            s.nextID,
		Type:          eventType,
		JobID:         s.jobID,
		SchemaVersion: 1,
		CreatedAt:     time.Now().UTC(),
		Data:          data,
	}
	s.nextID++
	s.buffer = append(s.buffer, event)
	s.buffer = trim(s.buffer, s.bufferLimit)
	subscribers := make([]chan Event, 0, len(s.subscribers))
	for subscriber := range s.subscribers {
		subscribers = append(subscribers, subscriber)
	}
	s.mu.Unlock()

	if err := appendEvent(s.path, event); err != nil {
		return event, err
	}
	for _, subscriber := range subscribers {
		select {
		case subscriber <- event:
		default:
		}
	}
	return event, nil
}

func (s *Store) Replay(afterID int64) ([]Event, bool, error) {
	events, err := readEvents(s.path)
	if err != nil {
		return nil, false, err
	}
	if afterID <= 0 {
		return events, false, nil
	}
	if len(events) == 0 {
		return []Event{}, false, nil
	}
	if events[0].ID > afterID+1 {
		return events, true, nil
	}
	replay := make([]Event, 0)
	for _, event := range events {
		if event.ID > afterID {
			replay = append(replay, event)
		}
	}
	return replay, false, nil
}

func (s *Store) Subscribe(buffer int) (chan Event, func()) {
	if buffer <= 0 {
		buffer = 16
	}
	ch := make(chan Event, buffer)
	s.mu.Lock()
	s.subscribers[ch] = struct{}{}
	s.mu.Unlock()
	unsubscribe := func() {
		s.mu.Lock()
		if _, ok := s.subscribers[ch]; ok {
			delete(s.subscribers, ch)
			close(ch)
		}
		s.mu.Unlock()
	}
	return ch, unsubscribe
}

func (s *Store) DropReplayBefore(minID int64) {
	s.mu.Lock()
	filtered := make([]Event, 0, len(s.buffer))
	for _, event := range s.buffer {
		if event.ID >= minID {
			filtered = append(filtered, event)
		}
	}
	s.buffer = filtered
	s.mu.Unlock()
	events, err := readEvents(s.path)
	if err != nil {
		return
	}
	filtered = filtered[:0]
	for _, event := range events {
		if event.ID >= minID {
			filtered = append(filtered, event)
		}
	}
	_ = writeEvents(s.path, filtered)
}

func appendEvent(path string, event Event) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	raw, err := json.Marshal(event)
	if err != nil {
		return err
	}
	_, err = file.Write(append(raw, '\n'))
	return err
}

func readEvents(path string) ([]Event, error) {
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return []Event{}, nil
		}
		return nil, err
	}
	defer file.Close()
	events := []Event{}
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		var event Event
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			continue
		}
		events = append(events, event)
	}
	return events, scanner.Err()
}

func writeEvents(path string, events []Event) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	encoder := json.NewEncoder(file)
	for _, event := range events {
		if err := encoder.Encode(event); err != nil {
			return err
		}
	}
	return nil
}

func trim(events []Event, limit int) []Event {
	if len(events) <= limit {
		return events
	}
	return append([]Event{}, events[len(events)-limit:]...)
}
