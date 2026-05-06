// Package paths contains Windows-friendly path validation helpers.
package paths

import (
	"fmt"
	"os"
	"path/filepath"
)

// ValidateInputFile verifies that a path exists and is a regular file.
func ValidateInputFile(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("input file does not exist: %s", filepath.Clean(path))
		}
		return fmt.Errorf("inspect input file: %w", err)
	}
	if info.IsDir() {
		return fmt.Errorf("input path is not a file: %s", filepath.Clean(path))
	}
	return nil
}

// ValidateOutputPath verifies that an explicit output path can be written.
func ValidateOutputPath(path string) error {
	if path == "" {
		return fmt.Errorf("--output is required")
	}
	if _, err := os.Stat(path); err == nil {
		return fmt.Errorf("output file already exists: %s", filepath.Clean(path))
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("inspect output file: %w", err)
	}
	dir := filepath.Dir(path)
	if dir == "." || dir == "" {
		return nil
	}
	info, err := os.Stat(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("output directory does not exist: %s", filepath.Clean(dir))
		}
		return fmt.Errorf("inspect output directory: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("output parent is not a directory: %s", filepath.Clean(dir))
	}
	return nil
}

// TempOutputPath returns a temporary file path in the final output directory.
func TempOutputPath(output string) string {
	dir := filepath.Dir(output)
	base := filepath.Base(output)
	return filepath.Join(dir, fmt.Sprintf(".%s.fast-sub-tmp-%d", base, os.Getpid()))
}
