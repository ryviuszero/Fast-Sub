// Package media owns normalized media metadata returned by Fast Sub.
package media

// Metadata is Fast Sub's normalized ffprobe result.
type Metadata struct {
	Path                string          `json:"path"`
	DurationSec         *float64        `json:"duration_sec"`
	Container           any             `json:"container"`
	AudioStreams        []StreamSummary `json:"audio_streams"`
	VideoStreams        []StreamSummary `json:"video_streams"`
	SelectedAudioStream StreamSummary   `json:"selected_audio_stream"`
}

// StreamSummary is a compact audio/video stream description.
type StreamSummary struct {
	Index       any      `json:"index"`
	Codec       any      `json:"codec"`
	CodecType   any      `json:"codec_type"`
	DurationSec *float64 `json:"duration_sec"`
	Channels    any      `json:"channels"`
	SampleRate  *int     `json:"sample_rate"`
	Width       any      `json:"width"`
	Height      any      `json:"height"`
	Language    *string  `json:"language"`
}
