package whispercpp

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

func TestTranscribeJSONWithCJKBlankSegmentAndChinesePaths(t *testing.T) {
	binary := fakeWhisperBinary(t)
	dir := t.TempDir()
	jobDir := mkdir(t, filepath.Join(dir, "job 含 空格"))
	audio := writeFile(t, filepath.Join(dir, "音频 sample.wav"), "wav")
	model := writeFile(t, filepath.Join(dir, "模型 small.bin"), "model")

	result, appErr := Transcribe(context.Background(), Options{
		Command:   binary,
		AudioPath: audio,
		ModelPath: model,
		JobDir:    jobDir,
		Language:  "auto",
	})
	if appErr != nil {
		t.Fatalf("Transcribe error = %v", appErr)
	}
	if result.Provider != "local-whisper-cpp" || result.OutputFormat != "json" {
		t.Fatalf("result = %#v", result)
	}
	if len(result.Segments) != 2 {
		t.Fatalf("segments = %#v", result.Segments)
	}
	if result.Segments[0].Text != "你好世界" {
		t.Fatalf("segment text = %#v", result.Segments[0].Text)
	}
}

func TestTranscribeFallsBackToSRTWhenJSONUnsupported(t *testing.T) {
	binary := fakeWhisperBinary(t)
	t.Setenv("FAST_SUB_FAKE_WHISPER_HELP_MODE", "srt_only")
	dir := t.TempDir()
	result, appErr := Transcribe(context.Background(), Options{
		Command:   binary,
		AudioPath: writeFile(t, filepath.Join(dir, "audio.wav"), "wav"),
		ModelPath: writeFile(t, filepath.Join(dir, "model.bin"), "model"),
		JobDir:    mkdir(t, filepath.Join(dir, "job")),
		Language:  "zh",
	})
	if appErr != nil {
		t.Fatalf("Transcribe error = %v", appErr)
	}
	if result.OutputFormat != "srt" || len(result.Segments) != 2 {
		t.Fatalf("result = %#v", result)
	}
}

func TestTranscribeFailureModes(t *testing.T) {
	cases := []struct {
		name     string
		mode     string
		wantCode string
	}{
		{"nonzero", "nonzero", "worker_failed"},
		{"invalid_output", "invalid_output", "worker_protocol_error"},
		{"invalid_timestamp", "invalid_timestamp", "worker_protocol_error"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			binary := fakeWhisperBinary(t)
			t.Setenv("FAST_SUB_FAKE_WHISPER_MODE", tc.mode)
			dir := t.TempDir()
			_, appErr := Transcribe(context.Background(), Options{
				Command:   binary,
				AudioPath: writeFile(t, filepath.Join(dir, "audio.wav"), "wav"),
				ModelPath: writeFile(t, filepath.Join(dir, "model.bin"), "model"),
				JobDir:    mkdir(t, filepath.Join(dir, "job")),
				Language:  "auto",
			})
			if appErr == nil {
				t.Fatal("expected error")
			}
			if appErr.Code != tc.wantCode {
				t.Fatalf("code = %s, want %s; err=%#v", appErr.Code, tc.wantCode, appErr)
			}
		})
	}
}

func TestCapabilityDetectionTimeout(t *testing.T) {
	binary := fakeWhisperBinary(t)
	t.Setenv("FAST_SUB_FAKE_WHISPER_HELP_MODE", "sleep")
	_, appErr := DetectCapabilities(context.Background(), binary, 8192, 10*time.Millisecond)
	if appErr == nil {
		t.Fatal("expected timeout")
	}
	if appErr.Code != "worker_timeout" {
		t.Fatalf("code = %s, want worker_timeout; err=%#v", appErr.Code, appErr)
	}
}

func TestDiscoverBinaryMissing(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	_, appErr := DiscoverBinary("", "")
	if appErr == nil || appErr.Code != "missing_dependency" {
		t.Fatalf("appErr = %#v", appErr)
	}
}

func TestParsersRejectInvalidOutput(t *testing.T) {
	if _, _, err := ParseJSON([]byte(`{"transcription":[{"start":2,"end":1,"text":"bad"}]}`)); err == nil {
		t.Fatal("expected invalid JSON segment error")
	}
	if _, _, err := ParseJSON([]byte(`{"transcription":[{"start":0,"end":1,"text":"ok"},{"text":"bad"}]}`)); err == nil {
		t.Fatal("expected mixed valid/invalid JSON segment error")
	}
	if _, _, err := ParseJSON([]byte(`{"transcription":[{"start":0,"end":1,"text":"ok"},"bad"]}`)); err == nil {
		t.Fatal("expected non-object JSON segment error")
	}
	if _, _, err := ParseSRT("1\n00:00:02,000 --> 00:00:01,000\nbad\n\n"); err == nil {
		t.Fatal("expected invalid SRT segment error")
	}
}

func fakeWhisperBinary(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	exe := "fake-whisper"
	if runtime.GOOS == "windows" {
		exe += ".exe"
	}
	sourcePath := filepath.Join(dir, "main.go")
	if err := os.WriteFile(sourcePath, []byte(fakeWhisperSource()), 0o600); err != nil {
		t.Fatal(err)
	}
	outputPath := filepath.Join(dir, exe)
	cmd := exec.Command("go", "build", "-o", outputPath, sourcePath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("build fake whisper: %v\n%s", err, out)
	}
	return outputPath
}

func fakeWhisperSource() string {
	return `package main
import (
  "encoding/json"
  "fmt"
  "os"
  "time"
)
func main() {
  for _, arg := range os.Args[1:] {
    if arg == "--help" {
      if os.Getenv("FAST_SUB_FAKE_WHISPER_HELP_MODE") == "sleep" {
        time.Sleep(5 * time.Second)
      }
      if os.Getenv("FAST_SUB_FAKE_WHISPER_HELP_MODE") == "srt_only" {
        fmt.Println("--output-srt -osrt --output-file -of --no-prints -np --language auto")
      } else {
        fmt.Println("--output-json -oj --output-json-full --output-srt -osrt --output-file -of --no-prints -np --language auto")
      }
      return
    }
    if arg == "--version" { fmt.Println("whisper.cpp fake 1.0"); return }
  }
  outputBase := ""
  format := "json"
  for i := 1; i < len(os.Args); i++ {
    if os.Args[i] == "-of" && i+1 < len(os.Args) { outputBase = os.Args[i+1]; i++ }
    if os.Args[i] == "-osrt" { format = "srt" }
    if os.Args[i] == "-oj" { format = "json" }
  }
  if outputBase == "" { os.Exit(2) }
  switch os.Getenv("FAST_SUB_FAKE_WHISPER_MODE") {
  case "nonzero":
    fmt.Fprintln(os.Stdout, "stdout noise")
    fmt.Fprintln(os.Stderr, "whisper failed")
    os.Exit(7)
  case "invalid_output":
    _ = os.WriteFile(outputBase+"."+format, []byte("{bad"), 0600)
    return
  case "invalid_timestamp":
    writeJSON(outputBase+".json", map[string]any{"result": map[string]any{"language": "zh"}, "transcription": []map[string]any{{"timestamps": map[string]any{"from": "00:00:02.000", "to": "00:00:01.000"}, "text": "bad"}}})
    return
  }
  fmt.Fprintln(os.Stdout, "debug stdout")
  fmt.Fprintln(os.Stderr, "debug stderr")
  if format == "srt" {
    _ = os.WriteFile(outputBase+".srt", []byte("1\n00:00:00,000 --> 00:00:01,000\n你好世界\n\n2\n00:00:01,000 --> 00:00:02,000\n第二行\n\n"), 0600)
    return
  }
  writeJSON(outputBase+".json", map[string]any{
    "result": map[string]any{"language": "zh"},
    "transcription": []map[string]any{
      {"timestamps": map[string]any{"from": "00:00:00.000", "to": "00:00:01.250"}, "text": " 你好世界 "},
      {"timestamps": map[string]any{"from": "00:00:01.250", "to": "00:00:01.500"}, "text": "   "},
      {"offsets": map[string]any{"from": 1500, "to": 2500}, "text": "第二行"},
    },
  })
}
func writeJSON(path string, payload any) {
  raw, _ := json.Marshal(payload)
  _ = os.WriteFile(path, raw, 0600)
}
`
}

func writeFile(t *testing.T, path string, content string) string {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func mkdir(t *testing.T, path string) string {
	t.Helper()
	if err := os.MkdirAll(path, 0o700); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestParseWhisperCPPJSONShapes(t *testing.T) {
	raw := map[string]any{
		"language": "ja",
		"segments": []map[string]any{
			{"start_sec": 0, "end_sec": 1, "text": "こんにちは"},
		},
	}
	encoded, _ := json.Marshal(raw)
	segments, language, err := ParseJSON(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if language != "ja" || len(segments) != 1 || !strings.Contains(segments[0].Text, "こんにちは") {
		t.Fatalf("language=%s segments=%#v", language, segments)
	}
}
