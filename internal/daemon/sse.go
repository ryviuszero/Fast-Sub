package daemon

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"fast-sub/internal/contracts"
	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/events"
)

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request, id string) {
	store, appErr := s.manager.Events(id)
	if appErr != nil {
		writeAppError(w, appErr)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(
			w,
			http.StatusInternalServerError,
			fserrors.New("internal_error", "events", "streaming is not supported.", "", nil),
		)
		return
	}
	if !s.replayEvents(w, r, flusher, id, store) {
		return
	}
	s.streamEvents(w, r, flusher, id, store)
}

func (s *Server) replayEvents(
	w http.ResponseWriter,
	r *http.Request,
	flusher http.Flusher,
	id string,
	store eventStore,
) bool {
	afterID, _ := strconv.ParseInt(r.Header.Get("Last-Event-ID"), 10, 64)
	replay, lost, err := store.Replay(afterID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fserrors.New("internal_error", "events", err.Error(), "", nil))
		return false
	}
	if lost {
		writeSSE(w, events.Event{
			Type:  events.TypeEventsLost,
			JobID: id,
			Data:  map[string]any{"job_id": id},
		})
		flusher.Flush()
	}
	for _, event := range replay {
		writeSSE(w, event)
		flusher.Flush()
	}
	return true
}

func (s *Server) streamEvents(
	w http.ResponseWriter,
	r *http.Request,
	flusher http.Flusher,
	id string,
	store eventStore,
) {
	ch, unsubscribe := store.Subscribe(32)
	defer unsubscribe()
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case event := <-ch:
			writeSSE(w, event)
			flusher.Flush()
		case <-ticker.C:
			writeSSE(w, events.Event{
				Type:  events.TypeHeartbeat,
				JobID: id,
				Data:  map[string]any{"job_id": id},
			})
			flusher.Flush()
		}
	}
}

type eventStore interface {
	Replay(afterID int64) ([]events.Event, bool, error)
	Subscribe(buffer int) (chan events.Event, func())
}

func writeSSE(w http.ResponseWriter, event events.Event) {
	if event.ID > 0 {
		fmt.Fprintf(w, "id: %d\n", event.ID)
	}
	fmt.Fprintf(w, "event: %s\n", event.Type)
	payload := map[string]any{
		"schema_version": contracts.DaemonSchemaVersion,
		"job_id":         event.JobID,
		"event_id":       event.ID,
		"type":           event.Type,
	}
	mergeEventData(payload, event.Data)
	raw, _ := json.Marshal(payload)
	fmt.Fprintf(w, "data: %s\n\n", raw)
}

func mergeEventData(payload map[string]any, data any) {
	if data == nil {
		return
	}
	raw, err := json.Marshal(data)
	if err != nil {
		payload["payload"] = data
		return
	}
	var fields map[string]any
	if err := json.Unmarshal(raw, &fields); err != nil {
		payload["payload"] = data
		return
	}
	for key, value := range fields {
		if sseReservedField(key) {
			continue
		}
		payload[key] = value
	}
}

func sseReservedField(key string) bool {
	switch key {
	case "schema_version", "job_id", "event_id", "type":
		return true
	default:
		return false
	}
}
