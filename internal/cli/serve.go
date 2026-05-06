package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"fast-sub/internal/daemon"
	fserrors "fast-sub/internal/errors"
)

type serveArgs struct {
	host           string
	port           int
	jsonReady      bool
	maxRunningJobs int
}

func runServe(ctx context.Context, cfg Config, args []string) int {
	parsed, err := parseServeArgs(args)
	if err != nil {
		return commandError(
			cfg,
			"serve",
			true,
			fserrors.New(fserrors.CodeInvalidUsage, "serve", err.Error(), "", nil),
		)
	}
	server, err := daemon.New(daemon.Config{
		Host:           parsed.host,
		Port:           parsed.port,
		MaxRunningJobs: parsed.maxRunningJobs,
		Version:        cfg.Version,
		Providers:      cfg.Providers,
	})
	if err != nil {
		return commandError(cfg, "serve", true, fserrors.New("internal_error", "serve", err.Error(), "", nil))
	}
	ready, err := server.ListenAndServe(ctx)
	if err != nil {
		return commandError(cfg, "serve", true, fserrors.New("internal_error", "serve", err.Error(), "", nil))
	}
	encoder := json.NewEncoder(cfg.Stdout)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(ready); err != nil {
		return commandError(cfg, "serve", true, fserrors.New("internal_error", "serve", err.Error(), "", nil))
	}
	<-ctx.Done()
	return fserrors.ExitOK
}

func parseServeArgs(args []string) (serveArgs, error) {
	parsed := serveArgs{
		host:           "127.0.0.1",
		port:           0,
		maxRunningJobs: 1,
	}
	for i := 0; i < len(args); i++ {
		next, err := parseServeArg(&parsed, args, i)
		if err != nil {
			return parsed, err
		}
		i = next
	}
	return parsed, nil
}

func parseServeArg(parsed *serveArgs, args []string, index int) (int, error) {
	arg := args[index]
	switch {
	case arg == "--json-ready":
		parsed.jsonReady = true
	case arg == "--host":
		value, next, err := requireValue(args, index, arg)
		if err != nil {
			return index, err
		}
		parsed.host = value
		return next, nil
	case strings.HasPrefix(arg, "--host="):
		parsed.host = strings.TrimPrefix(arg, "--host=")
	case arg == "--port":
		value, next, err := requireValue(args, index, arg)
		if err != nil {
			return index, err
		}
		if err := parseNonNegativeInt(value, &parsed.port, "--port"); err != nil {
			return index, err
		}
		return next, nil
	case strings.HasPrefix(arg, "--port="):
		if err := parseNonNegativeInt(strings.TrimPrefix(arg, "--port="), &parsed.port, "--port"); err != nil {
			return index, err
		}
	case arg == "--max-running-jobs":
		value, next, err := requireValue(args, index, arg)
		if err != nil {
			return index, err
		}
		if err := parsePositiveInt(value, &parsed.maxRunningJobs, "--max-running-jobs"); err != nil {
			return index, err
		}
		return next, nil
	case strings.HasPrefix(arg, "--max-running-jobs="):
		value := strings.TrimPrefix(arg, "--max-running-jobs=")
		if err := parsePositiveInt(value, &parsed.maxRunningJobs, "--max-running-jobs"); err != nil {
			return index, err
		}
	default:
		return index, fmt.Errorf("unknown flag: %s", arg)
	}
	return index, nil
}

func parseNonNegativeInt(value string, target *int, name string) error {
	if _, err := fmt.Sscanf(value, "%d", target); err != nil || *target < 0 {
		return fmt.Errorf("%s must be a non-negative integer", name)
	}
	return nil
}

func parsePositiveInt(value string, target *int, name string) error {
	if _, err := fmt.Sscanf(value, "%d", target); err != nil || *target <= 0 {
		return fmt.Errorf("%s must be a positive integer", name)
	}
	return nil
}

func printServeHelp(stdout io.Writer) {
	fmt.Fprintln(stdout, "  serve [--host 127.0.0.1] [--port 0] [--json-ready] [--max-running-jobs 1]")
}
