package providers

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestListShape(t *testing.T) {
	cfg := fakeRuntime(nil, false, nil)

	items := List(context.Background(), cfg)

	if len(items) != 3 {
		t.Fatalf("providers len = %d", len(items))
	}
	want := []string{"local-faster-whisper", "local-whisper-cpp", "api-openai-transcription"}
	for index, id := range want {
		if items[index].ID != id {
			t.Fatalf("provider[%d] id = %q, want %q", index, items[index].ID, id)
		}
		if items[index].CheckMode != CheckModeStatic {
			t.Fatalf("provider[%d] check mode = %q", index, items[index].CheckMode)
		}
	}
}

func TestFasterWhisperMissingWorkerThenMissingModelThenAvailable(t *testing.T) {
	modelDir := t.TempDir()

	missingWorker, ok := Test(context.Background(), fakeRuntime(nil, false, nil), "local-faster-whisper")
	if !ok {
		t.Fatal("provider missing")
	}
	if missingWorker.Status != StatusMissingDependency {
		t.Fatalf("status = %q", missingWorker.Status)
	}

	missingModel, _ := Test(context.Background(), fakeRuntime(nil, true, nil), "local-faster-whisper")
	if missingModel.Status != StatusMissingModel {
		t.Fatalf("status = %q", missingModel.Status)
	}

	available, _ := Test(context.Background(), fakeRuntime(map[string]string{"FAST_SUB_FASTER_WHISPER_MODEL_PATH": modelDir}, true, nil), "local-faster-whisper")
	if available.Status != StatusAvailable || !available.Available {
		t.Fatalf("available check = %#v", available)
	}
}

func TestFasterWhisperAvailableWithGoManagedModel(t *testing.T) {
	cfg := fakeRuntime(nil, true, nil)
	cfg.ModelResolver = func(providerID string) ModelResolution {
		if providerID != "local-faster-whisper" {
			t.Fatalf("provider id = %q", providerID)
		}
		return ModelResolution{OK: true, Path: filepath.Join("models", "whisper-small"), Message: "model is installed"}
	}

	available, ok := Test(context.Background(), cfg, "local-faster-whisper")
	if !ok {
		t.Fatal("provider missing")
	}
	if available.Status != StatusAvailable || !available.Available {
		t.Fatalf("available check = %#v", available)
	}
}

func TestWhisperCPPMissingBinaryThenMissingModelThenAvailable(t *testing.T) {
	modelDir := t.TempDir()

	missingBinary, ok := Test(context.Background(), fakeRuntime(nil, false, nil), "local-whisper-cpp")
	if !ok {
		t.Fatal("provider missing")
	}
	if missingBinary.Status != StatusMissingDependency {
		t.Fatalf("status = %q", missingBinary.Status)
	}

	missingModel, _ := Test(context.Background(), fakeRuntime(nil, true, nil), "local-whisper-cpp")
	if missingModel.Status != StatusMissingModel {
		t.Fatalf("status = %q", missingModel.Status)
	}

	available, _ := Test(context.Background(), fakeRuntime(map[string]string{"FAST_SUB_WHISPER_CPP_MODEL_PATH": modelDir}, true, nil), "local-whisper-cpp")
	if available.Status != StatusAvailable || !available.Available {
		t.Fatalf("available check = %#v", available)
	}
}

func TestExplicitCommandMustResolve(t *testing.T) {
	result, ok := Test(context.Background(), fakeRuntime(map[string]string{
		"FAST_SUB_STT_WORKER_COMMAND":        filepath.Join("missing", "worker"),
		"FAST_SUB_FASTER_WHISPER_MODEL_PATH": t.TempDir(),
	}, false, nil), "local-faster-whisper")
	if !ok {
		t.Fatal("provider missing")
	}
	if result.Status != StatusMissingDependency {
		t.Fatalf("status = %q", result.Status)
	}
	if result.Checks[0].OK {
		t.Fatalf("explicit missing command should not pass: %#v", result.Checks[0])
	}
}

func TestOpenAIKeyConfiguredWithoutNetwork(t *testing.T) {
	missing, ok := Test(context.Background(), fakeRuntime(nil, false, nil), "api-openai-transcription")
	if !ok {
		t.Fatal("provider missing")
	}
	if missing.Status != StatusMissingAPIKey {
		t.Fatalf("status = %q", missing.Status)
	}

	configured, _ := Test(context.Background(), fakeRuntime(map[string]string{"OPENAI_API_KEY": "sk-test-secret"}, false, nil), "api-openai-transcription")
	if configured.Status != StatusAvailable || !configured.Available {
		t.Fatalf("configured check = %#v", configured)
	}
	if configured.Details["live_network"] != false {
		t.Fatalf("provider test should be static, details = %#v", configured.Details)
	}
}

func TestUnknownProvider(t *testing.T) {
	_, ok := Test(context.Background(), fakeRuntime(nil, false, nil), "missing")
	if ok {
		t.Fatal("unknown provider should not resolve")
	}
}

func fakeRuntime(env map[string]string, lookPathOK bool, statErr error) RuntimeConfig {
	return RuntimeConfig{
		Env: func(key string) string {
			return env[key]
		},
		LookPath: func(name string) (string, error) {
			if lookPathOK {
				return filepath.Join("fake", name), nil
			}
			return "", errors.New("missing")
		},
		Stat: func(path string) (os.FileInfo, error) {
			if statErr != nil {
				return nil, statErr
			}
			return os.Stat(path)
		},
		ModelResolver: func(providerID string) ModelResolution {
			return ModelResolution{Message: "No compatible Go-managed model is installed."}
		},
	}
}
