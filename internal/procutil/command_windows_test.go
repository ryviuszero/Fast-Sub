//go:build windows

package procutil

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestRunCancelsWholeProcessTreeOnWindows(t *testing.T) {
	worker := fakeTreeWorkerBinary(t)
	dir := t.TempDir()
	childPIDPath := filepath.Join(dir, "child.pid")

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	result := Run(ctx, worker, []string{"--child-pid", childPIDPath}, nil, 4096)
	if result.Err == nil {
		t.Fatal("expected cancellation error")
	}

	var childPIDRaw []byte
	var err error
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		childPIDRaw, err = os.ReadFile(childPIDPath)
		if err == nil {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if err != nil {
		t.Fatalf("read child pid: %v", err)
	}
	childPID := strings.TrimSpace(string(childPIDRaw))
	if childPID == "" {
		t.Fatal("expected child pid to be recorded")
	}

	deadline = time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		running, err := isWindowsPIDRunning(childPID)
		if err != nil {
			t.Fatalf("check child process status: %v", err)
		}
		if !running {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}

	t.Fatalf("child pid %s was still running after cancellation", childPID)
}

func fakeTreeWorkerBinary(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	exe := "fake-tree-worker"
	if runtime.GOOS == "windows" {
		exe += ".exe"
	}
	sourcePath := filepath.Join(dir, "main.go")
	source := `package main

import (
	"flag"
	"os"
	"os/exec"
	"strconv"
	"time"
)

func main() {
	childPIDPath := flag.String("child-pid", "", "path to write child pid")
	childMode := flag.Bool("child", false, "run child process")
	flag.Parse()

	if *childMode {
		time.Sleep(30 * time.Second)
		return
	}

	cmd := exec.Command(os.Args[0], "--child")
	if err := cmd.Start(); err != nil {
		os.Exit(11)
	}
	if *childPIDPath != "" {
		_ = os.WriteFile(*childPIDPath, []byte(strconv.Itoa(cmd.Process.Pid)), 0600)
	}
	time.Sleep(30 * time.Second)
}
`
	if err := os.WriteFile(sourcePath, []byte(source), 0o600); err != nil {
		t.Fatal(err)
	}

	outputPath := filepath.Join(dir, exe)
	cmd := exec.Command("go", "build", "-o", outputPath, sourcePath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("build fake worker: %v\n%s", err, out)
	}
	return outputPath
}

func isWindowsPIDRunning(pid string) (bool, error) {
	cmd := exec.Command("tasklist", "/FI", fmt.Sprintf("PID eq %s", pid), "/FO", "CSV", "/NH")
	out, err := cmd.CombinedOutput()
	text := strings.TrimSpace(string(out))
	if text == "" {
		return false, nil
	}
	if strings.Contains(text, "INFO: No tasks are running") {
		return false, nil
	}
	if err != nil && !strings.Contains(text, "\"") {
		return false, nil
	}
	return strings.Contains(text, "\""), nil
}
