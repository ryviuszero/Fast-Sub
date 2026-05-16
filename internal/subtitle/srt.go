// Package subtitle renders subtitle formats owned by the Go preview path.
package subtitle

import (
	"fmt"
	"math"
	"strings"
)

// Word is an optional word-level timestamp returned by capable STT workers.
type Word struct {
	StartSec   float64  `json:"start_sec"`
	EndSec     float64  `json:"end_sec"`
	Text       string   `json:"text"`
	Confidence *float64 `json:"confidence,omitempty"`
}

// Segment is the subtitle cue shape produced by STT workers.
type Segment struct {
	StartSec float64 `json:"start_sec"`
	EndSec   float64 `json:"end_sec"`
	Text     string  `json:"text"`
	Words    []Word  `json:"words,omitempty"`
}

// RenderSRT renders worker segments as SubRip text.
func RenderSRT(segments []Segment) (string, error) {
	if len(segments) == 0 {
		return "", nil
	}
	var b strings.Builder
	for i, segment := range segments {
		if err := validateSegment(segment); err != nil {
			return "", fmt.Errorf("segment %d: %w", i+1, err)
		}
		text := normalizeText(segment.Text)
		if text == "" {
			return "", fmt.Errorf("segment %d: text is empty", i+1)
		}
		fmt.Fprintf(&b, "%d\n%s --> %s\n%s\n\n", i+1, formatTimestamp(segment.StartSec), formatTimestamp(segment.EndSec), text)
	}
	return b.String(), nil
}

func validateSegment(segment Segment) error {
	if math.IsNaN(segment.StartSec) || math.IsInf(segment.StartSec, 0) || math.IsNaN(segment.EndSec) || math.IsInf(segment.EndSec, 0) {
		return fmt.Errorf("timestamps must be finite")
	}
	if segment.StartSec < 0 || segment.EndSec < 0 {
		return fmt.Errorf("timestamps must be non-negative")
	}
	if segment.EndSec < segment.StartSec {
		return fmt.Errorf("end timestamp is before start timestamp")
	}
	return nil
}

func normalizeText(text string) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	lines := strings.Split(strings.TrimSpace(text), "\n")
	for i, line := range lines {
		lines[i] = strings.TrimSpace(line)
	}
	return strings.Join(lines, "\n")
}

func formatTimestamp(sec float64) string {
	totalMillis := int64(math.Round(sec * 1000))
	hours := totalMillis / 3600000
	totalMillis %= 3600000
	minutes := totalMillis / 60000
	totalMillis %= 60000
	seconds := totalMillis / 1000
	millis := totalMillis % 1000
	return fmt.Sprintf("%02d:%02d:%02d,%03d", hours, minutes, seconds, millis)
}
