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

func (s *Server) handleModel(w http.ResponseWriter, r *http.Request) {
	id, action, ok := parseModelRoute(r.URL.Path)
	if !ok || (r.Method == http.MethodPost && action != "verify") || (r.Method == http.MethodDelete && action != "") || (r.Method != http.MethodPost && r.Method != http.MethodDelete) {
		writeError(w, http.StatusNotFound, unknownRoute())
		return
	}
	manifest, err := models.LoadManifest("")
	if err != nil {
		writeError(w, http.StatusBadRequest, fserrors.New(fserrors.CodeInvalidInput, "models", err.Error(), "", nil))
		return
	}
	entry, exists := manifest.Get(id)
	if !exists {
		writeError(w, http.StatusNotFound, fserrors.New("unknown_model", "models", "unknown model: "+id, "", nil))
		return
	}
	if r.Method == http.MethodDelete {
		status, appErr := models.DefaultStore().Remove(entry)
		if appErr != nil {
			writeAppError(w, appErr)
			return
		}
		writeOK(w, map[string]any{
			"model_id":     id,
			"id":           id,
			"name":         entry.Name,
			"status":       "missing",
			"verified":     false,
			"path_summary": status.Path,
			"removed":      true,
			"warnings":     []string{},
		})
		return
	}
	status := models.DefaultStore().Verify(entry)
	resultStatus := "missing"
	if status.Installed {
		resultStatus = "available"
	}
	writeOK(w, map[string]any{
		"model_id":     id,
		"id":           id,
		"name":         entry.Name,
		"status":       resultStatus,
		"verified":     status.Installed,
		"path_summary": status.Path,
		"warnings":     []string{},
	})
}

func (s *Server) handleProviders(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusNotFound, unknownRoute())
		return
	}
	if providerID := r.URL.Query().Get("provider_id"); providerID != "" {
		mode := r.URL.Query().Get("mode")
		result, ok := providers.TestMode(r.Context(), s.cfg.Providers, providerID, mode)
		if !ok {
			writeError(w, http.StatusNotFound, unknownRoute())
			return
		}
		writeOK(w, map[string]any{"provider": providerResponse(result)})
		return
	}
	writeOK(w, map[string]any{"providers": providers.List(r.Context(), s.cfg.Providers)})
}

func providerResponse(result providers.CheckResult) map[string]any {
	return map[string]any{
		"id":                       result.Metadata.ID,
		"type":                     result.Metadata.Type,
		"location":                 result.Metadata.Location,
		"backend":                  result.Metadata.Backend,
		"offline":                  result.Metadata.Offline,
		"requires_api_key":         result.Metadata.RequiresAPIKey,
		"requires_model":           result.Metadata.RequiresModel,
		"privacy_note":             result.Metadata.PrivacyNote,
		"supported_languages":      result.Metadata.SupportedLanguages,
		"supports_word_timestamps": result.Metadata.SupportsWordTimestamps,
		"supports_batch":           result.Metadata.SupportsBatch,
		"capabilities":             result.Metadata.Capabilities,
		"compatible_model_types":   result.Metadata.CompatibleModelTypes,
		"status":                   result.Status,
		"check_mode":               result.CheckMode,
		"warnings":                 result.Warnings,
		"action_hint":              result.ActionHint,
	}
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

func parseModelRoute(path string) (string, string, bool) {
	rest := strings.TrimPrefix(path, "/v1/models/")
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
