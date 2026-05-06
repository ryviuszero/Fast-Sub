package ffmpeg

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/media"
	"fast-sub/internal/paths"
)

// Probe inspects media metadata with ffprobe.
func (r Runner) Probe(ctx context.Context, input string, timeout time.Duration) (media.Metadata, *fserrors.AppError) {
	var empty media.Metadata
	if err := paths.ValidateInputFile(input); err != nil {
		return empty, fserrors.New(fserrors.CodeInvalidInput, "input", err.Error(), "", nil)
	}
	probePath, err := LookPath(r.FFprobeName)
	if err != nil {
		return empty, fserrors.MissingDependency("probe", "ffprobe")
	}

	probeCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	args := []string{"-v", "error", "-print_format", "json", "-show_format", "-show_streams", input}
	completed := runCommand(probeCtx, probePath, args, 0)
	if completed.Err != nil {
		details := map[string]any{"exit_code": completed.ExitCode}
		if completed.Stderr != "" {
			details["stderr_tail"] = completed.Stderr
		}
		return empty, fserrors.New(
			fserrors.CodeFFprobeFailed,
			"probe",
			"ffprobe failed: "+processMessage(completed),
			"Check that the input is a supported media file and ffprobe can read it.",
			details,
		)
	}

	metadata, parseErr := parseProbeJSON(input, []byte(completed.Stdout))
	if parseErr != nil {
		return empty, fserrors.New(
			fserrors.CodeFFprobeFailed,
			"probe",
			parseErr.Error(),
			"Check that ffprobe is installed correctly and returns JSON output.",
			nil,
		)
	}
	return metadata, nil
}

func parseProbeJSON(input string, rawJSON []byte) (media.Metadata, error) {
	var raw map[string]any
	if err := json.Unmarshal(rawJSON, &raw); err != nil {
		return media.Metadata{}, fmt.Errorf("ffprobe returned invalid JSON")
	}
	rawStreams, ok := raw["streams"].([]any)
	if !ok {
		return media.Metadata{}, fmt.Errorf("ffprobe JSON is missing streams")
	}
	rawFormat, ok := raw["format"].(map[string]any)
	if !ok {
		return media.Metadata{}, fmt.Errorf("ffprobe JSON is missing format")
	}

	audioStreams := make([]media.StreamSummary, 0)
	videoStreams := make([]media.StreamSummary, 0)
	for _, item := range rawStreams {
		stream, ok := item.(map[string]any)
		if !ok {
			continue
		}
		summary := streamSummary(stream)
		switch stream["codec_type"] {
		case "audio":
			audioStreams = append(audioStreams, summary)
		case "video":
			videoStreams = append(videoStreams, summary)
		}
	}
	if len(audioStreams) == 0 {
		return media.Metadata{}, fmt.Errorf("no audio stream found in: %s", input)
	}

	return media.Metadata{
		Path:                input,
		DurationSec:         optionalFloat(rawFormat["duration"]),
		Container:           rawFormat["format_name"],
		AudioStreams:        audioStreams,
		VideoStreams:        videoStreams,
		SelectedAudioStream: audioStreams[0],
	}, nil
}

func streamSummary(stream map[string]any) media.StreamSummary {
	return media.StreamSummary{
		Index:       stream["index"],
		Codec:       stream["codec_name"],
		CodecType:   stream["codec_type"],
		DurationSec: optionalFloat(stream["duration"]),
		Channels:    stream["channels"],
		SampleRate:  optionalInt(stream["sample_rate"]),
		Width:       stream["width"],
		Height:      stream["height"],
		Language:    streamLanguage(stream),
	}
}

func streamLanguage(stream map[string]any) *string {
	tags, ok := stream["tags"].(map[string]any)
	if !ok {
		return nil
	}
	language, ok := tags["language"].(string)
	if !ok {
		return nil
	}
	return &language
}

func optionalFloat(value any) *float64 {
	switch typed := value.(type) {
	case float64:
		return &typed
	case string:
		var parsed float64
		if _, err := fmt.Sscanf(typed, "%f", &parsed); err == nil {
			return &parsed
		}
	}
	return nil
}

func optionalInt(value any) *int {
	switch typed := value.(type) {
	case float64:
		parsed := int(typed)
		return &parsed
	case string:
		var parsed int
		if _, err := fmt.Sscanf(typed, "%d", &parsed); err == nil {
			return &parsed
		}
	}
	return nil
}
