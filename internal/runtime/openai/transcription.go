// Package openai implements OpenAI-compatible speech-to-text HTTP calls.
package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"time"

	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/subtitle"
)

const (
	DefaultBaseURL        = "https://api.openai.com/v1"
	officialUploadLimit   = int64(25 * 1024 * 1024)
	defaultRequestTimeout = 5 * time.Minute
)

// HTTPDoer is the small interface needed by Client.
type HTTPDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

// Client calls the OpenAI-compatible audio transcription endpoint.
type Client struct {
	HTTPClient HTTPDoer
	BaseURL    string
	Timeout    time.Duration
}

// TranscribeOptions describes a single transcription upload.
type TranscribeOptions struct {
	AudioPath      string
	FileName       string
	Model          string
	APIKey         string
	Language       string
	DurationSec    *float64
	WordTimestamps bool
}

// Result is the provider-neutral transcription result.
type Result struct {
	Provider   string
	Model      string
	Language   string
	Segments   []subtitle.Segment
	Warnings   []string
	ElapsedSec float64
}

// Transcribe uploads one prepared audio file and normalizes the response.
func (c Client) Transcribe(ctx context.Context, opts TranscribeOptions) (Result, *fserrors.AppError) {
	var empty Result
	if strings.TrimSpace(opts.Model) == "" {
		return empty, fserrors.New(fserrors.CodeInvalidInput, "api_openai_transcription", "--model is required for api-openai-transcription.", "Pass an explicit OpenAI-compatible transcription model.", nil)
	}
	if err := checkOfficialUploadLimit(c.baseURL(), opts.AudioPath); err != nil {
		return empty, err
	}

	started := time.Now()
	body, contentType, appErr := multipartBody(opts)
	if appErr != nil {
		return empty, appErr
	}
	endpoint, err := transcriptionEndpoint(c.baseURL())
	if err != nil {
		return empty, fserrors.New(fserrors.CodeInvalidInput, "api_openai_transcription", err.Error(), "Pass a valid --base-url.", nil)
	}

	reqCtx := ctx
	cancel := func() {}
	if c.Timeout > 0 {
		reqCtx, cancel = context.WithTimeout(ctx, c.Timeout)
	} else {
		reqCtx, cancel = context.WithTimeout(ctx, defaultRequestTimeout)
	}
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, endpoint, body)
	if err != nil {
		return empty, fserrors.New(fserrors.CodeAPIFailed, "api_openai_transcription", redactSecret(err.Error(), opts.APIKey), "Check the OpenAI-compatible endpoint configuration.", nil)
	}
	if strings.TrimSpace(opts.APIKey) != "" {
		req.Header.Set("Authorization", "Bearer "+opts.APIKey)
	}
	req.Header.Set("Content-Type", contentType)

	httpClient := c.HTTPClient
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return empty, apiTransportError(reqCtx, err, opts.APIKey)
	}
	defer resp.Body.Close()

	raw, readErr := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if readErr != nil {
		return empty, fserrors.New(fserrors.CodeAPIFailed, "api_openai_transcription", redactSecret(readErr.Error(), opts.APIKey), "Retry the request or check network stability.", nil)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return empty, apiStatusError(resp.StatusCode, raw, opts.APIKey)
	}
	segments, language, warnings, appErr := parseTranscription(raw, opts.DurationSec)
	if appErr != nil {
		return empty, appErr
	}
	if opts.WordTimestamps && !modelSupportsWordTimestamps(opts.Model) {
		warnings = append(warnings, "word timestamps were requested but not sent because this model does not advertise whisper-1 word timestamp compatibility")
	}
	if language == "" {
		language = opts.Language
	}
	if language == "" || language == "auto" {
		language = "unknown"
	}
	return Result{
		Provider:   "api-openai-transcription",
		Model:      opts.Model,
		Language:   language,
		Segments:   segments,
		Warnings:   warnings,
		ElapsedSec: time.Since(started).Seconds(),
	}, nil
}

func multipartBody(opts TranscribeOptions) (*bytes.Buffer, string, *fserrors.AppError) {
	file, err := os.Open(opts.AudioPath)
	if err != nil {
		return nil, "", fserrors.New(fserrors.CodeInvalidInput, "api_openai_transcription", "open prepared upload audio: "+err.Error(), "", nil)
	}
	defer file.Close()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", opts.FileName)
	if err != nil {
		return nil, "", fserrors.New(fserrors.CodeAPIFailed, "api_openai_transcription", "create multipart file part: "+err.Error(), "", nil)
	}
	if _, err := io.Copy(part, file); err != nil {
		return nil, "", fserrors.New(fserrors.CodeAPIFailed, "api_openai_transcription", "write multipart file part: "+err.Error(), "", nil)
	}
	_ = writer.WriteField("model", opts.Model)
	if opts.Language != "" && opts.Language != "auto" {
		_ = writer.WriteField("language", opts.Language)
	}
	if modelSupportsVerboseSegments(opts.Model) {
		_ = writer.WriteField("response_format", "verbose_json")
		_ = writer.WriteField("timestamp_granularities[]", "segment")
		if opts.WordTimestamps {
			_ = writer.WriteField("timestamp_granularities[]", "word")
		}
	} else {
		_ = writer.WriteField("response_format", "json")
	}
	if err := writer.Close(); err != nil {
		return nil, "", fserrors.New(fserrors.CodeAPIFailed, "api_openai_transcription", "finalize multipart request: "+err.Error(), "", nil)
	}
	return &body, writer.FormDataContentType(), nil
}

func modelSupportsVerboseSegments(model string) bool {
	return model == "whisper-1"
}

func modelSupportsWordTimestamps(model string) bool {
	return model == "whisper-1"
}

func parseTranscription(raw []byte, duration *float64) ([]subtitle.Segment, string, []string, *fserrors.AppError) {
	var decoded struct {
		Text     string `json:"text"`
		Language string `json:"language"`
		Segments []struct {
			Start float64 `json:"start"`
			End   float64 `json:"end"`
			Text  string  `json:"text"`
			Words []struct {
				Start float64 `json:"start"`
				End   float64 `json:"end"`
				Text  string  `json:"text"`
				Word  string  `json:"word"`
			} `json:"words"`
		} `json:"segments"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return nil, "", nil, fserrors.New(fserrors.CodeAPIFailed, "api_openai_transcription", "OpenAI transcription response was invalid JSON.", "Retry the request or check endpoint compatibility.", nil)
	}
	segments := make([]subtitle.Segment, 0, len(decoded.Segments))
	for _, item := range decoded.Segments {
		words := make([]subtitle.Word, 0, len(item.Words))
		for _, word := range item.Words {
			text := word.Text
			if text == "" {
				text = word.Word
			}
			words = append(words, subtitle.Word{StartSec: word.Start, EndSec: word.End, Text: text})
		}
		segments = append(segments, subtitle.Segment{StartSec: item.Start, EndSec: item.End, Text: item.Text, Words: words})
	}
	warnings := []string{}
	if len(segments) == 0 && strings.TrimSpace(decoded.Text) != "" {
		end := 1.0
		if duration != nil && *duration > 0 {
			end = *duration
		}
		segments = append(segments, subtitle.Segment{StartSec: 0, EndSec: end, Text: decoded.Text})
		warnings = append(warnings, "provider response did not include segment timestamps; emitted one full-duration subtitle segment")
	}
	if len(segments) == 0 {
		return nil, "", nil, fserrors.New(fserrors.CodeAPIFailed, "api_openai_transcription", "OpenAI transcription response did not include text or segments.", "Check that the input contains speech and the model supports transcription.", nil)
	}
	if _, err := subtitle.RenderSRT(segments); err != nil {
		return nil, "", nil, fserrors.New(fserrors.CodeAPIFailed, "api_openai_transcription", "OpenAI transcription response had invalid subtitle segments: "+err.Error(), "Check endpoint compatibility.", nil)
	}
	return segments, decoded.Language, warnings, nil
}

func apiTransportError(ctx context.Context, err error, secret string) *fserrors.AppError {
	message := redactSecret(err.Error(), secret)
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		message = "OpenAI transcription request timed out."
	}
	return fserrors.New(fserrors.CodeAPIFailed, "api_openai_transcription", message, "Retry later or increase the timeout for long inputs.", nil)
}

func apiStatusError(status int, raw []byte, secret string) *fserrors.AppError {
	message := fmt.Sprintf("OpenAI transcription API returned HTTP %d.", status)
	var decoded struct {
		Error struct {
			Message string `json:"message"`
			Type    string `json:"type"`
			Code    any    `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &decoded); err == nil && decoded.Error.Message != "" {
		message = fmt.Sprintf("OpenAI transcription API returned HTTP %d: %s", status, decoded.Error.Message)
	}
	if strings.TrimSpace(secret) == "" && (status == http.StatusUnauthorized || status == http.StatusForbidden) {
		return fserrors.New(
			fserrors.CodeMissingAPIKey,
			"api_openai_transcription",
			redactSecret(message, secret),
			"This endpoint requires an API key. Save a key, or choose an OpenAI-compatible endpoint that accepts no-key requests.",
			map[string]any{"http_status": status},
		)
	}
	hint := "Check the provider configuration and retry."
	if status == http.StatusUnauthorized {
		hint = "Check that the API key is valid for the configured endpoint."
	}
	if status == http.StatusTooManyRequests {
		hint = "Retry after the rate limit resets or choose a different provider."
	}
	if status >= 500 {
		hint = "Retry later or use a different OpenAI-compatible endpoint."
	}
	return fserrors.New(fserrors.CodeAPIFailed, "api_openai_transcription", redactSecret(message, secret), hint, map[string]any{"http_status": status})
}

func checkOfficialUploadLimit(baseURL, audioPath string) *fserrors.AppError {
	if !IsOfficialBaseURL(baseURL) {
		return nil
	}
	info, err := os.Stat(audioPath)
	if err != nil {
		return fserrors.New(fserrors.CodeInvalidInput, "api_openai_transcription", "inspect prepared upload audio: "+err.Error(), "", nil)
	}
	if info.Size() <= officialUploadLimit {
		return nil
	}
	return fserrors.New(
		fserrors.CodeAPIFailed,
		"api_openai_transcription",
		"prepared upload audio exceeds the official OpenAI 25MB upload limit.",
		"Use --api-upload-format m4a or mp3, shorten the input, or configure an OpenAI-compatible endpoint with its own upload policy.",
		map[string]any{"upload_bytes": info.Size(), "upload_limit_bytes": officialUploadLimit},
	)
}

func (c Client) baseURL() string {
	if strings.TrimSpace(c.BaseURL) == "" {
		return DefaultBaseURL
	}
	return strings.TrimSpace(c.BaseURL)
}

func transcriptionEndpoint(base string) (string, error) {
	parsed, err := url.Parse(base)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("invalid base URL")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/")
	if path.Base(parsed.Path) == "v1" {
		parsed.Path = parsed.Path + "/audio/transcriptions"
	} else {
		parsed.Path = parsed.Path + "/v1/audio/transcriptions"
	}
	return parsed.String(), nil
}

// IsOfficialBaseURL reports whether official OpenAI upload limits should apply.
func IsOfficialBaseURL(base string) bool {
	parsed, err := url.Parse(base)
	if err != nil {
		return false
	}
	return strings.EqualFold(parsed.Host, "api.openai.com")
}

func redactSecret(value, secret string) string {
	if secret == "" {
		return fserrors.Redact(value)
	}
	value = strings.ReplaceAll(value, secret, "[redacted]")
	return fserrors.Redact(value)
}
