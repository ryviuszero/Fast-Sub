// Package cli implements the fast-sub-go command dispatcher.
package cli

import (
	"context"
	"fmt"

	fserrors "fast-sub/internal/errors"
)

func runProbe(ctx context.Context, cfg Config, args []string) int {
	jsonOutput, positionals, err := parseJSONFlag(args)
	if err != nil {
		return commandError(cfg, "probe", jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "probe", err.Error(), "", nil))
	}
	if len(positionals) != 1 {
		return commandError(cfg, "probe", jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "probe", "probe requires exactly one input path", "", nil))
	}
	metadata, appErr := cfg.Runner.Probe(ctx, positionals[0], probeTimeout)
	if appErr != nil {
		return commandError(cfg, "probe", jsonOutput, appErr)
	}
	if jsonOutput {
		writeSuccessJSON(cfg.Stdout, "probe", metadata)
		return fserrors.ExitOK
	}
	fmt.Fprintf(cfg.Stdout, "path: %s\n", metadata.Path)
	if metadata.DurationSec != nil {
		fmt.Fprintf(cfg.Stdout, "duration_sec: %v\n", *metadata.DurationSec)
	} else {
		fmt.Fprintln(cfg.Stdout, "duration_sec: ")
	}
	fmt.Fprintf(cfg.Stdout, "container: %v\n", metadata.Container)
	fmt.Fprintf(cfg.Stdout, "audio_streams: %d\n", len(metadata.AudioStreams))
	fmt.Fprintf(cfg.Stdout, "video_streams: %d\n", len(metadata.VideoStreams))
	return fserrors.ExitOK
}
