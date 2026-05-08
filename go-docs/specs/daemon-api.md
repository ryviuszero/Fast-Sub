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
  "target_language": "zh",
  "output_format": "srt",
  "word_timestamps": "off",
  "options": {
    "yes": false,
    "overwrite": false,
    "output_conflict": "ask",
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
model_install
translate_srt
burn_in
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

`GET /v1/providers` 当前按任务暴露 provider metadata：

- ASR：`local-faster-whisper`、`local-whisper-cpp`、`api-openai-transcription`。
- Translation：`local-nllb-ct2`、`web-bing`、`web-google`、`api-openai-chat`。

Provider metadata 必须包含 `type` / `location` / `privacy` / `requires_model` / `requires_api_key` / `supports_batch` / `supports_word_timestamps` / `supported_languages` / `compatible_model_types` 等 UI 可用字段。renderer 不读取 raw secret；API key 只通过 Electron main process 和 daemon secret/config adapter 管理。

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

## Round 12 Extensions

以下 contract 是 Round 12 Electron daemon integration 的扩展。Electron adapter 以本节 request/response shape 和 fake daemon fixtures 为接入边界。

### Additional Job Types

Round 12 在 `POST /v1/jobs` 中新增：

```text
model_install
translate_srt
burn_in
```

`transcribe` 保持现有语义。所有新增 job type 继续复用同一套 job state machine、SSE events、cancel/result/logs/delete endpoint 和 response envelope。

当前实现说明：

- `model_install` 已作为独立 job type 接入 job/SSE/cancel/result/logs/delete 通路，并复用现有 Go model installer；UI 必须在完成后通过 `GET /v1/models` 重新同步模型真实状态。
- `translate_srt` 已通过受控 Python CLI bridge 接入现有 `fast-sub translate`：使用 `exec.CommandContext`、参数白名单、环境变量 scrub、UTF-8 replacement decode、JSON stdout/log 分离和 redacted logs；默认测试使用 fake CLI，不访问真实网络、真实 OpenAI、真实模型。
- `burn_in` 已作为 daemon job type 接入，当前仍使用受控 placeholder bridge 写入小型输出文件，不拼 shell、不暴露 ffmpeg 细节；真实 ffmpeg bridge 仍是 Round 12 后续收口项。
- `GET /v1/config` / `PATCH /v1/config` 已作为 daemon-owned config API 暴露；当前 PATCH validate 并返回 merge 后 view model，持久 atomic writer 后续继续完善。

### Create Model Install Job

推荐 UI 侧新增 `createModelInstallJob(model_id)`，映射为：

```json
{
  "schema_version": 1,
  "type": "model_install",
  "model_id": "whisper-small",
  "provider": "local-faster-whisper",
  "options": {
    "verify_after_download": true
  }
}
```

`options.overwrite=true` 是显式覆盖开关，只能由 Electron main process 在用户确认覆盖后写入请求。默认或缺省时，如果 `output_path` 已存在，job 必须以 `output_exists` 失败；renderer 应显示覆盖/跳过/另存为确认，不得静默覆盖。

规则：

- `model_install` 是长任务，不能作为阻塞式短 HTTP 请求实现。
- result 必须包含 model id、最终 status、path 或 path summary、size summary。
- log 和 error 必须 redacted。
- 取消时进入 `canceling`，最终进入 `canceled` 或带结构化错误的 terminal state。
- `GET /v1/models` 是模型真实状态来源；UI 不能只相信 install job 的本地乐观状态。

示例 result：

```json
{
  "schema_version": 1,
  "ok": true,
  "result": {
    "job_id": "job_model_abcdef",
    "type": "model_install",
    "status": "succeeded",
    "model_id": "whisper-small",
    "model_status": "available",
    "path_summary": "%FAST_SUB_HOME%/models/whisper-small",
    "size_bytes": 123456789
  },
  "warnings": []
}
```

### Verify Model

Round 12 默认将 model verify 保留为短请求；如果后续校验耗时过长，可升级为 job。

Endpoints：

```http
POST /v1/models/{model_id}/verify
DELETE /v1/models/{model_id}
```

返回：

```json
{
  "schema_version": 1,
  "ok": true,
  "result": {
    "model_id": "whisper-small",
    "status": "available",
    "verified": true,
    "path_summary": "%FAST_SUB_HOME%/models/whisper-small",
    "warnings": []
  },
  "warnings": []
}
```

`DELETE /v1/models/{model_id}` 只删除 Go-managed model store 中该 manifest id 对应的受控模型目录，不能删除任意路径，不能接受 renderer 提供的 raw path。删除成功后返回同一模型的 missing 状态：

```json
{
  "schema_version": 1,
  "ok": true,
  "result": {
    "model_id": "whisper-small",
    "status": "missing",
    "verified": false,
    "removed": true,
    "path_summary": "%FAST_SUB_HOME%/models/whisper-small",
    "warnings": []
  },
  "warnings": []
}
```

### Translate SRT Job

`translate_srt` 用于桌面端“翻译已有 SRT”工具。Round 12 允许 Go daemon 受控调用现有 `fast-sub translate` Python CLI，后续再逐步 Go 原生化。

Request：

```json
{
  "schema_version": 1,
  "type": "translate_srt",
  "input_path": "C:/media/input.srt",
  "output_path": "C:/media/input.zh.srt",
  "provider": "web-bing",
  "model": "",
  "source_language": "auto",
  "target_language": "zh",
  "mode": "bilingual",
  "options": {
    "bilingual_order": "original-first",
    "batch_size": 20,
    "timeout_seconds": 30,
    "sleep_seconds": 0.2,
    "secret_ref": ""
  }
}
```

Rules：

- 远程 provider（`web-bing`、`web-google`、`api-openai-chat`）必须由 UI 完成字幕文本上传确认后才能创建 job；daemon 也会在缺少确认时拒绝执行。
- `local-nllb-ct2` 需要明确源语言，不建议使用 `auto`。
- `api-openai-chat` 需要 OpenAI-compatible API key/base URL/model 配置完整；raw key 不进入 renderer state。
- Go daemon 调 Python CLI 时必须使用 `exec.CommandContext` 和参数白名单，不拼 shell 字符串。
- Python CLI resolver 失败返回 `missing_dependency` 或 `runtime_not_found`。
- stdout/stderr 必须按 UTF-8 或可控 replacement 解码；JSON stdout 和 logs 必须分离。
- provider secret 只能通过 transient secret reference、受控环境变量或 `api_key_env` 使用；raw secret 不进入 persisted job metadata、events、logs、stdout、stderr。

### Burn In Job

`burn_in` 用于桌面端“字幕烧录”工具。Round 12 允许 Go daemon 受控调用现有 `fast-sub burn` 或等效 CLI 能力。

Request：

```json
{
  "schema_version": 1,
  "type": "burn_in",
  "input_path": "C:/media/input.mp4",
  "subtitle_path": "C:/media/input.srt",
  "output_path": "C:/media/input.burned.mp4",
  "options": {
    "font_preset": "default",
    "font_size": 24,
    "overwrite": false
  }
}
```

Rules：

- 必须使用 `exec.CommandContext` 和参数白名单，不拼 shell 字符串。
- ffmpeg/Python bridge 遵守 translate_srt 相同的编码、取消、redaction 和 JSON/log 分离规则。
- result 返回 output path summary、duration summary、size summary；不要返回 raw ffmpeg command。

### Job Result Shape

新增 job type 的 result 应保持可泛化：

```json
{
  "job_id": "job_abcdef",
  "type": "translate_srt",
  "status": "succeeded",
  "outputs": [
    {
      "kind": "subtitle",
      "path": "C:/media/input.zh.srt",
      "path_summary": "input.zh.srt"
    }
  ],
  "summary": {
    "processed_items": 1,
    "duration_ms": 1234
  }
}
```

### Config Boundary

Round 12 需要真实配置读写。Fast Sub runtime 配置统一由 Go daemon 管理，Electron main process 不直接写 runtime 配置文件；Electron 本地只保存窗口状态、debug/mock 偏好等纯 UI 偏好。

Daemon 必须暴露：

```text
GET   /v1/config
PATCH /v1/config
```

`GET /v1/config` 返回 daemon 已解析、已脱敏、可供桌面 UI 编辑的 config view model，而不是原始配置文件文本。

示例：

```json
{
  "schema_version": 1,
  "ok": true,
  "result": {
    "config_schema_version": 1,
    "language": "auto",
    "target_language": "zh",
    "output_directory": "source",
    "output_conflict": "ask",
    "output_format": "srt",
    "output_type": "original_srt",
    "device": "auto",
    "default_asr_provider": "local-faster-whisper",
    "default_translation_provider": "local-nllb-ct2",
    "default_asr_model": "whisper-small",
    "default_translation_model": "nllb-200-distilled-600m-ct2-int8",
    "word_timestamps": false,
    "keep_temp": false,
    "openai_compatible": {
      "base_url": "https://api.openai.com/v1",
      "model": "",
      "upload_format": "wav",
      "api_key_alias": "openai-default",
      "api_key_status": "missing"
    }
  },
  "warnings": []
}
```

`PATCH /v1/config` 使用 merge patch 语义：只更新传入字段，未传字段保持不变。daemon 必须 validate patch 后再写入配置文件。成功后返回更新后的 config view model。

示例 request：

```json
{
  "schema_version": 1,
  "patch": {
    "output_conflict": "skip",
    "output_format": "vtt",
    "output_type": "bilingual_srt",
    "target_language": "zh",
    "device": "cpu",
    "word_timestamps": true,
    "openai_compatible": {
      "base_url": "http://localhost:8000/v1",
      "model": "Systran/faster-whisper-small"
    }
  }
}
```

示例 success：

```json
{
  "schema_version": 1,
  "ok": true,
  "result": {
    "config_schema_version": 1,
    "output_conflict": "skip",
    "device": "cpu",
    "word_timestamps": true,
    "openai_compatible": {
      "base_url": "http://localhost:8000/v1",
      "model": "Systran/faster-whisper-small",
      "upload_format": "wav",
      "api_key_alias": "openai-default",
      "api_key_status": "missing"
    }
  },
  "warnings": []
}
```

示例 validation error：

```json
{
  "schema_version": 1,
  "ok": false,
  "error": {
    "code": "invalid_config",
    "message": "configuration patch is invalid.",
    "action_hint": "Review the highlighted settings and try again.",
    "details": {
      "fields": [
        {
          "path": "device",
          "code": "unsupported_value",
          "message": "device must be one of auto, cpu, cuda."
        }
      ]
    }
  },
  "warnings": []
}
```

要求：

- 配置写入必须 validate 后再写。
- 配置写入必须 atomic write：写临时文件，flush 成功后 rename/replace。
- 写失败保留旧配置。
- 配置文件包含 schema version 或等效版本字段。
- 读取损坏配置时返回可恢复错误，并提供使用默认配置、打开配置位置或备份损坏文件的恢复动作。
- masked key、key alias、环境变量名和 keychain reference 不能被误当作 raw API key 写回。
- 配置文件不得保存 raw API key、Authorization、daemon token、signed URL credential 或 proxy credential。
- `PATCH /v1/config` 成功后，daemon provider/model/job runtime 必须读取到更新后的配置或触发配置刷新。

### Secret Boundary

Round 12 的 provider secret 由 Electron main process 管理的 secret storage 保存。首选 keytar；如果 keytar 与当前 Electron/Node ABI 不兼容，可以 fallback 到 Electron safeStorage + 本地加密 secret store。Linux safeStorage 的 `basic_text` backend 不可静默宣称为安全存储。

daemon 规则：

- daemon 启动时不注入全部 provider secret。
- renderer 永远不读取 raw secret。
- 创建 API job 或 live provider test 时，Electron main 可以读取 secret，并通过 main-controlled transient secret channel 传给 daemon 或 job runner。
- 推荐 transient secret 使用一次性 secret reference / handle；默认单次使用、短 TTL，建议 5 分钟，使用后立即失效。
- raw secret 不得写入 daemon persisted config、job metadata、events、logs、stdout、stderr、errors report 或 renderer state。
- `secret_ref` 本身也不得原样持久化到 job metadata、events、logs、stdout、stderr 或 renderer state；需要落盘时只能写入 `[REDACTED_SECRET_REF]` 或等效脱敏占位。
- 如果 Round 12 暂不实现 daemon secret channel，API job 只能临时继续使用 `api_key_env`；这不是最终验收路径。

Round 12 推荐由 Electron main process 生成和持有 `secret_ref`，daemon 只接收 opaque reference。daemon 不应提供可列出或读取 secret 的 API。实现方式：

1. Electron main 从 secret storage 读取 raw provider secret。
2. Electron main 创建一次性 `secret_ref`，例如 `secretref_<random>`。
3. Electron main 将 `secret_ref -> raw secret` 保存到 main process 内存 map，设置短 TTL，建议 5 分钟。
4. Electron main 创建 job 或 live provider test 时，只把 `secret_ref` 放入 daemon request。
5. daemon job runner 需要 secret 时，通过 main-controlled transient secret channel 按 `secret_ref` 请求 secret。
6. Electron main 验证 `secret_ref` 未过期、未消费、调用来源属于当前 daemon session，然后返回 raw secret 给 main-controlled adapter 或 job runner。
7. `secret_ref` 成功消费后立即失效；job 取消、失败、完成、daemon repair 或 app 退出时也必须清理。

失败规则：

- `secret_ref` 过期：返回 `secret_ref_expired`。
- `secret_ref` 重复使用：返回 `secret_ref_consumed`。
- `secret_ref` 不存在：返回 `secret_ref_not_found`。
- daemon session 不匹配：返回 `secret_ref_invalid_session`。
- secret storage 读取失败：返回 `secret_unavailable`。

请求中只允许传 secret reference：

```json
{
  "options": {
    "secret_ref": "secretref_opaque_once"
  }
}
```

`secret_ref` 是不透明、短期、一次性引用，不得可逆推出 provider secret。

### Desktop Client Contract Updates

Round 12 需要同步更新 `desktop/shared/contracts/types.ts`：

- `JobKind` 增加 `model_install`。
- `ModelStatus` 增加可选 `installJobId?: string`。
- `FastSubClient` 增加 `createModelInstallJob(modelId): Promise<JobDetail>`。
- `installModel(modelId): Promise<ModelStatus>` 仅保留兼容语义，内部创建 `model_install` job 后返回 `installing` 状态和 `installJobId`。
- `FastSubClient` 增加 `removeModel(modelId): Promise<ModelStatus>`，映射到 daemon `DELETE /v1/models/{model_id}`，renderer 只传 model id，不传 raw path。
- mock client、daemon client、fake fixtures 和 tests 必须共享同一份 contract。

### Round 12 Fixture Requirements

12.1 完成时应提供 fake daemon fixtures。建议位置：

```text
desktop/test/fixtures/daemon/round12/
```

如果 Go 侧也需要 contract fixture，可同步放置或复制到：

```text
go-docs/fixtures/daemon/round12/
```

fixtures 至少覆盖：

- `model_install` queued/running/progress/succeeded/failed/canceled。
- `translate_srt` succeeded/failed/canceled。
- `burn_in` succeeded/failed/canceled。
- SSE `events_lost` 后 REST job snapshot。
- 401 unauthorized。
- daemon disconnected。
- config read/write success、validation failure、atomic write failure、corrupt config recovery。
- secret configured/missing/deleted/masked 状态。
- secret_ref success、expired、consumed、not_found、invalid_session、secret_unavailable。
- redaction：API key、Authorization、daemon token、signed URL、proxy credential 不出现在 JSON、logs、events 或测试快照。

Round 12 实现顺序规则：

- 12.1 contract 和 fake fixtures 未完成前，Electron adapter 不得猜测新增 request/response shape。
- 12.1 未完成前，不创建真实 `DaemonFastSubClient` adapter，不切换 UI 默认运行模式。

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
