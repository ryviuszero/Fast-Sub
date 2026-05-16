// Package downloads implements Fast Sub's native HTTP download backend.
package downloads

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

const metadataSuffix = ".meta.json"

// Backend downloads one URL to a target .part file.
type Backend interface {
	Download(ctx context.Context, request Request) (Result, error)
}

// Request describes a resumable HTTP file download.
type Request struct {
	URL      string
	PartPath string
	Client   *http.Client
	Label    string
	Progress ProgressFunc
}

// ProgressFunc receives byte progress for one download.
type ProgressFunc func(label string, downloaded, total int64)

// Result captures download behavior needed by model installation reports.
type Result struct {
	URL           string `json:"url"`
	Path          string `json:"path"`
	BytesWritten  int64  `json:"bytes_written"`
	Resumed       bool   `json:"resumed"`
	Restarted     bool   `json:"restarted"`
	StatusCode    int    `json:"status_code"`
	ETag          string `json:"etag,omitempty"`
	LastModified  string `json:"last_modified,omitempty"`
	AcceptRanges  string `json:"accept_ranges,omitempty"`
	ContentLength int64  `json:"content_length,omitempty"`
}

// HTTPBackend is the default native-http downloader.
type HTTPBackend struct {
	Client *http.Client
}

type metadata struct {
	URL          string `json:"url"`
	ETag         string `json:"etag,omitempty"`
	LastModified string `json:"last_modified,omitempty"`
}

// Download retrieves request.URL into request.PartPath, resuming when safe.
func (b HTTPBackend) Download(ctx context.Context, request Request) (Result, error) {
	client := request.Client
	if client == nil {
		client = b.Client
	}
	if client == nil {
		client = defaultHTTPClient()
	}
	if request.URL == "" {
		return Result{}, fmt.Errorf("download URL is empty")
	}
	if request.PartPath == "" {
		return Result{}, fmt.Errorf("part path is empty")
	}
	if err := os.MkdirAll(filepath.Dir(request.PartPath), 0o700); err != nil {
		return Result{}, fmt.Errorf("create part directory: %w", err)
	}

	restarted := false
	resumeFrom := fileSize(request.PartPath)
	meta, metaErr := readMetadata(request.PartPath)
	if resumeFrom > 0 && metaErr != nil {
		if err := removePartAndMeta(request.PartPath); err != nil {
			return Result{}, err
		}
		resumeFrom = 0
		restarted = true
	}
	if resumeFrom > 0 && shouldRestartForMetadata(ctx, client, request.URL, meta) {
		if err := removePartAndMeta(request.PartPath); err != nil {
			return Result{}, err
		}
		resumeFrom = 0
		restarted = true
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, request.URL, nil)
	if err != nil {
		return Result{}, fmt.Errorf("invalid download URL: %s", RedactURL(request.URL))
	}
	if resumeFrom > 0 {
		req.Header.Set("Range", fmt.Sprintf("bytes=%d-", resumeFrom))
	}
	resp, err := client.Do(req)
	if err != nil {
		return Result{}, fmt.Errorf("download %s failed: request failed", RedactURL(request.URL))
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Result{}, fmt.Errorf("download %s returned HTTP %d", RedactURL(request.URL), resp.StatusCode)
	}

	appendMode := resumeFrom > 0 && resp.StatusCode == http.StatusPartialContent
	if resumeFrom > 0 && !appendMode {
		if err := removePartAndMeta(request.PartPath); err != nil {
			return Result{}, err
		}
		resumeFrom = 0
		restarted = true
	}
	flags := os.O_CREATE | os.O_WRONLY
	if appendMode {
		flags |= os.O_APPEND
	} else {
		flags |= os.O_TRUNC
	}
	file, err := os.OpenFile(request.PartPath, flags, 0o600)
	if err != nil {
		return Result{}, fmt.Errorf("open part file: %w", err)
	}
	startFrom := resumeFrom
	currentDownloaded := resumeFrom
	total := responseTotal(resp.Header.Get("Content-Length"), startFrom, appendMode)
	label := request.Label
	if label == "" {
		label = filepath.Base(request.PartPath)
	}
	emitProgress(request.Progress, label, currentDownloaded, total)
	written, copyErr := copyWithProgress(file, resp.Body, func(delta int64) {
		currentDownloaded += delta
		emitProgress(request.Progress, label, currentDownloaded, total)
	})
	closeErr := file.Close()
	if copyErr != nil {
		return Result{}, fmt.Errorf("write part file: %w", copyErr)
	}
	if closeErr != nil {
		return Result{}, fmt.Errorf("close part file: %w", closeErr)
	}
	newMeta := metadata{
		URL:          request.URL,
		ETag:         resp.Header.Get("ETag"),
		LastModified: resp.Header.Get("Last-Modified"),
	}
	_ = writeMetadata(request.PartPath, newMeta)
	return Result{
		URL:           RedactURL(request.URL),
		Path:          request.PartPath,
		BytesWritten:  startFrom + written,
		Resumed:       appendMode,
		Restarted:     restarted,
		StatusCode:    resp.StatusCode,
		ETag:          newMeta.ETag,
		LastModified:  newMeta.LastModified,
		AcceptRanges:  resp.Header.Get("Accept-Ranges"),
		ContentLength: contentLength(resp.Header.Get("Content-Length")),
	}, nil
}

func defaultHTTPClient() *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			Proxy: http.ProxyFromEnvironment,
			DialContext: (&net.Dialer{
				Timeout:   30 * time.Second,
				KeepAlive: 30 * time.Second,
			}).DialContext,
			ForceAttemptHTTP2:     true,
			MaxIdleConns:          10,
			IdleConnTimeout:       90 * time.Second,
			TLSHandshakeTimeout:   30 * time.Second,
			ResponseHeaderTimeout: 60 * time.Second,
			ExpectContinueTimeout: 1 * time.Second,
		},
	}
}

// Sha256File returns the lowercase SHA-256 digest for a file.
func Sha256File(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	digest := sha256.New()
	if _, err := io.Copy(digest, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(digest.Sum(nil)), nil
}

func shouldRestartForMetadata(ctx context.Context, client *http.Client, url string, old metadata) bool {
	if old.URL != "" && old.URL != url {
		return true
	}
	if old.ETag == "" && old.LastModified == "" {
		return true
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, url, nil)
	if err != nil {
		return true
	}
	resp, err := client.Do(req)
	if err != nil {
		return true
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return true
	}
	etag := resp.Header.Get("ETag")
	lastModified := resp.Header.Get("Last-Modified")
	if old.ETag != "" && etag == "" {
		return true
	}
	if old.LastModified != "" && lastModified == "" {
		return true
	}
	if old.ETag != "" && etag != "" && old.ETag != etag {
		return true
	}
	if old.LastModified != "" && lastModified != "" && old.LastModified != lastModified {
		return true
	}
	return false
}

// RedactURL removes credentials and query strings from URLs before error output.
func RedactURL(value string) string {
	parsed, err := url.Parse(value)
	if err != nil {
		return "[redacted-url]"
	}
	parsed.User = nil
	parsed.RawQuery = ""
	parsed.ForceQuery = false
	parsed.Fragment = ""
	return parsed.String()
}

func readMetadata(partPath string) (metadata, error) {
	var meta metadata
	raw, err := os.ReadFile(partPath + metadataSuffix)
	if err != nil {
		return meta, err
	}
	if err := json.Unmarshal(raw, &meta); err != nil {
		return metadata{}, err
	}
	return meta, nil
}

func writeMetadata(partPath string, meta metadata) error {
	raw, err := json.Marshal(meta)
	if err != nil {
		return err
	}
	return os.WriteFile(partPath+metadataSuffix, raw, 0o600)
}

func removePartAndMeta(partPath string) error {
	if err := os.Remove(partPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove partial download: %w", err)
	}
	if err := os.Remove(partPath + metadataSuffix); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove partial metadata: %w", err)
	}
	return nil
}

func fileSize(path string) int64 {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return 0
	}
	return info.Size()
}

func contentLength(value string) int64 {
	if value == "" {
		return 0
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0
	}
	return parsed
}

func responseTotal(contentLengthHeader string, resumeFrom int64, appendMode bool) int64 {
	length := contentLength(contentLengthHeader)
	if length <= 0 {
		return 0
	}
	if appendMode {
		return resumeFrom + length
	}
	return length
}

func copyWithProgress(dst io.Writer, src io.Reader, progress func(delta int64)) (int64, error) {
	buffer := make([]byte, 64*1024)
	var written int64
	for {
		nr, readErr := src.Read(buffer)
		if nr > 0 {
			nw, writeErr := dst.Write(buffer[:nr])
			if nw > 0 {
				written += int64(nw)
				progress(int64(nw))
			}
			if writeErr != nil {
				return written, writeErr
			}
			if nr != nw {
				return written, io.ErrShortWrite
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				return written, nil
			}
			return written, readErr
		}
	}
}

func emitProgress(progress ProgressFunc, label string, downloaded, total int64) {
	if progress != nil {
		progress(label, downloaded, total)
	}
}
