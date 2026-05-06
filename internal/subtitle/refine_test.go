package subtitle

import (
	"strings"
	"testing"
)

func TestRefineSegmentsSplitsLongEnglishCue(t *testing.T) {
	segments := []Segment{{
		StartSec: 0.66,
		EndSec:   32.03,
		Text: "I work out a lot, running, stretching, and taking care of myself through a healthy diet. " +
			"I'm really proud of my wife. She's quite a fantastic person, inspiring and just full of really positive, good energy. " +
			"For whatever reason, I enjoy watching Nicholas Cage. I told my teachers I wanted to be my own boss.",
	}}

	refined := RefineSegments(segments, RefineOptions{Lang: "en"})
	if len(refined) < 4 {
		t.Fatalf("len(refined) = %d, want at least 4", len(refined))
	}
	for _, segment := range refined {
		if duration := segment.EndSec - segment.StartSec; duration > 6.1 {
			t.Fatalf("duration = %.3f, segment=%#v", duration, segment)
		}
		for _, line := range strings.Split(segment.Text, "\n") {
			if len([]rune(line)) > 42 {
				t.Fatalf("line is too long (%d): %q", len([]rune(line)), line)
			}
		}
	}
	if refined[0].StartSec != segments[0].StartSec {
		t.Fatalf("first start = %v", refined[0].StartSec)
	}
	if refined[len(refined)-1].EndSec != segments[0].EndSec {
		t.Fatalf("last end = %v", refined[len(refined)-1].EndSec)
	}
}

func TestRenderSRTAfterRefineProducesReadableCues(t *testing.T) {
	refined := RefineSegments([]Segment{{
		StartSec: 0,
		EndSec:   12,
		Text:     "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen",
	}}, RefineOptions{Lang: "en", MaxChars: 20})
	srt, err := RenderSRT(refined)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(srt, "-->") < 2 {
		t.Fatalf("expected split cues:\n%s", srt)
	}
	if strings.Contains(srt, "one two three four five six seven eight") {
		t.Fatalf("expected wrapped text:\n%s", srt)
	}
}

func TestRefineSegmentsUsesWordTimestampsWhenAvailable(t *testing.T) {
	segments := []Segment{{
		StartSec: 0,
		EndSec:   12,
		Text:     "one two three four five six",
		Words: []Word{
			{StartSec: 0.1, EndSec: 0.4, Text: "one"},
			{StartSec: 0.5, EndSec: 0.8, Text: "two"},
			{StartSec: 4.0, EndSec: 4.4, Text: "three"},
			{StartSec: 4.5, EndSec: 4.9, Text: "four"},
			{StartSec: 8.0, EndSec: 8.4, Text: "five"},
			{StartSec: 8.5, EndSec: 8.9, Text: "six"},
		},
	}}

	refined := RefineSegments(segments, RefineOptions{Lang: "en", MaxChars: 12, MaxDurationSec: 3})
	if len(refined) != 3 {
		t.Fatalf("len(refined) = %d, want 3: %#v", len(refined), refined)
	}
	if refined[0].StartSec != 0.1 || refined[0].EndSec != 0.8 {
		t.Fatalf("first cue timing = %.1f..%.1f", refined[0].StartSec, refined[0].EndSec)
	}
	if refined[1].Text != "three four" {
		t.Fatalf("second cue text = %q", refined[1].Text)
	}
}

func TestRefineSegmentsFallsBackWhenWordTimestampsAreInvalid(t *testing.T) {
	segments := []Segment{{
		StartSec: 0,
		EndSec:   12,
		Text:     "one two three four five six",
		Words: []Word{
			{StartSec: 1, EndSec: 2, Text: "one"},
			{StartSec: 0, EndSec: 1, Text: "two"},
		},
	}}

	refined := RefineSegments(segments, RefineOptions{Lang: "en", MaxChars: 12})
	if len(refined) == 0 {
		t.Fatal("expected fallback cues")
	}
	if refined[0].StartSec != 0 {
		t.Fatalf("expected fallback to segment timing, got %.1f", refined[0].StartSec)
	}
}
