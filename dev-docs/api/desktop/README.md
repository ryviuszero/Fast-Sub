# Desktop API Reference

Generated: 2026-05-21

Source paths:

- `desktop/shared/contracts/types.ts`
- `desktop/shared/contracts/daemonEventMapping.ts`
- `desktop/preload/index.ts`
- `desktop/renderer/src/global.d.ts`
- `desktop/renderer/src/client/DaemonFastSubClient.ts`
- `desktop/main/client/`

Generation command:

```powershell
rg -n "^(export type|export interface|export const|export class|export function|export async function|declare global|interface Window)" desktop -g "*.ts" -g "*.tsx"
```

This page is a checked-in reference snapshot. The source of truth for Electron architecture and daemon behavior remains `../../ui-docs/architecture.md` and `../../go-docs/specs/daemon-api.md`.

## Shared Contract Types

Source: `desktop/shared/contracts/types.ts`

String unions:

| Type | Values |
| --- | --- |
| `HealthStatus` | `ok`, `degraded`, `disconnected` |
| `ModelKind` | `asr`, `translation` |
| `ModelState` | `ready`, `missing`, `installing`, `failed`, `verifying` |
| `ProviderKind` | `local`, `web`, `api`, `native` |
| `ProviderCapability` | `stt`, `translation` |
| `ProviderState` | `available`, `missing_dependency`, `missing_model`, `missing_api_key`, `invalid_config`, `disabled`, `not_implemented` |
| `JobKind` | `transcribe`, `model_install`, `translate_srt`, `burn_in` |
| `JobStatus` | `queued`, `running`, `canceling`, `succeeded`, `failed`, `canceled`, `interrupted` |
| `JobEventType` | `snapshot`, `progress`, `log_tail`, `succeeded`, `failed`, `canceled`, `events_lost` |
| `RecoveryAction` | `retry`, `install_model`, `open_settings`, `open_diagnostics`, `repair_daemon`, `dismiss` |
| `FFmpegPackageManager` | `scoop`, `winget`, `choco` |

`JobStage` values:

```text
validating
queued
probing_media
installing_model
extracting_audio
preparing_upload
loading_model
transcribing
translating
burning_in
rendering
finalizing
done
```

## View Models

`UiError`:

```text
code
title
message
action
recoveryActions
diagnostic
details
```

`EnvironmentStatus`:

```text
health
os
arch
memory
disk
localTranscriptionReady
localTranslationReady
ffmpegReady
ffmpegInstalling
ffmpegInstallProgressPercent
ffmpegInstallLogs
modelDirectoryReady
daemonReady
warnings
error
```

`ModelStatus`:

```text
id
name
kind
state
sizeLabel
backend
compatibleProviders
defaultFor
recommendation
progressPercent
installJobId
requiredForMainFlow
diagnostic
```

`ProviderStatus`:

```text
id
name
kind
capability
state
checkMode
enabled
privacyNote
requiresUploadConfirmation
requiresApiKey
requiresModel
supportsBatch
supportsWordTimestamps
supportedLanguages
capabilities
compatibleModelTypes
maskedCredential
```

`ConfigViewModel`:

```text
defaultLanguage
targetLanguage
outputLocation
outputConflict
outputFormat
device
outputType
burnInVideo
asrProvider
translationProvider
asrModel
translationModel
keepTempFiles
wordTimestamps
folderScanIncludeSubfolders
folderScanMaxFiles
apiKeyAlias
openAIBaseUrl
openAIModel
openAIUploadFormat
apiKeyStatus
apiProviderConfigs
```

`ApiProviderConfigViewModel`:

```text
apiKeyAlias
openAIBaseUrl
openAIModel
openAIUploadFormat
apiKeyStatus
```

`CreateJobRequest`:

```text
type
inputPaths
outputDirectory
outputPath
outputType
outputFormat
outputConflict
language
targetLanguage
providerId
modelId
translationProviderId
translationModelId
translationUploadConfirmed
remoteUploadConfirmed
```

`JobResult`:

```text
subtitlePath
outputFolder
summary
durationLabel
language
```

`JobSummary`:

```text
id
displayId
type
status
statusLabel
title
currentFile
progressPercent
stageLabel
createdAt
completedAt
language
providerName
modelName
outputDirectory
```

`JobDetail` extends `JobSummary` with:

```text
inputPaths
outputDirectory
providerName
modelName
estimatedRemaining
result
error
logs
```

`JobEvent`:

```text
type
job
progress
result
error
logs
```

## FastSubClient Interface

Source: `desktop/shared/contracts/types.ts`

Methods:

| Method | Result |
| --- | --- |
| `health()` | `Promise<HealthStatus>` |
| `version()` | `Promise<string>` |
| `getEnvironmentStatus()` | `Promise<EnvironmentStatus>` |
| `repairDaemon()` | `Promise<EnvironmentStatus>` |
| `installFFmpegWithPackageManager(manager)` | `Promise<EnvironmentStatus>` |
| `installProviderDependency(providerId)` | `Promise<ProviderStatus>` |
| `getConfig()` | `Promise<ConfigViewModel>` |
| `updateConfig(patch)` | `Promise<ConfigViewModel>` |
| `saveProviderSecret(providerId, alias, rawSecret)` | `Promise<ConfigViewModel>` |
| `deleteProviderSecret(providerId, alias)` | `Promise<ConfigViewModel>` |
| `listModels()` | `Promise<ModelStatus[]>` |
| `installModel(modelId)` | `Promise<ModelStatus>` |
| `createModelInstallJob(modelId)` | `Promise<JobDetail>` |
| `verifyModel(modelId)` | `Promise<ModelStatus>` |
| `removeModel(modelId)` | `Promise<ModelStatus>` |
| `listProviders()` | `Promise<ProviderStatus[]>` |
| `testProvider(providerId, mode)` | `Promise<ProviderStatus>` |
| `createJob(request)` | `Promise<JobDetail>` |
| `listJobs()` | `Promise<JobSummary[]>` |
| `getJob(jobId)` | `Promise<JobDetail>` |
| `cancelJob(jobId)` | `Promise<JobDetail>` |
| `cancelAllJobs()` | `Promise<JobSummary[]>` |
| `getJobResult(jobId)` | `Promise<JobResult>` |
| `getJobLogs(jobId)` | `Promise<JobLogEntry[]>` |
| `deleteJob(jobId)` | `Promise<void>` |
| `subscribeJobEvents(jobId, handlers)` | `() => void` unsubscribe function |

Secret handling:

- `saveProviderSecret` accepts raw secret only across the preload/main IPC boundary.
- Renderer state must not retain or display raw secrets.
- Stored config uses aliases/status, not raw API key values.

## Preload APIs

Source: `desktop/preload/index.ts`

`window.fastSubSystem`:

| Method | Purpose |
| --- | --- |
| `selectMediaFiles()` | Native file picker for media files. |
| `selectMediaFolder(options)` | Native folder picker with scan options. |
| `selectFolder()` | Native folder picker. |
| `selectSubtitleOutputPath(defaultPath)` | Native save path picker. |
| `getPathForFile(file)` | Resolve browser `File` to local path. |
| `openPathMock(path)` | Mock/path opening adapter. |
| `getSecuritySnapshot()` | Returns context isolation, node integration, CSP, and raw IPC exposure flags. |

`window.fastSubClient` exposes the `FastSubClientBridge` methods listed above.

Preload security rules:

- `contextIsolation` must stay enabled.
- Renderer must not receive raw `ipcRenderer`.
- Bridge methods must expose narrow, typed operations only.

## Daemon Client Bridge

Source: `desktop/renderer/src/client/DaemonFastSubClient.ts`

`FastSubClientBridge` mirrors `FastSubClient`.

`DaemonFastSubClient` is a renderer-side adapter over the preload bridge:

- It does not call daemon HTTP directly.
- It delegates all privileged operations to main/preload.
- It exposes `subscribeJobEvents(jobId, handlers)` and returns an unsubscribe function.

`isJobEvent(value)` is a runtime guard that checks for an object with a `type` property.

## Main Process Client

Source area: `desktop/main/client/`

Important exported modules:

- `daemonClient.ts`: main-process daemon HTTP/SSE client.
- `daemonProcess.ts`: managed daemon lifecycle.
- `ipc.ts`: registers `fast-sub-client:*` handlers.
- `nativeDependencies.ts`: FFmpeg and whisper.cpp runtime detection/install helpers.
- `runtimeResources.ts`: packaged daemon and Python runtime path resolution.
- `secretStore.ts`: safeStorage-backed secret storage and transient secret refs.
- `transportLog.ts`: daemon transport logging.
- `uiError.ts`: maps thrown errors to UI-facing errors.

Main process privacy boundary:

- Main process may hold raw secrets temporarily.
- Renderer receives only aliases, status, masked credentials, or redacted diagnostics.
- Transport logs and diagnostics must redact secrets and credential-bearing URLs.

## Event Mapping

Source: `desktop/shared/contracts/daemonEventMapping.ts`

`mapDaemonEventToJobEvent(fixture)` maps daemon SSE-style events into renderer `JobEvent` objects.

Known daemon event categories include:

```text
snapshot
progress
log_tail
succeeded
failed
canceled
events_lost
```

Mapping rules are UI-facing and must stay aligned with `../../go-docs/specs/daemon-api.md`.
