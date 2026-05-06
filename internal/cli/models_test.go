package cli_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"fast-sub/internal/cli"
)

func TestModelsDryRunJSON(t *testing.T) {
	manifestPath, storeDir, _ := writeFixtureManifest(t, []byte("model"))
	t.Setenv("FAST_SUB_GO_MODEL_MANIFEST", manifestPath)
	t.Setenv("FAST_SUB_MODEL_STORE_DIR", storeDir)

	var stdout bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args:   []string{"models", "install", "fixture-model", "--dry-run", "--json"},
		Stdout: &stdout,
	})
	if code != 0 {
		t.Fatalf("exit code = %d, stdout=%s", code, stdout.String())
	}
	payload := mustJSON(t, stdout.String())
	if payload["ok"] != true || payload["action_hint"] != "" {
		t.Fatalf("payload = %#v", payload)
	}
	result := payload["result"].(map[string]any)
	if result["dry_run"] != true {
		t.Fatalf("result = %#v", result)
	}
	plan := result["plan"].(map[string]any)
	if plan["will_write_model_dir"] != false {
		t.Fatalf("plan = %#v", plan)
	}
}

func TestModelsDryRunJSONRedactsManifestURLs(t *testing.T) {
	manifestPath, storeDir, manifest := writeFixtureManifest(t, []byte("model"))
	manifest = fmt.Sprintf(manifest, "https://user:pass@example.test/model?token=secret")
	if err := os.WriteFile(manifestPath, []byte(manifest), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FAST_SUB_GO_MODEL_MANIFEST", manifestPath)
	t.Setenv("FAST_SUB_MODEL_STORE_DIR", storeDir)

	var stdout bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args:   []string{"models", "install", "fixture-model", "--dry-run", "--json"},
		Stdout: &stdout,
	})
	if code != 0 {
		t.Fatalf("exit code = %d, stdout=%s", code, stdout.String())
	}
	output := stdout.String()
	if strings.Contains(output, "user") || strings.Contains(output, "pass") || strings.Contains(output, "token=secret") {
		t.Fatalf("dry-run JSON leaked manifest URL secret:\n%s", output)
	}
	mustJSON(t, output)
}

func TestModelsInstallVerifyListJSONWithFakeHTTP(t *testing.T) {
	payload := []byte("model")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/model.bin" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(payload)
	}))
	defer server.Close()
	manifestPath, storeDir, manifest := writeFixtureManifest(t, payload)
	manifest = fmt.Sprintf(manifest, server.URL)
	if err := os.WriteFile(manifestPath, []byte(manifest), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FAST_SUB_GO_MODEL_MANIFEST", manifestPath)
	t.Setenv("FAST_SUB_MODEL_STORE_DIR", storeDir)

	var installOut bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args:   []string{"models", "install", "fixture-model", "--json"},
		Stdout: &installOut,
	})
	if code != 0 {
		t.Fatalf("install exit code = %d, stdout=%s", code, installOut.String())
	}
	mustJSON(t, installOut.String())

	var verifyOut bytes.Buffer
	code = cli.Run(context.Background(), cli.Config{
		Args:   []string{"models", "verify", "fixture-model", "--json"},
		Stdout: &verifyOut,
	})
	if code != 0 {
		t.Fatalf("verify exit code = %d, stdout=%s", code, verifyOut.String())
	}
	verifyPayload := mustJSON(t, verifyOut.String())
	if verifyPayload["ok"] != true {
		t.Fatalf("verify payload = %#v", verifyPayload)
	}

	var listOut bytes.Buffer
	code = cli.Run(context.Background(), cli.Config{
		Args:   []string{"models", "list", "--json"},
		Stdout: &listOut,
	})
	if code != 0 {
		t.Fatalf("list exit code = %d, stdout=%s", code, listOut.String())
	}
	listPayload := mustJSON(t, listOut.String())
	models := listPayload["result"].(map[string]any)["models"].([]any)
	if len(models) != 1 || models[0].(map[string]any)["installed"] != true {
		t.Fatalf("models = %#v", models)
	}
}

func TestModelsInstallHumanShowsProgressOnStderr(t *testing.T) {
	payload := []byte("model progress payload")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", fmt.Sprint(len(payload)))
		_, _ = w.Write(payload)
	}))
	defer server.Close()
	manifestPath, storeDir, manifest := writeFixtureManifest(t, payload)
	manifest = fmt.Sprintf(manifest, server.URL)
	if err := os.WriteFile(manifestPath, []byte(manifest), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FAST_SUB_GO_MODEL_MANIFEST", manifestPath)
	t.Setenv("FAST_SUB_MODEL_STORE_DIR", storeDir)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args:   []string{"models", "install", "fixture-model"},
		Stdout: &stdout,
		Stderr: &stderr,
	})
	if code != 0 {
		t.Fatalf("exit code = %d, stdout=%s stderr=%s", code, stdout.String(), stderr.String())
	}
	if !strings.Contains(stderr.String(), "Downloading model.bin") || !strings.Contains(stderr.String(), "Verified model.bin") {
		t.Fatalf("stderr did not include progress:\n%s", stderr.String())
	}
	if !strings.Contains(stdout.String(), "Installed fixture-model") {
		t.Fatalf("stdout = %q", stdout.String())
	}
}

func TestModelsInstallJSONDoesNotShowProgress(t *testing.T) {
	payload := []byte("json progress payload")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Length", fmt.Sprint(len(payload)))
		_, _ = w.Write(payload)
	}))
	defer server.Close()
	manifestPath, storeDir, manifest := writeFixtureManifest(t, payload)
	manifest = fmt.Sprintf(manifest, server.URL)
	if err := os.WriteFile(manifestPath, []byte(manifest), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FAST_SUB_GO_MODEL_MANIFEST", manifestPath)
	t.Setenv("FAST_SUB_MODEL_STORE_DIR", storeDir)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args:   []string{"models", "install", "fixture-model", "--json"},
		Stdout: &stdout,
		Stderr: &stderr,
	})
	if code != 0 {
		t.Fatalf("exit code = %d, stdout=%s stderr=%s", code, stdout.String(), stderr.String())
	}
	if stderr.String() != "" {
		t.Fatalf("JSON mode stderr should be empty, got %q", stderr.String())
	}
	mustJSON(t, stdout.String())
}

func TestModelsVerifyFailureJSONParseable(t *testing.T) {
	manifestPath, storeDir, _ := writeFixtureManifest(t, []byte("model"))
	t.Setenv("FAST_SUB_GO_MODEL_MANIFEST", manifestPath)
	t.Setenv("FAST_SUB_MODEL_STORE_DIR", storeDir)

	var stdout bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{
		Args:   []string{"models", "verify", "fixture-model", "--json"},
		Stdout: &stdout,
	})
	if code != 4 {
		t.Fatalf("exit code = %d, stdout=%s", code, stdout.String())
	}
	payload := mustJSON(t, stdout.String())
	if payload["ok"] != false || payload["action_hint"] == "" {
		t.Fatalf("payload = %#v", payload)
	}
	errorPayload := payload["error"].(map[string]any)
	if errorPayload["code"] != "missing_model" {
		t.Fatalf("error = %#v", errorPayload)
	}
}

func writeFixtureManifest(t *testing.T, payload []byte) (string, string, string) {
	t.Helper()
	workDir := t.TempDir()
	storeDir := filepath.Join(workDir, "models")
	sum := sha256.Sum256(payload)
	manifest := fmt.Sprintf(`{
  "schema_version": 1,
  "models": [
    {
      "id": "fixture-model",
      "name": "Fixture Model",
      "type": "asr",
      "backend": "faster-whisper",
      "artifact_kind": "model",
      "compatible_providers": ["local-faster-whisper"],
      "size_bytes": %d,
      "license": "MIT",
      "urls": ["%%s/"],
      "required_files": [
        {
          "path": "model.bin",
          "size_bytes": %d,
          "sha256": %q
        }
      ],
      "privacy_class": "local",
      "install_layout": "directory",
      "source_type": "http",
      "min_disk_free_bytes": 1
    }
  ]
}`, len(payload), len(payload), hex.EncodeToString(sum[:]))
	manifestPath := filepath.Join(workDir, "manifest.json")
	if err := os.WriteFile(manifestPath, []byte(fmt.Sprintf(manifest, "https://example.test")), 0o600); err != nil {
		t.Fatal(err)
	}
	return manifestPath, storeDir, manifest
}

func TestModelsJSONUnmarshalStrictly(t *testing.T) {
	manifestPath, storeDir, _ := writeFixtureManifest(t, []byte("model"))
	t.Setenv("FAST_SUB_GO_MODEL_MANIFEST", manifestPath)
	t.Setenv("FAST_SUB_MODEL_STORE_DIR", storeDir)
	var stdout bytes.Buffer
	code := cli.Run(context.Background(), cli.Config{Args: []string{"models", "verify", "nope", "--json"}, Stdout: &stdout})
	if code != 4 {
		t.Fatalf("exit code = %d", code)
	}
	var decoded struct {
		SchemaVersion string         `json:"schema_version"`
		OK            bool           `json:"ok"`
		Command       string         `json:"command"`
		Error         map[string]any `json:"error"`
		ActionHint    string         `json:"action_hint"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &decoded); err != nil {
		t.Fatalf("stdout is not parseable JSON: %v\n%s", err, stdout.String())
	}
	if decoded.Error["code"] != "missing_model" || decoded.ActionHint == "" {
		t.Fatalf("decoded = %#v", decoded)
	}
}
