package subtitle

import (
	"math"
	"strings"
	"unicode"
)

const (
	cjkDefaultLineChars = 22
	enDefaultLineChars  = 42
	minSplitDurationSec = 0.5
)

// RefineOptions controls readable cue splitting and line wrapping.
type RefineOptions struct {
	Lang           string
	MaxChars       int
	MinDurationSec float64
	MaxDurationSec float64
}

// RefineSegments repairs and formats STT segments for readable SRT output.
func RefineSegments(segments []Segment, options RefineOptions) []Segment {
	cleaned := dropBlankSegments(segments)
	if len(cleaned) == 0 {
		return nil
	}
	options = fillRefineDefaults(options)
	maxChars := resolveMaxChars(cleaned, options)
	repaired := repairTimeline(cleaned, options)
	split := splitLongSegments(repaired, options, maxChars)
	return repairTimeline(split, options)
}

func fillRefineDefaults(options RefineOptions) RefineOptions {
	if options.Lang == "" {
		options.Lang = "auto"
	}
	if options.MinDurationSec <= 0 {
		options.MinDurationSec = 1.0
	}
	if options.MaxDurationSec <= 0 {
		options.MaxDurationSec = 6.0
	}
	return options
}

func dropBlankSegments(segments []Segment) []Segment {
	cleaned := make([]Segment, 0, len(segments))
	for _, segment := range segments {
		text := normalizeText(segment.Text)
		if text == "" {
			continue
		}
		segment.StartSec = math.Max(0, segment.StartSec)
		segment.EndSec = math.Max(0, segment.EndSec)
		segment.Text = text
		cleaned = append(cleaned, segment)
	}
	return cleaned
}

func repairTimeline(segments []Segment, options RefineOptions) []Segment {
	repaired := make([]Segment, 0, len(segments))
	previousEnd := 0.0
	for _, segment := range segments {
		start := math.Max(0, segment.StartSec)
		end := math.Max(start, segment.EndSec)
		if start < previousEnd {
			start = previousEnd
		}
		if end <= start {
			end = start + options.MinDurationSec
		}
		segment.StartSec = start
		segment.EndSec = end
		repaired = append(repaired, segment)
		previousEnd = end
	}
	return repaired
}

func splitLongSegments(segments []Segment, options RefineOptions, maxChars int) []Segment {
	split := make([]Segment, 0, len(segments))
	for _, segment := range segments {
		if wordSegments, ok := splitSegmentByWords(segment, options, maxChars); ok {
			split = append(split, wordSegments...)
			continue
		}
		chunks := textChunks(segment.Text, maxChars)
		duration := segment.EndSec - segment.StartSec
		if duration > options.MaxDurationSec && (len(chunks) == 1 || duration/float64(len(chunks)) > options.MaxDurationSec) {
			chunks = splitChunk(strings.ReplaceAll(normalizeText(segment.Text), "\n", " "), maxChars)
		}
		if len(chunks) <= 1 || duration/float64(len(chunks)) < minSplitDurationSec {
			segment.Text = wrapSubtitleText(segment.Text, maxChars)
			split = append(split, segment)
			continue
		}
		step := duration / float64(len(chunks))
		for i, chunk := range chunks {
			part := segment
			part.StartSec = segment.StartSec + step*float64(i)
			part.EndSec = segment.StartSec + step*float64(i+1)
			part.Text = wrapSubtitleText(chunk, maxChars)
			split = append(split, part)
		}
	}
	return split
}

func splitSegmentByWords(segment Segment, options RefineOptions, maxChars int) ([]Segment, bool) {
	words := validWords(segment)
	if len(words) == 0 {
		return nil, false
	}
	useCJKSpacing := shouldUseCJKSpacing(segment, options)
	limit := maxChars * 2
	chunks := make([]Segment, 0)
	current := make([]Word, 0)
	for _, word := range words {
		candidate := append(append([]Word{}, current...), word)
		candidateText := joinWordTexts(candidate, useCJKSpacing)
		candidateDuration := candidate[len(candidate)-1].EndSec - candidate[0].StartSec
		shouldFlush := len(current) > 0 && (plainLen(candidateText) > limit || candidateDuration > options.MaxDurationSec)
		if shouldFlush {
			chunks = append(chunks, segmentFromWords(current, maxChars, useCJKSpacing))
			current = current[:0]
		}
		current = append(current, word)
	}
	if len(current) > 0 {
		chunks = append(chunks, segmentFromWords(current, maxChars, useCJKSpacing))
	}
	if len(chunks) == 0 {
		return nil, false
	}
	return chunks, true
}

func validWords(segment Segment) []Word {
	if len(segment.Words) == 0 {
		return nil
	}
	valid := make([]Word, 0, len(segment.Words))
	previousEnd := -1.0
	for _, word := range segment.Words {
		word.Text = strings.TrimSpace(word.Text)
		if word.Text == "" {
			continue
		}
		if math.IsNaN(word.StartSec) || math.IsInf(word.StartSec, 0) || math.IsNaN(word.EndSec) || math.IsInf(word.EndSec, 0) {
			return nil
		}
		if word.StartSec < 0 || word.EndSec < word.StartSec || (previousEnd >= 0 && word.StartSec < previousEnd-0.001) {
			return nil
		}
		valid = append(valid, word)
		previousEnd = word.EndSec
	}
	return valid
}

func segmentFromWords(words []Word, maxChars int, cjk bool) Segment {
	text := joinWordTexts(words, cjk)
	return Segment{
		StartSec: words[0].StartSec,
		EndSec:   words[len(words)-1].EndSec,
		Text:     wrapSubtitleText(text, maxChars),
		Words:    append([]Word{}, words...),
	}
}

func joinWordTexts(words []Word, cjk bool) string {
	parts := make([]string, 0, len(words))
	for _, word := range words {
		text := strings.TrimSpace(word.Text)
		if text != "" {
			parts = append(parts, text)
		}
	}
	if cjk {
		return strings.Join(parts, "")
	}
	return strings.Join(parts, " ")
}

func shouldUseCJKSpacing(segment Segment, options RefineOptions) bool {
	lang := strings.ToLower(options.Lang)
	if lang == "zh" || lang == "ja" || lang == "ko" {
		return true
	}
	if lang != "auto" {
		return false
	}
	return containsCJK([]Segment{segment})
}

func textChunks(text string, maxChars int) []string {
	normalized := normalizeText(text)
	if plainLen(normalized) <= maxChars*2 {
		return []string{normalized}
	}
	paragraphs := strings.Split(normalized, "\n")
	chunks := make([]string, 0)
	current := ""
	for _, paragraph := range paragraphs {
		if paragraph == "" {
			continue
		}
		for _, part := range splitChunk(paragraph, maxChars) {
			candidate := part
			if current != "" {
				candidate = current + "\n" + part
			}
			if plainLen(candidate) > maxChars*2 && current != "" {
				chunks = append(chunks, current)
				current = part
			} else {
				current = candidate
			}
		}
	}
	if current != "" {
		chunks = append(chunks, current)
	}
	return chunks
}

func splitChunk(text string, maxChars int) []string {
	words := strings.Fields(text)
	if len(words) > 1 {
		chunks := make([]string, 0)
		current := ""
		for _, word := range words {
			candidate := word
			if current != "" {
				candidate = current + " " + word
			}
			if len([]rune(candidate)) > maxChars && current != "" {
				chunks = append(chunks, current)
				current = word
			} else {
				current = candidate
			}
		}
		if current != "" {
			chunks = append(chunks, current)
		}
		return chunks
	}
	runes := []rune(text)
	chunks := make([]string, 0, (len(runes)+maxChars-1)/maxChars)
	for start := 0; start < len(runes); start += maxChars {
		end := start + maxChars
		if end > len(runes) {
			end = len(runes)
		}
		chunks = append(chunks, string(runes[start:end]))
	}
	return chunks
}

func wrapSubtitleText(text string, maxChars int) string {
	parts := splitChunk(strings.ReplaceAll(normalizeText(text), "\n", " "), maxChars)
	lines := make([]string, 0, len(parts))
	for _, part := range parts {
		if len(lines) == 0 || plainLen(lines[len(lines)-1])+1+plainLen(part) > maxChars {
			lines = append(lines, part)
		} else {
			lines[len(lines)-1] += " " + part
		}
	}
	return strings.Join(lines, "\n")
}

func resolveMaxChars(segments []Segment, options RefineOptions) int {
	if options.MaxChars > 0 {
		return options.MaxChars
	}
	lang := strings.ToLower(options.Lang)
	if lang == "zh" || lang == "ja" || lang == "ko" || (lang == "auto" && containsCJK(segments)) {
		return cjkDefaultLineChars
	}
	return enDefaultLineChars
}

func containsCJK(segments []Segment) bool {
	for _, segment := range segments {
		for _, char := range segment.Text {
			if (char >= '\u4e00' && char <= '\u9fff') || (char >= '\u3040' && char <= '\u30ff') || (char >= '\uac00' && char <= '\ud7af') {
				return true
			}
		}
	}
	return false
}

func plainLen(text string) int {
	count := 0
	for _, char := range text {
		if char != '\n' && char != '\r' && !unicode.IsControl(char) {
			count++
		}
	}
	return count
}
