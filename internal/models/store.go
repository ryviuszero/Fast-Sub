package models

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"fast-sub/internal/downloads"
	fserrors "fast-sub/internal/errors"
)

const (
	minDiskReserveBytes = int64(50 * 1024 * 1024)
	stagingDirName      = ".staging"
	lockDirName         = ".locks"
)

// Store resolves and verifies Go-managed model installation paths.
type Store struct {
	Root string
}

// Status is the JSON-friendly verification state for a model.
type Status struct {
	ID           string `json:"id"`
	Path         string `json:"path"`
	Installed    bool   `json:"installed"`
	Status       string `json:"status"`
	Message      string `json:"message"`
	SHA256       string `json:"sha256,omitempty"`
	SizeBytes    int64  `json:"size_bytes,omitempty"`
	CheckedFiles int    `json:"checked_files"`
	ManifestType string `json:"manifest_type"`
}

// ListRow describes one model in models list output.
type ListRow struct {
	ID                  string   `json:"id"`
	Name                string   `json:"name"`
	Type                string   `json:"type"`
	Backend             string   `json:"backend"`
	ArtifactKind        string   `json:"artifact_kind"`
	CompatibleProviders []string `json:"compatible_providers"`
	SizeBytes           int64    `json:"size_bytes"`
	License             string   `json:"license"`
	Installed           bool     `json:"installed"`
	Status              string   `json:"status"`
	Path                string   `json:"path"`
	ManifestType        string   `json:"manifest_type"`
	RequiredFiles       int      `json:"required_files"`
	PrivacyClass        string   `json:"privacy_class"`
}

// DefaultStore returns the user-scoped Fast Sub model store.
func DefaultStore() Store {
	if override := os.Getenv("FAST_SUB_MODEL_STORE_DIR"); override != "" {
		return Store{Root: override}
	}
	if runtime.GOOS == "windows" {
		base := os.Getenv("LOCALAPPDATA")
		if base == "" {
			base = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Local")
		}
		return Store{Root: filepath.Join(base, "fast-sub", "models")}
	}
	if base := os.Getenv("XDG_DATA_HOME"); base != "" {
		return Store{Root: filepath.Join(base, "fast-sub", "models")}
	}
	home, _ := os.UserHomeDir()
	return Store{Root: filepath.Join(home, ".local", "share", "fast-sub", "models")}
}

// ModelDir returns the final directory for a model id.
func (s Store) ModelDir(entry ManifestEntry) string {
	return filepath.Join(s.Root, entry.ID)
}

// List returns all manifest rows with current verification status.
func (s Store) List(manifest Manifest) []ListRow {
	rows := make([]ListRow, 0, len(manifest.Models))
	for _, entry := range manifest.Models {
		status := s.Verify(entry)
		rows = append(rows, ListRow{
			ID:                  entry.ID,
			Name:                entry.Name,
			Type:                entry.Type,
			Backend:             entry.Backend,
			ArtifactKind:        entry.ArtifactKind,
			CompatibleProviders: entry.CompatibleProviders,
			SizeBytes:           entry.SizeBytes,
			License:             entry.License,
			Installed:           status.Installed,
			Status:              status.Status,
			Path:                s.ModelDir(entry),
			ManifestType:        entry.ManifestType(),
			RequiredFiles:       len(entry.RequiredFiles),
			PrivacyClass:        entry.PrivacyClass,
		})
	}
	return rows
}

// Verify checks installed files and checksums for one model.
func (s Store) Verify(entry ManifestEntry) Status {
	if err := entry.validate(); err != nil {
		return Status{ID: entry.ID, Path: s.ModelDir(entry), Installed: false, Status: "invalid_manifest", Message: err.Error(), ManifestType: entry.ManifestType()}
	}
	path := s.ModelDir(entry)
	if entry.ManifestType() == "directory" {
		return s.verifyDirectory(entry, path)
	}
	return s.verifySingle(entry, filepath.Join(path, singleFilename(entry)))
}

func (s Store) verifyDirectory(entry ManifestEntry, path string) Status {
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return Status{ID: entry.ID, Path: path, Status: "missing", Message: "Model directory is missing.", ManifestType: entry.ManifestType()}
		}
		return inaccessibleStatus(entry, path, err, 0)
	}
	if !info.IsDir() {
		return Status{ID: entry.ID, Path: path, Status: "invalid_path", Message: "Model path exists but is not a directory.", ManifestType: entry.ManifestType()}
	}
	var total int64
	for index, file := range entry.RequiredFiles {
		filePath := filepath.Join(path, filepath.FromSlash(file.Path))
		status := verifyFile(entry, filePath, file.SHA256, index, entry.ManifestType(), file.Path)
		if !status.Installed {
			return status
		}
		total += status.SizeBytes
	}
	return Status{
		ID:           entry.ID,
		Path:         path,
		Installed:    true,
		Status:       "installed",
		Message:      fmt.Sprintf("Model directory is installed and verified (%d files).", len(entry.RequiredFiles)),
		SizeBytes:    total,
		CheckedFiles: len(entry.RequiredFiles),
		ManifestType: entry.ManifestType(),
	}
}

func (s Store) verifySingle(entry ManifestEntry, path string) Status {
	return verifyFile(entry, path, entry.SHA256, 0, entry.ManifestType(), filepath.Base(path))
}

func verifyFile(entry ManifestEntry, path, expected string, checked int, manifestType, label string) Status {
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return Status{ID: entry.ID, Path: path, Status: "missing", Message: "Required model file is missing: " + label, CheckedFiles: checked, ManifestType: manifestType}
		}
		return inaccessibleStatus(entry, path, err, checked)
	}
	if info.IsDir() {
		return Status{ID: entry.ID, Path: path, Status: "invalid_path", Message: "Required model path is not a file: " + label, CheckedFiles: checked, ManifestType: manifestType}
	}
	actual, err := sha256File(path)
	if err != nil {
		return inaccessibleStatus(entry, path, err, checked)
	}
	if !strings.EqualFold(actual, expected) {
		return Status{ID: entry.ID, Path: path, Status: "hash_mismatch", Message: "Required model file exists, but sha256 does not match the manifest: " + label, SHA256: actual, SizeBytes: info.Size(), CheckedFiles: checked, ManifestType: manifestType}
	}
	return Status{ID: entry.ID, Path: path, Installed: true, Status: "installed", Message: "Required model file is installed and verified: " + label, SHA256: actual, SizeBytes: info.Size(), CheckedFiles: checked + 1, ManifestType: manifestType}
}

func inaccessibleStatus(entry ManifestEntry, path string, err error, checked int) Status {
	return Status{ID: entry.ID, Path: path, Status: "inaccessible", Message: "Model path is inaccessible: " + err.Error(), CheckedFiles: checked, ManifestType: entry.ManifestType()}
}

// ClassifyStatusError maps verification failures to stable CLI errors.
func ClassifyStatusError(command string, status Status) *fserrors.AppError {
	switch status.Status {
	case "missing":
		return fserrors.New(fserrors.CodeMissingModel, command, status.Message, "Install the model with `fast-sub-go models install "+status.ID+"`.", map[string]any{"model_id": status.ID, "path": status.Path})
	case "hash_mismatch":
		return fserrors.New(fserrors.CodeHashMismatch, command, status.Message, "Remove the damaged model directory and run install again.", map[string]any{"model_id": status.ID, "path": status.Path, "sha256": status.SHA256})
	case "inaccessible":
		return fserrors.New(fserrors.CodePermissionDenied, command, status.Message, "Check file permissions for the model store.", map[string]any{"model_id": status.ID, "path": status.Path})
	default:
		return fserrors.New(fserrors.CodeInvalidInput, command, status.Message, "Check the model manifest and model store path.", map[string]any{"model_id": status.ID, "path": status.Path, "status": status.Status})
	}
}

func validateRelativePath(value string) error {
	if value == "" {
		return fmt.Errorf("path is empty")
	}
	if filepath.IsAbs(value) {
		return fmt.Errorf("absolute paths are not allowed")
	}
	clean := filepath.Clean(filepath.FromSlash(value))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
		return fmt.Errorf("path traversal is not allowed")
	}
	for _, part := range strings.Split(clean, string(os.PathSeparator)) {
		if part == ".." || part == "" {
			return fmt.Errorf("path traversal is not allowed")
		}
	}
	return nil
}

func candidateURLs(entry ManifestEntry, file ManifestFile) []string {
	if len(file.URLs) > 0 {
		return file.URLs
	}
	urls := make([]string, 0, len(entry.URLs))
	for _, root := range entry.URLs {
		joined, err := url.JoinPath(root, filepath.ToSlash(file.Path))
		if err == nil {
			urls = append(urls, joined)
		}
	}
	return urls
}

func redactURLs(values []string) []string {
	redacted := make([]string, 0, len(values))
	for _, value := range values {
		redacted = append(redacted, downloads.RedactURL(value))
	}
	return redacted
}

func (f PlanFile) downloadURLs() []string {
	if len(f.DownloadURLs) > 0 {
		return f.DownloadURLs
	}
	return f.URLs
}

func singleFilename(entry ManifestEntry) string {
	if len(entry.RequiredFiles) == 1 {
		return filepath.Base(entry.RequiredFiles[0].Path)
	}
	return entry.ID + ".bin"
}

func sha256File(path string) (string, error) {
	return downloads.Sha256File(path)
}

func classifyInstallError(command string, err error) *fserrors.AppError {
	message := err.Error()
	lower := strings.ToLower(message)
	code := fserrors.CodeDownloadFailed
	hint := "Check your network connection and retry the model install."
	if strings.Contains(lower, "not enough free disk") {
		code = fserrors.CodeDiskFull
		hint = "Free disk space or choose a model store with more space."
	}
	if strings.Contains(lower, "permission") || strings.Contains(lower, "access is denied") {
		code = fserrors.CodePermissionDenied
		hint = "Check write permissions for the model store."
	}
	if strings.Contains(lower, "sha256") || strings.Contains(lower, "checksum") {
		code = fserrors.CodeHashMismatch
		hint = "Retry the install. Fast Sub removed the damaged partial download."
	}
	if strings.Contains(lower, "lock") {
		hint = "Wait for the other install to finish, or remove the stale lock after checking no install is running."
	}
	return fserrors.New(code, command, message, hint, nil)
}

// InstallOptions configures model installation.
type InstallOptions struct {
	DryRun            bool
	Backend           DownloadBackend
	FreeSpace         func(string) (int64, error)
	StaleLockDuration time.Duration
	Progress          ProgressFunc
}

// DownloadBackend is the downloader dependency used by model installation.
type DownloadBackend interface {
	Download(context.Context, DownloadRequest) (DownloadResult, error)
}

// DownloadRequest is the model-package view of a download request.
type DownloadRequest struct {
	URL      string
	PartPath string
	Label    string
	Progress ProgressFunc
}

// DownloadResult summarizes one downloaded file.
type DownloadResult struct {
	URL       string `json:"url"`
	Path      string `json:"path"`
	Resumed   bool   `json:"resumed"`
	Restarted bool   `json:"restarted"`
}

// ProgressFunc receives install progress events.
type ProgressFunc func(Progress)

// Progress describes model install progress without writing to stdout/stderr.
type Progress struct {
	ModelID      string `json:"model_id"`
	FilePath     string `json:"file_path"`
	FileIndex    int    `json:"file_index"`
	FileCount    int    `json:"file_count"`
	FileBytes    int64  `json:"file_bytes"`
	FileTotal    int64  `json:"file_total"`
	OverallBytes int64  `json:"overall_bytes"`
	OverallTotal int64  `json:"overall_total"`
	Stage        string `json:"stage"`
}

// InstallPlan is returned by dry-run and successful install operations.
type InstallPlan struct {
	ModelID             string     `json:"model_id"`
	TargetDir           string     `json:"target_dir"`
	StagingDir          string     `json:"staging_dir"`
	Files               []PlanFile `json:"files"`
	TotalSizeBytes      int64      `json:"total_size_bytes"`
	RequiredDiskBytes   int64      `json:"required_disk_bytes"`
	ChecksumStrategy    string     `json:"checksum_strategy"`
	PrivacyClass        string     `json:"privacy_class"`
	License             string     `json:"license"`
	LicenseURL          string     `json:"license_url,omitempty"`
	SourceType          string     `json:"source_type"`
	DownloadBackend     string     `json:"download_backend"`
	WillWriteModelDir   bool       `json:"will_write_model_dir"`
	CompatibleProviders []string   `json:"compatible_providers"`
}

// PlanFile describes one file in an install plan.
type PlanFile struct {
	Path         string   `json:"path"`
	SizeBytes    int64    `json:"size_bytes"`
	SHA256       string   `json:"sha256"`
	URLs         []string `json:"urls"`
	DownloadURLs []string `json:"-"`
}
