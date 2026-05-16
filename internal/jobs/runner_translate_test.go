package jobs

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunTranslateSRTUsesPythonCLIBridge(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "input.srt")
	output := filepath.Join(dir, "input.zh.srt")
	if err := os.WriteFile(input, []byte("1\n00:00:00,000 --> 00:00:01,000\nhello\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	env := map[string]string{
		"FAST_SUB_PYTHON_CLI":      fmt.Sprintf("%q -test.run=TestTranslateCLIHelper --", os.Args[0]),
		"GO_WANT_TRANSLATE_HELPER": "1",
		"PATH":                     os.Getenv("PATH"),
		"PATHEXT":                  os.Getenv("PATHEXT"),
		"SYSTEMROOT":               os.Getenv("SYSTEMROOT"),
		"WINDIR":                   os.Getenv("WINDIR"),
		"TEMP":                     os.Getenv("TEMP"),
		"TMP":                      os.Getenv("TMP"),
	}
	modelDir := filepath.Join(dir, "nllb-model")
	if err := os.MkdirAll(modelDir, 0o700); err != nil {
		t.Fatal(err)
	}
	runner := DefaultRunner{
		Env: func(key string) string { return env[key] },
		ModelLookup: func(modelID, providerID string) (string, error) {
			if modelID != "nllb-200-distilled-600m-ct2-int8" || providerID != "local-nllb-ct2" {
				t.Fatalf("unexpected lookup %q %q", modelID, providerID)
			}
			return modelDir, nil
		},
	}
	result, appErr := runner.runTranslateSRT(context.Background(), CreateRequest{
		Type:           "translate_srt",
		InputPath:      input,
		OutputPath:     output,
		Provider:       "web-bing",
		Language:       "en",
		TargetLanguage: "zh",
		Options:        map[string]any{"yes": true},
	}, func(Update) {})
	if appErr != nil {
		t.Fatalf("runTranslateSRT error = %#v", appErr)
	}
	if result.OutputPath != output || result.Provider != "web-bing" || result.Segments != 1 {
		t.Fatalf("result = %#v", result)
	}
	if raw, err := os.ReadFile(output); err != nil || !strings.Contains(string(raw), "你好") {
		t.Fatalf("output raw=%q err=%v", raw, err)
	}
}

func TestRunTranslateSRTAcceptsPlainTextInput(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "notes.txt")
	output := filepath.Join(dir, "notes.translated.txt")
	if err := os.WriteFile(input, []byte("hello\n\nworld"), 0o600); err != nil {
		t.Fatal(err)
	}
	env := map[string]string{
		"FAST_SUB_PYTHON_CLI":      fmt.Sprintf("%q -test.run=TestTranslateCLIHelper --", os.Args[0]),
		"GO_WANT_TRANSLATE_HELPER": "1",
		"PATH":                     os.Getenv("PATH"),
		"PATHEXT":                  os.Getenv("PATHEXT"),
		"SYSTEMROOT":               os.Getenv("SYSTEMROOT"),
		"WINDIR":                   os.Getenv("WINDIR"),
		"TEMP":                     os.Getenv("TEMP"),
		"TMP":                      os.Getenv("TMP"),
	}
	modelDir := filepath.Join(dir, "nllb-model")
	if err := os.MkdirAll(modelDir, 0o700); err != nil {
		t.Fatal(err)
	}
	runner := DefaultRunner{
		Env: func(key string) string { return env[key] },
		ModelLookup: func(modelID, providerID string) (string, error) {
			if modelID != "nllb-200-distilled-600m-ct2-int8" || providerID != "local-nllb-ct2" {
				t.Fatalf("unexpected lookup %q %q", modelID, providerID)
			}
			return modelDir, nil
		},
	}
	result, appErr := runner.runTranslateSRT(context.Background(), CreateRequest{
		Type:           "translate_srt",
		InputPath:      input,
		Provider:       "web-bing",
		Language:       "en",
		TargetLanguage: "zh",
		Options:        map[string]any{"yes": true},
	}, func(Update) {})
	if appErr != nil {
		t.Fatalf("runTranslateSRT error = %#v", appErr)
	}
	if result.OutputPath != output || result.Segments != 2 {
		t.Fatalf("result = %#v", result)
	}
	raw, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(raw)) != "你好\n\n你好" {
		t.Fatalf("translated text = %q", raw)
	}
	if _, err := os.Stat(filepath.Join(dir, "notes.translated.srt")); !os.IsNotExist(err) {
		t.Fatalf("unexpected SRT sidecar err=%v", err)
	}
}

func TestRunTranslateSRTPlainTextPreservesLineLayout(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "notes.txt")
	output := filepath.Join(dir, "notes.translated.txt")
	if err := os.WriteFile(input, []byte("first\n\nsecond\nthird\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	env := map[string]string{
		"FAST_SUB_PYTHON_CLI":      fmt.Sprintf("%q -test.run=TestTranslateCLIHelper --", os.Args[0]),
		"GO_WANT_TRANSLATE_HELPER": "1",
		"PATH":                     os.Getenv("PATH"),
		"PATHEXT":                  os.Getenv("PATHEXT"),
		"SYSTEMROOT":               os.Getenv("SYSTEMROOT"),
		"WINDIR":                   os.Getenv("WINDIR"),
		"TEMP":                     os.Getenv("TEMP"),
		"TMP":                      os.Getenv("TMP"),
	}
	modelDir := filepath.Join(dir, "nllb-model")
	if err := os.MkdirAll(modelDir, 0o700); err != nil {
		t.Fatal(err)
	}
	runner := DefaultRunner{
		Env: func(key string) string { return env[key] },
		ModelLookup: func(modelID, providerID string) (string, error) {
			if modelID != "nllb-200-distilled-600m-ct2-int8" || providerID != "local-nllb-ct2" {
				t.Fatalf("unexpected lookup %q %q", modelID, providerID)
			}
			return modelDir, nil
		},
	}
	_, appErr := runner.runTranslateSRT(context.Background(), CreateRequest{
		Type:           "translate_srt",
		InputPath:      input,
		OutputPath:     output,
		Provider:       "local-nllb-ct2",
		Language:       "ko",
		TargetLanguage: "zh",
	}, func(Update) {})
	if appErr != nil {
		t.Fatalf("runTranslateSRT error = %#v", appErr)
	}
	raw, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != "你好\n\n你好\n你好\n" {
		t.Fatalf("translated text = %q", raw)
	}
}

func TestTranslatedCueTextsToPlainTextCollapsesProviderNewlinesPerSourceLine(t *testing.T) {
	layout := []plainTextLineLayout{
		{Text: "first", Translatable: true},
		{Text: "", Translatable: false},
		{Text: "second", Translatable: true},
	}
	got := translatedCueTextsToPlainText([]string{
		"你好\n世界",
		"第二\n行",
	}, layout)
	if got != "你好 世界\n\n第二 行" {
		t.Fatalf("translated text = %q", got)
	}
}

func TestRunTranslateSRTRequiresRemoteConfirmation(t *testing.T) {
	runner := DefaultRunner{}
	_, appErr := runner.runTranslateSRT(context.Background(), CreateRequest{
		Type:      "translate_srt",
		InputPath: "input.srt",
		Provider:  "api-openai-chat",
	}, func(Update) {})
	if appErr == nil || appErr.Code != "invalid_input" {
		t.Fatalf("appErr = %#v", appErr)
	}
}

func TestResolveTranslateCLIAddsProviderExtraForUV(t *testing.T) {
	runner := DefaultRunner{Env: func(key string) string {
		if key == "FAST_SUB_PYTHON_CLI" {
			return "uv run fast-sub"
		}
		return ""
	}}
	command, args, appErr := runner.resolveTranslateCLI("local-nllb-ct2")
	if appErr != nil {
		t.Fatal(appErr)
	}
	if command != "uv" || strings.Join(args, " ") != "run --extra local-translate fast-sub" {
		t.Fatalf("command=%q args=%q", command, strings.Join(args, " "))
	}
}

func TestTranslateEnvDefaultsUVCacheDir(t *testing.T) {
	env := translateEnv("local-nllb-ct2", func(key string) string {
		switch key {
		case "PATH":
			return "bin"
		default:
			return ""
		}
	})
	if !hasString(env, "UV_CACHE_DIR=.uv-cache") {
		t.Fatalf("env = %#v", env)
	}
	if !hasString(env, "PYTHONUTF8=1") || !hasString(env, "PYTHONIOENCODING=utf-8:replace") {
		t.Fatalf("python utf8 env missing: %#v", env)
	}
}

func TestParseTranslateJSONReadsErrorEnvelope(t *testing.T) {
	parsed, err := parseTranslateJSON([]byte(`{"ok":false,"error":{"code":"missing_dependency","stage":"translate","message":"local-nllb-ct2 requires ctranslate2","action_hint":"Install local translation extra."}}`))
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Code != "missing_dependency" || parsed.Message != "local-nllb-ct2 requires ctranslate2" || parsed.ActionHint != "Install local translation extra." {
		t.Fatalf("parsed = %#v", parsed)
	}
}

func TestTranslateArgsIncludesTimeout(t *testing.T) {
	runner := DefaultRunner{
		ModelLookup: func(modelID, providerID string) (string, error) {
			if modelID != "nllb-200-distilled-600m-ct2-int8" || providerID != "local-nllb-ct2" {
				t.Fatalf("unexpected lookup %q %q", modelID, providerID)
			}
			return "C:\\models\\nllb", nil
		},
	}
	args, appErr := runner.translateArgs(
		CreateRequest{
			Provider: "web-google",
			Options:  map[string]any{"timeout": 12.5, "yes": true},
		},
		"input.srt",
		"web-google",
		"en",
		"zh",
		"out.srt",
	)
	if appErr != nil {
		t.Fatalf("translateArgs error = %#v", appErr)
	}
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "--timeout 12.5") {
		t.Fatalf("args = %q", joined)
	}
}

func TestTranslateCLIHelper(t *testing.T) {
	if os.Getenv("GO_WANT_TRANSLATE_HELPER") != "1" {
		return
	}
	input := ""
	output := ""
	args := os.Args
	for index, arg := range args {
		if arg == "--output" && index+1 < len(args) {
			output = args[index+1]
		}
		if arg == "translate" && index+1 < len(args) {
			input = args[index+1]
		}
	}
	if output == "" {
		fmt.Fprintln(os.Stderr, "missing --output")
		os.Exit(2)
	}
	cues := 1
	if input != "" {
		if raw, err := os.ReadFile(input); err == nil {
			cues = strings.Count(string(raw), " --> ")
			if cues < 1 {
				cues = 1
			}
		}
	}
	var out strings.Builder
	for index := 0; index < cues; index++ {
		start := index * 2
		end := start + 2
		fmt.Fprintf(&out, "%d\n%s --> %s\n你好\n\n", index+1, srtTimestamp(start), srtTimestamp(end))
	}
	if err := os.WriteFile(output, []byte(out.String()), 0o600); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf(`{"srt_path":%q,"provider":"web-bing","source_language":"en","target_language":"zh","cues_count":%d,"warnings":[]}`+"\n", output, cues)
	os.Exit(0)
}
