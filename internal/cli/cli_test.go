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
	"testing"

	"fast-sub/internal/cli"
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

func mustJSON(t *testing.T, output string) map[string]any {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal([]byte(output), &payload); err != nil {
		t.Fatalf("stdout is not JSON: %v\n%s", err, output)
	}
	return payload
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
