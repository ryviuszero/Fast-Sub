package ffmpeg

import (
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"testing"
)

func TestSubtitleFilterEscapesWindowsPath(t *testing.T) {
	filter := subtitleFilter(`C:\Users\Example\Videos\clip,one.srt`)
	want := `subtitles=filename='C\:/Users/Example/Videos/clip\,one.srt'`
	if filter != want {
		t.Fatalf("filter = %q, want %q", filter, want)
	}
}

func TestBurnPresetMapsUserOptions(t *testing.T) {
	tests := map[string]string{
		"":         "medium",
		"fast":     "veryfast",
		"veryfast": "veryfast",
		"quality":  "slow",
		"slow":     "slow",
	}
	for input, want := range tests {
		if got := burnPreset(input); got != want {
			t.Fatalf("burnPreset(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestBurnInArgsSpecifyMP4MuxerForTempOutput(t *testing.T) {
	args := burnInArgs("input.mp4", "subtitle.srt", ".input.burned.mp4.fast-sub-tmp-123", "medium")
	if !reflect.DeepEqual(args[len(args)-3:], []string{"-f", "mp4", ".input.burned.mp4.fast-sub-tmp-123"}) {
		t.Fatalf("tail args = %#v, want explicit mp4 muxer before temp output", args[len(args)-3:])
	}
}

func TestLookPathPackagedRuntimeUsesAppPrivateFFmpegDir(t *testing.T) {
	t.Setenv("FAST_SUB_PACKAGED_RUNTIME_ONLY", "1")
	binDir := t.TempDir()
	t.Setenv("FAST_SUB_FFMPEG_BIN_DIR", binDir)
	name := "ffmpeg"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	want := filepath.Join(binDir, name)
	if err := os.WriteFile(want, []byte("fake"), 0o700); err != nil {
		t.Fatal(err)
	}
	got, err := LookPath("ffmpeg")
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("path = %q, want %q", got, want)
	}
	if _, err := LookPath("ffprobe"); err == nil {
		t.Fatal("missing app-private ffprobe should not fall back to PATH")
	}
}
