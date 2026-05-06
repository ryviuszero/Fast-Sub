# Fast Sub Daemon API Contract

## Summary

本文记录 Round 10.5 已落地的 daemon API contract。后续桌面 UI bridge/shell 应以本文为当前接入基准。

当前通信模型：

```text
Electron main process
  -> 启动 fast-sub-go serve --host 127.0.0.1 --port 0
  -> 从 stdout 读取一行 ready JSON
  -> 使用 Authorization: Bearer <token> 调 HTTP REST
  -> 使用 SSE 订阅 job events
```

daemon 是 local-first 设计：默认只监听 loopback，默认禁用 CORS，除 health/version 外的业务 API 都需要一次性 bearer token。

## Startup

推荐启动命令：

```bash
fast-sub-go serve --host 127.0.0.1 --port 0 --json-ready --max-running-jobs 1
```

别名：

```bash
fast-sub-go daemon
```

ready JSON 只写一次到 stdout：

```json
{
  "schema_version": 1,
  "ready": true,
  "base_url": "http://127.0.0.1:49231",
  "token": "ephemeral-token",
  "pid": 12345
}
```

UI 启动规则：

- stdout ready JSON 是唯一启动握手通道。
- 不解析 stderr 判断 daemon 是否 ready。
- token 只保存在 Electron main/preload 可控区域，不暴露给任意网页上下文。
- App 退出时关闭 daemon，让 running jobs 进入 cancel 流程。

## Authentication

公开 endpoint：

```text
GET /v1/health
GET /v1/version
```

其他 endpoint 必须携带：

```http
Authorization: Bearer <ready-token>
```

未授权响应：

```json
{
  "schema_version": 1,
  "ok": false,
  "error": {
    "code": "unauthorized",
    "message": "authorization bearer token is required."
  },
  "warnings": []
}
```

安全规则：

- 本版本 host 必须是 loopback。
- 默认禁用 CORS。
- ready token 不写入 job metadata、logs 或 events。
- API key、Authorization header、raw secret、signed URL credential、provider 原始敏感响应都必须 redacted。

## Response Envelope

成功：

```json
{
  "schema_version": 1,
  "ok": true,
  "result": {},
  "warnings": []
}
```

失败：

```json
{
  "schema_version": 1,
  "ok": false,
  "error": {
    "code": "invalid_input",
    "message": "request body is invalid JSON.",
    "action_hint": "",
    "details": {}
  },
  "warnings": []
}
```

HTTP status mapping：

```text
400 invalid_input / invalid_usage
401 unauthorized
404 unknown_job
409 invalid_state / output_exists
500 internal_error and unexpected failures
```

即使 HTTP status 不是 200，body 也必须使用统一 JSON envelope。

## REST Endpoints

```text
GET    /v1/health
GET    /v1/version
GET    /v1/models
GET    /v1/providers
GET    /v1/jobs
POST   /v1/jobs
GET    /v1/jobs/{job_id}
POST   /v1/jobs/{job_id}/cancel
GET    /v1/jobs/{job_id}/result
GET    /v1/jobs/{job_id}/logs
GET    /v1/jobs/{job_id}/events
DELETE /v1/jobs/{job_id}
```

### Create Job

```http
POST /v1/jobs
Content-Type: application/json
```

Request：

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
    "keep_temp": false,
    "device": "auto",
    "compute_type": "auto",
    "batch_size": 8
  }
}
```

当前支持的 job type：

```text
transcribe
```

当前支持的 transcribe provider：

```text
local-faster-whisper
local-whisper-cpp
api-openai-transcription
```

Response：

```json
{
  "schema_version": 1,
  "ok": true,
  "result": {
    "job_id": "job_abcdef",
    "status": "queued",
    "events_url": "/v1/jobs/job_abcdef/events"
  },
  "warnings": []
}
```

### Get Job

```http
GET /v1/jobs/{job_id}
```

返回当前 job metadata，包括 id、type、status、stage、progress、provider、model、input path、output path、created time、started time、finished time、result 和 error。

### List Jobs

```http
GET /v1/jobs
```

按创建时间返回 jobs。

### Cancel Job

```http
POST /v1/jobs/{job_id}/cancel
```

规则：

- queued/created job 直接进入 `canceled`。
- running job 进入 `canceling`，对应 context 被取消，最终应进入 `canceled`。
- terminal job 返回 `invalid_state`。

### Get Result

```http
GET /v1/jobs/{job_id}/result
```

规则：

- terminal job 返回 result 或 structured error。
- non-terminal job 返回 `invalid_state`。

### Get Logs

```http
GET /v1/jobs/{job_id}/logs
```

返回有限长度的 redacted log summary。UI 不应依赖 log 文本判断状态。

### Delete Job

```http
DELETE /v1/jobs/{job_id}
```

规则：

- 只能删除 terminal job。
- non-terminal job 返回 `invalid_state`。

## SSE Events

Endpoint：

```http
GET /v1/jobs/{job_id}/events
Accept: text/event-stream
```

Event 格式：

```text
event: progress
id: 12
data: {"schema_version":1,"job_id":"job_abcdef","stage":"transcribing","percent":55}
```

支持的 event type：

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

Replay 规则：

- event id 在单个 job 内单调递增。
- `Last-Event-ID` 表示从该 id 后继续 replay。
- 如果历史不可用或发现 gap，daemon 发送 `events_lost`。
- UI 收到 `events_lost` 后应调用 `GET /v1/jobs/{job_id}` 重新同步。
- heartbeat 用于保持连接。
- 慢客户端或断开的 subscriber 不能阻塞 job execution。

## Job State Machine

Status：

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

常见 stage：

```text
validating
queued
probing_media
extracting_audio
preparing_upload
transcribing
rendering
done
```

规则：

- 默认 `max_running_jobs=1`，更多 jobs 进入 FIFO queue。
- daemon shutdown 会取消 running jobs。
- daemon restart 会恢复 queued jobs，并把旧 running/canceling jobs 标记为 `interrupted`。
- 用户取消不是普通失败，最终优先标记为 `canceled`。
- terminal jobs 必须有 `finished_at`。
- failed/interrupted/canceled jobs 应包含 structured error。

## Model And Provider Metadata

```http
GET /v1/models
GET /v1/providers
```

这两个 endpoint 复用 Go CLI 语义，不应触发真实转写、音频上传或模型下载。

Provider status vocabulary：

```text
available
missing_dependency
missing_model
missing_api_key
invalid_config
disabled
not_implemented
```

## UI Integration Notes

桌面 UI 应该：

- 由 Electron main process 启动 daemon。
- 读取 ready JSON 并保存 `base_url` / token。
- 使用 REST 做 create/list/query/cancel/result/logs/models/providers。
- 使用 SSE 做 progress 和 terminal state updates。
- 断线重连时以 REST job state 为 source of truth。
- App 退出时关闭 daemon，并预期 running jobs 进入 canceled/interrupted。
- 不直接调用 Python worker。
- 不用 log 文本作为机器状态。

Deferred：

- WebSocket。
- CORS allowlist。
- Go translation provider runtime。
- warm worker pool。
- 多 running job resource scheduler。
- Windows Job Object / 递归进程树终止。
