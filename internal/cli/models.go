// Package cli implements the fast-sub-go command dispatcher.
package cli

import (
	"context"
	"fmt"
	"io"
	"strings"

	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/models"
)

func runModels(ctx context.Context, cfg Config, args []string) int {
	if len(args) == 0 {
		return commandError(cfg, "models", false, fserrors.New(fserrors.CodeInvalidUsage, "models", "models requires a subcommand", "Run `fast-sub-go models list --json`.", nil))
	}
	switch args[0] {
	case "list":
		return runModelsList(cfg, args[1:])
	case "verify":
		return runModelsVerify(cfg, args[1:])
	case "install":
		return runModelsInstall(ctx, cfg, args[1:])
	default:
		jsonOutput, _, _ := parseJSONFlag(args[1:])
		return commandError(cfg, "models "+args[0], jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "models", "unknown models subcommand: "+args[0], "Use list, verify, or install.", nil))
	}
}

func runModelsList(cfg Config, args []string) int {
	jsonOutput, positionals, err := parseJSONFlag(args)
	if err != nil {
		return commandError(cfg, "models list", jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "models list", err.Error(), "", nil))
	}
	if len(positionals) != 0 {
		return commandError(cfg, "models list", jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "models list", "models list does not accept positional arguments", "", nil))
	}
	manifest, appErr := loadModelsManifest("models list")
	if appErr != nil {
		return commandError(cfg, "models list", jsonOutput, appErr)
	}
	rows := models.DefaultStore().List(manifest)
	if jsonOutput {
		writeSuccessJSON(cfg.Stdout, "models list", map[string]any{"models": rows})
		return fserrors.ExitOK
	}
	writeModelsListTable(cfg.Stdout, rows)
	return fserrors.ExitOK
}

func writeModelsListTable(stdout io.Writer, rows []models.ListRow) {
	idWidth := len("MODEL")
	typeWidth := len("TYPE")
	statusWidth := len("STATUS")
	for _, row := range rows {
		idWidth = maxInt(idWidth, len(row.ID))
		typeWidth = maxInt(typeWidth, len(row.Type))
		statusWidth = maxInt(statusWidth, len(row.Status))
	}
	fmt.Fprintf(stdout, "%-*s  %-*s  %-*s  %s\n", idWidth, "MODEL", typeWidth, "TYPE", statusWidth, "STATUS", "PATH")
	for _, row := range rows {
		fmt.Fprintf(stdout, "%-*s  %-*s  %-*s  %s\n", idWidth, row.ID, typeWidth, row.Type, statusWidth, row.Status, row.Path)
	}
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func runModelsVerify(cfg Config, args []string) int {
	jsonOutput, positionals, err := parseJSONFlag(args)
	if err != nil {
		return commandError(cfg, "models verify", jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "models verify", err.Error(), "", nil))
	}
	if len(positionals) != 1 {
		return commandError(cfg, "models verify", jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "models verify", "models verify requires exactly one model id", "", nil))
	}
	manifest, appErr := loadModelsManifest("models verify")
	if appErr != nil {
		return commandError(cfg, "models verify", jsonOutput, appErr)
	}
	entry, ok := manifest.Get(positionals[0])
	if !ok {
		return commandError(cfg, "models verify", jsonOutput, unknownModelError("models verify", manifest, positionals[0]))
	}
	status := models.DefaultStore().Verify(entry)
	if jsonOutput {
		if status.Installed {
			writeSuccessJSON(cfg.Stdout, "models verify", status)
			return fserrors.ExitOK
		}
		return writeErrorJSON(cfg.Stdout, "models verify", models.ClassifyStatusError("models verify", status))
	}
	if status.Installed {
		fmt.Fprintf(cfg.Stdout, "%s: installed (%s)\n", status.ID, status.Path)
		return fserrors.ExitOK
	}
	return commandError(cfg, "models verify", false, models.ClassifyStatusError("models verify", status))
}

type modelsInstallArgs struct {
	jsonOutput  bool
	dryRun      bool
	positionals []string
}

func runModelsInstall(ctx context.Context, cfg Config, args []string) int {
	parsed, err := parseModelsInstallArgs(args)
	if err != nil {
		return commandError(cfg, "models install", parsed.jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "models install", err.Error(), "", nil))
	}
	if len(parsed.positionals) != 1 {
		return commandError(cfg, "models install", parsed.jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "models install", "models install requires exactly one model id", "", nil))
	}
	manifest, appErr := loadModelsManifest("models install")
	if appErr != nil {
		return commandError(cfg, "models install", parsed.jsonOutput, appErr)
	}
	entry, ok := manifest.Get(parsed.positionals[0])
	if !ok {
		return commandError(cfg, "models install", parsed.jsonOutput, unknownModelError("models install", manifest, parsed.positionals[0]))
	}
	opts := models.InstallOptions{DryRun: parsed.dryRun}
	if !parsed.jsonOutput && !parsed.dryRun {
		opts.Progress = newInstallProgressWriter(cfg.Stderr).Update
	}
	result, installErr := models.DefaultStore().Install(ctx, entry, opts)
	if installErr != nil {
		return commandError(cfg, "models install", parsed.jsonOutput, installErr)
	}
	if parsed.jsonOutput {
		writeSuccessJSON(cfg.Stdout, "models install", result)
		return fserrors.ExitOK
	}
	if parsed.dryRun {
		fmt.Fprintf(cfg.Stdout, "Would install %s to %s (%d bytes)\n", result.ModelID, result.Plan.TargetDir, result.Plan.TotalSizeBytes)
		return fserrors.ExitOK
	}
	fmt.Fprintf(cfg.Stdout, "Installed %s: %s\n", result.ModelID, result.Status.Path)
	return fserrors.ExitOK
}

func parseModelsInstallArgs(args []string) (modelsInstallArgs, error) {
	parsed := modelsInstallArgs{positionals: make([]string, 0, len(args))}
	for _, arg := range args {
		switch arg {
		case "--json":
			parsed.jsonOutput = true
		case "--dry-run":
			parsed.dryRun = true
		default:
			if strings.HasPrefix(arg, "-") {
				return parsed, fmt.Errorf("unknown flag: %s", arg)
			}
			parsed.positionals = append(parsed.positionals, arg)
		}
	}
	return parsed, nil
}

func loadModelsManifest(command string) (models.Manifest, *fserrors.AppError) {
	manifest, err := models.LoadManifest("")
	if err != nil {
		return models.Manifest{}, fserrors.New(fserrors.CodeInvalidInput, command, err.Error(), "Check FAST_SUB_GO_MODEL_MANIFEST or use the built-in manifest.", nil)
	}
	return manifest, nil
}

func unknownModelError(command string, manifest models.Manifest, id string) *fserrors.AppError {
	ids := make([]string, 0, len(manifest.Models))
	for _, entry := range manifest.Models {
		ids = append(ids, entry.ID)
	}
	return fserrors.New(fserrors.CodeMissingModel, command, "unknown model id: "+id, "Choose one of: "+strings.Join(ids, ", "), map[string]any{"model_id": id})
}

type installProgressWriter struct {
	stderr      io.Writer
	lastPercent map[string]int
	currentFile string
}

func newInstallProgressWriter(stderr io.Writer) *installProgressWriter {
	return &installProgressWriter{
		stderr:      stderr,
		lastPercent: map[string]int{},
	}
}

func (w *installProgressWriter) Update(progress models.Progress) {
	if w == nil || w.stderr == nil {
		return
	}
	if progress.Stage == "verified" {
		fmt.Fprintf(w.stderr, "\r%s\rVerified %s (%d/%d)\n", clearLine(), progress.FilePath, progress.FileIndex, progress.FileCount)
		w.currentFile = ""
		return
	}
	percent := progressPercent(progress.FileBytes, progress.FileTotal)
	if last, ok := w.lastPercent[progress.FilePath]; ok && percent >= 0 && percent < 100 && percent/5 == last/5 {
		return
	}
	w.lastPercent[progress.FilePath] = percent
	if w.currentFile != "" && w.currentFile != progress.FilePath {
		fmt.Fprint(w.stderr, "\n")
	}
	w.currentFile = progress.FilePath
	if percent >= 0 {
		fmt.Fprintf(
			w.stderr,
			"\r%s\rDownloading %s (%d/%d): %d%% (%s/%s)",
			clearLine(),
			progress.FilePath,
			progress.FileIndex,
			progress.FileCount,
			percent,
			formatBytes(progress.FileBytes),
			formatBytes(progress.FileTotal),
		)
		return
	}
	fmt.Fprintf(
		w.stderr,
		"\r%s\rDownloading %s (%d/%d): %s",
		clearLine(),
		progress.FilePath,
		progress.FileIndex,
		progress.FileCount,
		formatBytes(progress.FileBytes),
	)
}

func clearLine() string {
	return strings.Repeat(" ", 120)
}

func progressPercent(done, total int64) int {
	if total <= 0 {
		return -1
	}
	if done >= total {
		return 100
	}
	return int(done * 100 / total)
}

func formatBytes(value int64) string {
	const unit = 1024
	if value < unit {
		return fmt.Sprintf("%d B", value)
	}
	units := []string{"KiB", "MiB", "GiB", "TiB"}
	size := float64(value)
	for _, suffix := range units {
		size /= unit
		if size < unit {
			return fmt.Sprintf("%.1f %s", size, suffix)
		}
	}
	return fmt.Sprintf("%.1f PiB", size/unit)
}
