package worker

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestReadSTTResponseMissingResponse(t *testing.T) {
	_, appErr := ReadSTTResponse(filepath.Join(t.TempDir(), "missing.json"))
	if appErr == nil {
		t.Fatal("expected error")
	}
	if appErr.Code != "worker_protocol_error" {
		t.Fatalf("code = %s", appErr.Code)
	}
}

func TestRunSTTTimeout(t *testing.T) {
	command := fakeWorkerBinary(t, `package main
import "time"
func main() { time.Sleep(2 * time.Second) }
`)
	dir := t.TempDir()
	_, appErr := Runner{
		Command: command,
		Timeout: 10 * time.Millisecond,
	}.RunSTT(context.Background(), filepath.Join(dir, "request.json"), filepath.Join(dir, "response.json"), STTRequest{
		JobID:       "job_timeout",
		AudioPath:   filepath.Join(dir, "audio.wav"),
		ModelPath:   filepath.Join(dir, "model"),
		Language:    "auto",
		Device:      "auto",
		ComputeType: "auto",
		BatchSize:   8,
	})
	if appErr == nil {
		t.Fatal("expected timeout error")
	}
	if appErr.Code != "worker_timeout" {
		t.Fatalf("code = %s", appErr.Code)
	}
}

func TestRunSTTWritesNumericSchemaRequest(t *testing.T) {
	command := fakeWorkerBinary(t, `package main
import (
  "encoding/json"
  "os"
)
func main() {
  var responsePath string
  for i := 1; i < len(os.Args); i++ {
    if os.Args[i] == "--response" && i+1 < len(os.Args) { responsePath = os.Args[i+1]; i++ }
  }
  raw, _ := json.Marshal(map[string]any{"schema_version": 1, "language": "en", "segments": []map[string]any{{"start_sec": 0, "end_sec": 1, "text": "ok"}}})
  _ = os.WriteFile(responsePath, raw, 0600)
}
`)
	dir := t.TempDir()
	requestPath := filepath.Join(dir, "request.json")
	responsePath := filepath.Join(dir, "response.json")
	_, appErr := Runner{Command: command}.RunSTT(context.Background(), requestPath, responsePath, STTRequest{
		JobID:          "job_schema",
		AudioPath:      filepath.Join(dir, "audio.wav"),
		ModelPath:      filepath.Join(dir, "model"),
		Language:       "ja",
		Device:         "cuda",
		ComputeType:    "float16",
		BatchSize:      3,
		WordTimestamps: true,
	})
	if appErr != nil {
		t.Fatal(appErr)
	}
	raw, err := os.ReadFile(requestPath)
	if err != nil {
		t.Fatal(err)
	}
	var request map[string]any
	if err := json.Unmarshal(raw, &request); err != nil {
		t.Fatal(err)
	}
	if request["schema_version"] != float64(1) {
		t.Fatalf("schema_version = %#v", request["schema_version"])
	}
	if request["language"] != "ja" || request["device"] != "cuda" || request["compute_type"] != "float16" || request["batch_size"] != float64(3) {
		t.Fatalf("request = %#v", request)
	}
	if request["word_timestamps"] != true {
		t.Fatalf("word_timestamps = %#v", request["word_timestamps"])
	}
}

func TestRunSTTForcesPythonUTF8Env(t *testing.T) {
	command := fakeWorkerBinary(t, `package main
import (
  "encoding/json"
  "os"
)
func main() {
  if os.Getenv("PYTHONUTF8") != "1" || os.Getenv("PYTHONIOENCODING") != "utf-8:replace" {
    os.Exit(7)
  }
  var responsePath string
  for i := 1; i < len(os.Args); i++ {
    if os.Args[i] == "--response" && i+1 < len(os.Args) { responsePath = os.Args[i+1]; i++ }
  }
  raw, _ := json.Marshal(map[string]any{"schema_version": 1, "language": "zh", "segments": []map[string]any{{"start_sec": 0, "end_sec": 1, "text": "中文 ok"}}})
  _ = os.WriteFile(responsePath, raw, 0600)
}
`)
	dir := t.TempDir()
	_, appErr := Runner{Command: command}.RunSTT(context.Background(), filepath.Join(dir, "request.json"), filepath.Join(dir, "response.json"), STTRequest{
		JobID:       "job_utf8",
		AudioPath:   filepath.Join(dir, "audio.wav"),
		ModelPath:   filepath.Join(dir, "model"),
		Language:    "zh",
		Device:      "auto",
		ComputeType: "auto",
		BatchSize:   1,
	})
	if appErr != nil {
		t.Fatal(appErr)
	}
}

func TestSTTWorkerEnvScrubsSecrets(t *testing.T) {
	values := map[string]string{
		"PATH":                    "C:\\safe-bin",
		"TEMP":                    "C:\\Temp",
		"OPENAI_API_KEY":          "sk-secret",
		"FAST_SUB_OPENAI_API_KEY": "sk-fast-sub-secret",
		"FAST_SUB_DAEMON_TOKEN":   "ready-token",
		"AUTHORIZATION":           "Bearer token",
	}
	env := appendPythonUTF8Env(sttWorkerEnv(func(key string) string {
		return values[key]
	}))
	joined := strings.Join(env, "\n")
	for _, secret := range []string{"sk-secret", "sk-fast-sub-secret", "ready-token", "Bearer token"} {
		if strings.Contains(joined, secret) {
			t.Fatalf("worker env leaked secret %q in %q", secret, joined)
		}
	}
	if !strings.Contains(joined, "PATH=C:\\safe-bin") {
		t.Fatalf("expected PATH to be preserved in %q", joined)
	}
	if !strings.Contains(joined, "PYTHONIOENCODING=utf-8:replace") {
		t.Fatalf("expected Python UTF-8 env in %q", joined)
	}
}

func TestRunSTTTreatsEmptySegmentsAsEmptySubtitle(t *testing.T) {
	command := fakeWorkerBinary(t, `package main
import (
  "encoding/json"
  "os"
)
func main() {
  var responsePath string
  for i := 1; i < len(os.Args); i++ {
    if os.Args[i] == "--response" && i+1 < len(os.Args) { responsePath = os.Args[i+1]; i++ }
  }
  raw, _ := json.Marshal(map[string]any{"schema_version": 1, "error": map[string]any{"code": "EMPTY_SEGMENTS", "message": "faster-whisper returned no segments.", "retryable": false, "details": map[string]any{}}})
  _ = os.WriteFile(responsePath, raw, 0600)
  os.Exit(1)
}
`)
	dir := t.TempDir()
	response, appErr := Runner{Command: command}.RunSTT(context.Background(), filepath.Join(dir, "request.json"), filepath.Join(dir, "response.json"), STTRequest{
		JobID:       "job_empty",
		AudioPath:   filepath.Join(dir, "audio.wav"),
		ModelPath:   filepath.Join(dir, "model"),
		Language:    "auto",
		Device:      "auto",
		ComputeType: "auto",
		BatchSize:   1,
	})
	if appErr != nil {
		t.Fatal(appErr)
	}
	if len(response.Segments) != 0 {
		t.Fatalf("segments = %#v", response.Segments)
	}
	if len(response.Warnings) == 0 {
		t.Fatal("expected empty subtitle warning")
	}
}

func fakeWorkerBinary(t *testing.T, source string) string {
	t.Helper()
	dir := t.TempDir()
	exe := "fake-worker"
	if runtime.GOOS == "windows" {
		exe += ".exe"
	}
	sourcePath := filepath.Join(dir, "main.go")
	if err := os.WriteFile(sourcePath, []byte(source), 0o600); err != nil {
		t.Fatal(err)
	}
	outputPath := filepath.Join(dir, exe)
	cmd := exec.Command("go", "build", "-o", outputPath, sourcePath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("build fake worker: %v\n%s", err, out)
	}
	return outputPath
}
