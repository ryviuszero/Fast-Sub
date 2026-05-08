# Round 12: Electron Daemon Integration And Release Feature Closure

## Summary

Round 12 是 Fast Sub 桌面版发布前的核心功能闭环轮。目标是把 Round 11 的 mock-first Electron shell 接入真实 Go daemon，并在 Round 13 打包发布前完成用户可见核心功能。

本轮完成后，桌面 UI 应能通过真实 daemon 完成模型安装、模型校验、主路径转写、翻译已有 SRT、字幕烧录、配置读写、API key 安全保存、任务进度订阅、取消、失败恢复、结果查看和日志诊断。

Round 13 只做打包、安装器、发布检查、E2E/smoke、诊断 polish 和产品化收口，不再补核心业务能力。

## Goals

- 实现 `DaemonFastSubClient`，与 `MockFastSubClient` 共用 `FastSubClient` interface。
- Electron main process 启动并管理 `fast-sub-go serve --host 127.0.0.1 --port 0 --json-ready --max-running-jobs 1`。
- main/preload controlled client 持有 daemon `base_url` 和 bearer token；renderer 不接触 token、Authorization、raw HTTP/SSE 或 raw secret。
- Go daemon 扩展 `model_install`、`translate_srt`、`burn_in` job type。
- 模型安装走独立 `model_install` job，通过同一套 job/SSE/取消/失败/结果模型展示进度。
- `translate_srt` 和 `burn_in` 本轮允许 Go daemon 受控调用现有 `fast-sub` Python CLI 能力，后续再逐步 Go 原生化。
- 配置读写真实落地，普通设置写入 Fast Sub 配置文件。
- API key 和 provider secret 使用 Electron main process 管理的 secret storage；首选 `keytar` 保存到 OS keychain / Windows Credential Manager，必要时 fallback 到 Electron `safeStorage` + 本地加密 secret store。配置文件只保存 alias、masked 状态或 keychain reference。
- mock 模式继续保留，用于无 daemon、无模型、无网络的 UI 开发和默认测试。

## Non-goals

- 不做 Electron 打包、签名、安装器和发布流程。
- 不重写 Go 原生 translation runtime。
- 不重写 Go 原生 burn-in runtime，除非只是复用已有 Go/CLI 能力的薄封装。
- 不把 Python worker、ffmpeg、whisper.cpp 或 provider runtime 直接暴露给 renderer。
- 不实现 WebSocket、远程 Web 控制、本机 daemon 公网访问、多用户权限或云同步。
- 不实现复杂多 running job 资源调度、priority queue、retry/DLQ、warm worker pool。
- 不在默认测试中访问真实网络、真实 OpenAI、真实模型、真实 ffmpeg、真实 whisper.cpp 或 GPU。

## Branch Plan

推荐分支：

```text
codex/fast-sub-round12-daemon-integration
```

Round 12 覆盖 UI、daemon API、配置和安全存储，建议一个主分支推进，避免 main/preload/renderer/daemon contract 漂移。实现时可以按 workstream 分阶段提交，合并前按用户要求 squash 成一个 reviewable commit。

分支内每完成一个主要 workstream，都必须更新 `ui-docs/project-tracker.md`，记录完成内容、验证命令、剩余问题和下一步。

## Implementation Units

Round 12 范围包含 Electron、Go daemon、Python CLI bridge、配置和安全存储，必须按以下顺序推进。除非前一个单元的 contract 和测试边界已经稳定，否则不要跳到后续 UI 集成。

| 单元 | 名称 | 范围 | 验收 |
|---|---|---|---|
| 12.1 | Daemon API contract 扩展 | 更新 `go-docs/specs/daemon-api.md`，补 `model_install`、`translate_srt`、`burn_in`、config、transient secret reference 边界和 fixtures | UI 不再猜 API；fake daemon fixtures 覆盖新增 job type |
| 12.2 | Daemon lifecycle 和 ready bridge | Electron main 启动 daemon、读取 ready JSON、保存 token、处理超时/退出/repair | renderer 不接触 token；ready 成功和失败路径可测 |
| 12.3 | REST/SSE client 和状态映射 | 实现 `DaemonFastSubClient` adapter、REST envelope 映射、fetch-based SSE、重连和 `events_lost` resync | job progress、terminal event、401、断线和 unsubscribe 可测 |
| 12.4 | Config 和 secret storage 基础 adapter | 真实配置读写、atomic write、schema version、secret storage adapter、provider secret 传递策略 | API key 不进配置文件；fake keytar/safeStorage 测试通过 |
| 12.5 | 真实 transcribe job 接入 | 主界面创建真实 `transcribe` job，展示进度、取消、完成和日志 | 小媒体手动 smoke 可生成 SRT；保存配置会影响后续默认 request |
| 12.6 | `model_install` job | 模型安装通过 job/SSE 展示进度、失败、取消、重试和结果 | 模型页和首次启动页从 `listModels()` 重新同步真实状态 |
| 12.7 | `translate_srt` / `burn_in` bridge | Go daemon 受控调用 Python CLI 或等效 CLI 能力，接入任务队列和结果 | CLI resolver、参数白名单、取消、失败、redacted logs 和小 fixture smoke 可用 |
| 12.8 | UI 集成和回归收口 | 默认切真实 daemon client，保留 mock/debug；诊断、错误恢复和回归测试 | Round 13 不再需要新增核心业务功能 |

Round 12 的实现顺序是：先 contract，后 daemon bridge，再 config/secret 基础 adapter，然后真实 job，最后 UI 回归收口。真实 job 的默认 provider/model/output/device 必须使用保存后的配置；显式 UI request 参数仍可覆盖配置默认值。

12.1 的最小交付物：

- `go-docs/specs/daemon-api.md` 写明 `model_install`、`translate_srt`、`burn_in` 的 request/result/event shape。
- 写明 model install result、verify result、job result、log result 和 error envelope。
- 写明 daemon config API：`GET /v1/config` 和 `PATCH /v1/config` 是 Fast Sub runtime 配置的唯一写入入口；Electron 本地只保存 UI 偏好。
- 写明 `GET /v1/config` 返回脱敏 config view model，`PATCH /v1/config` 使用 merge patch 语义，成功后返回更新后的 config view model。
- 写明 provider secret 不进入 daemon persisted config/logs/events 的规则。
- 写明 transient secret channel 的具体契约：推荐使用一次性 secret reference / handle；raw secret 不进入 persisted job metadata、events、logs、stdout、stderr 或 renderer state。
- 写明 `secret_ref` 由 Electron main process 生成和持有，daemon 只接收 opaque reference；补齐过期、重复使用、不存在、session 不匹配和 secret storage 读取失败等错误。
- 提供 fake daemon fixtures，覆盖新增 job type、SSE event、errors、model install 和 config/secret 状态。
- 12.1 完成前，Electron adapter 不得猜测新增 request/response shape，不创建真实 `DaemonFastSubClient` adapter，不切换 UI 默认运行模式。

## Workstream 1: Daemon Lifecycle And Client Bridge

- Electron main process 启动 `fast-sub-go serve --host 127.0.0.1 --port 0 --json-ready --max-running-jobs 1`。
- stdout ready JSON 是唯一启动握手来源；不得解析 stderr 判断 ready。
- ready JSON 必须包含 `schema_version`、`ready`、`base_url`、`token`、`pid`。
- daemon token 只保存在 main/preload controlled adapter 的内存中，不写磁盘、不进 renderer state、不进日志。
- app 退出时关闭 daemon；daemon 退出、ready 超时、ready JSON 格式错误、端口不可用都映射为 `UiError`。
- Windows 下必须至少处理直接 daemon 子进程关闭和取消；如果本轮不实现完整 Windows Job Object / 递归进程树终止，必须在文档和诊断中记录限制。
- repair 或 app 退出时应尽量避免遗留 `fast-sub-go`、Python CLI、ffmpeg 等孤儿进程；无法保证时必须提供诊断提示。
- `repairDaemon()` 负责重启 daemon、重新读取 ready JSON、重新同步 health/models/providers/jobs。
- `health()` 和 `version()` 可在 daemon 未授权状态下探测；业务 API 必须带 bearer token。

## Workstream 2: DaemonFastSubClient

- 新增 `DaemonFastSubClient` renderer-facing facade 和 main/preload controlled adapter。
- renderer 只调用 typed allowlist API，不拼 URL、不设置 Authorization header、不打开 raw SSE。
- `FastSubClient` contract 需要补充模型安装 job 语义：
  - 推荐新增 `createModelInstallJob(modelId): Promise<JobDetail>`。
  - 保留 `installModel(modelId): Promise<ModelStatus>` 只用于兼容 UI 旧调用，内部创建 `model_install` job 后返回 `installing` 状态，并包含 `installJobId`。
  - 实现层和测试应优先使用 `createModelInstallJob()`，避免长任务被误当成短请求。
  - 新增 `removeModel(modelId): Promise<ModelStatus>`，映射 daemon `DELETE /v1/models/{model_id}`；renderer 只传 manifest model id，不传 raw path。
- `desktop/shared/contracts/types.ts` 需要同步更新：
  - `JobKind` 增加 `model_install`。
  - `ModelStatus` 增加可选 `installJobId?: string`。
  - `FastSubClient` 增加 `createModelInstallJob(modelId): Promise<JobDetail>`。
  - `FastSubClient` 增加 `removeModel(modelId): Promise<ModelStatus>`。
  - mock client、daemon client、tests 和 fixtures 必须使用同一份 contract。
- client 实现：
  - `health`
  - `version`
  - `getEnvironmentStatus`
  - `repairDaemon`
  - `getConfig`
  - `updateConfig`
  - `listModels`
  - `installModel`
  - `verifyModel`
  - `listProviders`
  - `testProvider`
  - `createJob`
  - `listJobs`
  - `getJob`
  - `cancelJob`
  - `cancelAllJobs`
  - `getJobResult`
  - `getJobLogs`
  - `deleteJob`
  - `subscribeJobEvents`
  - `createModelInstallJob`
  - `removeModel`
- REST response envelope 统一映射为 UI view model；不把 raw HTTP response、raw JSON envelope、daemon job id、token 或 raw errors 暴露到普通主界面。
- 401 映射为“本地服务认证失效”，提供 `repairDaemon` 恢复动作。
- daemon disconnected 映射为“本地服务中断”，提供重新连接/一键修复。

## Workstream 3: SSE And Job State

- `subscribeJobEvents(jobId, handlers)` 通过 main/preload controlled client 订阅 daemon SSE。
- SSE 实现固定采用 main process fetch-based SSE，不使用 renderer 原生 `EventSource`。
- fetch-based SSE 必须支持 Authorization header、`AbortController`、`Last-Event-ID`、heartbeat timeout、可控重连和 fatal error。
- 支持 `Last-Event-ID` 重连。
- 重连策略必须区分：
  - 401：fatal，映射为“本地服务认证失效”，提示 `repairDaemon()`。
  - 404：job 不存在，映射为可理解错误。
  - 5xx / 网络断开：可重试，带退避。
  - 用户取消 / unsubscribe：立即停止，不自动重连。
- 支持 daemon events：
  - `created`
  - `queued`
  - `started`
  - `progress`
  - `log`
  - `warning`
  - `completed`
  - `failed`
  - `canceled`
  - `interrupted`
  - `events_lost`
  - `heartbeat`
- 映射到 UI events：
  - `snapshot`
  - `progress`
  - `log_tail`
  - `succeeded`
  - `failed`
  - `canceled`
  - `events_lost`
- `events_lost` 后必须调用 `getJob(jobId)` 重新同步，不继续相信旧进度。
- heartbeat 不改变 UI state。
- log/warning 只进入 redacted 日志或非阻断提示，不驱动状态机。
- 取消 job 时必须调用 `unsubscribe()`，避免 SSE/定时器泄漏。

## Workstream 4: Config And Secret Storage

- 配置读写本轮真实落地。
- Fast Sub runtime 配置写入统一通过 daemon config API：
  - `GET /v1/config`
  - `PATCH /v1/config`
- Electron main process 不直接写 Fast Sub runtime 配置文件；Electron 本地只保存窗口状态、debug/mock 偏好等纯 UI 偏好。
- `PATCH /v1/config` 成功后，daemon provider/model/job runtime 必须读取到更新后的配置或触发配置刷新。
- 配置写入必须 validate 后再写。
- 配置写入必须使用 atomic write：写临时文件，flush 成功后 rename/replace。
- 写配置失败时必须保留旧配置，并返回可恢复 `UiError`。
- 配置文件必须包含 schema version 或等效版本字段；后续可做 migration。
- 读取损坏配置时必须提供恢复动作，例如使用默认配置、打开配置位置或备份损坏文件。
- masked key、key alias、环境变量名和 keychain reference 不能被误当作 raw API key 写回。
- 普通设置写入 Fast Sub 配置文件，至少覆盖：
  - 默认语言
  - 输出位置
  - 输出冲突策略
  - 设备
  - 默认 ASR provider
  - 默认 translation provider
  - 默认 ASR model
  - 默认 translation model
  - word timestamps
  - keep temp
  - OpenAI-compatible base URL
  - OpenAI-compatible model
  - OpenAI upload format
- API key 和 provider secret 不写入配置文件。
- 首选 `keytar`，由 Electron main process 保存、读取、删除 provider secret。
- 因 `keytar` 是 native module 且上游仓库已归档，Round 12 实现前必须确认当前 Electron/Node ABI、Windows/macOS/Linux 预编译或 rebuild 兼容性。
- 如果 `keytar` 兼容性不可接受，备选方案是 Electron `safeStorage` + 本地加密 secret store；Linux 上必须检测 `safeStorage.getSelectedStorageBackend()`，不能在 `basic_text` 后端下静默宣称安全存储。
- secret 从 Electron 到 daemon 的传递策略：
  - daemon 启动时不注入全部 provider secret。
  - renderer 永远不读取 raw secret。
  - 创建 API job 或 live provider test 时，Electron main 从 keytar/safeStorage 读取 secret，并通过 main-controlled transient secret channel 传给 daemon 或 job runner。
  - transient secret 推荐使用一次性 secret reference / handle；默认单次使用、短 TTL，建议 5 分钟，使用后立即失效。
  - raw secret 不得放入普通 persisted request、daemon persisted config、job metadata、events、logs、stdout、stderr 或 renderer state。
  - `secret_ref` 本身也不得原样持久化到 job metadata、events、logs、stdout、stderr 或 renderer state；需要落盘时只能写入 `[REDACTED_SECRET_REF]` 或等效脱敏占位。
  - 如果 Round 12 不新增 daemon secret channel，则 API job 必须继续使用 `api_key_env`，并在 UI 中明确提示“保存到系统凭据库的 key 暂不用于 daemon API 调用”；但这只能作为临时降级路径，不能作为最终验收路径。
- renderer 只看到 key alias、masked credential、是否已配置。
- 配置文件只保存 alias、masked 状态、环境变量名或 keychain reference。
- `testProvider(providerId, "live")` 使用 keytar/safeStorage 中的 secret 或配置中的 `api_key_env`，但不得将 raw secret 返回给 renderer。
- 删除 provider secret 后，provider 状态应刷新为 `missing_api_key` 或对应用户文案。

## Workstream 5: Real Transcribe Job

- 主界面一键生成走真实 daemon `transcribe` job。
- 真实 job 的默认 provider/model/output/device 必须使用保存后的配置；显式 UI request 参数仍可覆盖配置默认值。
- 支持当前 Go daemon provider：
  - `local-faster-whisper`
  - `local-whisper-cpp`
  - `api-openai-transcription`
- API provider 必须显式选择并确认上传；不能因本地 provider 不可用自动切 API。

## Workstream 6: Model Install Job

- Go daemon 新增独立 `model_install` job type。
- UI 的 `createModelInstallJob(modelId)` 创建 `model_install` job 并进入任务队列/模型页进度展示。
- 旧 `installModel(modelId)` 不能做长耗时 HTTP 阻塞安装；如保留该方法，必须委托 `createModelInstallJob()` 并返回带 `installJobId` 的 installing 状态。
- model install job 支持：
  - queued/running/succeeded/failed/canceled/interrupted 状态。
  - 下载进度、校验进度、当前文件或阶段文案。
  - cancel。
  - redacted error。
  - result 中返回 model id、status、path、size summary。
- `verifyModel(modelId)` 可走短请求；如果后续校验变长，可升级为 job，但 Round 12 默认保留短请求。
- `removeModel(modelId)` 可走短请求，但 daemon 只能删除 manifest 中声明的本机模型目录，不能接受 renderer 传入的任意路径。
- 模型页和首次启动页必须使用真实 `listModels()` 状态刷新，不能只相信 install job 的本地乐观状态。
- 模型安装失败必须提供重试和诊断入口。

## Workstream 7: Translate SRT And Burn In Bridge

### Translate SRT

- Go daemon 新增 `translate_srt` job type。
- Round 12 允许 Go daemon 受控调用现有 `fast-sub translate` Python CLI。
- 必须使用 `exec.CommandContext` 和参数白名单，不拼 shell 字符串。
- Python CLI resolver 优先级：
  1. 显式配置的 CLI command/path。
  2. 环境变量 `FAST_SUB_PYTHON_CLI` 或等效 Go config 字段。
  3. 当前虚拟环境/开发环境中的 `uv run fast-sub`。
  4. PATH 中的 `fast-sub`。
  5. 打包后随应用分发的受控 Python CLI 入口。
- CLI resolver 失败必须返回结构化 `missing_dependency` 或 `runtime_not_found`，并给出用户可执行的修复提示。
- Python CLI bridge 必须 scrub 环境变量，只传必要变量和明确的 provider secret reference。
- stdout/stderr 必须按 UTF-8 或可控编码读取，避免 Windows GBK 解码崩溃；无法解码的字节必须以 replacement 方式进入 redacted log。
- JSON stdout 和日志必须分离，不能把第三方日志混入 JSON contract。
- 取消时必须取消 context，并尽量终止直接子进程；如果子进程树清理不完整，必须记录限制和诊断提示。
- 支持取消、失败、结果和 redacted logs。
- 远程翻译 provider 必须显示上传字幕文本确认。

### Burn In

- Go daemon 新增 `burn_in` job type。
- Round 12 允许 Go daemon 受控调用现有 `fast-sub burn` 或等效 CLI 能力。
- 必须使用 `exec.CommandContext` 和参数白名单，不拼 shell 字符串。
- 使用与 `translate_srt` 相同的 Python CLI resolver 和 missing runtime 错误规则。
- Python/ffmpeg bridge 必须遵守和 `translate_srt` 相同的编码、环境变量、取消、redaction 和 JSON/log 分离规则。
- 支持取消、失败、结果和 redacted logs。

## Workstream 8: UI Integration

- 默认运行模式切到真实 daemon client；mock/debug 模式保留。
- 12.8 前，开发模式可以继续保留 mock/fake daemon 作为默认或显式启动方式；12.8 验收时才把真实 daemon client 作为桌面 UI 默认运行模式。
- 生产模式不能因为 daemon 启动失败或认证失败而静默切换到 mock；必须显示本地服务错误和恢复动作。
- 开发和测试可通过明确环境变量、启动参数或隐藏 debug panel 切换 mock/fake daemon。
- mock/debug 模式必须在 UI 或诊断中明确标记，避免用户误以为正在执行真实任务。
- 首次启动页真实检查 daemon、ffmpeg/ffprobe、模型目录、默认 ASR、默认 NLLB。
- 主界面真实创建 transcribe job。
- 翻译 SRT 工具真实创建 `translate_srt` job。
- 字幕烧录工具真实创建 `burn_in` job。
- 模型管理页真实创建 `model_install` job 并展示进度/失败/重试。
- 任务队列展示所有真实 job 类型。
- 设置页保存真实配置，API key 保存到 Electron main process 管理的 secret storage。
- 诊断页展示 daemon 状态、最近 redacted logs、结构化错误、重启/修复入口。
- 普通主界面不得显示 daemon、SSE、job id、JSON envelope、worker、CLI command 或 provider runtime 细节。

## Workstream 9: Documentation Updates

- 更新 `ui-docs/project-tracker.md`：记录 Round 12 spec、已定决策、待实现 workstreams。
- 更新 `ui-docs/architecture.md`：把 Round 12 后真实 daemon client、model_install job、secret storage、config adapter 写入架构。
- 更新 `ui-docs/code-standards.md`：明确 secret storage、daemon IPC、SSE client、config adapter 的代码规则。
- 更新 `go-docs/specs/daemon-api.md`：新增 `model_install`、`translate_srt`、`burn_in`、model install endpoint/job contract 和 config/secret 边界。
- 如果新增 daemon request/response schema，同步 golden fixtures 或 contract tests。
- 文档更新顺序必须是：先更新 daemon API contract，再实现 Electron adapter；不要让 UI 端先猜测 daemon request/response shape。12.1 未完成前，不创建真实 `DaemonFastSubClient` adapter，不切换 UI 默认运行模式。

## Testing

默认验证：

```bash
cd desktop && npm run typecheck
cd desktop && npm test
cd desktop && npm run build
cd desktop && npm run smoke
go test ./...
```

测试必须默认使用 fake daemon、fake SSE、fake secret storage、fake CLI runner、fake model installer。

重点覆盖：

- daemon ready JSON 成功、超时、格式错误、进程提前退出。
- renderer 不能读取 token、Authorization、raw API key、raw SSE。
- REST success/error envelope 映射为 UI view model。
- 401 映射为可恢复错误。
- SSE progress、terminal event、heartbeat、events_lost、reconnect。
- `model_install` job 成功、失败、取消、重试、redaction。
- `translate_srt` job 成功、失败、取消，且参数白名单构造。
- `burn_in` job 成功、失败、取消，且参数白名单构造。
- 配置读写 roundtrip。
- secret storage save/read/delete/masked status，包括 keytar 首选路径和 safeStorage fallback。
- `safeStorage` fallback 的可用性检测和 Linux `basic_text` 风险提示。
- 配置文件 validate、atomic write、损坏配置恢复、masked key 不被当作 raw key 写回。
- API key、Authorization、daemon token、signed URL、proxy credential 不出现在 stdout、stderr、JSON、UI、日志、errors report、测试快照。
- 远程 provider 上传确认阻断：确认前不创建 job。
- mock 模式仍然可运行原有 Round 11 flow。

手动真实 smoke 不放入默认 CI，但 Round 12 合入前必须记录结果：

- 测试资产建议放在 `local_tests/round12/`，包括一个小音频或小视频、一个小 SRT、一个小视频和字幕组合；如果资产由用户手动提供，最终记录必须写明路径和来源。
- 使用一个小音频或小视频，通过真实 daemon 生成 SRT。
- 使用一个小 SRT fixture，通过真实 daemon 创建 `translate_srt` job。
- 使用一个小视频和字幕 fixture，通过真实 daemon 创建 `burn_in` job；如果本地缺少 ffmpeg 或 burn 能力，记录阻塞原因和恢复动作。
- 使用真实配置文件保存普通设置，并确认后续任务读取到更新后的设置。
- 使用真实 secret storage 保存、读取、删除一个测试 provider secret，并确认配置文件没有 raw secret。

## Acceptance Criteria

- 桌面 UI 默认真实连接 Go daemon。
- 主界面可以通过真实 daemon 创建转写任务并看到进度、取消、完成结果和日志。
- 模型安装通过独立 `model_install` job 执行，UI 可查看进度、取消、失败、重试。
- 翻译 SRT 和字幕烧录通过 daemon job type 接入真实功能。
- 设置页写入真实配置，后续任务使用保存后的设置。
- API key 使用 Electron main process 管理的 secret storage 保存；首选 keytar，如兼容性验证失败，则使用已记录并测试通过的 safeStorage fallback，且 Linux `basic_text` 不可静默视为安全存储。配置文件不保存 raw API key。
- daemon 断开、401、events_lost、job failed、job canceled 都有用户可理解恢复路径。
- mock 模式保留，默认测试不依赖真实 daemon、模型、网络、ffmpeg、whisper.cpp、OpenAI 或 GPU。
- Round 13 不再需要新增核心业务功能，只做发布和产品化收口。
