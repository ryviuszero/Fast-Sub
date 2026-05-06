package main

import (
	"context"
	"os"

	"fast-sub/internal/cli"
)

var version = "0.1.0-dev"

func main() {
	os.Exit(cli.Run(context.Background(), cli.Config{
		Args:    os.Args[1:],
		Stdout:  os.Stdout,
		Stderr:  os.Stderr,
		Version: version,
	}))
}
