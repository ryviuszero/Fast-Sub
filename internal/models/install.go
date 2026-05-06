package models

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"fast-sub/internal/downloads"
	fserrors "fast-sub/internal/errors"
)

const defaultStaleLockDuration = 2 * time.Hour

// NativeDownloadBackend adapts internal/downloads to model installation.
type NativeDownloadBackend struct {
	Backend downloads.Backend
}

// Download downloads one model file through the native HTTP backend.
func (b NativeDownloadBackend) Download(ctx context.Context, request DownloadRequest) (DownloadResult, error) {
	backend := b.Backend
	if backend == nil {
		backend = downloads.HTTPBackend{}
	}
	result, err := backend.Download(ctx, downloads.Request{
		URL:      request.URL,
		PartPath: request.PartPath,
		Label:    request.Label,
		Progress: func(label string, downloaded, total int64) {
			if request.Progress != nil {
				request.Progress(Progress{FilePath: label, FileBytes: downloaded, FileTotal: total, Stage: "download"})
			}
		},
	})
	if err != nil {
		return DownloadResult{}, err
	}
	return DownloadResult{URL: result.URL, Path: result.Path, Resumed: result.Resumed, Restarted: result.Restarted}, nil
}

// InstallResult is returned by models install.
type InstallResult struct {
	ModelID   string           `json:"model_id"`
	Status    Status           `json:"status"`
	Plan      InstallPlan      `json:"plan"`
	Downloads []DownloadResult `json:"downloads,omitempty"`
	DryRun    bool             `json:"dry_run"`
}

// Install downloads, verifies, and atomically publishes a model.
func (s Store) Install(ctx context.Context, entry ManifestEntry, opts InstallOptions) (InstallResult, *fserrors.AppError) {
	command := "models install"
	plan, err := s.Plan(entry)
	if err != nil {
		return InstallResult{}, fserrors.New(fserrors.CodeInvalidInput, command, err.Error(), "Check the model manifest.", map[string]any{"model_id": entry.ID})
	}
	if opts.DryRun {
		plan.WillWriteModelDir = false
		return InstallResult{ModelID: entry.ID, Plan: plan, DryRun: true}, nil
	}
	if status := s.Verify(entry); status.Installed {
		return InstallResult{ModelID: entry.ID, Status: status, Plan: plan}, nil
	} else if status.Status == "hash_mismatch" || status.Status == "invalid_path" {
		return InstallResult{}, ClassifyStatusError(command, status)
	}

	release, err := s.acquireLock(entry, opts.StaleLockDuration)
	if err != nil {
		return InstallResult{}, classifyInstallError(command, err)
	}
	defer release()
	if status := s.Verify(entry); status.Installed {
		return InstallResult{ModelID: entry.ID, Status: status, Plan: plan}, nil
	}
	if err := s.checkDisk(plan.RequiredDiskBytes, opts.FreeSpace); err != nil {
		return InstallResult{}, classifyInstallError(command, err)
	}

	staging := plan.StagingDir
	if err := os.MkdirAll(staging, 0o700); err != nil {
		return InstallResult{}, classifyInstallError(command, fmt.Errorf("create staging directory: %w", err))
	}

	backend := opts.Backend
	if backend == nil {
		backend = NativeDownloadBackend{}
	}
	var downloadResults []DownloadResult
	for _, file := range plan.Files {
		fileIndex := len(downloadResults) + 1
		target, err := safeJoin(staging, file.Path)
		if err != nil {
			return InstallResult{}, fserrors.New(fserrors.CodeInvalidInput, command, err.Error(), "Fix the manifest required file path.", map[string]any{"model_id": entry.ID, "path": file.Path})
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			return InstallResult{}, classifyInstallError(command, fmt.Errorf("create file directory: %w", err))
		}
		if isVerifiedFile(target, file.SHA256) {
			if opts.Progress != nil {
				opts.Progress(Progress{
					ModelID:      entry.ID,
					FilePath:     file.Path,
					FileIndex:    fileIndex,
					FileCount:    len(plan.Files),
					FileBytes:    file.SizeBytes,
					FileTotal:    file.SizeBytes,
					OverallBytes: downloadedBefore(plan.Files, fileIndex),
					OverallTotal: plan.TotalSizeBytes,
					Stage:        "verified",
				})
			}
			downloadResults = append(downloadResults, DownloadResult{Path: target})
			continue
		}
		if err := removeMismatchedFile(target, file.SHA256); err != nil {
			return InstallResult{}, classifyInstallError(command, err)
		}
		partPath := target + ".part"
		var lastErr error
		for _, candidate := range file.downloadURLs() {
			result, err := backend.Download(ctx, DownloadRequest{
				URL:      candidate,
				PartPath: partPath,
				Label:    file.Path,
				Progress: func(progress Progress) {
					progress.ModelID = entry.ID
					progress.FilePath = file.Path
					progress.FileIndex = fileIndex
					progress.FileCount = len(plan.Files)
					progress.OverallTotal = plan.TotalSizeBytes
					progress.OverallBytes = downloadedBefore(plan.Files, fileIndex-1) + progress.FileBytes
					if opts.Progress != nil {
						opts.Progress(progress)
					}
				},
			})
			if err != nil {
				lastErr = err
				continue
			}
			actual, err := sha256File(partPath)
			if err != nil {
				lastErr = err
				continue
			}
			if actual != file.SHA256 {
				_ = os.Remove(partPath)
				_ = os.Remove(partPath + ".meta.json")
				lastErr = fmt.Errorf("downloaded sha256 mismatch for %s: expected %s, got %s", file.Path, file.SHA256, actual)
				continue
			}
			if opts.Progress != nil {
				opts.Progress(Progress{
					ModelID:      entry.ID,
					FilePath:     file.Path,
					FileIndex:    fileIndex,
					FileCount:    len(plan.Files),
					FileBytes:    file.SizeBytes,
					FileTotal:    file.SizeBytes,
					OverallBytes: downloadedBefore(plan.Files, fileIndex),
					OverallTotal: plan.TotalSizeBytes,
					Stage:        "verified",
				})
			}
			if err := os.Rename(partPath, target); err != nil {
				lastErr = fmt.Errorf("publish downloaded file: %w", err)
				continue
			}
			downloadResults = append(downloadResults, result)
			lastErr = nil
			break
		}
		if lastErr != nil {
			return InstallResult{}, classifyInstallError(command, lastErr)
		}
	}

	status := Status{}
	if entry.ManifestType() == "directory" {
		status = s.verifyDirectory(entry, staging)
	} else {
		status = s.verifySingle(entry, filepath.Join(staging, singleFilename(entry)))
	}
	if !status.Installed {
		return InstallResult{}, ClassifyStatusError(command, status)
	}
	final := plan.TargetDir
	if err := os.MkdirAll(filepath.Dir(final), 0o700); err != nil {
		return InstallResult{}, classifyInstallError(command, fmt.Errorf("create model store: %w", err))
	}
	if _, err := os.Stat(final); err == nil {
		if err := os.RemoveAll(final); err != nil {
			return InstallResult{}, classifyInstallError(command, fmt.Errorf("remove incomplete final model directory: %w", err))
		}
	} else if err != nil && !os.IsNotExist(err) {
		return InstallResult{}, classifyInstallError(command, fmt.Errorf("inspect final model directory: %w", err))
	}
	if err := os.Rename(staging, final); err != nil {
		return InstallResult{}, classifyInstallError(command, fmt.Errorf("atomic rename staging directory: %w", err))
	}
	status = s.Verify(entry)
	if !status.Installed {
		return InstallResult{}, ClassifyStatusError(command, status)
	}
	_ = os.RemoveAll(staging)
	return InstallResult{ModelID: entry.ID, Status: status, Plan: plan, Downloads: downloadResults}, nil
}

func downloadedBefore(files []PlanFile, count int) int64 {
	var total int64
	for i := 0; i < count && i < len(files); i++ {
		total += files[i].SizeBytes
	}
	return total
}

func isVerifiedFile(path, expectedSHA256 string) bool {
	actual, err := sha256File(path)
	return err == nil && actual == expectedSHA256
}

func removeMismatchedFile(path, expectedSHA256 string) error {
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect staged file: %w", err)
	}
	if info.IsDir() {
		return fmt.Errorf("staged model path is a directory: %s", path)
	}
	actual, err := sha256File(path)
	if err != nil {
		return fmt.Errorf("verify staged file: %w", err)
	}
	if actual == expectedSHA256 {
		return nil
	}
	if err := os.Remove(path); err != nil {
		return fmt.Errorf("remove mismatched staged file: %w", err)
	}
	return nil
}

// Plan returns a dry-run friendly install plan.
func (s Store) Plan(entry ManifestEntry) (InstallPlan, error) {
	if err := entry.validate(); err != nil {
		return InstallPlan{}, err
	}
	target := s.ModelDir(entry)
	staging := filepath.Join(s.Root, stagingDirName, entry.ID)
	files := make([]PlanFile, 0, len(entry.RequiredFiles))
	if entry.ManifestType() == "directory" {
		for _, required := range entry.RequiredFiles {
			files = append(files, PlanFile{
				Path:         filepath.ToSlash(required.Path),
				SizeBytes:    required.SizeBytes,
				SHA256:       required.SHA256,
				URLs:         redactURLs(candidateURLs(entry, required)),
				DownloadURLs: candidateURLs(entry, required),
			})
		}
	} else {
		file := ManifestFile{Path: singleFilename(entry), SizeBytes: entry.SizeBytes, SHA256: entry.SHA256, URLs: entry.URLs}
		files = append(files, PlanFile{Path: file.Path, SizeBytes: file.SizeBytes, SHA256: file.SHA256, URLs: redactURLs(file.URLs), DownloadURLs: file.URLs})
	}
	requiredDisk := entry.MinDiskFreeBytes
	if requiredDisk == 0 {
		requiredDisk = entry.SizeBytes + maxInt64(minDiskReserveBytes, entry.SizeBytes/20)
	}
	return InstallPlan{
		ModelID:             entry.ID,
		TargetDir:           target,
		StagingDir:          staging,
		Files:               files,
		TotalSizeBytes:      entry.SizeBytes,
		RequiredDiskBytes:   requiredDisk,
		ChecksumStrategy:    "sha256",
		PrivacyClass:        entry.PrivacyClass,
		License:             entry.License,
		LicenseURL:          entry.LicenseURL,
		SourceType:          entry.SourceType,
		DownloadBackend:     "native-http",
		WillWriteModelDir:   true,
		CompatibleProviders: entry.CompatibleProviders,
	}, nil
}

func (s Store) acquireLock(entry ManifestEntry, stale time.Duration) (func(), error) {
	if stale == 0 {
		stale = defaultStaleLockDuration
	}
	lockDir := filepath.Join(s.Root, lockDirName)
	if err := os.MkdirAll(lockDir, 0o700); err != nil {
		return nil, fmt.Errorf("create lock directory: %w", err)
	}
	lockPath := filepath.Join(lockDir, entry.ID+".lock")
	file, err := os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err == nil {
		_, _ = fmt.Fprintf(file, "pid=%d\ncreated_at=%s\n", os.Getpid(), time.Now().Format(time.RFC3339))
		_ = file.Close()
		return func() { _ = os.Remove(lockPath) }, nil
	}
	if !os.IsExist(err) {
		return nil, fmt.Errorf("create model install lock: %w", err)
	}
	info, statErr := os.Stat(lockPath)
	if pid := readLockPID(lockPath); pid > 0 && !processExists(pid) {
		if removeErr := os.Remove(lockPath); removeErr != nil && !os.IsNotExist(removeErr) {
			return nil, fmt.Errorf("remove stale model install lock for dead pid %d: %w", pid, removeErr)
		}
		return s.acquireLock(entry, stale)
	}
	if statErr == nil && time.Since(info.ModTime()) > stale {
		return nil, fmt.Errorf("stale model install lock detected: %s", lockPath)
	}
	return nil, fmt.Errorf("model install lock is held for %s", entry.ID)
}

func readLockPID(lockPath string) int {
	raw, err := os.ReadFile(lockPath)
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(raw), "\n") {
		key, value, ok := strings.Cut(strings.TrimSpace(line), "=")
		if !ok || key != "pid" {
			continue
		}
		pid, err := strconv.Atoi(strings.TrimSpace(value))
		if err != nil {
			return 0
		}
		return pid
	}
	return 0
}

func (s Store) checkDisk(required int64, freeSpace func(string) (int64, error)) error {
	if freeSpace == nil {
		freeSpace = usableFreeSpace
	}
	if err := os.MkdirAll(s.Root, 0o700); err != nil {
		return fmt.Errorf("create model store: %w", err)
	}
	free, err := freeSpace(s.Root)
	if err != nil {
		return err
	}
	if free < required {
		return fmt.Errorf("not enough free disk space: need %d bytes, have %d bytes", required, free)
	}
	return nil
}

func safeJoin(root, relative string) (string, error) {
	if err := validateRelativePath(relative); err != nil {
		return "", err
	}
	candidate := filepath.Join(root, filepath.FromSlash(relative))
	rel, err := filepath.Rel(root, candidate)
	if err != nil {
		return "", err
	}
	if rel == ".." || len(rel) >= 3 && rel[:3] == ".."+string(os.PathSeparator) {
		return "", fmt.Errorf("path traversal is not allowed")
	}
	return candidate, nil
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
