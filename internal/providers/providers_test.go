package providers

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestListShape(t *testing.T) {
	cfg := fakeRuntime(nil, false, nil)

	items := List(context.Background(), cfg)

	if len(items) != 7 {
		t.Fatalf("providers len = %d", len(items))
	}
	want := []string{"local-faster-whisper", "local-whisper-cpp", "api-openai-transcription", "local-nllb-ct2", "web-bing", "web-google", "api-openai-chat"}
	for index, id := range want {
		if items[index].ID != id {
			t.Fatalf("provider[%d] id = %q, want %q", index, items[index].ID, id)
		}
		if items[index].CheckMode != CheckModeStatic {
			t.Fatalf("provider[%d] check mode = %q", index, items[index].CheckMode)
		}
	}
}

func TestTranslationProvidersAreListedWithMetadata(t *testing.T) {
	items := List(context.Background(), fakeRuntime(webHelperEnv(), true, nil))
	byID := map[string]ListedProvider{}
	for _, item := range items {
		byID[item.ID] = item
	}
	for _, id := range []string{"local-nllb-ct2", "web-bing", "web-google", "api-openai-chat"} {
		item, ok := byID[id]
		if !ok {
			t.Fatalf("missing provider %s", id)
		}
		if item.Type != typeTranslation {
			t.Fatalf("%s type = %q", id, item.Type)
		}
		if !hasString(item.Capabilities, "translate_srt") {
			t.Fatalf("%s capabilities = %#v", id, item.Capabilities)
		}
	}
	if byID["web-bing"].Status != StatusAvailable {
		t.Fatalf("web-bing status = %q", byID["web-bing"].Status)
	}
	if !strings.Contains(byID["web-bing"].PrivacyNote, "best-effort") {
		t.Fatalf("web-bing privacy note = %q", byID["web-bing"].PrivacyNote)
	}
	if byID["api-openai-chat"].Status != StatusAvailable {
		t.Fatalf("api-openai-chat status = %q", byID["api-openai-chat"].Status)
	}
	if byID["api-openai-chat"].RequiresAPIKey {
		t.Fatalf("api-openai-chat should let live connectivity decide whether auth is required")
	}
}

func TestWebTranslationProviderMissingHelper(t *testing.T) {
	result, ok := Test(context.Background(), fakeRuntime(nil, false, nil), "web-bing")
	if !ok {
		t.Fatal("provider missing")
	}
	if result.Status != StatusMissingDependency || result.Available {
		t.Fatalf("result = %#v", result)
	}
	if strings.Contains(result.ActionHint, "FAST_SUB_WEB_TRANSLATE_HELPER") {
		t.Fatalf("action hint should not expose helper env names: %q", result.ActionHint)
	}
}

func TestWebTranslationProviderRequiresHelperArgs(t *testing.T) {
	for name, args := range map[string]string{
		"missing": "",
		"empty":   "[]",
	} {
		t.Run(name, func(t *testing.T) {
			env := map[string]string{"FAST_SUB_WEB_TRANSLATE_HELPER_COMMAND": "node"}
			if args != "" {
				env["FAST_SUB_WEB_TRANSLATE_HELPER_ARGS"] = args
			}
			result, ok := Test(context.Background(), fakeRuntime(env, true, nil), "web-google")
			if !ok {
				t.Fatal("provider missing")
			}
			if result.Status != StatusMissingDependency || result.Available {
				t.Fatalf("result = %#v", result)
			}
		})
	}
}

func TestWebTranslationProviderHelperConfigured(t *testing.T) {
	result, ok := Test(context.Background(), fakeRuntime(webHelperEnv(), true, nil), "web-google")
	if !ok {
		t.Fatal("provider missing")
	}
	if result.Status != StatusAvailable || !result.Available {
		t.Fatalf("result = %#v", result)
	}
}

func TestLocalNLLBMissingDependencies(t *testing.T) {
	cfg := fakeRuntime(nil, true, nil)
	cfg.RunCommand = func(context.Context, string, []string) error {
		return errors.New("missing module")
	}
	cfg.ModelResolver = func(providerID string) ModelResolution {
		if providerID != "local-nllb-ct2" {
			t.Fatalf("provider id = %q", providerID)
		}
		return ModelResolution{OK: true, Path: filepath.Join("models", "nllb"), Message: "model is installed"}
	}

	result, ok := Test(context.Background(), cfg, "local-nllb-ct2")
	if !ok {
		t.Fatal("provider missing")
	}
	if result.Status != StatusMissingDependency || result.Available {
		t.Fatalf("result = %#v", result)
	}
}

func TestLocalTranslateDependencyCommandUsesUVExtra(t *testing.T) {
	cfg := fakeRuntime(map[string]string{"FAST_SUB_PYTHON_CLI": "uv run fast-sub"}, true, nil)

	command, args, ok := localTranslateDependencyCommand(cfg)
	if !ok {
		t.Fatal("command did not resolve")
	}
	if command != "uv" || strings.Join(args, " ") != "run --extra local-translate python -c import ctranslate2, sentencepiece" {
		t.Fatalf("command=%q args=%q", command, strings.Join(args, " "))
	}
}

func TestLocalTranslateDependencyCommandPrefersPackagedPython(t *testing.T) {
	cfg := fakeRuntime(map[string]string{
		"FAST_SUB_PYTHON":     `"` + filepath.Join("C:", "Fast Sub", "python.exe") + `"`,
		"FAST_SUB_PYTHON_CLI": "uv run fast-sub",
	}, true, nil)

	command, args, ok := localTranslateDependencyCommand(cfg)
	if !ok {
		t.Fatal("command did not resolve")
	}
	if command != filepath.Join("C:", "Fast Sub", "python.exe") || strings.Join(args, " ") != "-c import ctranslate2, sentencepiece" {
		t.Fatalf("command=%q args=%q", command, strings.Join(args, " "))
	}
}

func TestLocalTranslateDependencyCommandDoesNotUseImplicitUV(t *testing.T) {
	cfg := fakeRuntime(nil, false, nil)
	cfg.LookPath = func(name string) (string, error) {
		if name == "uv" {
			return filepath.Join("fake", name), nil
		}
		return "", errors.New("missing")
	}

	if command, args, ok := localTranslateDependencyCommand(cfg); ok {
		t.Fatalf("implicit uv should not resolve command=%q args=%q", command, strings.Join(args, " "))
	}
}

func TestLocalTranslateDependencyCommandPackagedRuntimeDoesNotUseSystemPython(t *testing.T) {
	cfg := fakeRuntime(map[string]string{"FAST_SUB_PACKAGED_RUNTIME_ONLY": "1"}, true, nil)
	if command, args, ok := localTranslateDependencyCommand(cfg); ok {
		t.Fatalf("packaged runtime should not use system python command=%q args=%q", command, strings.Join(args, " "))
	}
}

func TestLocalTranslatePackagedRuntimeUsesRepairHint(t *testing.T) {
	check := checkLocalTranslateDependencies(context.Background(), fakeRuntime(map[string]string{"FAST_SUB_PACKAGED_RUNTIME_ONLY": "1"}, true, nil))
	if check.OK || check.Status != StatusMissingDependency {
		t.Fatalf("packaged runtime should be missing without app-private Python: %#v", check)
	}
	assertPackagedRepairHint(t, check.ActionHint)
}

func TestFasterWhisperMissingDependencies(t *testing.T) {
	cfg := fakeRuntime(nil, true, nil)
	cfg.RunCommand = func(context.Context, string, []string) error {
		return errors.New("missing module")
	}
	cfg.ModelResolver = func(providerID string) ModelResolution {
		if providerID != "local-faster-whisper" {
			t.Fatalf("provider id = %q", providerID)
		}
		return ModelResolution{OK: true, Path: filepath.Join("models", "whisper-small"), Message: "model is installed"}
	}

	result, ok := Test(context.Background(), cfg, "local-faster-whisper")
	if !ok {
		t.Fatal("provider missing")
	}
	if result.Status != StatusMissingDependency || result.Available {
		t.Fatalf("result = %#v", result)
	}
	if result.Checks[0].Name != "python_dependencies" {
		t.Fatalf("first check = %#v", result.Checks[0])
	}
}

func TestLocalASRDependencyCommandUsesUVExtra(t *testing.T) {
	cfg := fakeRuntime(map[string]string{"FAST_SUB_STT_WORKER_COMMAND": "uv run fast-sub-worker-faster-whisper"}, true, nil)

	command, args, ok := localASRDependencyCommand(cfg)
	if !ok {
		t.Fatal("command did not resolve")
	}
	if command != "uv" || strings.Join(args, " ") != "run --extra local-asr python -c import faster_whisper" {
		t.Fatalf("command=%q args=%q", command, strings.Join(args, " "))
	}
}

func TestLocalASRDependencyCommandPrefersPackagedPython(t *testing.T) {
	cfg := fakeRuntime(map[string]string{
		"FAST_SUB_PYTHON":             `"` + filepath.Join("C:", "Fast Sub", "python.exe") + `"`,
		"FAST_SUB_STT_WORKER_COMMAND": "uv run fast-sub-worker-faster-whisper",
	}, true, nil)

	command, args, ok := localASRDependencyCommand(cfg)
	if !ok {
		t.Fatal("command did not resolve")
	}
	if command != filepath.Join("C:", "Fast Sub", "python.exe") || strings.Join(args, " ") != "-c import faster_whisper" {
		t.Fatalf("command=%q args=%q", command, strings.Join(args, " "))
	}
}

func TestLocalASRDependencyCommandDoesNotUseImplicitUV(t *testing.T) {
	cfg := fakeRuntime(nil, false, nil)
	cfg.LookPath = func(name string) (string, error) {
		if name == "uv" {
			return filepath.Join("fake", name), nil
		}
		return "", errors.New("missing")
	}

	if command, args, ok := localASRDependencyCommand(cfg); ok {
		t.Fatalf("implicit uv should not resolve command=%q args=%q", command, strings.Join(args, " "))
	}
}

func TestLocalASRDependencyCommandPackagedRuntimeDoesNotUseSystemPython(t *testing.T) {
	cfg := fakeRuntime(map[string]string{"FAST_SUB_PACKAGED_RUNTIME_ONLY": "1"}, true, nil)
	if command, args, ok := localASRDependencyCommand(cfg); ok {
		t.Fatalf("packaged runtime should not use system python command=%q args=%q", command, strings.Join(args, " "))
	}
}

func TestLocalASRPackagedRuntimeUsesRepairHint(t *testing.T) {
	check := checkFasterWhisperDependencies(context.Background(), fakeRuntime(map[string]string{"FAST_SUB_PACKAGED_RUNTIME_ONLY": "1"}, true, nil))
	if check.OK || check.Status != StatusMissingDependency {
		t.Fatalf("packaged runtime should be missing without app-private Python: %#v", check)
	}
	assertPackagedRepairHint(t, check.ActionHint)
}

func TestSTTWorkerCommandDoesNotUseImplicitUV(t *testing.T) {
	cfg := fakeRuntime(nil, false, nil)
	cfg.LookPath = func(name string) (string, error) {
		if name == "uv" {
			return filepath.Join("fake", name), nil
		}
		return "", errors.New("missing")
	}

	check := checkSTTWorkerCommand(cfg)
	if check.OK || check.Status != StatusMissingDependency {
		t.Fatalf("implicit uv should not make worker available: %#v", check)
	}
}

func TestSTTWorkerCommandPackagedRuntimeDoesNotUsePATHFallback(t *testing.T) {
	cfg := fakeRuntime(map[string]string{"FAST_SUB_PACKAGED_RUNTIME_ONLY": "1"}, true, nil)
	check := checkSTTWorkerCommand(cfg)
	if check.OK || check.Status != StatusMissingDependency {
		t.Fatalf("packaged runtime should not use PATH worker: %#v", check)
	}
	assertPackagedRepairHint(t, check.ActionHint)
}

func TestWhisperCPPCommandPackagedRuntimeUsesRepairHint(t *testing.T) {
	check := checkWhisperCPPCommand(fakeRuntime(map[string]string{"FAST_SUB_PACKAGED_RUNTIME_ONLY": "1"}, true, nil))
	if check.OK || check.Status != StatusMissingDependency {
		t.Fatalf("packaged runtime should be missing without app-private whisper.cpp: %#v", check)
	}
	assertPackagedRepairHint(t, check.ActionHint)
}

func TestWhisperCPPCommandAllowsPackagedPathWithSpaces(t *testing.T) {
	binDir := filepath.Join(t.TempDir(), "Fast Sub", "resources", "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	binary := filepath.Join(binDir, "whisper-cli")
	if err := os.WriteFile(binary, []byte("fake"), 0o755); err != nil {
		t.Fatal(err)
	}
	cfg := fakeRuntime(map[string]string{
		"FAST_SUB_PACKAGED_RUNTIME_ONLY": "1",
		"FAST_SUB_WHISPER_CPP_COMMAND":   binary,
	}, false, nil)
	cfg.RunCommand = func(_ context.Context, command string, args []string) error {
		if command != binary || len(args) != 1 || args[0] != "--help" {
			t.Fatalf("unexpected command check: %q %#v", command, args)
		}
		return nil
	}

	check := checkWhisperCPPCommand(cfg)

	if !check.OK || check.Status != StatusAvailable {
		t.Fatalf("packaged path with spaces should resolve: %#v", check)
	}
}

func TestWhisperCPPCommandRejectsNonRunnablePackagedPath(t *testing.T) {
	binDir := filepath.Join(t.TempDir(), "Fast Sub", "resources", "bin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	modelFile := filepath.Join(binDir, "ggml-base.bin")
	if err := os.WriteFile(modelFile, []byte("not executable"), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg := fakeRuntime(map[string]string{
		"FAST_SUB_PACKAGED_RUNTIME_ONLY": "1",
		"FAST_SUB_WHISPER_CPP_COMMAND":   modelFile,
	}, false, nil)
	cfg.RunCommand = func(context.Context, string, []string) error {
		return errors.New("not runnable")
	}

	check := checkWhisperCPPCommand(cfg)

	if check.OK || check.Status != StatusMissingDependency {
		t.Fatalf("non-runnable packaged path should be missing dependency: %#v", check)
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
	if result.Checks[1].OK {
		t.Fatalf("explicit missing command should not pass: %#v", result.Checks[1])
	}
}

func TestOpenAIStaticCheckDoesNotRequireKeyWithoutNetwork(t *testing.T) {
	noKey, ok := Test(context.Background(), fakeRuntime(nil, false, nil), "api-openai-transcription")
	if !ok {
		t.Fatal("provider missing")
	}
	if noKey.Status != StatusAvailable || !noKey.Available {
		t.Fatalf("status = %#v", noKey)
	}
	if noKey.Details["api_key_configured"] != false {
		t.Fatalf("api_key_configured = %#v", noKey.Details["api_key_configured"])
	}

	configured, _ := Test(context.Background(), fakeRuntime(map[string]string{"OPENAI_API_KEY": "sk-test-secret"}, false, nil), "api-openai-transcription")
	if configured.Status != StatusAvailable || !configured.Available {
		t.Fatalf("configured check = %#v", configured)
	}
	if configured.Details["live_network"] != false {
		t.Fatalf("provider test should be static, details = %#v", configured.Details)
	}
	if configured.Details["api_key_configured"] != true {
		t.Fatalf("api_key_configured = %#v", configured.Details["api_key_configured"])
	}
}

func TestOpenAIKeyConfiguredThroughConfigFile(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "fast-sub-go.toml")
	if err := os.WriteFile(configPath, []byte(`
[providers.api-openai-transcription]
api_key_env = "FAST_SUB_TEST_OPENAI_KEY"
model = "gpt-4o-transcribe"
`), 0o600); err != nil {
		t.Fatal(err)
	}

	configured, ok := Test(context.Background(), fakeRuntime(map[string]string{
		"FAST_SUB_GO_CONFIG":       configPath,
		"FAST_SUB_TEST_OPENAI_KEY": "sk-test-secret",
	}, false, nil), "api-openai-transcription")
	if !ok {
		t.Fatal("provider missing")
	}
	if configured.Status != StatusAvailable || !configured.Available {
		t.Fatalf("configured check = %#v", configured)
	}
	if configured.Details["api_key_env"] != "FAST_SUB_TEST_OPENAI_KEY" {
		t.Fatalf("api_key_env = %#v", configured.Details["api_key_env"])
	}
	if configured.Details["live_network"] != false {
		t.Fatalf("provider test should be static, details = %#v", configured.Details)
	}
}

func TestOpenAICompatibleLocalEndpointAllowsMissingKey(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "fast-sub-go.toml")
	if err := os.WriteFile(configPath, []byte(`
[providers.api-openai-chat]
base_url = "http://127.0.0.1:1234/v1"
model = "qwen/qwen3-4b-2507"
`), 0o600); err != nil {
		t.Fatal(err)
	}

	result, ok := Test(context.Background(), fakeRuntime(map[string]string{
		"FAST_SUB_GO_CONFIG": configPath,
	}, false, nil), "api-openai-chat")
	if !ok {
		t.Fatal("provider missing")
	}
	if result.Status != StatusAvailable || !result.Available {
		t.Fatalf("local endpoint check = %#v", result)
	}
	if result.Details["auth_decided_by_live_check"] != true {
		t.Fatalf("auth_decided_by_live_check = %#v", result.Details["auth_decided_by_live_check"])
	}
	if result.Details["api_key_env"] != "OPENAI_API_KEY" {
		t.Fatalf("api_key_env = %#v", result.Details["api_key_env"])
	}
}

func TestOpenAITranscriptionLegacyAliasUsesProviderSpecificEnv(t *testing.T) {
	configPath := filepath.Join(t.TempDir(), "fast-sub-go.toml")
	if err := os.WriteFile(configPath, []byte(`
[providers.api-openai-transcription]
api_key_env = "openai-default"
model = "gpt-4o-transcribe"
`), 0o600); err != nil {
		t.Fatal(err)
	}

	result, ok := Test(context.Background(), fakeRuntime(map[string]string{
		"FAST_SUB_GO_CONFIG":                    configPath,
		"FAST_SUB_OPENAI_TRANSCRIPTION_API_KEY": "sk-test-secret",
	}, false, nil), "api-openai-transcription")
	if !ok {
		t.Fatal("provider missing")
	}
	if result.Status != StatusAvailable || !result.Available {
		t.Fatalf("legacy alias check = %#v", result)
	}
	if result.Details["api_key_env"] != "FAST_SUB_OPENAI_TRANSCRIPTION_API_KEY" {
		t.Fatalf("api_key_env = %#v", result.Details["api_key_env"])
	}
}

func TestOpenAICompatibleLiveCheckUsesModelsEndpointWithoutKeyForLocalServer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "" {
			t.Fatalf("Authorization header should be omitted for no-key local check")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	defer server.Close()
	configPath := filepath.Join(t.TempDir(), "fast-sub-go.toml")
	if err := os.WriteFile(configPath, []byte(`
[providers.api-openai-chat]
base_url = "`+server.URL+`/v1"
model = "qwen/qwen3-4b-2507"
`), 0o600); err != nil {
		t.Fatal(err)
	}

	result, ok := TestMode(context.Background(), fakeRuntime(map[string]string{
		"FAST_SUB_GO_CONFIG": configPath,
	}, false, nil), "api-openai-chat", CheckModeLive)
	if !ok {
		t.Fatal("provider missing")
	}
	if result.CheckMode != CheckModeLive || result.Status != StatusAvailable || !result.Available {
		t.Fatalf("live check = %#v", result)
	}
	if result.Details["live_network"] != true {
		t.Fatalf("live_network = %#v", result.Details["live_network"])
	}
}

func TestOpenAITranscriptionLiveCheckUsesModelsEndpointWithoutPreflightKey(t *testing.T) {
	called := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if r.URL.Path != "/v1/models" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "" {
			t.Fatalf("Authorization header should be omitted when no key is configured")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	defer server.Close()
	configPath := filepath.Join(t.TempDir(), "fast-sub-go.toml")
	if err := os.WriteFile(configPath, []byte(`
[providers.api-openai-transcription]
base_url = "`+server.URL+`/v1"
model = "FenomAI/faster-whisper-large-v3"
`), 0o600); err != nil {
		t.Fatal(err)
	}

	result, ok := TestMode(context.Background(), fakeRuntime(map[string]string{
		"FAST_SUB_GO_CONFIG": configPath,
	}, false, nil), "api-openai-transcription", CheckModeLive)
	if !ok {
		t.Fatal("provider missing")
	}
	if !called {
		t.Fatal("live check should call /models instead of failing on missing key before request")
	}
	if result.CheckMode != CheckModeLive || result.Status != StatusAvailable || !result.Available {
		t.Fatalf("live check = %#v", result)
	}
	if result.Details["auth_decided_by_live_check"] != true {
		t.Fatalf("auth_decided_by_live_check = %#v", result.Details["auth_decided_by_live_check"])
	}
}

func TestOpenAICompatibleLiveCheckReportsKeyRejected(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer server.Close()
	configPath := filepath.Join(t.TempDir(), "fast-sub-go.toml")
	if err := os.WriteFile(configPath, []byte(`
[providers.api-openai-chat]
base_url = "`+server.URL+`/v1"
model = "qwen/qwen3-4b-2507"
`), 0o600); err != nil {
		t.Fatal(err)
	}

	result, ok := TestMode(context.Background(), fakeRuntime(map[string]string{
		"FAST_SUB_GO_CONFIG": configPath,
	}, false, nil), "api-openai-chat", CheckModeLive)
	if !ok {
		t.Fatal("provider missing")
	}
	if result.Status != StatusMissingAPIKey || result.Available {
		t.Fatalf("live rejected check = %#v", result)
	}
}

func TestOpenAIInvalidConfigIsUnavailableEvenWithEnvKey(t *testing.T) {
	missingConfigPath := filepath.Join(t.TempDir(), "missing.toml")

	result, ok := Test(context.Background(), fakeRuntime(map[string]string{
		"FAST_SUB_GO_CONFIG": missingConfigPath,
		"OPENAI_API_KEY":     "sk-test-secret",
	}, false, nil), "api-openai-transcription")
	if !ok {
		t.Fatal("provider missing")
	}
	if result.Status != StatusInvalidConfig || result.Available {
		t.Fatalf("invalid config check = %#v", result)
	}
	if result.Checks[0].Name != "config" {
		t.Fatalf("check name = %q", result.Checks[0].Name)
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
		RunCommand: func(context.Context, string, []string) error {
			return nil
		},
		ModelResolver: func(providerID string) ModelResolution {
			return ModelResolution{Message: "No compatible Go-managed model is installed."}
		},
	}
}

func webHelperEnv() map[string]string {
	return map[string]string{
		"FAST_SUB_WEB_TRANSLATE_HELPER_COMMAND": "node",
		"FAST_SUB_WEB_TRANSLATE_HELPER_ARGS":    `["helper.mjs"]`,
	}
}

func assertPackagedRepairHint(t *testing.T, hint string) {
	t.Helper()
	lower := strings.ToLower(hint)
	if !strings.Contains(lower, "repair") || !strings.Contains(lower, "reinstall") {
		t.Fatalf("packaged hint = %q, want repair/reinstall guidance", hint)
	}
	for _, forbidden := range []string{"uv", "path", "system python"} {
		if strings.Contains(lower, forbidden) {
			t.Fatalf("packaged hint = %q, should not mention developer/system setup %q", hint, forbidden)
		}
	}
}
