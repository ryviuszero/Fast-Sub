package subtitle

import (
	"strings"
	"testing"
)

func TestRenderSRTFormatsAndNormalizesText(t *testing.T) {
	got, err := RenderSRT([]Segment{{
		StartSec: 0,
		EndSec:   2.3456,
		Text:     "  hello\r\n world  ",
	}})
	if err != nil {
		t.Fatal(err)
	}
	want := "1\n00:00:00,000 --> 00:00:02,346\nhello\nworld\n\n"
	if got != want {
		t.Fatalf("SRT = %q, want %q", got, want)
	}
}

func TestRenderSRTRejectsInvalidSegments(t *testing.T) {
	cases := []Segment{
		{StartSec: -1, EndSec: 1, Text: "bad"},
		{StartSec: 2, EndSec: 1, Text: "bad"},
		{StartSec: 0, EndSec: 1, Text: "   "},
	}
	for _, segment := range cases {
		_, err := RenderSRT([]Segment{segment})
		if err == nil {
			t.Fatalf("expected error for %#v", segment)
		}
		if !strings.Contains(err.Error(), "segment 1") {
			t.Fatalf("error = %v", err)
		}
	}
}
