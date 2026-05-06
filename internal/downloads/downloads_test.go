package downloads

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHTTPBackendResumeWithRange(t *testing.T) {
	payload := []byte("hello world")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"v1"`)
		if r.Method == http.MethodHead {
			return
		}
		if r.Header.Get("Range") != "bytes=5-" {
			t.Fatalf("Range = %q", r.Header.Get("Range"))
		}
		w.Header().Set("Content-Range", "bytes 5-10/11")
		w.WriteHeader(http.StatusPartialContent)
		_, _ = w.Write(payload[5:])
	}))
	defer server.Close()

	part := filepath.Join(t.TempDir(), "model.bin.part")
	if err := os.WriteFile(part, payload[:5], 0o600); err != nil {
		t.Fatal(err)
	}
	if err := writeMetadata(part, metadata{URL: server.URL, ETag: `"v1"`}); err != nil {
		t.Fatal(err)
	}
	result, err := HTTPBackend{}.Download(context.Background(), Request{URL: server.URL, PartPath: part})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Resumed || result.Restarted {
		t.Fatalf("result = %#v", result)
	}
	raw, err := os.ReadFile(part)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != string(payload) {
		t.Fatalf("part = %q", raw)
	}
}

func TestHTTPBackendRestartsWhenETagChanges(t *testing.T) {
	payload := []byte("new payload")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"new"`)
		if r.Method == http.MethodHead {
			return
		}
		if r.Header.Get("Range") != "" {
			t.Fatalf("Range should be cleared after ETag change, got %q", r.Header.Get("Range"))
		}
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	part := filepath.Join(t.TempDir(), "model.bin.part")
	if err := os.WriteFile(part, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := writeMetadata(part, metadata{URL: server.URL, ETag: `"old"`}); err != nil {
		t.Fatal(err)
	}
	result, err := HTTPBackend{}.Download(context.Background(), Request{URL: server.URL, PartPath: part})
	if err != nil {
		t.Fatal(err)
	}
	if result.Resumed || !result.Restarted {
		t.Fatalf("result = %#v", result)
	}
	raw, err := os.ReadFile(part)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != string(payload) {
		t.Fatalf("part = %q", raw)
	}
}

func TestHTTPBackendRestartsWhenValidatorMissing(t *testing.T) {
	payload := []byte("new payload")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			return
		}
		if r.Header.Get("Range") != "" {
			t.Fatalf("Range should be cleared when prior ETag cannot be confirmed, got %q", r.Header.Get("Range"))
		}
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	part := filepath.Join(t.TempDir(), "model.bin.part")
	if err := os.WriteFile(part, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := writeMetadata(part, metadata{URL: server.URL, ETag: `"old"`}); err != nil {
		t.Fatal(err)
	}
	result, err := HTTPBackend{}.Download(context.Background(), Request{URL: server.URL, PartPath: part})
	if err != nil {
		t.Fatal(err)
	}
	if result.Resumed || !result.Restarted {
		t.Fatalf("result = %#v", result)
	}
}

func TestHTTPBackendRestartsWhenMetadataMissing(t *testing.T) {
	payload := []byte("new payload")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			return
		}
		if r.Header.Get("Range") != "" {
			t.Fatalf("Range should be cleared when metadata is missing, got %q", r.Header.Get("Range"))
		}
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	part := filepath.Join(t.TempDir(), "model.bin.part")
	if err := os.WriteFile(part, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	result, err := HTTPBackend{}.Download(context.Background(), Request{URL: server.URL, PartPath: part})
	if err != nil {
		t.Fatal(err)
	}
	if result.Resumed || !result.Restarted {
		t.Fatalf("result = %#v", result)
	}
}

func TestHTTPBackendRestartsWhenMetadataHasNoValidators(t *testing.T) {
	payload := []byte("new payload")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead {
			return
		}
		if r.Header.Get("Range") != "" {
			t.Fatalf("Range should be cleared when metadata has no validators, got %q", r.Header.Get("Range"))
		}
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	part := filepath.Join(t.TempDir(), "model.bin.part")
	if err := os.WriteFile(part, []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := writeMetadata(part, metadata{URL: server.URL}); err != nil {
		t.Fatal(err)
	}
	result, err := HTTPBackend{}.Download(context.Background(), Request{URL: server.URL, PartPath: part})
	if err != nil {
		t.Fatal(err)
	}
	if result.Resumed || !result.Restarted {
		t.Fatalf("result = %#v", result)
	}
}

func TestHTTPBackendRedactsCredentialURLInErrors(t *testing.T) {
	part := filepath.Join(t.TempDir(), "model.bin.part")
	_, err := HTTPBackend{}.Download(context.Background(), Request{
		URL:      "http://user:pass@127.0.0.1:1/model.bin?token=secret",
		PartPath: part,
	})
	if err == nil {
		t.Fatal("expected download error")
	}
	message := err.Error()
	if strings.Contains(message, "user") || strings.Contains(message, "pass") || strings.Contains(message, "token=secret") {
		t.Fatalf("error leaked credential URL: %s", message)
	}
}

func TestHTTPBackendRedactsMalformedURLInErrors(t *testing.T) {
	part := filepath.Join(t.TempDir(), "model.bin.part")
	_, err := HTTPBackend{}.Download(context.Background(), Request{
		URL:      "http://user:pass@%zz/model.bin?token=secret",
		PartPath: part,
	})
	if err == nil {
		t.Fatal("expected malformed URL error")
	}
	message := err.Error()
	if strings.Contains(message, "user") || strings.Contains(message, "pass") || strings.Contains(message, "token=secret") {
		t.Fatalf("error leaked malformed URL secret: %s", message)
	}
}
