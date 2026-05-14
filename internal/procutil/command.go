package procutil

import (
	"bytes"
	"context"
	"errors"
	"os/exec"
	"time"
)

const killWaitTimeout = 5 * time.Second

// CompletedProcess captures the tail of a completed subprocess invocation.
type CompletedProcess struct {
	Stdout   string
	Stderr   string
	ExitCode int
	Err      error
}

// Run starts a subprocess, captures stdout/stderr, and tears down the whole
// process tree when the context is canceled.
func Run(ctx context.Context, name string, args []string, env []string, tailLimit int) CompletedProcess {
	cmd := exec.Command(name, args...)
	cmd.Env = env
	configureCommand(cmd)

	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Start(); err != nil {
		return CompletedProcess{
			Stdout:   tail(stdout.String(), tailLimit),
			Stderr:   tail(stderr.String(), tailLimit),
			ExitCode: exitCode(err),
			Err:      err,
		}
	}
	releaseManagedTree, manageErr := manageStartedCommand(cmd)
	if manageErr != nil {
		releaseManagedTree = func() {}
	}
	defer releaseManagedTree()

	done := make(chan error, 1)
	go func() {
		done <- cmd.Wait()
	}()

	var err error
	select {
	case err = <-done:
	case <-ctx.Done():
		releaseManagedTree()
		_ = terminateProcessTree(cmd)
		select {
		case <-done:
		case <-time.After(killWaitTimeout):
			if cmd.Process != nil {
				_ = cmd.Process.Kill()
			}
			<-done
		}
		err = ctx.Err()
	}

	return CompletedProcess{
		Stdout:   tail(stdout.String(), tailLimit),
		Stderr:   tail(stderr.String(), tailLimit),
		ExitCode: exitCode(err),
		Err:      err,
	}
}

func exitCode(err error) int {
	if err == nil {
		return 0
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode()
	}
	return 1
}

func tail(value string, limit int) string {
	if limit <= 0 || len(value) <= limit {
		return value
	}
	return value[len(value)-limit:]
}
