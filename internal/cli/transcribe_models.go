package cli

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/models"
)

func resolveFasterWhisperModelPath(parsed transcribeArgs, command string) (string, *fserrors.AppError) {
	if parsed.modelPath != "" {
		if err := validateModelPath(parsed.modelPath); err != nil {
			return "", fserrors.New(fserrors.CodeMissingModel, command, err.Error(), "Pass --model-path to an existing local model directory.", nil)
		}
		return parsed.modelPath, nil
	}
	if parsed.model == "" {
		envPath := os.Getenv("FAST_SUB_FASTER_WHISPER_MODEL_PATH")
		if envPath == "" {
			envPath = os.Getenv("FAST_SUB_MODEL_PATH")
		}
		if envPath != "" {
			if err := validateModelPath(envPath); err != nil {
				return "", fserrors.New(fserrors.CodeMissingModel, command, err.Error(), "Fix FAST_SUB_FASTER_WHISPER_MODEL_PATH or pass --model-path.", nil)
			}
			return envPath, nil
		}
		return "", fserrors.New(fserrors.CodeMissingModel, command, "--model or --model-path is required for local-faster-whisper.", "Pass --model-path to an existing local model directory or install the requested model id.", nil)
	}
	modelPath, err := resolveInstalledProviderModelPath(parsed.model, "local-faster-whisper")
	if err != nil {
		return "", fserrors.New(fserrors.CodeMissingModel, command, err.Error(), "Install the model or pass --model-path to an existing local model directory.", nil)
	}
	if err := validateModelPath(modelPath); err != nil {
		return "", fserrors.New(fserrors.CodeMissingModel, command, err.Error(), "Repair or reinstall the model, or pass --model-path.", nil)
	}
	return modelPath, nil
}

func resolveWhisperCPPModelPath(parsed transcribeArgs, command string) (string, *fserrors.AppError) {
	if parsed.modelPath != "" {
		modelPath, err := resolveModelFileOrDir(parsed.modelPath)
		if err != nil {
			return "", fserrors.New(fserrors.CodeMissingModel, command, err.Error(), "Pass --model-path to an existing whisper.cpp model file.", nil)
		}
		return modelPath, nil
	}
	if parsed.model == "" {
		envPath := os.Getenv("FAST_SUB_WHISPER_CPP_MODEL_PATH")
		if envPath == "" {
			envPath = os.Getenv("FAST_SUB_MODEL_PATH")
		}
		if envPath != "" {
			modelPath, err := resolveModelFileOrDir(envPath)
			if err != nil {
				return "", fserrors.New(fserrors.CodeMissingModel, command, err.Error(), "Fix FAST_SUB_WHISPER_CPP_MODEL_PATH or pass --model-path.", nil)
			}
			return modelPath, nil
		}
		return "", fserrors.New(fserrors.CodeMissingModel, command, "--model or --model-path is required for local-whisper-cpp.", "Pass --model-path to a whisper.cpp model file or install the requested model id.", nil)
	}
	modelPath, err := resolveInstalledWhisperCPPModelPath(parsed.model)
	if err != nil {
		return "", fserrors.New(fserrors.CodeMissingModel, command, err.Error(), "Install the model or pass --model-path to an existing whisper.cpp model file.", nil)
	}
	return modelPath, nil
}

func resolveInstalledWhisperCPPModelPath(modelID string) (string, error) {
	if manifest, err := models.LoadManifest(""); err == nil {
		if entry, ok := manifest.Get(modelID); ok {
			if !hasString(entry.CompatibleProviders, "local-whisper-cpp") {
				return "", fmt.Errorf("model is not compatible with local-whisper-cpp: %s", modelID)
			}
			status := models.DefaultStore().Verify(entry)
			if !status.Installed {
				return "", fmt.Errorf("model is not installed: %s", modelID)
			}
			return resolveModelFileOrDir(status.Path)
		}
	}
	candidates := []string{}
	if legacyStore := os.Getenv("FAST_SUB_MODEL_STORE"); legacyStore != "" {
		candidates = append(candidates, filepath.Join(legacyStore, modelID))
	}
	candidates = append(candidates,
		filepath.Join(models.DefaultStore().Root, modelID),
		filepath.Join(".fast-sub", "models", modelID),
	)
	for _, candidate := range candidates {
		modelPath, ok := existingModelCandidate(candidate)
		if ok {
			return modelPath, nil
		}
	}
	return "", fmt.Errorf("model is not installed: %s", modelID)
}

func resolveInstalledProviderModelPath(modelID, providerID string) (string, error) {
	manifest, err := models.LoadManifest("")
	if err != nil {
		return "", fmt.Errorf("model manifest could not be loaded: %w", err)
	}
	entry, ok := manifest.Get(modelID)
	if !ok || !hasString(entry.CompatibleProviders, providerID) {
		return "", fmt.Errorf("model is not compatible with %s: %s", providerID, modelID)
	}
	status := models.DefaultStore().Verify(entry)
	if !status.Installed {
		return "", fmt.Errorf("model is not installed: %s", modelID)
	}
	return status.Path, nil
}

func existingModelCandidate(path string) (string, bool) {
	info, err := os.Stat(path)
	if err != nil {
		return "", false
	}
	if !info.IsDir() {
		return path, true
	}
	for _, name := range []string{"model.bin", "ggml-model.bin", "model.gguf"} {
		candidate := filepath.Join(path, name)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, true
		}
	}
	entries, err := os.ReadDir(path)
	if err != nil {
		return "", false
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		lower := strings.ToLower(entry.Name())
		if strings.HasSuffix(lower, ".bin") || strings.HasSuffix(lower, ".gguf") {
			return filepath.Join(path, entry.Name()), true
		}
	}
	return "", false
}

func resolveModelFileOrDir(modelPath string) (string, error) {
	info, err := os.Stat(modelPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("model path does not exist: %s", filepath.Clean(modelPath))
		}
		return "", fmt.Errorf("inspect model path: %w", err)
	}
	if info.IsDir() {
		if candidate, ok := existingModelCandidate(modelPath); ok && candidate != "" {
			return candidate, nil
		}
		return "", fmt.Errorf("model directory contains no .bin or .gguf model file: %s", filepath.Clean(modelPath))
	}
	return modelPath, nil
}

func defaultManagedWhisperCPPBinaryDir() string {
	if legacyStore := os.Getenv("FAST_SUB_MODEL_STORE"); legacyStore != "" {
		return filepath.Join(legacyStore, "whisper-cpp")
	}
	return filepath.Join(models.DefaultStore().Root, "whisper-cpp")
}

func validateModelPath(modelPath string) error {
	info, err := os.Stat(modelPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("model path does not exist: %s", filepath.Clean(modelPath))
		}
		return fmt.Errorf("inspect model path: %w", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("model path is not a directory: %s", filepath.Clean(modelPath))
	}
	return nil
}
