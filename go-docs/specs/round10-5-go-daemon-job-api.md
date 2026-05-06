# Fast Sub Round 10.5: Go Daemon And Job API Gate

## Summary

Round 10.5 是桌面 UI 前的 daemon/job API gate。目标不是开始做 Electron UI，而是先把 UI 需要依赖的本地任务接口稳定下来。

本轮推荐通信方案：

```text
Electron UI / future local Web UI
  -> HTTP REST: create/query/cancel/config/models/providers
  -> SSE: job progress/log/status events
  -> Go local daemon on 127.0.0.1
```

主结论：

- REST 负责低频命令和查询。
- SSE 负责服务端到 UI 的进度、日志和状态流。
- WebSocket 暂缓，等出现高频双向控制需求再加。
- Electron IPC / stdio JSON-RPC 可以作为 daemon 启动和端口握手方式，不作为主业务 API。
- 即使默认只监听 `127.0.0.1`，daemon 也必须使用一次性 bearer token 保护非公开 API，避免本机网页或其他进程误用。
- Round 10.5 默认只允许一个 running job，其他 job 排队；复杂资源调度和 worker pool 延后。

## Current State

Round 10 已完成 Go product core：

- Go models `list/install/verify`。
- Go providers `list/test`。
- Go `transcribe` 支持：
  - `local-faster-whisper`
  - `local-whisper-cpp`
  - `api-openai-transcription`
- Go 已经拥有模型下载、provider 状态、ffmpeg/ffprobe 调用、native whisper.cpp 调用和 OpenAI-compatible STT 调用。

仍缺少 UI 前的 job 层：

- 没有长期运行的 local daemon。
- 没有 job create/status/cancel/result API。
- 没有实时 progress/log event stream。
- 没有 UI 可依赖的 job state machine。
- 没有 daemon auth/handshake。
- 没有 job list、retention、restart recovery 和 event replay gap 语义。
- Python translate 已实现，但 Go 侧 translate runtime 尚未实现。

## Branch

推荐分支：

```text
codex/fast-sub-go-daemon-job-api
```

本轮建议一个分支完成，不切并行分支。daemon API 会触及 CLI、job state、HTTP handler、event stream、transcribe orchestration，过早拆分容易制造接口漂移。

## Goals

- 新增 `fast-sub-go serve` 或 `fast-sub-go daemon`。
- daemon 默认只监听 `127.0.0.1`。
- 支持 `--host 127.0.0.1`、`--port 0`，其中 `--port 0` 自动选择空闲端口。
- 支持启动 ready JSON，包含 `base_url`、一次性 token、pid、schema_version。
- 提供稳定 REST API：
  - create job
  - query job
  - list jobs
  - cancel job
  - job result/log lookup
  - list models
  - list providers
  - health/version
- 提供 SSE event stream：
  - progress
  - log
  - status
  - completed
  - failed
  - canceled
- 首版 job 类型只要求支持 `transcribe`。
- transcribe job 复用 Round 10 Go provider/runtime 能力。
- Go daemon 不静默启用远程 provider。
- 默认禁用 CORS；未来 Web UI 需要时再显式配置 `--allow-origin`。
- 默认 `max_running_jobs=1`，允许多个 queued job。
- daemon restart 后，旧的 `running/canceling` job 必须标记为 `interrupted` 或 `failed`，不能永久停在 running。
- JSON schema、错误码、隐私边界和 CLI 保持一致。

## Non-Goals

- 不做 Electron UI。
- 不做 Web UI。
- 不实现 Go translate provider runtime。
- 不把 Python translate 重写为 Go。
- 不实现完整 worker pool。
- 不实现用户账户、远程访问、多用户权限或公网服务。
- 不实现 WebSocket，除非本轮实现中证明 SSE 无法满足最小 UI gate。
- 不默认开放 `0.0.0.0`。
- 不默认启用 CORS。
- 不实现多 running job 资源调度。
- 不实现 external queue、Redis、SQLite job queue、priority queue、retry/DLQ。
- 不实现 warm worker pool 或模型常驻策略。
- 不保证 Windows 下递归终止所有孙进程；Round 10.5 至少终止直接子进程，并记录 Windows job object 为后续增强。
- 不在默认测试中调用真实 ffmpeg、真实 whisper.cpp、真实 OpenAI、真实模型或真实网络。

## Communication Decision

### REST

REST 用于请求/响应型操作：

```text
POST /v1/jobs
GET  /v1/jobs
GET  /v1/jobs/{job_id}
POST /v1/jobs/{job_id}/cancel
GET  /v1/jobs/{job_id}/result
GET  /v1/jobs/{job_id}/logs
DELETE /v1/jobs/{job_id}
GET  /v1/models
GET  /v1/providers
GET  /v1/health
GET  /v1/version
```

优点：

- 容易用 `httptest` 测试。
- Electron、future Web、CLI wrapper 都能复用。
- JSON schema 和 error contract 清晰。
- curl/Postman/浏览器 DevTools 都容易调试。
- HTTP status code 可与统一 JSON error body 搭配使用。

限制：

- 不适合高频实时进度。
- 需要配合 SSE 或轮询获取任务变化。

### SSE

SSE 用于 daemon 到 UI 的单向事件流：

```text
GET /v1/jobs/{job_id}/events
```

事件类型：

```text
created
queued
started
progress
log
warning
completed
failed
canceled
interrupted
events_lost
heartbeat
```

优点：

- 比 WebSocket 简单。
- 浏览器/Electron 原生支持。
- 本地 `127.0.0.1` 场景下代理和缓冲风险较低。
- 自动重连语义对 UI 友好。

限制：

- 只支持服务端到客户端单向推送。
- cancel/pause/resume 仍走 REST。
- EventSource 不能自定义 Authorization header；Electron renderer 应通过 preload/main process 建立受控连接，或未来改用 fetch-based SSE client。

### WebSocket Deferred

WebSocket 暂缓。

适合后续场景：

- 高频双向控制。
- 多任务实时面板。
- 远程 Web 版。
- pause/resume/参数热修改等复杂交互。

当前本地字幕工具的最小 UI gate 不需要 WebSocket。

### Electron IPC / stdio

Electron 可以通过 IPC 管理 Go daemon 子进程生命周期，但业务通信仍走 REST + SSE。

推荐启动流程：

```text
1. Electron main process 启动 fast-sub-go serve --host 127.0.0.1 --port 0。
2. Go daemon 在 stdout 输出一行启动 JSON，例如 {"schema_version":1,"ready":true,"base_url":"http://127.0.0.1:49231","token":"...","pid":12345}。
3. Electron main process 读取 base_url 和 token。
4. Renderer 通过 main process 或安全 preload 调用 REST/SSE，不直接暴露 token 给任意网页上下文。
5. Electron 退出时关闭 Go daemon。
```

## Auth And Local Security

Round 10.5 默认安全模型：

- daemon 默认只监听 `127.0.0.1`。
- `GET /v1/health` 和 `GET /v1/version` 可以不需要 token。
- 其他 API 必须携带 `Authorization: Bearer <ready-token>`。
- ready token 每次 daemon 启动生成一次，不写入仓库，不打印到 stderr/logs/events/job metadata。
- 默认禁用 CORS，不设置 `Access-Control-Allow-Origin: *`。
- 未来如果需要浏览器 Web UI，必须显式 `--allow-origin <origin>`，并重新审查 token 暴露方式。
- 所有 auth failure 返回结构化 `unauthorized`，HTTP status 使用 401。
- 任何日志、错误、event、job 文件都必须 redacted token。

## API Draft

### Create Job

```http
POST /v1/jobs
Content-Type: application/json
```

Request:

```json
{
  "schema_version": 1,
  "type": "transcribe",
  "input_path": "C:/media/input.mp4",
  "output_path": "C:/media/input.srt",
  "provider": "local-faster-whisper",
  "model": "whisper-small",
  "model_path": "",
  "language": "auto",
  "word_timestamps": "off",
  "options": {
    "yes": false,
    "keep_temp": false
  }
}
```

Response:

```json
{
  "schema_version": 1,
  "ok": true,
  "result": {
    "job_id": "job_20260506_abcdef",
    "status": "queued",
    "events_url": "/v1/jobs/job_20260506_abcdef/events"
  },
  "warnings": []
}
```

### List Jobs

```http
GET /v1/jobs
```

Response:

```json
{
  "schema_version": 1,
  "ok": true,
  "result": {
    "jobs": [
      {
        "job_id": "01JZEXAMPLE000000000000000",
        "type": "transcribe",
        "status": "running",
        "stage": "transcribing",
        "progress": {"percent": 42},
        "provider": "local-faster-whisper",
        "model": "whisper-small",
        "output_path": "C:/media/input.srt",
        "created_at": "2026-05-06T10:00:00Z",
        "started_at": "2026-05-06T10:00:03Z",
        "finished_at": null
      }
    ]
  },
  "warnings": []
}
```

### Get Job

```http
GET /v1/jobs/{job_id}
```

Response:

```json
{
  "schema_version": 1,
  "ok": true,
  "result": {
    "job_id": "job_20260506_abcdef",
    "type": "transcribe",
    "status": "running",
    "stage": "transcribing",
    "progress": {
      "percent": 42,
      "current": 42,
      "total": 100
    },
    "provider": "local-faster-whisper",
    "model": "whisper-small",
    "input_path": "C:/media/input.mp4",
    "output_path": "C:/media/input.srt",
    "created_at": "2026-05-06T10:00:00Z",
    "started_at": "2026-05-06T10:00:03Z",
    "finished_at": null
  },
  "warnings": []
}
```

### Cancel Job

```http
POST /v1/jobs/{job_id}/cancel
```

Response:

```json
{
  "schema_version": 1,
  "ok": true,
  "result": {
    "job_id": "job_20260506_abcdef",
    "status": "canceling"
  },
  "warnings": []
}
```

### Job Events

```http
GET /v1/jobs/{job_id}/events
Accept: text/event-stream
```

SSE event:

```text
event: progress
id: 12
data: {"schema_version":1,"job_id":"job_20260506_abcdef","stage":"transcribing","percent":42}
```

Final event:

```text
event: completed
id: 31
data: {"schema_version":1,"job_id":"job_20260506_abcdef","output_path":"C:/media/input.srt","segments":120}
```

SSE rules:

- Event `id` 必须在单个 job 内单调递增。
- `events.jsonl` 是 replay source；内存 replay buffer 必须有上限。
- 支持 `Last-Event-ID`，从指定 id 后继续发送。
- 如果 `Last-Event-ID` 太旧、events.jsonl 已被清理或发现 id gap，先发送 `events_lost`，UI 必须重新 `GET /v1/jobs/{job_id}` 同步状态。
- heartbeat 默认 10-30 秒一次，防止中间层断开空闲连接。
- 慢客户端或断开的 SSE subscriber 不能阻塞 job runner。
- progress event 使用稳定 schema；log event 是人类诊断文本，UI 不得依赖 log 文本判断状态。

### Get Job Result

```http
GET /v1/jobs/{job_id}/result
```

用于读取 terminal job 的结构化结果，例如 output path、segment count、elapsed time、provider/model metadata。未完成 job 返回 `invalid_state`。

### Get Job Logs

```http
GET /v1/jobs/{job_id}/logs
```

用于读取 redacted 诊断日志摘要。Round 10.5 不要求返回完整日志文件，只要求返回受限 tail 和 log file availability。

### Delete / Cleanup Job

```http
DELETE /v1/jobs/{job_id}
```

用于清理 terminal job metadata/tmp/logs。running/canceling job 返回 `invalid_state`。

## Job State Machine

Job status:

```text
created
queued
running
canceling
succeeded
failed
canceled
interrupted
```

Stage:

```text
validating
probing_media
installing_model
extracting_audio
preparing_upload
loading_model
transcribing
rendering
finalizing
done
```

Rules:

- `created -> queued -> running -> succeeded|failed|canceling`。
- `canceling -> canceled|failed`。
- daemon 启动时发现旧 `running/canceling` job，必须转为 `interrupted` 或 `failed`，并写入 terminal event。
- 用户取消不等于普通失败；最终应优先标记 `canceled`。
- 所有 terminal status 必须有 `finished_at`。
- `failed` 必须包含 structured error。
- `interrupted` 必须包含 structured error，例如 `daemon_restarted`。
- API provider job 必须保留 explicit provider 选择，不允许 daemon 自动切 API。
- Round 10.5 默认 `max_running_jobs=1`；queued job 按 FIFO 执行。
- cancel queued job 直接进入 `canceled`；cancel running job 先进入 `canceling`。
- Windows cancel 至少终止直接子进程；递归终止子进程树 / Job Object 作为后续增强项。

## Job Folder

每个 job 拥有独立目录：

```text
jobs/
  job_20260506_abcdef/
    job.json
    events.jsonl
    request.json
    response.json
    error.json
    logs/
      ffmpeg.stderr.log
      worker.stderr.log
      provider.stderr.log
    tmp/
      audio.wav
      api-upload.m4a
    outputs/
```

要求：

- job metadata 持久化到 `job.json`。
- events 追加写入 `events.jsonl`，便于 UI 重连后补历史。
- job id 使用 ULID/UUID 风格稳定随机 ID，不使用短随机时间戳拼接作为唯一依据。
- 成功任务可按 retention policy 清理中间文件。
- terminal job 默认保留一段时间；超过 retention 后可清理 tmp/logs，job summary 可继续保留或按策略删除。
- 失败任务默认保留必要诊断文件，但不得保存 API key、Authorization、raw request body 或敏感 provider response。
- `--keep-temp` 或 job option 可保留中间文件。

## Error And Privacy Contract

REST error response 复用 Go CLI error code：

```json
{
  "schema_version": 1,
  "ok": false,
  "error": {
    "code": "missing_model",
    "message": "model is not installed: whisper-small",
    "action_hint": "Run fast-sub-go models install whisper-small.",
    "details": {}
  },
  "warnings": []
}
```

隐私规则：

- daemon 默认只监听 `127.0.0.1`。
- 默认不允许远程 host。
- 非 health/version API 需要一次性 bearer token。
- 默认禁用 CORS。
- API provider 必须显式选择。
- job request、job metadata、events、logs 中不得保存 API key、Authorization header、raw secret、signed URL credential 或敏感 request body。
- signed URL query、proxy credential、ready token、provider raw response 都必须 redacted。
- 远程 provider event 必须包含 privacy warning。
- `models/providers` API 不得触发真实上传。

HTTP status mapping:

```text
400 invalid_input
401 unauthorized
404 unknown_job
409 invalid_state / output_exists / job_not_terminal
500 internal_error
```

即使 HTTP status 非 200，body 仍必须是统一 JSON error contract。

## Package Layout

推荐新增或扩展：

```text
internal/daemon/
internal/jobs/
internal/events/
internal/contracts/
internal/runtime/fasterwhisper/
```

职责：

- `internal/daemon/`：HTTP server、routing、REST/SSE handler、listen lifecycle。
- `internal/jobs/`：job store、state machine、runner、cancel registry、retention。
- `internal/events/`：event type、event bus、SSE encoder、event replay。
- `internal/contracts/`：daemon-facing request/response schema 和 golden fixtures。
- `internal/cli/`：新增 `serve/daemon` 命令，保持 command wiring，不承载 job 业务。

依赖方向：

- `daemon` 可依赖 `jobs`、`events`、`models`、`providers`。
- `jobs` 可依赖 runtime/provider/model/media/subtitle/error 包。
- runtime 包不能依赖 `daemon`。
- `events` 应是底层包，不依赖具体 provider runtime。

## Workstreams

### Workstream 1: Daemon Skeleton

- 新增 `fast-sub-go serve`。
- 支持 `--host`、`--port`、`--json-ready`、`--max-running-jobs`。
- 默认 host 为 `127.0.0.1`。
- `--port 0` 自动分配端口。
- 默认 `--max-running-jobs=1`。
- stdout ready JSON 只输出一次，不混入日志，包含 `base_url`、`token`、pid、schema_version。
- 生成 per-process execute id。
- graceful shutdown。

### Workstream 2: Job Store And State

- ULID/UUID job id 生成。
- job metadata 持久化。
- job status transition。
- in-memory runner registry。
- FIFO queue。
- finished job retention。
- daemon startup recovery：旧 running/canceling 标记 interrupted。
- cancel context 管理。
- terminal status 写入。

### Workstream 3: REST API

- `POST /v1/jobs`。
- `GET /v1/jobs`。
- `GET /v1/jobs/{id}`。
- `POST /v1/jobs/{id}/cancel`。
- `GET /v1/jobs/{id}/result`。
- `GET /v1/jobs/{id}/logs`。
- `DELETE /v1/jobs/{id}`。
- `GET /v1/models`。
- `GET /v1/providers`。
- `GET /v1/health`。
- `GET /v1/version`。
- bearer token auth for non-public endpoints。
- HTTP status mapping。

### Workstream 4: SSE Events

- event bus。
- job event append-only store。
- `GET /v1/jobs/{id}/events`。
- heartbeat。
- reconnect via `Last-Event-ID`。
- bounded replay。
- `events_lost` / replay gap handling。
- slow subscriber cleanup。
- completed/failed/canceled terminal events。

### Workstream 5: Transcribe Job Runner

- 把现有 CLI transcribe orchestration 抽到可复用 runner，避免 daemon 调 CLI 字符串。
- 支持 `local-faster-whisper`。
- 支持 `local-whisper-cpp`。
- 支持 `api-openai-transcription`，但仍要求 explicit provider 和 explicit model/config。
- `auto --yes` 规则保持：不静默启用 API。

### Workstream 6: Tests And Docs

- `httptest` 覆盖 REST。
- fake event subscriber 覆盖 SSE。
- fake ffmpeg/worker/whisper.cpp/OpenAI server。
- JSON schema/golden fixtures。
- privacy/redaction tests。
- cancel tests。
- README 手动 smoke。

## Testing

默认测试：

```bash
go test ./...
```

默认测试必须满足：

- 不访问真实网络。
- 不需要真实模型。
- 不需要真实 ffmpeg。
- 不需要真实 whisper.cpp。
- 不需要真实 OpenAI key。
- 不需要 GPU。

重点测试：

- daemon `--port 0` ready JSON。
- ready JSON 包含 token 且 token 不进入 logs/events/job metadata。
- 非 health/version API 无 token 返回 401。
- 默认 CORS disabled。
- REST success/failure JSON 可解析。
- `POST /v1/jobs` 创建 transcribe job。
- `GET /v1/jobs` 返回列表。
- `GET /v1/jobs/{id}` 返回状态。
- `GET /v1/jobs/{id}/result` 未完成时返回 `invalid_state`。
- cancel 后 job 进入 `canceling/canceled`。
- cancel queued job 直接 canceled。
- SSE 收到 progress 和 terminal event。
- SSE reconnect 可通过 `Last-Event-ID` 补事件。
- SSE replay gap 发送 `events_lost`。
- 慢/断开的 SSE subscriber 不阻塞 runner。
- daemon restart 后旧 running job 标记 interrupted。
- 默认 max_running_jobs=1，第二个 job queued。
- API provider 不会被默认选择。
- API key 不出现在 job metadata、events、stdout、stderr、logs。
- unknown job id 返回结构化错误。
- invalid request 返回 `invalid_input`。
- provider/model missing 返回现有错误码。

## Acceptance Criteria

- `fast-sub-go serve --host 127.0.0.1 --port 0` 可启动并输出 base URL。
- ready JSON 包含一次性 token，业务 API 需要 bearer token。
- REST + SSE API 能跑一个 fake transcribe job。
- `GET /v1/jobs`、`GET /v1/jobs/{id}/result`、`GET /v1/jobs/{id}/logs` 可用于 UI 任务页。
- daemon job runner 能复用 Round 10 三个 STT provider 的 fake/default 测试能力。
- `models/providers` API 和 CLI 语义一致。
- job cancel 可终止 running job 并产生 terminal event。
- 成功、失败、取消都有可查询 job state。
- daemon restart 不留下永久 running job。
- SSE reconnect/gap 语义稳定。
- 默认只允许一个 running job，排队行为可测试。
- `--json` / ready stdout 不被日志污染。
- 本轮不实现 UI，但 Electron 可以基于此 API 开始集成。

## Merge Criteria

- `gofmt`。
- `go test ./...`。
- 不破坏现有 `fast-sub-go` CLI 命令。
- 不破坏 Python `fast-sub`。
- 不提交 job 运行产物、模型、真实媒体、API key 或本机敏感路径。
- API schema 和 event schema 写入文档或 golden fixtures。

## Deferred

- Electron UI。
- WebSocket。
- Go translate provider runtime。
- Python translation worker daemon integration。
- warm worker pool。
- 多任务优先级和复杂调度。
- 多 running job 资源调度。
- retry / DLQ。
- Windows Job Object / 递归进程树终止增强。
- 远程访问、安全认证、多用户。
- CORS allowlist。
- daemon auto update / tray lifecycle。
