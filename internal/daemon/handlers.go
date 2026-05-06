package daemon

import (
	"encoding/json"
	"net/http"
	"strings"

	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/jobs"
	"fast-sub/internal/models"
	"fast-sub/internal/providers"
)

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusNotFound, unknownRoute())
		return
	}
	writeOK(w, map[string]any{"ready": true})
}

func (s *Server) handleVersion(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusNotFound, unknownRoute())
		return
	}
	writeOK(w, map[string]any{"version": s.cfg.Version})
}

func (s *Server) handleModels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusNotFound, unknownRoute())
		return
	}
	manifest, err := models.LoadManifest("")
	if err != nil {
		writeError(
			w,
			http.StatusBadRequest,
			fserrors.New(fserrors.CodeInvalidInput, "models", err.Error(), "", nil),
		)
		return
	}
	writeOK(w, map[string]any{"models": models.DefaultStore().List(manifest)})
}

func (s *Server) handleProviders(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusNotFound, unknownRoute())
		return
	}
	writeOK(w, map[string]any{"providers": providers.List(r.Context(), s.cfg.Providers)})
}

func (s *Server) handleJobs(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeOK(w, map[string]any{"jobs": s.manager.List()})
	case http.MethodPost:
		s.createJob(w, r)
	default:
		writeError(w, http.StatusNotFound, unknownRoute())
	}
}

func (s *Server) createJob(w http.ResponseWriter, r *http.Request) {
	var req jobs.CreateRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := decoder.Decode(&req); err != nil {
		writeError(
			w,
			http.StatusBadRequest,
			fserrors.New(fserrors.CodeInvalidInput, "create_job", "request body is invalid JSON.", "", nil),
		)
		return
	}
	job, appErr := s.manager.Create(req)
	if appErr != nil {
		writeAppError(w, appErr)
		return
	}
	writeOK(w, map[string]any{
		"job_id":     job.ID,
		"status":     job.Status,
		"events_url": "/v1/jobs/" + job.ID + "/events",
	})
}

func (s *Server) handleJob(w http.ResponseWriter, r *http.Request) {
	id, action, ok := parseJobRoute(r.URL.Path)
	if !ok {
		writeError(w, http.StatusNotFound, unknownRoute())
		return
	}
	switch {
	case r.Method == http.MethodGet && action == "":
		job, appErr := s.manager.Get(id)
		writeResultOrError(w, job, appErr)
	case r.Method == http.MethodPost && action == "cancel":
		job, appErr := s.manager.Cancel(id)
		writeResultOrError(w, cancelResult(job), appErr)
	case r.Method == http.MethodGet && action == "result":
		result, appErr := s.manager.Result(id)
		writeResultOrError(w, result, appErr)
	case r.Method == http.MethodGet && action == "logs":
		logs, appErr := s.manager.Logs(id)
		writeResultOrError(w, logs, appErr)
	case r.Method == http.MethodDelete && action == "":
		s.deleteJob(w, id)
	case r.Method == http.MethodGet && action == "events":
		s.handleEvents(w, r, id)
	default:
		writeError(w, http.StatusNotFound, unknownRoute())
	}
}

func (s *Server) deleteJob(w http.ResponseWriter, id string) {
	if appErr := s.manager.Delete(id); appErr != nil {
		writeAppError(w, appErr)
		return
	}
	writeOK(w, map[string]any{"job_id": id, "deleted": true})
}

func parseJobRoute(path string) (string, string, bool) {
	rest := strings.TrimPrefix(path, "/v1/jobs/")
	parts := strings.Split(strings.Trim(rest, "/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		return "", "", false
	}
	action := ""
	if len(parts) > 1 {
		action = parts[1]
	}
	return parts[0], action, true
}

func cancelResult(job *jobs.Job) map[string]any {
	if job == nil {
		return map[string]any{"job_id": "", "status": ""}
	}
	return map[string]any{"job_id": job.ID, "status": job.Status}
}
