package cli_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"fast-sub/internal/cli"
	"fast-sub/internal/providers"
)

func TestVersionOutputsNonEmpty(t *testing.T) {
	var stdout bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args:    []string{"--version"},
		Stdout:  &stdout,
		Version: "test-version",
	})
	if code != 0 {
		t.Fatalf("exit code = %d", code)
	}
	if strings.TrimSpace(stdout.String()) != "test-version" {
		t.Fatalf("stdout = %q", stdout.String())
	}
}

func TestServeReadyJSON(t *testing.T) {
	oldCWD, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(oldCWD)

	ctx, cancel := context.WithCancel(context.Background())
	stdout := &notifyWriter{wrote: make(chan struct{})}
	done := make(chan int, 1)
	go func() {
		done <- cli.Run(ctx, cli.Config{
			Args:    []string{"serve", "--host", "127.0.0.1", "--port", "0", "--json-ready", "--max-running-jobs", "1"},
			Stdout:  stdout,
			Stderr:  ioDiscard{},
			Version: "test-version",
		})
	}()

	select {
	case <-stdout.wrote:
	case <-time.After(3 * time.Second):
		cancel()
		t.Fatal("timed out waiting for ready JSON")
	}
	cancel()
	select {
	case code := <-done:
		if code != 0 {
			t.Fatalf("exit code = %d, stdout=%s", code, stdout.String())
		}
	case <-time.After(3 * time.Second):
		t.Fatal("serve did not stop after context cancel")
	}
	var ready struct {
		SchemaVersion int    `json:"schema_version"`
		Ready         bool   `json:"ready"`
		BaseURL       string `json:"base_url"`
		Token         string `json:"token"`
		PID           int    `json:"pid"`
	}
	if err := json.Unmarshal([]byte(stdout.String()), &ready); err != nil {
		t.Fatalf("ready JSON invalid: %v; stdout=%s", err, stdout.String())
	}
	if ready.SchemaVersion != 1 || !ready.Ready || ready.Token == "" || ready.PID == 0 || !strings.HasPrefix(ready.BaseURL, "http://127.0.0.1:") {
		t.Fatalf("ready = %#v", ready)
	}
}

func TestDoctorJSONSuccess(t *testing.T) {
	ffmpeg := fakeBinary(t, "ffmpeg", fakeVersionBinary("ffmpeg version fake"))
	ffprobe := fakeBinary(t, "ffprobe", fakeVersionBinary("ffprobe version fake"))
	prependPath(t, ffmpeg)
	prependPath(t, ffprobe)

	var stdout bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args:   []string{"doctor", "--json"},
		Stdout: &stdout,
	})
	if code != 0 {
		t.Fatalf("exit code = %d, stdout=%s", code, stdout.String())
	}
	payload := mustJSON(t, stdout.String())
	if payload["ok"] != true {
		t.Fatalf("ok = %#v", payload["ok"])
	}
	if payload["command"] != "doctor" {
		t.Fatalf("command = %#v", payload["command"])
	}
}

func TestDoctorJSONMissingDependency(t *testing.T) {
	t.Setenv("PATH", t.TempDir())

	var stdout bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args:   []string{"doctor", "--json"},
		Stdout: &stdout,
	})
	if code != 3 {
		t.Fatalf("exit code = %d, stdout=%s", code, stdout.String())
	}
	payload := mustJSON(t, stdout.String())
	if payload["ok"] != false {
		t.Fatalf("ok = %#v", payload["ok"])
	}
	errorPayload := payload["error"].(map[string]any)
	if errorPayload["code"] != "missing_dependency" {
		t.Fatalf("error code = %#v", errorPayload["code"])
	}
}

func TestProbeJSONSuccessWithWindowsLikePaths(t *testing.T) {
	ffprobe := fakeBinary(t, "ffprobe", fakeProbeBinary(validProbeJSON()))
	prependPath(t, ffprobe)

	workDir := t.TempDir()
	input := filepath.Join(workDir, "含 空格", "输入 sample.wav")
	if err := os.MkdirAll(filepath.Dir(input), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(input, []byte("fake"), 0o600); err != nil {
		t.Fatal(err)
	}

	var stdout bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args:   []string{"probe", input, "--json"},
		Stdout: &stdout,
	})
	if code != 0 {
		t.Fatalf("exit code = %d, stdout=%s", code, stdout.String())
	}
	payload := mustJSON(t, stdout.String())
	result := payload["result"].(map[string]any)
	if result["path"] != input {
		t.Fatalf("path = %#v, want %q", result["path"], input)
	}
	selected := result["selected_audio_stream"].(map[string]any)
	if selected["sample_rate"] != float64(16000) {
		t.Fatalf("sample_rate = %#v", selected["sample_rate"])
	}
}

func TestProbeJSONMissingInput(t *testing.T) {
	var stdout bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args:   []string{"probe", "missing.wav", "--json"},
		Stdout: &stdout,
	})
	if code != 2 {
		t.Fatalf("exit code = %d, stdout=%s", code, stdout.String())
	}
	payload := mustJSON(t, stdout.String())
	if payload["ok"] != false {
		t.Fatalf("ok = %#v", payload["ok"])
	}
}

func TestProbeJSONInvalidFFprobeJSON(t *testing.T) {
	ffprobe := fakeBinary(t, "ffprobe", fakeProbeBinary("{not json"))
	prependPath(t, ffprobe)
	input := filepath.Join(t.TempDir(), "sample.wav")
	if err := os.WriteFile(input, []byte("fake"), 0o600); err != nil {
		t.Fatal(err)
	}

	var stdout bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args:   []string{"probe", input, "--json"},
		Stdout: &stdout,
	})
	if code != 7 {
		t.Fatalf("exit code = %d, stdout=%s", code, stdout.String())
	}
	payload := mustJSON(t, stdout.String())
	errorPayload := payload["error"].(map[string]any)
	if errorPayload["code"] != "ffprobe_failed" {
		t.Fatalf("error code = %#v", errorPayload["code"])
	}
}

func TestExtractJSONSuccessWithFakeFFmpeg(t *testing.T) {
	ffmpeg := fakeBinary(t, "ffmpeg", fakeFFmpegSuccessBinary())
	prependPath(t, ffmpeg)

	workDir := t.TempDir()
	input := filepath.Join(workDir, "含 空格 输入.wav")
	output := filepath.Join(workDir, "输出 audio.wav")
	if err := os.WriteFile(input, []byte("fake"), 0o600); err != nil {
		t.Fatal(err)
	}

	var stdout bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args:   []string{"extract", input, "--output", output, "--json"},
		Stdout: &stdout,
	})
	if code != 0 {
		t.Fatalf("exit code = %d, stdout=%s", code, stdout.String())
	}
	if _, err := os.Stat(output); err != nil {
		t.Fatalf("output missing: %v", err)
	}
	payload := mustJSON(t, stdout.String())
	result := payload["result"].(map[string]any)
	if result["sample_rate"] != float64(16000) {
		t.Fatalf("sample_rate = %#v", result["sample_rate"])
	}
}

func TestExtractJSONMissingInput(t *testing.T) {
	var stdout bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args:   []string{"extract", "missing.wav", "--output", "out.wav", "--json"},
		Stdout: &stdout,
	})
	if code != 2 {
		t.Fatalf("exit code = %d, stdout=%s", code, stdout.String())
	}
	mustJSON(t, stdout.String())
}

func TestExtractJSONOutputExistsWithoutOverwrite(t *testing.T) {
	workDir := t.TempDir()
	input := filepath.Join(workDir, "input.wav")
	output := filepath.Join(workDir, "output.wav")
	if err := os.WriteFile(input, []byte("fake"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(output, []byte("existing"), 0o600); err != nil {
		t.Fatal(err)
	}

	var stdout bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args:   []string{"extract", input, "--output", output, "--json"},
		Stdout: &stdout,
	})
	if code != 2 {
		t.Fatalf("exit code = %d, stdout=%s", code, stdout.String())
	}
	payload := mustJSON(t, stdout.String())
	errorPayload := payload["error"].(map[string]any)
	if errorPayload["code"] != "invalid_input" {
		t.Fatalf("error code = %#v", errorPayload["code"])
	}
}

func TestProvidersListJSONSuccess(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args:      []string{"providers", "list", "--json"},
		Stdout:    &stdout,
		Stderr:    &stderr,
		Providers: providerRuntimeForCLI(nil, false),
	})
	if code != 0 {
		t.Fatalf("exit code = %d, stdout=%s", code, stdout.String())
	}
	if stderr.String() != "" {
		t.Fatalf("stderr should be empty in JSON mode, got %q", stderr.String())
	}
	payload := mustJSON(t, stdout.String())
	result := payload["result"].(map[string]any)
	list := result["providers"].([]any)
	if len(list) != 3 {
		t.Fatalf("providers len = %d", len(list))
	}
}

func TestProvidersTestJSONAvailable(t *testing.T) {
	modelDir := t.TempDir()
	var stdout, stderr bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args:   []string{"providers", "test", "local-faster-whisper", "--json"},
		Stdout: &stdout,
		Stderr: &stderr,
		Providers: providerRuntimeForCLI(map[string]string{
			"FAST_SUB_FASTER_WHISPER_MODEL_PATH": modelDir,
		}, true),
	})
	if code != 0 {
		t.Fatalf("exit code = %d, stdout=%s", code, stdout.String())
	}
	if stderr.String() != "" {
		t.Fatalf("stderr should be empty in JSON mode, got %q", stderr.String())
	}
	payload := mustJSON(t, stdout.String())
	result := payload["result"].(map[string]any)
	if result["status"] != "available" {
		t.Fatalf("status = %#v", result["status"])
	}
	if result["check_mode"] != "static" {
		t.Fatalf("check_mode = %#v", result["check_mode"])
	}
}

func TestProvidersTestJSONFailureAndSecretRedaction(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args:   []string{"providers", "test", "api-openai-transcription", "--json"},
		Stdout: &stdout,
		Stderr: &stderr,
		Providers: providerRuntimeForCLI(map[string]string{
			"OPENAI_API_KEY": "sk-test-raw-secret",
		}, false),
	})
	if code != 0 {
		t.Fatalf("configured API key should make static provider test pass, exit code = %d", code)
	}
	if strings.Contains(stdout.String(), "sk-test-raw-secret") || strings.Contains(stderr.String(), "sk-test-raw-secret") {
		t.Fatalf("secret leaked in output")
	}

	stdout.Reset()
	stderr.Reset()
	code = cli.Run(context.Background(), cli.Config{
		Args:      []string{"providers", "test", "api-openai-transcription", "--json"},
		Stdout:    &stdout,
		Stderr:    &stderr,
		Providers: providerRuntimeForCLI(nil, false),
	})
	if code == 0 {
		t.Fatalf("missing API key should fail")
	}
	if stderr.String() != "" {
		t.Fatalf("stderr should be empty in JSON mode, got %q", stderr.String())
	}
	payload := mustJSON(t, stdout.String())
	errorPayload := payload["error"].(map[string]any)
	if errorPayload["code"] != "missing_api_key" {
		t.Fatalf("error code = %#v", errorPayload["code"])
	}

	stdout.Reset()
	stderr.Reset()
	code = cli.Run(context.Background(), cli.Config{
		Args:   []string{"providers", "test", "api-openai-transcription", "--json"},
		Stdout: &stdout,
		Stderr: &stderr,
		Providers: providerRuntimeForCLI(map[string]string{
			"FAST_SUB_GO_CONFIG": filepath.Join(t.TempDir(), "missing.toml"),
			"OPENAI_API_KEY":     "sk-test-raw-secret",
		}, false),
	})
	if code == 0 {
		t.Fatalf("invalid config should fail")
	}
	if stderr.String() != "" {
		t.Fatalf("stderr should be empty in JSON mode, got %q", stderr.String())
	}
	payload = mustJSON(t, stdout.String())
	errorPayload = payload["error"].(map[string]any)
	if errorPayload["code"] != "invalid_input" {
		t.Fatalf("error code = %#v", errorPayload["code"])
	}
	details := errorPayload["details"].(map[string]any)
	if details["status"] != "invalid_config" {
		t.Fatalf("status = %#v", details["status"])
	}
	if strings.Contains(stdout.String(), "sk-test-raw-secret") || strings.Contains(stderr.String(), "sk-test-raw-secret") {
		t.Fatalf("secret leaked in output")
	}
}

func mustJSON(t *testing.T, output string) map[string]any {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal([]byte(output), &payload); err != nil {
		t.Fatalf("stdout is not JSON: %v\n%s", err, output)
	}
	return payload
}

func providerRuntimeForCLI(env map[string]string, lookPathOK bool) providers.RuntimeConfig {
	return providers.RuntimeConfig{
		Env: func(key string) string {
			return env[key]
		},
		LookPath: func(name string) (string, error) {
			if lookPathOK {
				return filepath.Join("fake", name), nil
			}
			return "", os.ErrNotExist
		},
		Stat: os.Stat,
	}
}

func fakeBinary(t *testing.T, name string, source string) string {
	t.Helper()
	dir := t.TempDir()
	exe := name
	if runtime.GOOS == "windows" {
		exe += ".exe"
	}
	sourcePath := filepath.Join(dir, "main.go")
	if err := os.WriteFile(sourcePath, []byte(source), 0o600); err != nil {
		t.Fatalf("write fake binary source: %v", err)
	}
	outputPath := filepath.Join(dir, exe)
	cmd := exec.Command("go", "build", "-o", outputPath, sourcePath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("build fake binary: %v\n%s", err, out)
	}
	return outputPath
}

func prependPath(t *testing.T, binaryPath string) {
	t.Helper()
	current := os.Getenv("PATH")
	t.Setenv("PATH", fmt.Sprintf("%s%c%s", filepath.Dir(binaryPath), os.PathListSeparator, current))
}

type notifyWriter struct {
	mu    sync.Mutex
	once  sync.Once
	wrote chan struct{}
	buf   bytes.Buffer
}

func (w *notifyWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	n, err := w.buf.Write(p)
	w.once.Do(func() { close(w.wrote) })
	return n, err
}

func (w *notifyWriter) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.buf.String()
}

type ioDiscard struct{}

func (ioDiscard) Write(p []byte) (int, error) {
	return len(p), nil
}

func fakeVersionBinary(line string) string {
	return `package main
import "fmt"
func main() { fmt.Println(` + strconvQuote(line) + `) }
`
}

func fakeProbeBinary(payload string) string {
	return `package main
import "fmt"
func main() { fmt.Print(` + strconvQuote(payload) + `) }
`
}

func fakeFFmpegSuccessBinary() string {
	return `package main
import (
  "os"
)
func main() {
  if len(os.Args) == 0 { os.Exit(2) }
  out := os.Args[len(os.Args)-1]
  if err := os.WriteFile(out, []byte("wav"), 0600); err != nil { os.Exit(1) }
}
`
}

func validProbeJSON() string {
	return `{
  "streams": [
    {
      "index": 0,
      "codec_name": "pcm_s16le",
      "codec_type": "audio",
      "duration": "1.250000",
      "channels": 1,
      "sample_rate": "16000",
      "tags": {"language": "eng"}
    },
    {
      "index": 1,
      "codec_name": "h264",
      "codec_type": "video",
      "width": 1920,
      "height": 1080
    }
  ],
  "format": {"duration": "1.250000", "format_name": "wav"}
}`
}

func strconvQuote(value string) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}
