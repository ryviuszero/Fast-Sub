// Package ffmpeg runs ffmpeg and ffprobe through exec.CommandContext.
package ffmpeg

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	fserrors "fast-sub/internal/errors"
)

const defaultTailLimit = 8192

// BinaryStatus records local binary availability and version first line.
type BinaryStatus struct {
	Available bool   `json:"available"`
	Path      string `json:"path,omitempty"`
	Version   string `json:"version,omitempty"`
}

// Runner invokes ffmpeg and ffprobe binaries.
type Runner struct {
	FFmpegName  string
	FFprobeName string
	TailLimit   int
}

// NewRunner returns a runner using binaries from PATH.
func NewRunner() Runner {
	return Runner{FFmpegName: "ffmpeg", FFprobeName: "ffprobe", TailLimit: defaultTailLimit}
}

func (r Runner) tailLimit() int {
	if r.TailLimit <= 0 {
		return defaultTailLimit
	}
	return r.TailLimit
}

// LookPath resolves a media binary.
func LookPath(name string) (string, error) {
	if os.Getenv("FAST_SUB_PACKAGED_RUNTIME_ONLY") == "1" && !strings.ContainsAny(name, `/\`) && !filepath.IsAbs(name) {
		if path, ok := packagedMediaBinary(name); ok {
			return path, nil
		}
		return "", exec.ErrNotFound
	}
	return exec.LookPath(name)
}

func packagedMediaBinary(name string) (string, bool) {
	binDir := os.Getenv("FAST_SUB_FFMPEG_BIN_DIR")
	if strings.TrimSpace(binDir) == "" {
		return "", false
	}
	base := filepath.Base(name)
	if runtime.GOOS == "windows" && !strings.HasSuffix(strings.ToLower(base), ".exe") {
		base += ".exe"
	}
	switch strings.ToLower(strings.TrimSuffix(base, ".exe")) {
	case "ffmpeg", "ffprobe":
	default:
		return "", false
	}
	path := filepath.Join(binDir, base)
	if info, err := os.Stat(path); err == nil && !info.IsDir() {
		return path, true
	}
	return "", false
}

// CheckBinary returns whether a binary is available and its version first line.
func CheckBinary(ctx context.Context, name string, timeout time.Duration) BinaryStatus {
	path, err := LookPath(name)
	if err != nil {
		return BinaryStatus{Available: false}
	}
	checkCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	completed := runCommand(checkCtx, path, []string{"-version"}, defaultTailLimit)
	status := BinaryStatus{Available: true, Path: path}
	if completed.Err == nil && completed.ExitCode == 0 {
		status.Version = firstLine(completed.Stdout)
	}
	return status
}

type completedProcess struct {
	Stdout   string
	Stderr   string
	ExitCode int
	Err      error
}

func runCommand(ctx context.Context, name string, args []string, tailLimit int) completedProcess {
	cmd := exec.CommandContext(ctx, name, args...)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	exitCode := 0
	if err != nil {
		exitCode = 1
		var exitErr *exec.ExitError
		if errors.As(err, &exitErr) {
			exitCode = exitErr.ExitCode()
		}
	}
	if ctx.Err() != nil {
		err = ctx.Err()
	}
	return completedProcess{
		Stdout:   tail(stdout.String(), tailLimit),
		Stderr:   tail(stderr.String(), tailLimit),
		ExitCode: exitCode,
		Err:      err,
	}
}

func processMessage(completed completedProcess) string {
	message := strings.TrimSpace(completed.Stderr)
	if message == "" {
		message = strings.TrimSpace(completed.Stdout)
	}
	if message == "" {
		message = fmt.Sprintf("process exited with code %d", completed.ExitCode)
	}
	return fserrors.Redact(message)
}

func tail(value string, limit int) string {
	if limit <= 0 || len(value) <= limit {
		return value
	}
	return value[len(value)-limit:]
}

func firstLine(value string) string {
	lines := strings.Split(strings.TrimSpace(value), "\n")
	if len(lines) == 0 {
		return ""
	}
	return strings.TrimSpace(lines[0])
}
