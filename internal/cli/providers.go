// Package cli implements the fast-sub-go command dispatcher.
package cli

import (
	"context"
	"fmt"

	fserrors "fast-sub/internal/errors"
	"fast-sub/internal/providers"
)

func runProviders(ctx context.Context, cfg Config, args []string) int {
	if len(args) == 0 {
		return commandError(cfg, "providers", false, fserrors.New(fserrors.CodeInvalidUsage, "providers", "providers requires a subcommand", "Run `fast-sub-go providers list --json` or `fast-sub-go providers test <id> --json`.", nil))
	}
	switch args[0] {
	case "list":
		return runProvidersList(ctx, cfg, args[1:])
	case "test":
		return runProvidersTest(ctx, cfg, args[1:])
	default:
		jsonOutput, _, _ := parseJSONFlag(args[1:])
		return commandError(cfg, "providers", jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "providers", "unknown providers subcommand: "+args[0], "Run `fast-sub-go providers list --json` or `fast-sub-go providers test <id> --json`.", nil))
	}
}

func runProvidersList(ctx context.Context, cfg Config, args []string) int {
	jsonOutput, positionals, err := parseJSONFlag(args)
	if err != nil {
		return commandError(cfg, "providers list", jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "providers list", err.Error(), "", nil))
	}
	if len(positionals) != 0 {
		return commandError(cfg, "providers list", jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "providers list", "providers list does not accept positional arguments", "", nil))
	}
	result := providers.List(ctx, cfg.Providers)
	if jsonOutput {
		writeSuccessJSON(cfg.Stdout, "providers list", map[string]any{"providers": result})
		return fserrors.ExitOK
	}
	for _, provider := range result {
		fmt.Fprintf(cfg.Stdout, "%s\t%s\t%s\t%s\n", provider.ID, provider.Type, provider.Location, provider.Status)
	}
	return fserrors.ExitOK
}

func runProvidersTest(ctx context.Context, cfg Config, args []string) int {
	jsonOutput, positionals, err := parseJSONFlag(args)
	if err != nil {
		return commandError(cfg, "providers test", jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "providers test", err.Error(), "", nil))
	}
	if len(positionals) != 1 {
		return commandError(cfg, "providers test", jsonOutput, fserrors.New(fserrors.CodeInvalidUsage, "providers test", "providers test requires exactly one provider id", "", nil))
	}
	result, ok := providers.Test(ctx, cfg.Providers, positionals[0])
	if !ok {
		return commandError(cfg, "providers test", jsonOutput, fserrors.New(fserrors.CodeInvalidInput, "providers test", "unknown provider: "+positionals[0], "Run `fast-sub-go providers list --json` to see supported providers.", map[string]any{"provider_id": positionals[0]}))
	}
	if result.Available {
		if jsonOutput {
			writeSuccessJSON(cfg.Stdout, "providers test", result)
			return fserrors.ExitOK
		}
		fmt.Fprintf(cfg.Stdout, "%s: %s (%s)\n", result.ProviderID, result.Status, result.CheckMode)
		return fserrors.ExitOK
	}
	return commandError(cfg, "providers test", jsonOutput, providerUnavailableError(result))
}

func providerUnavailableError(result providers.CheckResult) *fserrors.AppError {
	code := fserrors.CodeProviderUnavailable
	switch result.Status {
	case providers.StatusMissingDependency:
		code = fserrors.CodeMissingDependency
	case providers.StatusMissingModel:
		code = fserrors.CodeMissingModel
	case providers.StatusMissingAPIKey:
		code = fserrors.CodeMissingAPIKey
	case providers.StatusInvalidConfig:
		code = fserrors.CodeInvalidInput
	case providers.StatusNotImplemented:
		code = fserrors.CodeNotImplemented
	}
	return fserrors.New(
		code,
		"providers test",
		fmt.Sprintf("provider %s is %s", result.ProviderID, result.Status),
		result.ActionHint,
		map[string]any{
			"provider_id": result.ProviderID,
			"status":      result.Status,
			"check_mode":  result.CheckMode,
			"checks":      result.Checks,
			"warnings":    result.Warnings,
			"details":     result.Details,
		},
	)
}
