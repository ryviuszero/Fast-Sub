package models

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type fakeBackend struct {
	payloads map[string][]byte
	calls    int
}

func (b *fakeBackend) Download(_ context.Context, request DownloadRequest) (DownloadResult, error) {
	b.calls++
	payload, ok := b.payloads[request.URL]
	if !ok {
		return DownloadResult{}, fmt.Errorf("missing fake payload for %s", request.URL)
	}
	if err := os.MkdirAll(filepath.Dir(request.PartPath), 0o700); err != nil {
		return DownloadResult{}, err
	}
	if err := os.WriteFile(request.PartPath, payload, 0o600); err != nil {
		return DownloadResult{}, err
	}
	return DownloadResult{URL: request.URL, Path: request.PartPath}, nil
}

type failOnceBackend struct {
	payload             []byte
	calls               int
	seenPartWithPartial bool
}

func (b *failOnceBackend) Download(_ context.Context, request DownloadRequest) (DownloadResult, error) {
	b.calls++
	if b.calls == 1 {
		if err := os.MkdirAll(filepath.Dir(request.PartPath), 0o700); err != nil {
			return DownloadResult{}, err
		}
		if err := os.WriteFile(request.PartPath, b.payload[:2], 0o600); err != nil {
			return DownloadResult{}, err
		}
		return DownloadResult{}, fmt.Errorf("network interrupted")
	}
	raw, err := os.ReadFile(request.PartPath)
	if err == nil && string(raw) == string(b.payload[:2]) {
		b.seenPartWithPartial = true
	}
	if err := os.WriteFile(request.PartPath, b.payload, 0o600); err != nil {
		return DownloadResult{}, err
	}
	return DownloadResult{URL: request.URL, Path: request.PartPath, Resumed: b.seenPartWithPartial}, nil
}

func TestInstallDirectoryModelAndVerify(t *testing.T) {
	store := Store{Root: t.TempDir()}
	payload := []byte("model")
	entry := fixtureEntry(payload)
	result, appErr := store.Install(context.Background(), entry, InstallOptions{
		Backend:   &fakeBackend{payloads: map[string][]byte{"https://example.test/model.bin": payload}},
		FreeSpace: func(string) (int64, error) { return 1 << 30, nil },
	})
	if appErr != nil {
		t.Fatalf("install error: %#v", appErr)
	}
	if !result.Status.Installed {
		t.Fatalf("status = %#v", result.Status)
	}
	status := store.Verify(entry)
	if !status.Installed || status.CheckedFiles != 1 {
		t.Fatalf("verify status = %#v", status)
	}
	if _, err := os.Stat(filepath.Join(store.Root, stagingDirName)); err != nil && !os.IsNotExist(err) {
		t.Fatalf("staging dir inspect: %v", err)
	}
}

func TestInstallPreservesPartAcrossRetry(t *testing.T) {
	store := Store{Root: t.TempDir()}
	payload := []byte("model")
	entry := fixtureEntry(payload)
	backend := &failOnceBackend{payload: payload}
	_, appErr := store.Install(context.Background(), entry, InstallOptions{
		Backend:   backend,
		FreeSpace: func(string) (int64, error) { return 1 << 30, nil },
	})
	if appErr == nil || appErr.Code != "download_failed" {
		t.Fatalf("first install error = %#v", appErr)
	}
	partPath := filepath.Join(store.Root, stagingDirName, entry.ID, "model.bin.part")
	if _, err := os.Stat(partPath); err != nil {
		t.Fatalf("partial download was not preserved: %v", err)
	}
	result, appErr := store.Install(context.Background(), entry, InstallOptions{
		Backend:   backend,
		FreeSpace: func(string) (int64, error) { return 1 << 30, nil },
	})
	if appErr != nil {
		t.Fatalf("retry install error: %#v", appErr)
	}
	if !result.Status.Installed || !backend.seenPartWithPartial {
		t.Fatalf("retry did not resume preserved part, status=%#v seen=%v", result.Status, backend.seenPartWithPartial)
	}
}

func TestInstallRepairsIncompleteFinalDirectory(t *testing.T) {
	store := Store{Root: t.TempDir()}
	payload := []byte("model")
	entry := fixtureEntry(payload)
	if err := os.MkdirAll(store.ModelDir(entry), 0o700); err != nil {
		t.Fatal(err)
	}
	result, appErr := store.Install(context.Background(), entry, InstallOptions{
		Backend:   &fakeBackend{payloads: map[string][]byte{"https://example.test/model.bin": payload}},
		FreeSpace: func(string) (int64, error) { return 1 << 30, nil },
	})
	if appErr != nil {
		t.Fatalf("install error: %#v", appErr)
	}
	if !result.Status.Installed {
		t.Fatalf("status = %#v", result.Status)
	}
}

func TestInstallDryRunDoesNotWriteModelDir(t *testing.T) {
	store := Store{Root: t.TempDir()}
	entry := fixtureEntry([]byte("model"))
	result, appErr := store.Install(context.Background(), entry, InstallOptions{DryRun: true})
	if appErr != nil {
		t.Fatalf("dry run error: %#v", appErr)
	}
	if !result.DryRun || result.Plan.WillWriteModelDir {
		t.Fatalf("dry run result = %#v", result)
	}
	if _, err := os.Stat(store.ModelDir(entry)); !os.IsNotExist(err) {
		t.Fatalf("model dir should not exist, err=%v", err)
	}
}

func TestInstallChecksumMismatchCleansPart(t *testing.T) {
	store := Store{Root: t.TempDir()}
	entry := fixtureEntry([]byte("expected"))
	_, appErr := store.Install(context.Background(), entry, InstallOptions{
		Backend:   &fakeBackend{payloads: map[string][]byte{"https://example.test/model.bin": []byte("wrong")}},
		FreeSpace: func(string) (int64, error) { return 1 << 30, nil },
	})
	if appErr == nil || appErr.Code != "hash_mismatch" {
		t.Fatalf("appErr = %#v", appErr)
	}
	parts, err := filepath.Glob(filepath.Join(store.Root, stagingDirName, "*", "*.part"))
	if err != nil {
		t.Fatal(err)
	}
	if len(parts) != 0 {
		t.Fatalf("damaged part files remained: %v", parts)
	}
}

func TestInstallDiskFull(t *testing.T) {
	store := Store{Root: t.TempDir()}
	entry := fixtureEntry([]byte("model"))
	_, appErr := store.Install(context.Background(), entry, InstallOptions{
		Backend:   &fakeBackend{payloads: map[string][]byte{"https://example.test/model.bin": []byte("model")}},
		FreeSpace: func(string) (int64, error) { return 1, nil },
	})
	if appErr == nil || appErr.Code != "disk_full" {
		t.Fatalf("appErr = %#v", appErr)
	}
}

func TestManifestPathTraversalRejected(t *testing.T) {
	store := Store{Root: t.TempDir()}
	entry := fixtureEntry([]byte("model"))
	entry.RequiredFiles[0].Path = "../escape.bin"
	status := store.Verify(entry)
	if status.Status != "invalid_manifest" {
		t.Fatalf("status = %#v", status)
	}
}

func TestLockContentionAndStaleLock(t *testing.T) {
	store := Store{Root: t.TempDir()}
	entry := fixtureEntry([]byte("model"))
	release, err := store.acquireLock(entry, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if _, err := store.acquireLock(entry, time.Hour); err == nil {
		t.Fatal("expected lock contention")
	}
	release()
	lockPath := filepath.Join(store.Root, lockDirName, entry.ID+".lock")
	if err := os.MkdirAll(filepath.Dir(lockPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(lockPath, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-3 * time.Hour)
	if err := os.Chtimes(lockPath, old, old); err != nil {
		t.Fatal(err)
	}
	if _, err := store.acquireLock(entry, time.Hour); err == nil || !strings.Contains(err.Error(), "stale") {
		t.Fatalf("expected stale lock, got %v", err)
	}
}

func TestDeadPIDLockIsRecovered(t *testing.T) {
	store := Store{Root: t.TempDir()}
	entry := fixtureEntry([]byte("model"))
	lockPath := filepath.Join(store.Root, lockDirName, entry.ID+".lock")
	if err := os.MkdirAll(filepath.Dir(lockPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(lockPath, []byte("pid=99999999\ncreated_at=2026-05-06T14:48:02+08:00\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	release, err := store.acquireLock(entry, time.Hour)
	if err != nil {
		t.Fatalf("dead pid lock should be recovered: %v", err)
	}
	defer release()
	raw, err := os.ReadFile(lockPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), fmt.Sprintf("pid=%d", os.Getpid())) {
		t.Fatalf("lock was not replaced with current pid: %s", raw)
	}
}

func TestVerifyMissingRequiredFile(t *testing.T) {
	store := Store{Root: t.TempDir()}
	entry := fixtureEntry([]byte("model"))
	if err := os.MkdirAll(store.ModelDir(entry), 0o700); err != nil {
		t.Fatal(err)
	}
	status := store.Verify(entry)
	if status.Status != "missing" {
		t.Fatalf("status = %#v", status)
	}
}

func TestBuiltInManifestIncludesFasterWhisperASRModels(t *testing.T) {
	manifest := BuiltInManifest()
	for _, id := range []string{"whisper-base", "whisper-small", "whisper-large-v3-turbo"} {
		entry, ok := manifest.Get(id)
		if !ok {
			t.Fatalf("missing built-in model %s", id)
		}
		if entry.Type != "asr" || entry.Backend != "faster-whisper" {
			t.Fatalf("%s = type %s backend %s", id, entry.Type, entry.Backend)
		}
		if !hasString(entry.CompatibleProviders, "local-faster-whisper") {
			t.Fatalf("%s compatible providers = %#v", id, entry.CompatibleProviders)
		}
		if len(entry.RequiredFiles) == 0 {
			t.Fatalf("%s has no required files", id)
		}
	}
}

func TestBuiltInManifestIncludesWhisperCPPModels(t *testing.T) {
	manifest := BuiltInManifest()
	for _, id := range []string{"whispercpp-base", "whispercpp-small", "whispercpp-large-v3-turbo-q5_0"} {
		entry, ok := manifest.Get(id)
		if !ok {
			t.Fatalf("missing built-in model %s", id)
		}
		if entry.Type != "asr" || entry.Backend != "whisper.cpp" {
			t.Fatalf("%s = type %s backend %s", id, entry.Type, entry.Backend)
		}
		if !hasString(entry.CompatibleProviders, "local-whisper-cpp") {
			t.Fatalf("%s compatible providers = %#v", id, entry.CompatibleProviders)
		}
		if entry.ManifestType() != "file" || entry.SHA256 == "" || len(entry.URLs) != 1 {
			t.Fatalf("%s has invalid file manifest: %#v", id, entry)
		}
		if !strings.Contains(entry.URLs[0], "huggingface.co/ggerganov/whisper.cpp") {
			t.Fatalf("%s URL = %s", id, entry.URLs[0])
		}
		if status := (Store{Root: t.TempDir()}).Verify(entry); status.Status != "missing" {
			t.Fatalf("%s verify status = %#v", id, status)
		}
	}
}

func hasString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func fixtureEntry(payload []byte) ManifestEntry {
	sum := sha256.Sum256(payload)
	return ManifestEntry{
		ID:                  "fixture-model",
		Name:                "Fixture Model",
		Type:                "asr",
		Backend:             "faster-whisper",
		ArtifactKind:        "model",
		CompatibleProviders: []string{"local-faster-whisper"},
		SizeBytes:           int64(len(payload)),
		License:             "MIT",
		URLs:                []string{"https://example.test/"},
		RequiredFiles: []ManifestFile{{
			Path:      "model.bin",
			SizeBytes: int64(len(payload)),
			SHA256:    hex.EncodeToString(sum[:]),
			URLs:      []string{"https://example.test/model.bin"},
		}},
		PrivacyClass:     "local",
		InstallLayout:    "directory",
		SourceType:       "http",
		MinDiskFreeBytes: 2,
	}
}
