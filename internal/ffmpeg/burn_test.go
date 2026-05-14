package ffmpeg

import (
	"reflect"
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
