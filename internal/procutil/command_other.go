//go:build !windows

package procutil

import "os/exec"

func configureCommand(cmd *exec.Cmd) {}

func manageStartedCommand(cmd *exec.Cmd) (func(), error) {
	return func() {}, nil
}

func terminateProcessTree(cmd *exec.Cmd) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	return cmd.Process.Kill()
}
