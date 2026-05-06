package cli_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"fast-sub/internal/cli"
)

func TestTranscribeJSONSuccessWithFakeWorker(t *testing.T) {
	withWorkingDir(t, t.TempDir())
	ffmpeg := fakeBinary(t, "ffmpeg", fakeFFmpegSuccessBinary())
	ffprobe := fakeBinary(t, "ffprobe", fakeProbeBinary(validProbeJSON()))
	worker := fakeBinary(t, "fake-worker", fakeSTTWorkerBinary())
	prependPath(t, ffmpeg)
	prependPath(t, ffprobe)

	workDir := t.TempDir()
	input := writeFile(t, filepath.Join(workDir, "含 空格", "input sample.mp4"), "fake")
	modelDir := mkdir(t, filepath.Join(workDir, "模型 small"))
	output := filepath.Join(workDir, "out.srt")
	requestCopy := filepath.Join(workDir, "request-copy.json")
	t.Setenv("FAST_SUB_FAKE_WORKER_REQUEST_COPY", requestCopy)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args: []string{
			"transcribe", input,
			"--model-path", modelDir,
			"--output", output,
			"--language", "zh",
			"--device", "cpu",
			"--compute-type", "int8",
			"--batch-size", "4",
			"--word-timestamps", "on",
			"--worker-command", worker,
			"--worker-arg", "--fake-extra",
			"--json",
		},
		Stdout: &stdout,
		Stderr: &stderr,
	})
	if code != 0 {
		t.Fatalf("exit code = %d, stdout=%s stderr=%s", code, stdout.String(), stderr.String())
	}
	if stderr.String() != "" {
		t.Fatalf("stderr should be empty in JSON mode, got %q", stderr.String())
	}
	payload := mustJSON(t, stdout.String())
	result := payload["result"].(map[string]any)
	if result["segments"] != float64(2) {
		t.Fatalf("segments = %#v", result["segments"])
	}
	if _, err := os.Stat(output); err != nil {
		t.Fatalf("output missing: %v", err)
	}
	srt, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(srt), "00:00:00,000 --> 00:00:01,250") || !strings.Contains(string(srt), "你好") {
		t.Fatalf("unexpected SRT:\n%s", srt)
	}

	request := mustJSONFile(t, requestCopy)
	if request["schema_version"] != float64(1) {
		t.Fatalf("schema_version = %#v", request["schema_version"])
	}
	if request["device"] != "cpu" || request["compute_type"] != "int8" || request["batch_size"] != float64(4) {
		t.Fatalf("request options = %#v", request)
	}
	if request["word_timestamps"] != true {
		t.Fatalf("word_timestamps = %#v", request["word_timestamps"])
	}
	if request["model_path"] != modelDir {
		t.Fatalf("model_path = %#v", request["model_path"])
	}
}

func TestTranscribeFasterWhisperJSONSuccessWithModelID(t *testing.T) {
	withWorkingDir(t, t.TempDir())
	ffmpeg := fakeBinary(t, "ffmpeg", fakeFFmpegSuccessBinary())
	ffprobe := fakeBinary(t, "ffprobe", fakeProbeBinary(validProbeJSON()))
	worker := fakeBinary(t, "fake-worker", fakeSTTWorkerBinary())
	prependPath(t, ffmpeg)
	prependPath(t, ffprobe)

	workDir := t.TempDir()
	storeDir := mkdir(t, filepath.Join(workDir, "store with spaces"))
	modelDir := mkdir(t, filepath.Join(storeDir, "whisper-small"))
	writeFile(t, filepath.Join(modelDir, "config.json"), "config")
	writeFile(t, filepath.Join(modelDir, "model.bin"), "model")
	manifestPath := filepath.Join(workDir, "manifest.json")
	writeTranscribeManifest(t, manifestPath)
	t.Setenv("FAST_SUB_GO_MODEL_MANIFEST", manifestPath)
	t.Setenv("FAST_SUB_MODEL_STORE_DIR", storeDir)
	requestCopy := filepath.Join(workDir, "request-copy.json")
	t.Setenv("FAST_SUB_FAKE_WORKER_REQUEST_COPY", requestCopy)
	input := writeFile(t, filepath.Join(workDir, "input.mp4"), "fake")

	var stdout bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args:   []string{"transcribe", input, "--provider", "local-faster-whisper", "--model", "whisper-small", "--worker-command", worker, "--json"},
		Stdout: &stdout,
	})
	if code != 0 {
		t.Fatalf("exit code = %d, stdout=%s", code, stdout.String())
	}
	payload := mustJSON(t, stdout.String())
	result := payload["result"].(map[string]any)
	if result["model"] != "whisper-small" {
		t.Fatalf("model = %#v", result["model"])
	}
	request := mustJSONFile(t, requestCopy)
	if request["model_path"] != modelDir {
		t.Fatalf("model_path = %#v, want %s", request["model_path"], modelDir)
	}
}

func TestTranscribeOpenAIJSONSuccessWithMockHTTP(t *testing.T) {
	withWorkingDir(t, t.TempDir())
	ffmpeg := fakeBinary(t, "ffmpeg", fakeFFmpegSuccessBinary())
	ffprobe := fakeBinary(t, "ffprobe", fakeProbeBinary(validProbeJSON()))
	prependPath(t, ffmpeg)
	prependPath(t, ffprobe)

	var sawAuth bool
	var sawJSONFormat bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/transcriptions" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		sawAuth = r.Header.Get("Authorization") == "Bearer test-openai-secret"
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			t.Fatalf("multipart: %v", err)
		}
		sawJSONFormat = r.FormValue("response_format") == "json"
		if r.FormValue("timestamp_granularities[]") != "" {
			t.Fatalf("gpt-4o request should not send whisper timestamp_granularities")
		}
		_, fileHeader, err := r.FormFile("file")
		if err != nil {
			t.Fatalf("file part: %v", err)
		}
		if filepath.Ext(fileHeader.Filename) != ".m4a" {
			t.Fatalf("upload filename = %s", fileHeader.Filename)
		}
		_, _ = io.WriteString(w, `{"text":"hello from api","usage":{"total_tokens":3}}`)
	}))
	defer server.Close()

	workDir := t.TempDir()
	input := writeFile(t, filepath.Join(workDir, "input.mp4"), "fake")
	output := filepath.Join(workDir, "api.srt")
	t.Setenv("FAST_SUB_OPENAI_TEST_KEY", "test-openai-secret")

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args: []string{
			"transcribe", input,
			"--provider", "api-openai-transcription",
			"--model", "gpt-4o-transcribe",
			"--api-key-env", "FAST_SUB_OPENAI_TEST_KEY",
			"--base-url", server.URL,
			"--output", output,
			"--json",
		},
		Stdout: &stdout,
		Stderr: &stderr,
	})
	if code != 0 {
		t.Fatalf("exit code = %d, stdout=%s stderr=%s", code, stdout.String(), stderr.String())
	}
	if !sawAuth || !sawJSONFormat {
		t.Fatalf("server did not observe expected auth/format")
	}
	payload := mustJSON(t, stdout.String())
	result := payload["result"].(map[string]any)
	if result["provider"] != "api-openai-transcription" || result["model"] != "gpt-4o-transcribe" {
		t.Fatalf("result = %#v", result)
	}
	if result["api_upload_format"] != "m4a" {
		t.Fatalf("api_upload_format = %#v", result["api_upload_format"])
	}
	srt, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(srt), "hello from api") {
		t.Fatalf("unexpected SRT:\n%s", srt)
	}
	if strings.Contains(stdout.String(), "test-openai-secret") || strings.Contains(stderr.String(), "test-openai-secret") {
		t.Fatalf("secret leaked: stdout=%s stderr=%s", stdout.String(), stderr.String())
	}
}

func TestTranscribeOpenAIJSONFailureIsRedacted(t *testing.T) {
	withWorkingDir(t, t.TempDir())
	ffmpeg := fakeBinary(t, "ffmpeg", fakeFFmpegSuccessBinary())
	ffprobe := fakeBinary(t, "ffprobe", fakeProbeBinary(validProbeJSON()))
	prependPath(t, ffmpeg)
	prependPath(t, ffprobe)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"error":{"message":"bad key sk-real-secret"}}`)
	}))
	defer server.Close()

	workDir := t.TempDir()
	input := writeFile(t, filepath.Join(workDir, "input.mp4"), "fake")
	t.Setenv("FAST_SUB_OPENAI_TEST_KEY", "sk-real-secret")

	var stdout bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args: []string{
			"transcribe", input,
			"--provider", "api-openai-transcription",
			"--model", "whisper-1",
			"--api-key-env", "FAST_SUB_OPENAI_TEST_KEY",
			"--base-url", server.URL,
			"--output", filepath.Join(workDir, "api-fail.srt"),
			"--json",
		},
		Stdout: &stdout,
	})
	if code != 1 {
		t.Fatalf("exit code = %d, stdout=%s", code, stdout.String())
	}
	payload := mustJSON(t, stdout.String())
	errorPayload := payload["error"].(map[string]any)
	if errorPayload["code"] != "api_failed" {
		t.Fatalf("error code = %#v", errorPayload["code"])
	}
	if strings.Contains(stdout.String(), "sk-real-secret") || strings.Contains(stdout.String(), "Authorization") {
		t.Fatalf("secret leaked in JSON: %s", stdout.String())
	}
}

func TestTranscribeOpenAIUsesConfigFile(t *testing.T) {
	withWorkingDir(t, t.TempDir())
	ffmpeg := fakeBinary(t, "ffmpeg", fakeFFmpegSuccessBinary())
	ffprobe := fakeBinary(t, "ffprobe", fakeProbeBinary(validProbeJSON()))
	prependPath(t, ffmpeg)
	prependPath(t, ffprobe)

	var sawAuth bool
	var sawMP3 bool
	var sawWords bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawAuth = r.Header.Get("Authorization") == "Bearer configured-secret"
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			t.Fatalf("multipart: %v", err)
		}
		for _, value := range r.MultipartForm.Value["timestamp_granularities[]"] {
			if value == "word" {
				sawWords = true
			}
		}
		_, fileHeader, err := r.FormFile("file")
		if err != nil {
			t.Fatalf("file part: %v", err)
		}
		sawMP3 = filepath.Ext(fileHeader.Filename) == ".mp3"
		_, _ = io.WriteString(w, `{"text":"configured hello"}`)
	}))
	defer server.Close()

	workDir := t.TempDir()
	input := writeFile(t, filepath.Join(workDir, "input.mp4"), "fake")
	output := filepath.Join(workDir, "configured.srt")
	configPath := writeFile(t, filepath.Join(workDir, "fast-sub-go.toml"), fmt.Sprintf(`
[providers.api-openai-transcription]
model = "whisper-1"
api_key_env = "FAST_SUB_CONFIGURED_OPENAI_KEY"
base_url = "%s"
api_upload_format = "mp3"
words = true
`, server.URL))
	t.Setenv("FAST_SUB_CONFIGURED_OPENAI_KEY", "configured-secret")

	var stdout bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args: []string{
			"transcribe", input,
			"--provider", "api-openai-transcription",
			"--config", configPath,
			"--output", output,
			"--json",
		},
		Stdout: &stdout,
	})
	if code != 0 {
		t.Fatalf("exit code = %d, stdout=%s", code, stdout.String())
	}
	if !sawAuth || !sawMP3 || !sawWords {
		t.Fatalf("server did not observe configured auth/upload format/words")
	}
	payload := mustJSON(t, stdout.String())
	result := payload["result"].(map[string]any)
	if result["model"] != "whisper-1" {
		t.Fatalf("model = %#v", result["model"])
	}
	if result["api_upload_format"] != "mp3" {
		t.Fatalf("api_upload_format = %#v", result["api_upload_format"])
	}
	if strings.Contains(stdout.String(), "configured-secret") {
		t.Fatalf("secret leaked in stdout: %s", stdout.String())
	}
}

func TestTranscribeOpenAIUsesDefaultConfigFile(t *testing.T) {
	workingDir := t.TempDir()
	withWorkingDir(t, workingDir)
	ffmpeg := fakeBinary(t, "ffmpeg", fakeFFmpegSuccessBinary())
	ffprobe := fakeBinary(t, "ffprobe", fakeProbeBinary(validProbeJSON()))
	prependPath(t, ffmpeg)
	prependPath(t, ffprobe)

	var sawAuth bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawAuth = r.Header.Get("Authorization") == "Bearer default-config-secret"
		_, _ = io.WriteString(w, `{"text":"default config hello"}`)
	}))
	defer server.Close()

	input := writeFile(t, filepath.Join(workingDir, "input.mp4"), "fake")
	output := filepath.Join(workingDir, "default-config.srt")
	writeFile(t, filepath.Join(workingDir, "fast-sub-go.toml"), fmt.Sprintf(`
[providers.api-openai-transcription]
model = "gpt-4o-transcribe"
api_key_env = "FAST_SUB_DEFAULT_CONFIG_OPENAI_KEY"
base_url = "%s"
api_upload_format = "m4a"
`, server.URL))
	t.Setenv("FAST_SUB_DEFAULT_CONFIG_OPENAI_KEY", "default-config-secret")

	var stdout bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args: []string{
			"transcribe", input,
			"--provider", "api-openai-transcription",
			"--output", output,
			"--json",
		},
		Stdout: &stdout,
	})
	if code != 0 {
		t.Fatalf("exit code = %d, stdout=%s", code, stdout.String())
	}
	if !sawAuth {
		t.Fatalf("server did not observe auth from default config")
	}
	if strings.Contains(stdout.String(), "default-config-secret") {
		t.Fatalf("secret leaked in stdout: %s", stdout.String())
	}
}

func TestTranscribeOpenAIRejectsRawAPIKeyInConfigFile(t *testing.T) {
	withWorkingDir(t, t.TempDir())
	workDir := t.TempDir()
	input := writeFile(t, filepath.Join(workDir, "input.mp4"), "fake")
	configPath := writeFile(t, filepath.Join(workDir, "fast-sub-go.toml"), `
[providers.api-openai-transcription]
api_key = "sk-should-not-be-here"
`)

	var stdout bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args: []string{
			"transcribe", input,
			"--provider", "api-openai-transcription",
			"--model", "gpt-4o-transcribe",
			"--config", configPath,
			"--json",
		},
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
	if strings.Contains(stdout.String(), "sk-should-not-be-here") {
		t.Fatalf("secret leaked in stdout: %s", stdout.String())
	}
}

func TestTranscribeOpenAIRejectsRawAPIKeyFlag(t *testing.T) {
	cases := []struct {
		name string
		args []string
	}{
		{name: "separate value", args: []string{"--api-key", "sk-test"}},
		{name: "equals value", args: []string{"--api-key=sk-test"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			withWorkingDir(t, t.TempDir())
			workDir := t.TempDir()
			input := writeFile(t, filepath.Join(workDir, "input.mp4"), "fake")

			var stdout bytes.Buffer
			var stderr bytes.Buffer
			args := []string{
				"transcribe", input,
				"--provider", "api-openai-transcription",
				"--model", "gpt-4o-transcribe",
			}
			args = append(args, tc.args...)
			args = append(args, "--json")
			code := cli.Run(context.Background(), cli.Config{
				Args:   args,
				Stdout: &stdout,
				Stderr: &stderr,
			})
			if code == 0 {
				t.Fatalf("raw API key flag should fail")
			}
			payload := mustJSON(t, stdout.String())
			errorPayload := payload["error"].(map[string]any)
			if errorPayload["code"] != "invalid_input" {
				t.Fatalf("error code = %#v", errorPayload["code"])
			}
			if strings.Contains(stdout.String(), "sk-test") || strings.Contains(stderr.String(), "sk-test") {
				t.Fatalf("secret leaked: stdout=%s stderr=%s", stdout.String(), stderr.String())
			}
		})
	}
}

func TestAutoJSONSuccessWithFakeWorkerAndYesPlaceholder(t *testing.T) {
	withWorkingDir(t, t.TempDir())
	ffmpeg := fakeBinary(t, "ffmpeg", fakeFFmpegSuccessBinary())
	ffprobe := fakeBinary(t, "ffprobe", fakeProbeBinary(validProbeJSON()))
	worker := fakeBinary(t, "fake-worker", fakeSTTWorkerBinary())
	prependPath(t, ffmpeg)
	prependPath(t, ffprobe)

	workDir := t.TempDir()
	input := writeFile(t, filepath.Join(workDir, "input.mp3"), "fake")
	modelDir := mkdir(t, filepath.Join(workDir, "model"))

	var stdout bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args:   []string{"auto", input, "--model-path", modelDir, "--worker-command", worker, "--yes", "--json"},
		Stdout: &stdout,
	})
	if code != 0 {
		t.Fatalf("exit code = %d, stdout=%s", code, stdout.String())
	}
	payload := mustJSON(t, stdout.String())
	if payload["command"] != "auto" || payload["ok"] != true {
		t.Fatalf("payload = %#v", payload)
	}
	result := payload["result"].(map[string]any)
	if !strings.HasSuffix(result["output_path"].(string), "input.srt") {
		t.Fatalf("output_path = %#v", result["output_path"])
	}
}

func TestTranscribeWhisperCPPJSONSuccessWithModelPath(t *testing.T) {
	withWorkingDir(t, t.TempDir())
	ffmpeg := fakeBinary(t, "ffmpeg", fakeFFmpegSuccessBinary())
	ffprobe := fakeBinary(t, "ffprobe", fakeProbeBinary(validProbeJSON()))
	whisper := fakeBinary(t, "fake-whisper", fakeWhisperCPPBinary())
	prependPath(t, ffmpeg)
	prependPath(t, ffprobe)

	workDir := t.TempDir()
	input := writeFile(t, filepath.Join(workDir, "含 空格", "input sample.mp4"), "fake")
	modelPath := writeFile(t, filepath.Join(workDir, "模型 small.bin"), "model")
	output := filepath.Join(workDir, "输出 local.srt")

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args: []string{
			"transcribe", input,
			"--provider", "local-whisper-cpp",
			"--model-path", modelPath,
			"--output", output,
			"--whisper-cpp-command", whisper,
			"--json",
		},
		Stdout: &stdout,
		Stderr: &stderr,
	})
	if code != 0 {
		t.Fatalf("exit code = %d, stdout=%s stderr=%s", code, stdout.String(), stderr.String())
	}
	if stderr.String() != "" {
		t.Fatalf("stderr should be empty in JSON mode, got %q", stderr.String())
	}
	payload := mustJSON(t, stdout.String())
	result := payload["result"].(map[string]any)
	if result["provider"] != "local-whisper-cpp" || result["segments"] != float64(2) {
		t.Fatalf("result = %#v", result)
	}
	srt, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(srt), "你好世界") {
		t.Fatalf("unexpected SRT:\n%s", srt)
	}
}

func TestTranscribeWhisperCPPJSONSuccessWithModelID(t *testing.T) {
	withWorkingDir(t, t.TempDir())
	ffmpeg := fakeBinary(t, "ffmpeg", fakeFFmpegSuccessBinary())
	ffprobe := fakeBinary(t, "ffprobe", fakeProbeBinary(validProbeJSON()))
	whisper := fakeBinary(t, "fake-whisper", fakeWhisperCPPBinary())
	prependPath(t, ffmpeg)
	prependPath(t, ffprobe)

	workDir := t.TempDir()
	modelStore := mkdir(t, filepath.Join(workDir, "store with spaces"))
	modelDir := mkdir(t, filepath.Join(modelStore, "whispercpp-small"))
	writeFile(t, filepath.Join(modelDir, "whispercpp-small.bin"), "model")
	manifestPath := filepath.Join(workDir, "manifest.json")
	writeTranscribeManifest(t, manifestPath)
	t.Setenv("FAST_SUB_GO_MODEL_MANIFEST", manifestPath)
	t.Setenv("FAST_SUB_MODEL_STORE_DIR", modelStore)
	t.Setenv("FAST_SUB_WHISPER_CPP_COMMAND", whisper)
	input := writeFile(t, filepath.Join(workDir, "input.mp4"), "fake")

	var stdout bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args:   []string{"transcribe", input, "--provider", "local-whisper-cpp", "--model", "whispercpp-small", "--json"},
		Stdout: &stdout,
	})
	if code != 0 {
		t.Fatalf("exit code = %d, stdout=%s", code, stdout.String())
	}
	payload := mustJSON(t, stdout.String())
	if payload["ok"] != true {
		t.Fatalf("payload = %#v", payload)
	}
}

func TestTranscribeWhisperCPPAllowsUnknownLegacyModelID(t *testing.T) {
	withWorkingDir(t, t.TempDir())
	ffmpeg := fakeBinary(t, "ffmpeg", fakeFFmpegSuccessBinary())
	ffprobe := fakeBinary(t, "ffprobe", fakeProbeBinary(validProbeJSON()))
	whisper := fakeBinary(t, "fake-whisper", fakeWhisperCPPBinary())
	prependPath(t, ffmpeg)
	prependPath(t, ffprobe)

	workDir := t.TempDir()
	modelStore := mkdir(t, filepath.Join(workDir, "store with spaces"))
	modelDir := mkdir(t, filepath.Join(modelStore, "legacy-whispercpp-small"))
	writeFile(t, filepath.Join(modelDir, "ggml-small.bin"), "model")
	manifestPath := filepath.Join(workDir, "manifest.json")
	writeTranscribeManifest(t, manifestPath)
	t.Setenv("FAST_SUB_GO_MODEL_MANIFEST", manifestPath)
	t.Setenv("FAST_SUB_MODEL_STORE_DIR", modelStore)
	t.Setenv("FAST_SUB_WHISPER_CPP_COMMAND", whisper)
	input := writeFile(t, filepath.Join(workDir, "input.mp4"), "fake")

	var stdout bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args:   []string{"transcribe", input, "--provider", "local-whisper-cpp", "--model", "legacy-whispercpp-small", "--json"},
		Stdout: &stdout,
	})
	if code != 0 {
		t.Fatalf("exit code = %d, stdout=%s", code, stdout.String())
	}
	payload := mustJSON(t, stdout.String())
	if payload["ok"] != true {
		t.Fatalf("payload = %#v", payload)
	}
}

func TestTranscribeWhisperCPPRejectsKnownIncompatibleModelID(t *testing.T) {
	withWorkingDir(t, t.TempDir())
	whisper := fakeBinary(t, "fake-whisper", fakeWhisperCPPBinary())

	workDir := t.TempDir()
	modelStore := mkdir(t, filepath.Join(workDir, "store with spaces"))
	legacyModelDir := mkdir(t, filepath.Join(modelStore, "whisper-small"))
	writeFile(t, filepath.Join(legacyModelDir, "ggml-small.bin"), "legacy model")
	manifestPath := filepath.Join(workDir, "manifest.json")
	writeTranscribeManifest(t, manifestPath)
	t.Setenv("FAST_SUB_GO_MODEL_MANIFEST", manifestPath)
	t.Setenv("FAST_SUB_MODEL_STORE_DIR", modelStore)
	markerPath := filepath.Join(workDir, "whisper-ran.txt")
	t.Setenv("FAST_SUB_FAKE_WHISPER_RUN_MARKER", markerPath)
	input := writeFile(t, filepath.Join(workDir, "input.mp4"), "fake")

	var stdout bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args:   []string{"transcribe", input, "--provider", "local-whisper-cpp", "--model", "whisper-small", "--whisper-cpp-command", whisper, "--json"},
		Stdout: &stdout,
	})
	if code == 0 {
		t.Fatalf("expected failure, stdout=%s", stdout.String())
	}
	payload := mustJSON(t, stdout.String())
	errorPayload := payload["error"].(map[string]any)
	if errorPayload["code"] != "missing_model" {
		t.Fatalf("error code = %#v", errorPayload["code"])
	}
	if !strings.Contains(errorPayload["message"].(string), "model is not compatible with local-whisper-cpp") {
		t.Fatalf("message = %#v", errorPayload["message"])
	}
	if _, err := os.Stat(markerPath); !os.IsNotExist(err) {
		t.Fatalf("whisper.cpp fake binary should not run, stat err=%v", err)
	}
}

func TestTranscribeJSONFailureCases(t *testing.T) {
	cases := []struct {
		name     string
		args     func(workDir, input, modelDir, workerPath string) []string
		pathMode string
		worker   string
		wantCode string
		wantExit int
	}{
		{
			name: "missing input",
			args: func(workDir, input, modelDir, workerPath string) []string {
				return []string{"transcribe", filepath.Join(workDir, "missing.mp4"), "--model-path", modelDir, "--worker-command", workerPath, "--json"}
			},
			pathMode: "all",
			wantCode: "invalid_input",
			wantExit: 2,
		},
		{
			name: "missing ffprobe",
			args: func(workDir, input, modelDir, workerPath string) []string {
				return []string{"transcribe", input, "--model-path", modelDir, "--worker-command", workerPath, "--json"}
			},
			pathMode: "ffmpeg-only",
			wantCode: "missing_dependency",
			wantExit: 3,
		},
		{
			name: "missing ffmpeg",
			args: func(workDir, input, modelDir, workerPath string) []string {
				return []string{"transcribe", input, "--model-path", modelDir, "--worker-command", workerPath, "--json"}
			},
			pathMode: "ffprobe-only",
			wantCode: "missing_dependency",
			wantExit: 3,
		},
		{
			name: "missing worker",
			args: func(workDir, input, modelDir, workerPath string) []string {
				return []string{"transcribe", input, "--model-path", modelDir, "--json"}
			},
			pathMode: "ffmpeg-ffprobe-only",
			wantCode: "missing_worker",
			wantExit: 3,
		},
		{
			name: "missing model path",
			args: func(workDir, input, modelDir, workerPath string) []string {
				return []string{"transcribe", input, "--worker-command", workerPath, "--json"}
			},
			pathMode: "all",
			wantCode: "missing_model",
			wantExit: 4,
		},
		{
			name: "missing model id",
			args: func(workDir, input, modelDir, workerPath string) []string {
				return []string{"transcribe", input, "--model", "small", "--worker-command", workerPath, "--json"}
			},
			pathMode: "all",
			wantCode: "missing_model",
			wantExit: 4,
		},
		{
			name: "output exists",
			args: func(workDir, input, modelDir, workerPath string) []string {
				output := writeFile(t, filepath.Join(workDir, "exists.srt"), "old")
				return []string{"transcribe", input, "--model-path", modelDir, "--output", output, "--worker-command", workerPath, "--json"}
			},
			pathMode: "all",
			wantCode: "output_exists",
			wantExit: 2,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			withWorkingDir(t, t.TempDir())
			ffmpeg := fakeBinary(t, "ffmpeg", fakeFFmpegSuccessBinary())
			ffprobe := fakeBinary(t, "ffprobe", fakeProbeBinary(validProbeJSON()))
			worker := fakeBinary(t, "fake-worker", fakeSTTWorkerBinary())
			setPathForMode(t, tc.pathMode, ffmpeg, ffprobe)
			workDir := t.TempDir()
			input := writeFile(t, filepath.Join(workDir, "input.mp4"), "fake")
			modelDir := mkdir(t, filepath.Join(workDir, "model"))

			var stdout bytes.Buffer
			code := cli.Run(context.Background(), cli.Config{Args: tc.args(workDir, input, modelDir, worker), Stdout: &stdout})
			if code != tc.wantExit {
				t.Fatalf("exit code = %d, want %d, stdout=%s", code, tc.wantExit, stdout.String())
			}
			payload := mustJSON(t, stdout.String())
			errorPayload := payload["error"].(map[string]any)
			if errorPayload["code"] != tc.wantCode {
				t.Fatalf("error code = %#v, want %s", errorPayload["code"], tc.wantCode)
			}
		})
	}
}

func TestTranscribeWorkerProtocolFailuresAreJSON(t *testing.T) {
	cases := []struct {
		mode     string
		wantCode string
		wantExit int
	}{
		{"nonzero", "worker_failed", 1},
		{"invalid_json", "worker_protocol_error", 8},
		{"wrong_schema", "worker_protocol_error", 8},
		{"error_response", "missing_model", 4},
		{"ok_false", "worker_failed", 1},
		{"empty_segments", "worker_failed", 1},
		{"invalid_timestamps", "worker_protocol_error", 8},
		{"stdout_pollution", "", 0},
		{"word_timestamps", "", 0},
	}
	for _, tc := range cases {
		t.Run(tc.mode, func(t *testing.T) {
			withWorkingDir(t, t.TempDir())
			ffmpeg := fakeBinary(t, "ffmpeg", fakeFFmpegSuccessBinary())
			ffprobe := fakeBinary(t, "ffprobe", fakeProbeBinary(validProbeJSON()))
			worker := fakeBinary(t, "fake-worker", fakeSTTWorkerBinary())
			prependPath(t, ffmpeg)
			prependPath(t, ffprobe)
			t.Setenv("FAST_SUB_FAKE_WORKER_MODE", tc.mode)

			workDir := t.TempDir()
			input := writeFile(t, filepath.Join(workDir, "input.mp4"), "fake")
			modelDir := mkdir(t, filepath.Join(workDir, "model"))
			output := filepath.Join(workDir, tc.mode+".srt")
			var stdout bytes.Buffer
			code := cli.Run(context.Background(), cli.Config{
				Args:   []string{"transcribe", input, "--model-path", modelDir, "--output", output, "--worker-command", worker, "--json"},
				Stdout: &stdout,
			})
			if code != tc.wantExit {
				t.Fatalf("exit code = %d, want %d, stdout=%s", code, tc.wantExit, stdout.String())
			}
			payload := mustJSON(t, stdout.String())
			if tc.wantCode == "" {
				if payload["ok"] != true {
					t.Fatalf("expected success payload, got %#v", payload)
				}
				return
			}
			errorPayload := payload["error"].(map[string]any)
			if errorPayload["code"] != tc.wantCode {
				t.Fatalf("error code = %#v, want %s", errorPayload["code"], tc.wantCode)
			}
		})
	}
}

func mustJSONFile(t *testing.T, path string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("file is not JSON: %v\n%s", err, raw)
	}
	return payload
}

func withWorkingDir(t *testing.T, dir string) {
	t.Helper()
	old, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chdir(old); err != nil {
			t.Fatalf("restore working directory: %v", err)
		}
	})
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

func setPathForMode(t *testing.T, mode, ffmpegPath, ffprobePath string) {
	t.Helper()
	switch mode {
	case "all":
		prependPath(t, ffmpegPath)
		prependPath(t, ffprobePath)
	case "ffmpeg-only":
		t.Setenv("PATH", filepath.Dir(ffmpegPath))
	case "ffprobe-only":
		t.Setenv("PATH", filepath.Dir(ffprobePath))
	case "ffmpeg-ffprobe-only":
		t.Setenv("PATH", filepath.Dir(ffmpegPath)+string(os.PathListSeparator)+filepath.Dir(ffprobePath))
	default:
		t.Fatalf("unknown path mode %s", mode)
	}
}

func fakeSTTWorkerBinary() string {
	return `package main
import (
  "encoding/json"
  "fmt"
  "os"
)
func main() {
  var requestPath, responsePath string
  for i := 1; i < len(os.Args); i++ {
    if os.Args[i] == "--request" && i+1 < len(os.Args) { requestPath = os.Args[i+1]; i++ }
    if os.Args[i] == "--response" && i+1 < len(os.Args) { responsePath = os.Args[i+1]; i++ }
  }
  if copyPath := os.Getenv("FAST_SUB_FAKE_WORKER_REQUEST_COPY"); copyPath != "" {
    raw, _ := os.ReadFile(requestPath)
    _ = os.WriteFile(copyPath, raw, 0600)
  }
  mode := os.Getenv("FAST_SUB_FAKE_WORKER_MODE")
  switch mode {
  case "nonzero":
    fmt.Fprintln(os.Stderr, "worker failed noisily")
    os.Exit(9)
  case "invalid_json":
    _ = os.WriteFile(responsePath, []byte("{not json"), 0600)
  case "wrong_schema":
    writeJSON(responsePath, map[string]any{"schema_version": 2, "segments": []any{}})
	case "error_response":
		writeJSON(responsePath, map[string]any{"schema_version": 1, "error": map[string]any{"code": "MODEL_NOT_FOUND", "message": "Model path does not exist.", "retryable": false}})
		os.Exit(1)
  case "ok_false":
    writeJSON(responsePath, map[string]any{"schema_version": 1, "ok": false, "segments": defaultSegments()})
	case "empty_segments":
    writeJSON(responsePath, success([]map[string]any{}))
  case "invalid_timestamps":
    writeJSON(responsePath, success([]map[string]any{{"start_sec": 2.0, "end_sec": 1.0, "text": "bad"}}))
	case "stdout_pollution":
		fmt.Println("debug text on stdout")
		writeJSON(responsePath, success(defaultSegments()))
	case "word_timestamps":
		writeJSON(responsePath, success([]map[string]any{{
			"start_sec": 0.0,
			"end_sec": 12.0,
			"text": "one two three four five six",
			"words": []map[string]any{
				{"start_sec": 0.1, "end_sec": 0.4, "text": "one"},
				{"start_sec": 0.5, "end_sec": 0.8, "text": "two"},
				{"start_sec": 4.0, "end_sec": 4.4, "text": "three"},
				{"start_sec": 4.5, "end_sec": 4.9, "text": "four"},
				{"start_sec": 8.0, "end_sec": 8.4, "text": "five"},
				{"start_sec": 8.5, "end_sec": 8.9, "text": "six"},
			},
		}}))
	default:
    writeJSON(responsePath, success(defaultSegments()))
  }
}

func defaultSegments() []map[string]any {
  return []map[string]any{
    {"start_sec": 0.0, "end_sec": 1.25, "text": " 你好 "},
    {"start_sec": 1.25, "end_sec": 2.5, "text": "line\r\nbreak"},
  }
}
func success(segments []map[string]any) map[string]any {
  return map[string]any{"schema_version": 1, "provider": "local-faster-whisper", "language": "zh", "elapsed_sec": 0.5, "actual_device": "cpu", "actual_compute_type": "int8", "segments": segments, "warnings": []string{}}
}
func writeJSON(path string, payload any) {
  raw, _ := json.Marshal(payload)
  _ = os.WriteFile(path, raw, 0600)
}
`
}

func fakeWhisperCPPBinary() string {
	return `package main
import (
	"encoding/json"
	"fmt"
	"os"
  "strings"
)
func main() {
  if marker := os.Getenv("FAST_SUB_FAKE_WHISPER_RUN_MARKER"); marker != "" {
    _ = os.WriteFile(marker, []byte(strings.Join(os.Args, "\n")), 0600)
  }
  for _, arg := range os.Args[1:] {
    if arg == "--help" {
      fmt.Println("--output-json -oj --output-srt -osrt --output-file -of --no-prints -np --language auto")
      return
    }
    if arg == "--version" {
      fmt.Println("whisper.cpp fake")
      return
    }
  }
  outputBase := ""
  for i := 1; i < len(os.Args); i++ {
    if os.Args[i] == "-of" && i+1 < len(os.Args) {
      outputBase = os.Args[i+1]
      i++
    }
  }
  if outputBase == "" {
    os.Exit(2)
  }
  fmt.Println("stdout that must not reach fast-sub-go stdout")
  fmt.Fprintln(os.Stderr, "stderr that must not reach fast-sub-go stdout")
  payload := map[string]any{
    "result": map[string]any{"language": "zh"},
    "transcription": []map[string]any{
      {"timestamps": map[string]any{"from": "00:00:00.000", "to": "00:00:01.250"}, "text": "你好世界"},
      {"timestamps": map[string]any{"from": "00:00:01.250", "to": "00:00:02.500"}, "text": "第二行"},
    },
  }
  raw, _ := json.Marshal(payload)
  _ = os.WriteFile(outputBase+".json", raw, 0600)
}
`
}

func writeTranscribeManifest(t *testing.T, path string) {
	t.Helper()
	manifest := `{
  "schema_version": 1,
  "models": [
    {
      "id": "whisper-small",
      "name": "Whisper Small Fixture",
      "type": "asr",
      "backend": "faster-whisper",
      "artifact_kind": "model",
      "compatible_providers": ["local-faster-whisper"],
      "size_bytes": 2,
      "license": "MIT",
      "urls": ["https://example.test/"],
      "required_files": [
        {"path": "config.json", "size_bytes": 6, "sha256": "b79606fb3afea5bd1609ed40b622142f1c98125abcfe89a76a661b0e8e343910"},
        {"path": "model.bin", "size_bytes": 5, "sha256": "9372c470eeadd5ecd9c3c74c2b3cb633f8e2f2fad799250a0f70d652b6b825e4"}
      ],
      "privacy_class": "local",
      "install_layout": "directory",
      "source_type": "http",
      "platforms": ["all"]
    },
    {
      "id": "whispercpp-small",
      "name": "Whisper CPP Small Fixture",
      "type": "asr",
      "backend": "whisper.cpp",
      "artifact_kind": "model",
      "compatible_providers": ["local-whisper-cpp"],
      "size_bytes": 5,
      "license": "MIT",
      "urls": ["https://example.test/whispercpp-small.bin"],
      "sha256": "9372c470eeadd5ecd9c3c74c2b3cb633f8e2f2fad799250a0f70d652b6b825e4",
      "privacy_class": "local",
      "install_layout": "file",
      "source_type": "http",
      "platforms": ["all"]
    }
  ]
}`
	if err := os.WriteFile(path, []byte(manifest), 0o600); err != nil {
		t.Fatal(err)
	}
}
