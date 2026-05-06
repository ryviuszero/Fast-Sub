// Package cli implements the fast-sub-go command dispatcher.
package cli

import (
	"context"
	"fmt"
	"strings"

	fserrors "fast-sub/internal/errors"
)

type extractArgs struct {
	jsonOutput  bool
	output      string
	positionals []string
}

func runExtract(ctx context.Context, cfg Config, args []string) int {
	parsed, err := parseExtractArgs(args)
	if err != nil {
		return commandError(cfg, "extract", parsed.jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "extract", err.Error(), "", nil))
	}
	if len(parsed.positionals) != 1 {
		return commandError(cfg, "extract", parsed.jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "extract", "extract requires exactly one input path", "", nil))
	}
	result, appErr := cfg.Runner.ExtractAudio(ctx, parsed.positionals[0], parsed.output, extractTimeout)
	if appErr != nil {
		return commandError(cfg, "extract", parsed.jsonOutput, appErr)
	}
	if parsed.jsonOutput {
		writeSuccessJSON(cfg.Stdout, "extract", result)
		return fserrors.ExitOK
	}
	fmt.Fprintf(cfg.Stdout, "Wrote audio: %s\n", result.OutputPath)
	return fserrors.ExitOK
}

func parseExtractArgs(args []string) (extractArgs, error) {
	parsed := extractArgs{positionals: make([]string, 0, len(args))}
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--json":
			parsed.jsonOutput = true
		case arg == "--output" || arg == "-o":
			if i+1 >= len(args) {
				return parsed, fmt.Errorf("%s requires a value", arg)
			}
			i++
			parsed.output = args[i]
		case strings.HasPrefix(arg, "--output="):
			parsed.output = strings.TrimPrefix(arg, "--output=")
		case strings.HasPrefix(arg, "-"):
			return parsed, fmt.Errorf("unknown flag: %s", arg)
		default:
			parsed.positionals = append(parsed.positionals, arg)
		}
	}
	return parsed, nil
}
