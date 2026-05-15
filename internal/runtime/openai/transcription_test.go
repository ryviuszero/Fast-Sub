package openai

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestTranscribeWhisperVerboseSuccess(t *testing.T) {
	audio := writeAudio(t, "small")
	var sawVerbose bool
	var sawWords bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			t.Fatalf("multipart: %v", err)
		}
		sawVerbose = r.FormValue("response_format") == "verbose_json" && r.FormValue("timestamp_granularities[]") == "segment"
		for _, value := range r.MultipartForm.Value["timestamp_granularities[]"] {
			if value == "word" {
				sawWords = true
			}
		}
		_, _ = io.WriteString(w, `{"language":"en","segments":[{"start":0,"end":1.2,"text":"hello","words":[{"start":0,"end":0.5,"word":"hello"}]},{"start":1.2,"end":2,"text":"world"}]}`)
	}))
	defer server.Close()

	result, appErr := Client{BaseURL: server.URL}.Transcribe(context.Background(), TranscribeOptions{
		AudioPath:      audio,
		FileName:       "audio.wav",
		Model:          "whisper-1",
		APIKey:         "sk-test",
		WordTimestamps: true,
	})
	if appErr != nil {
		t.Fatalf("appErr = %v", appErr)
	}
	if !sawVerbose {
		t.Fatalf("whisper-1 request did not ask for verbose segment timestamps")
	}
	if !sawWords {
		t.Fatalf("whisper-1 request did not ask for word timestamps")
	}
	if result.Language != "en" || len(result.Segments) != 2 {
		t.Fatalf("result = %#v", result)
	}
	if len(result.Segments[0].Words) != 1 || result.Segments[0].Words[0].Text != "hello" {
		t.Fatalf("words = %#v", result.Segments[0].Words)
	}
}

func TestTranscribeCommonFailures(t *testing.T) {
	cases := []struct {
		name    string
		status  int
		body    string
		wantMsg string
	}{
		{"unauthorized", http.StatusUnauthorized, `{"error":{"message":"bad key sk-secret"}}`, "HTTP 401"},
		{"rate limited", http.StatusTooManyRequests, `{"error":{"message":"too many requests"}}`, "HTTP 429"},
		{"server error", http.StatusBadGateway, `{"error":{"message":"upstream down"}}`, "HTTP 502"},
		{"invalid json", http.StatusOK, `{not json`, "invalid JSON"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			audio := writeAudio(t, "small")
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.status)
				_, _ = io.WriteString(w, tc.body)
			}))
			defer server.Close()

			_, appErr := Client{BaseURL: server.URL}.Transcribe(context.Background(), TranscribeOptions{
				AudioPath: audio,
				FileName:  "audio.m4a",
				Model:     "gpt-4o-transcribe",
				APIKey:    "sk-secret",
			})
			if appErr == nil {
				t.Fatalf("expected error")
			}
			if appErr.Code != "api_failed" {
				t.Fatalf("code = %s", appErr.Code)
			}
			if !strings.Contains(appErr.Message, tc.wantMsg) {
				t.Fatalf("message = %q, want %q", appErr.Message, tc.wantMsg)
			}
			if strings.Contains(appErr.Message, "sk-secret") {
				t.Fatalf("secret leaked: %q", appErr.Message)
			}
		})
	}
}

func TestTranscribeTimeout(t *testing.T) {
	audio := writeAudio(t, "small")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(50 * time.Millisecond)
		_, _ = io.WriteString(w, `{"text":"late"}`)
	}))
	defer server.Close()

	_, appErr := Client{BaseURL: server.URL, Timeout: time.Millisecond}.Transcribe(context.Background(), TranscribeOptions{
		AudioPath: audio,
		FileName:  "audio.m4a",
		Model:     "gpt-4o-transcribe",
		APIKey:    "sk-secret",
	})
	if appErr == nil || appErr.Code != "api_failed" {
		t.Fatalf("appErr = %#v", appErr)
	}
	if !strings.Contains(appErr.Message, "timed out") {
		t.Fatalf("message = %q", appErr.Message)
	}
}

func TestOfficialUploadLimitOnlyAppliesToOfficialBaseURL(t *testing.T) {
	dir := t.TempDir()
	audio := filepath.Join(dir, "large.m4a")
	file, err := os.Create(audio)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(25*1024*1024 + 1); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	errOfficial := checkOfficialUploadLimit(DefaultBaseURL, audio)
	if errOfficial == nil || errOfficial.Code != "api_failed" {
		t.Fatalf("official limit error = %#v", errOfficial)
	}
	if errCompatible := checkOfficialUploadLimit("http://127.0.0.1:1234/v1", audio); errCompatible != nil {
		t.Fatalf("compatible endpoint should not apply official limit: %v", errCompatible)
	}
}

func TestTranscribeWithoutAPIKeyAllowsNoAuthEndpoint(t *testing.T) {
	audio := writeAudio(t, "small")
	var authHeader string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader = r.Header.Get("Authorization")
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			t.Fatalf("multipart: %v", err)
		}
		if got := r.FormValue("model"); got != "compatible-stt" {
			t.Fatalf("model = %q", got)
		}
		_, _ = io.WriteString(w, `{"language":"en","text":"hello from local endpoint"}`)
	}))
	defer server.Close()

	result, appErr := Client{BaseURL: server.URL}.Transcribe(context.Background(), TranscribeOptions{
		AudioPath: audio,
		FileName:  "audio.m4a",
		Model:     "compatible-stt",
	})
	if appErr != nil {
		t.Fatalf("appErr = %v", appErr)
	}
	if authHeader != "" {
		t.Fatalf("Authorization header should be omitted, got %q", authHeader)
	}
	if result.Language != "en" || len(result.Segments) != 1 || result.Segments[0].Text != "hello from local endpoint" {
		t.Fatalf("result = %#v", result)
	}
}

func TestTranscribeWithoutAPIKeyUnauthorizedMapsMissingKey(t *testing.T) {
	audio := writeAudio(t, "small")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"error":{"message":"missing bearer token"}}`)
	}))
	defer server.Close()

	_, appErr := Client{BaseURL: server.URL}.Transcribe(context.Background(), TranscribeOptions{
		AudioPath: audio,
		FileName:  "audio.m4a",
		Model:     "compatible-stt",
	})
	if appErr == nil || appErr.Code != "missing_api_key" {
		t.Fatalf("appErr = %#v", appErr)
	}
	if !strings.Contains(appErr.Message, "HTTP 401") {
		t.Fatalf("message = %q", appErr.Message)
	}
}

func writeAudio(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "audio.m4a")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}
