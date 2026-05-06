package cli

import (
	"fmt"
	"strings"
)

type transcribeArgs struct {
	jsonOutput        bool
	output            string
	modelPath         string
	model             string
	provider          string
	whisperCommand    string
	language          string
	device            string
	computeType       string
	batchSize         int
	workerCommand     string
	workerArgs        []string
	wordTimestamps    string
	wordTimestampsSet bool
	apiKeyEnv         string
	baseURL           string
	apiUploadFormat   string
	configPath        string
	keepTemp          bool
	yes               bool
	positionals       []string
}

func parseTranscribeArgs(args []string, command string) (transcribeArgs, error) {
	parsed := transcribeArgs{
		language:       "auto",
		device:         "auto",
		computeType:    "auto",
		batchSize:      8,
		wordTimestamps: "off",
		positionals:    make([]string, 0, len(args)),
	}
	for _, arg := range args {
		if arg == "--json" {
			parsed.jsonOutput = true
			break
		}
	}
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch {
		case arg == "--json":
			parsed.jsonOutput = true
		case arg == "--keep-temp":
			parsed.keepTemp = true
		case arg == "--yes":
			parsed.yes = true
		case arg == "--output" || arg == "-o":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.output = value
			i = next
		case strings.HasPrefix(arg, "--output="):
			parsed.output = strings.TrimPrefix(arg, "--output=")
		case arg == "--model-path":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.modelPath = value
			i = next
		case strings.HasPrefix(arg, "--model-path="):
			parsed.modelPath = strings.TrimPrefix(arg, "--model-path=")
		case arg == "--model":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.model = value
			i = next
		case strings.HasPrefix(arg, "--model="):
			parsed.model = strings.TrimPrefix(arg, "--model=")
		case arg == "--provider":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.provider = value
			i = next
		case strings.HasPrefix(arg, "--provider="):
			parsed.provider = strings.TrimPrefix(arg, "--provider=")
		case arg == "--whisper-cpp-command":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.whisperCommand = value
			i = next
		case strings.HasPrefix(arg, "--whisper-cpp-command="):
			parsed.whisperCommand = strings.TrimPrefix(arg, "--whisper-cpp-command=")
		case arg == "--language":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.language = value
			i = next
		case strings.HasPrefix(arg, "--language="):
			parsed.language = strings.TrimPrefix(arg, "--language=")
		case arg == "--device":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.device = value
			i = next
		case strings.HasPrefix(arg, "--device="):
			parsed.device = strings.TrimPrefix(arg, "--device=")
		case arg == "--compute-type":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.computeType = value
			i = next
		case strings.HasPrefix(arg, "--compute-type="):
			parsed.computeType = strings.TrimPrefix(arg, "--compute-type=")
		case arg == "--batch-size":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			if _, scanErr := fmt.Sscanf(value, "%d", &parsed.batchSize); scanErr != nil || parsed.batchSize <= 0 {
				return parsed, fmt.Errorf("--batch-size must be a positive integer")
			}
			i = next
		case strings.HasPrefix(arg, "--batch-size="):
			value := strings.TrimPrefix(arg, "--batch-size=")
			if _, scanErr := fmt.Sscanf(value, "%d", &parsed.batchSize); scanErr != nil || parsed.batchSize <= 0 {
				return parsed, fmt.Errorf("--batch-size must be a positive integer")
			}
		case arg == "--worker-command":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.workerCommand = value
			i = next
		case strings.HasPrefix(arg, "--worker-command="):
			parsed.workerCommand = strings.TrimPrefix(arg, "--worker-command=")
		case arg == "--worker-arg":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.workerArgs = append(parsed.workerArgs, value)
			i = next
		case strings.HasPrefix(arg, "--worker-arg="):
			parsed.workerArgs = append(parsed.workerArgs, strings.TrimPrefix(arg, "--worker-arg="))
		case arg == "--word-timestamps":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.wordTimestamps = value
			parsed.wordTimestampsSet = true
			i = next
		case strings.HasPrefix(arg, "--word-timestamps="):
			parsed.wordTimestamps = strings.TrimPrefix(arg, "--word-timestamps=")
			parsed.wordTimestampsSet = true
		case arg == "--api-key" || strings.HasPrefix(arg, "--api-key="):
			return parsed, fmt.Errorf(rawAPIKeyUnsupportedMessage)
		case arg == "--api-key-env":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.apiKeyEnv = value
			i = next
		case strings.HasPrefix(arg, "--api-key-env="):
			parsed.apiKeyEnv = strings.TrimPrefix(arg, "--api-key-env=")
		case arg == "--base-url":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.baseURL = value
			i = next
		case strings.HasPrefix(arg, "--base-url="):
			parsed.baseURL = strings.TrimPrefix(arg, "--base-url=")
		case arg == "--api-upload-format":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.apiUploadFormat = value
			i = next
		case strings.HasPrefix(arg, "--api-upload-format="):
			parsed.apiUploadFormat = strings.TrimPrefix(arg, "--api-upload-format=")
		case arg == "--config":
			value, next, err := requireValue(args, i, arg)
			if err != nil {
				return parsed, err
			}
			parsed.configPath = value
			i = next
		case strings.HasPrefix(arg, "--config="):
			parsed.configPath = strings.TrimPrefix(arg, "--config=")
		case strings.HasPrefix(arg, "-"):
			return parsed, fmt.Errorf("unknown flag: %s", arg)
		default:
			parsed.positionals = append(parsed.positionals, arg)
		}
	}
	if command != "auto" && parsed.yes {
		return parsed, fmt.Errorf("--yes is only accepted by auto in the Go preview")
	}
	return parsed, nil
}
