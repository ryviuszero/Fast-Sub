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
	runner := DefaultRunner{Env: func(key string) string { return env[key] }}
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

func TestTranslateCLIHelper(t *testing.T) {
	if os.Getenv("GO_WANT_TRANSLATE_HELPER") != "1" {
		return
	}
	output := ""
	args := os.Args
	for index, arg := range args {
		if arg == "--output" && index+1 < len(args) {
			output = args[index+1]
		}
	}
	if output == "" {
		fmt.Fprintln(os.Stderr, "missing --output")
		os.Exit(2)
	}
	if err := os.WriteFile(output, []byte("1\n00:00:00,000 --> 00:00:01,000\n你好\n"), 0o600); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf(`{"srt_path":%q,"provider":"web-bing","source_language":"en","target_language":"zh","cues_count":1,"warnings":[]}`+"\n", output)
	os.Exit(0)
}
