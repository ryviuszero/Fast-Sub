# Fast Sub Electron 应用架构

本文档只描述 Fast Sub 桌面 Electron 应用的架构，不描述整个 Fast Sub 后端项目的内部实现。Electron 应用的职责是提供普通用户可理解的本地字幕工作台：首次启动检查、拖拽生成字幕、任务队列、模型和 provider 设置、诊断入口，以及对远程上传行为的显式确认。Go daemon、Python worker、ffmpeg、whisper.cpp 和远程 API 都是 Electron 应用通过 `FastSubClient` 间接访问的外部能力。

## 技术堆叠

| 层 | 技术 | 作用 | 关键约束 |
| --- | --- | --- | --- |
| 桌面壳 | Electron main process | 创建窗口、管理应用生命周期、启动/关闭本机 Go daemon、处理系统对话框 | 不承载 UI 业务状态；不把 daemon token 暴露给 renderer |
| 安全桥 | Electron preload + IPC | 向 renderer 暴露受控 API，如选择文件、打开目录、调用 client、订阅任务事件 | 不暴露 Node.js、shell、token、API key 或任意文件系统访问 |
| Renderer | React + TypeScript + Vite | 实现原型中的页面、组件、表单、状态和交互 | 只能通过 `FastSubClient` 访问后端数据 |
| 原型来源 | `dev-docs/ui-docs/prototype` | 提供视觉、文案、状态和信息架构参考 | 原型不是运行时 contract；真实 contract 来自 client types 和 daemon schema |
| UI 状态层 | React state / 后续轻量 store | 管理当前页面、选中文件、表单草稿、任务列表、设置草稿和 toast/dialog | 不能把 UI state 当作后端真相 |
| Client 抽象 | `FastSubClient` interface | 隔离 UI 与后端实现；统一 mock 和 daemon client | UI 不能知道当前是 mock 还是真实 daemon |
| Mock client | `MockFastSubClient` | 支撑 mock-first 开发，模拟完整用户流程和失败状态 | 必须覆盖缺模型、安装失败、取消、远程确认、daemon disconnected 等场景 |
| Daemon client | `DaemonFastSubClient` | 通过 REST + SSE 访问本机 Go daemon | 真实 HTTP/SSE、bearer token、401、断线、SSE reconnect、events_lost 只能在 main/preload controlled client 中处理 |
| 本地服务边界 | Go daemon on `127.0.0.1` | 提供 health/version/models/providers/jobs API 和 SSE events | Electron 只依赖公开 API，不调用 daemon 内部包 |
| 本机持久设置 | Daemon config API / Electron store | 保存非敏感运行设置、默认选项、最近路径、折叠状态 | 运行配置通过 `GET/PATCH /v1/config` 写入 daemon config；不保存 API key、daemon token 或 raw secret |
| 安全存储 | Electron `safeStorage` + 本地加密 secret store + daemon transient secret store | 保存 API key 和 provider secret；创建 API job/live check 时换取一次性 `secret_ref` | renderer 只看到 masked 状态或 key alias；daemon 启动环境不注入全部 secret；后续可评估 OS keychain/keytar |
| 文件入口 | Electron dialog / drag-and-drop | 添加媒体文件、文件夹、SRT、输出目录 | 路径传给 client 前需要基础校验和用户确认 |
| 事件流 | SSE via main/preload controlled client | 推送任务进度、日志摘要、完成、失败、取消、中断 | UI 依赖 progress/status schema，不依赖 raw log 文本 |
| 日志展示 | UI diagnostics panels | 显示 redacted logs、结构化错误、最近事件 | 默认折叠，普通主流程不展示内部细节 |

## 页面和功能边界

Electron 应用的页面结构参考 `dev-docs/ui-docs/prototype/v2/app.jsx` 中的 artboard 分区。

| UI 区域 | 参考原型 | 职责 | 不应该做的事 |
| --- | --- | --- | --- |
| 首次启动 / 环境检查 | `SetupCheck`、`SetupInstall`、`SetupASR`、`SetupTranslation`、`SetupDone`、`SetupModelDownloadFailed` | 检查环境、引导安装依赖、准备默认 ASR/翻译模型、写入默认参数 | 不展示 daemon token、job id、raw JSON |
| 主界面 / 一键生成 | `MainEmpty`、`MainFiles`、`MainAdvancedSettings`、`MainModelsMissing`、`OutputConflictDialog`、`MainGenerating`、`MainDone2` | 添加媒体、展示默认输出、展开详细设置、处理模型缺失、输出冲突、生成进度和结果 | 不暴露 provider 内部实现、worker 细节、SSE event 名称 |
| 子功能 | `ToolTranslateSRT`、`ToolBurnIn` | 翻译已有 SRT、字幕烧录 | 不打断拖拽视频生成字幕的主流程 |
| 任务队列 | `QueueList`、`QueueDetail`、`QueueFailedDetail` | 展示等待中、正在生成、已完成、已失败、已取消；支持取消、重试、查看日志、打开结果 | 不让普通用户必须理解 `created/running/canceling/interrupted` 等内部状态 |
| 设置 / 通用 | `SettGeneral` | 默认语言、输出位置、输出冲突策略、设备、输出类型等 | 不显示配置文件格式 |
| 设置 / 模型管理 | `SettModels`、`SettModelMaintenance` | 模型状态、安装、校验、重试、占用空间 | 不展示下载器内部锁、`.part`、staging directory |
| 设置 / API 服务（历史原型） | `SettAPI`、`SettAPIUploadConfirm` | 当前不作为独立用户入口；base URL、API key alias、模型、上传确认已并入对应 Provider 卡片 | 不在 renderer 保存 raw API key |
| 设置 / Provider 管理 | `SettProviders` | 单页按 `转写 Provider` / `翻译 Provider` 分组；展示 local/api/web/native 分类、状态、隐私说明、默认 provider、配置、live/static test | 不默认联网或上传数据测试 provider |
| 设置 / 诊断 | `SettDiag`、`SettDaemonRecovery`、`SettDiagStructured` | daemon 状态、一键修复、redacted logs、结构化错误、最近事件 | 不展示完整 token、Authorization、API key、signed URL |
| 设置 / Benchmark | `SettBenchmarkPlan` | 作为诊断/规划入口展示 benchmark 能力 | 第一版不把 benchmark 放到主流程 |

## 建议文件夹职责

以下是 Electron 应用后续实现时的建议目录。Round 11 已确定生产 Electron 应用根目录使用 `desktop/`，职责边界应保持。

| 文件夹 | 职责 | 不应该做的事 |
| --- | --- | --- |
| `dev-docs/ui-docs/` | UI 规划、架构、产品流程、原型说明 | 不放真实 secret、本地报告、大文件 |
| `dev-docs/ui-docs/prototype/` | 当前 Vite/React 原型和 artboards | 不作为生产代码目录直接依赖 |
| `desktop/` | Electron 应用根目录 | 不混入 Go/Python 后端实现 |
| `desktop/main/` | Electron main process、窗口、daemon lifecycle、系统菜单、系统 dialog | 不保存 UI 业务状态，不渲染页面 |
| `desktop/preload/` | 安全 IPC bridge、受控文件选择、受控 client 方法暴露 | 不暴露 Node.js 全局能力 |
| `desktop/renderer/` | React UI、页面、组件、路由、样式 | 不调用系统命令，不读取 secret |
| `desktop/renderer/pages/setup/` | 首次启动检查和默认模型准备流程 | 不展示内部 contract 细节 |
| `desktop/renderer/pages/main/` | 拖拽添加文件、一键生成、详细设置、结果状态 | 不承载任务执行逻辑 |
| `desktop/renderer/pages/jobs/` | 任务列表、任务详情、失败详情、日志摘要 | 不直接解析 job 文件夹 |
| `desktop/renderer/pages/tools/` | 翻译 SRT、字幕烧录等独立工具 | 不把次级工具塞进主路径 |
| `desktop/renderer/pages/settings/` | 通用、模型、Provider、诊断、Benchmark 设置页；API 配置内嵌对应 Provider 卡片 | 不保存 raw secret |
| `desktop/renderer/components/` | 通用 UI 组件，如按钮、状态标签、进度条、文件卡片、确认弹窗 | 不发起后端请求 |
| `desktop/renderer/client/` | `FastSubClient` 类型、mock client、daemon client 的 renderer-facing facade / hooks / view-model adapter | 不实现真实 HTTP/SSE，不持有 token，不绕过 preload 安全边界 |
| `desktop/main/client/` | `DaemonFastSubClient` 的真实 daemon adapter、daemon lifecycle、auth、REST/SSE、config 写入 | 不渲染 UI，不保存页面状态 |
| `desktop/preload/client/` | 将 main process client 以受控 IPC API 暴露给 renderer | 不暴露任意 URL、Authorization、shell 或文件系统能力 |
| `desktop/renderer/state/` | UI store、view model、form state、derived state | 不成为后端 truth source |
| `desktop/shared/contracts/` | TypeScript contract types、schema adapter、错误码映射 | 不包含 React 组件 |
| `desktop/shared/privacy/` | provider privacy 文案、远程上传确认模型、redaction UI helper | 不处理 raw secret |
| `desktop/test/` | UI、client、mock flow、contract mapping 测试 | 不依赖真实模型、真实 API、真实大媒体 |

## 存储模型

### 数据库

Electron 应用第一版不引入数据库。

| 存储 | 是否使用 | 内容 |
| --- | --- | --- |
| SQL 数据库 | 不使用 | 不保存 UI 状态、job、模型或 provider |
| SQLite | 暂缓 | 只有当任务历史筛选、复杂查询或长期本地项目管理成为必要时再评估 |
| 外部队列数据库 | 不使用 | 不引入 Redis、Postgres、RabbitMQ 或云队列 |

### Electron 本地文件存储

| 存储 | 内容 | 规则 |
| --- | --- | --- |
| UI 设置 | 默认输出位置、输出冲突策略、语言偏好、设备偏好、折叠状态、最近页面 | 用户设置直接映射到 Fast Sub 配置文件；纯 UI 偏好可存在 Electron store |
| 最近文件记录 | 最近添加的媒体路径、最近输出目录 | 应允许用户清除；不提交仓库 |
| Mock 数据 | mock 模型、mock provider、mock jobs、mock 进度场景 | 只用于开发和测试 |
| UI 缓存 | 页面筛选、tab、排序、临时表单草稿 | 不能作为后端真相 |

### 安全存储

| 存储 | 内容 | 规则 |
| --- | --- | --- |
| Electron `safeStorage` + 本地加密 secret store | API key、provider secret | renderer 不读取 raw value；只通过 main process 保存、替换、删除和查询 masked status |
| Daemon transient secret store | API job/live check 的一次性 `secret_ref` | 只保存在 daemon 内存；短 TTL、单次消费；不写 request/job/events/log |
| Electron main memory | daemon ready token、base URL、进程句柄 | token 不写入磁盘，不暴露给任意 renderer |
| 配置文件 | 用户设置、默认模型、provider 默认值、API key 环境变量名、key alias、masked 状态、provider API base URL/model | 不保存 raw API key |

### 外部后端存储边界

Electron 应用可以通过 daemon API 查看这些状态，但不直接管理其文件结构。

| 存储 | 所属方 | Electron 看到的内容 |
| --- | --- | --- |
| Model store | Go daemon / model manager | 模型 ID、名称、大小、状态、provider 兼容性、license/privacy |
| Job store | Go daemon / job manager | job 列表、状态、进度、结果、redacted 日志 |
| Logs | Go daemon / job manager | 受限 redacted tail、结构化错误、诊断摘要 |
| Benchmark reports | CLI/daemon 或用户选择目录 | 报告路径和摘要，不默认读取大文件 |

### 禁止保存的内容

- API key 明文。
- Authorization header。
- daemon ready token。
- signed URL credential。
- proxy credential。
- raw provider response 中的敏感内容。
- 未 redacted 的远程 request body。
- 用户未确认保存的上传音频副本。

## 身份验证和访问模型

Fast Sub Electron 应用是单用户本地桌面应用，不实现账号、团队或云同步。

| 场景 | 访问模型 |
| --- | --- |
| App 启动 daemon | Electron main process 启动 `fast-sub-go serve --host 127.0.0.1 --port 0`，读取 ready JSON |
| Token 保存 | main process 内存保存 daemon token；renderer 不直接持有 |
| Renderer 调用后端 | renderer 调用 preload 暴露的受控方法，例如 `window.fastSub.createJob()` |
| REST 请求 | main/preload controlled client 添加 bearer token |
| SSE 订阅 | 通过 main/preload controlled client 订阅，处理 EventSource header 限制或使用 fetch-based SSE |
| Health/version | 可无 token 调用，但仍通过 client 边界 |
| API key 管理 | renderer 提交 key alias 或用户输入给 main process；main process 写入 `safeStorage` + 本地加密 secret store，配置文件只保存 alias/env 名称；创建 API job/live check 前由 main 调用 `/v1/secrets` 换取一次性 `secret_ref` |
| 远程 provider 使用 | UI 必须展示上传内容、provider 名称、费用/隐私提示，并要求确认 |
| 文件访问 | 用户通过 file dialog 或 drag-and-drop 授权路径；UI 不扫描未选择目录 |

访问规则：

- 默认只连接 `127.0.0.1` daemon。
- 默认禁用 CORS。
- 不支持远程 Web 控制本机 daemon。
- 不把 daemon token、API key 或 Authorization header 写入 UI state。
- 远程 provider 不允许在后台静默启用。

## AI 和后台任务模型

Electron 应用不运行 AI 推理。它只创建任务、展示进度、展示结果和处理用户确认。

### UI 可见 provider 分类

| 分类 | 示例 | UI 文案重点 |
| --- | --- | --- |
| 本地 ASR | `local-faster-whisper` | 本地处理，不上传音频；需要本地模型 |
| Native ASR | `local-whisper-cpp` | 本地处理，依赖本机 binary 和模型；Windows 缺 binary 时由 Electron main 受控下载安装到 app 私有 native-binaries 目录 |
| API ASR | `api-openai-transcription` | 会上传音频；需要 API key、base URL 和模型 |
| 本地翻译 | `local-nllb-ct2` | 本地处理字幕文本；需要翻译模型 |
| 网页翻译 | `web-bing`、`web-google` | 会把字幕文本发送到第三方网页翻译服务 |
| API 翻译 | `api-openai-chat` | 会上传字幕文本；可能产生费用 |

### UI job 类型

| Job 类型 | 用户入口 | UI 处理 |
| --- | --- | --- |
| `transcribe` | 主界面一键生成 | 默认主流程；当输出内容为翻译字幕/双语字幕时，daemon 在同一 job 内部串联转写和翻译 |
| `model_install` | 设置 / 模型管理 | 独立模型下载/验证长任务；模型页在当前 tab 内显示进度、失败、取消和重试 |
| `translate_srt` | 子功能：翻译已有 SRT | 独立工具，不影响主流程 |
| `burn_in` | 子功能：字幕烧录 | 独立工具，展示视频重编码进度 |
| `bench` / `bench_translate` | 设置 / 诊断 / Benchmark | 第一版只保留入口或规划状态 |

### UI 状态映射

| Daemon 状态 | 普通用户状态 | UI 行为 |
| --- | --- | --- |
| `created` / `queued` | 等待中 | 可取消、可移除等待任务 |
| `running` | 正在生成 | 显示进度、预计时间、取消按钮 |
| `canceling` | 正在取消 | 禁用重复取消 |
| `succeeded` | 已完成 | 显示打开字幕、打开文件夹、继续添加 |
| `failed` | 已失败 | 显示问题说明、建议操作、重试、查看日志 |
| `canceled` | 已取消 | 显示可重试或移除 |
| `interrupted` | 服务中断 | 显示一键修复和重新同步 |

### 用户可见阶段映射

| 内部阶段 | 用户文案 |
| --- | --- |
| `validating` | 正在检查文件 |
| `probing_media` | 正在分析媒体 |
| `installing_model` | 正在准备模型 |
| `extracting_audio` | 正在提取音频 |
| `preparing_upload` | 正在准备上传 |
| `loading_model` | 正在加载模型 |
| `transcribing` | 正在转写音频 |
| `translating` | 正在翻译字幕 |
| `burning_in` | 正在烧录字幕 |
| `rendering` | 正在生成文件 |
| `finalizing` | 正在收尾 |
| `done` | 已完成 |

后台任务规则：

- UI 默认表现为一个正在运行的任务，其余任务等待中。
- 用户可以取消当前任务或全部取消。
- 失败任务必须提供重试、查看日志、打开诊断。
- 日志默认折叠，结构化错误优先显示为可理解文案。
- `events_lost` 时 UI 必须重新查询 job 状态，而不是继续相信旧进度。

## 不变式

这些规则是 Electron 应用代码绝不能违反的约束。

1. Renderer 只能通过 `FastSubClient` 访问后端能力。
2. Renderer 不能直接调用 Python worker、ffmpeg、ffprobe、whisper.cpp、模型下载器或 provider runtime。
3. Renderer 不能持有 daemon ready token、API key、Authorization header 或 raw provider secret。
4. Main/preload 暴露给 renderer 的 API 必须是 allowlist，不暴露任意 shell、任意文件读写或 Node.js 全局对象。
5. UI 状态不能成为后端真相；任务、模型和 provider 真相来自 client 返回的 contract。
6. Mock client 和 daemon client 必须实现同一个 `FastSubClient` 接口。
7. 普通主界面不能展示 daemon base URL、token、job id、SSE event 名称、JSON envelope 或 worker 细节。
8. 诊断页展示的 token、API key、Authorization、signed URL、proxy credential 必须 redacted。
9. 默认本地处理，不能静默启用远程 ASR 或远程翻译。
10. 使用会上传音频或字幕文本的 provider 前，UI 必须显示确认。
11. `auto` 或“一键生成”不能因为本地 provider 不可用而自动切到 API provider。
12. API key 不能保存到 localStorage、普通 UI state 或未加密配置文件。
13. Event/log 文本不能作为 UI 状态机判断依据；UI 只依赖结构化 status/progress/error。
14. `failed`、`interrupted` 状态必须显示用户可执行的恢复动作。
15. 输出文件已存在时，默认询问用户；不能静默覆盖。
16. 模型安装失败必须显示重试入口和诊断入口。
17. 远程 provider 页面必须显示 provider 类型、上传内容、API key 要求和费用/隐私提示。
18. 设置页可以修改默认参数，但不能要求普通用户理解配置文件格式。
19. Benchmark 和诊断不能干扰主生成流程。
20. UI 测试必须覆盖 mock 成功、mock 失败、取消、缺模型、输出冲突、远程确认和 daemon disconnected。

## FastSubClient Contract

`FastSubClient` 是 Electron UI 唯一可依赖的后端边界。页面、组件和 renderer state 不能直接依赖 daemon REST endpoint、SSE event、IPC channel 或 Python/Go 内部实现。

### 实现位置

| 实现 | 位置 | 职责 |
| --- | --- | --- |
| `MockFastSubClient` | renderer 或测试环境 | 模拟完整 UI 流程、延迟、进度、失败、取消、缺模型、安装失败、远程确认和 daemon disconnected |
| `DaemonFastSubClient` facade | renderer-facing client | 暴露 typed 方法和 view model，不持有 token，不发起真实 HTTP/SSE |
| `DaemonFastSubClient` adapter | main/preload controlled client | 启动/连接 daemon，持有 token，执行 REST/SSE，处理 auth、reconnect、events_lost、JSON parsing、config 写入 |

### 方法

```text
FastSubClient
  health()
  version()
  getEnvironmentStatus()
  repairDaemon()
  getConfig()
  updateConfig(patch)
  listModels()
  installModel(modelId)
  verifyModel(modelId)
  createModelInstallJob(modelId)
  removeModel(modelId)
  listProviders()
  testProvider(providerId, mode)
  createJob(request)
  listJobs()
  getJob(jobId)
  cancelJob(jobId)
  cancelAllJobs()
  getJobResult(jobId)
  getJobLogs(jobId)
  deleteJob(jobId)
  subscribeJobEvents(jobId, handlers)
```

### 返回模型

- 返回 UI 需要的 typed result，不返回 raw HTTP response、raw SSE event 或 raw IPC payload。
- 所有错误统一映射为 UI error model，包含用户可理解说明、可执行恢复动作、原始 error code 和 redacted diagnostic detail。
- job、model、provider、config、privacy confirmation 必须有显式 TypeScript 类型。
- mock client 和 daemon client 必须共享同一套 interface、fixtures 和 contract mapping 测试。

### 配置同步

- 设置页的用户设置直接映射到 Fast Sub 配置文件。
- renderer 只编辑配置 view model；真实读写由 main/preload controlled client 完成。
- API key 和 provider secret 不写入配置文件，只保存 key alias、环境变量名、masked 状态或 secret store reference；API job/live check 只向 daemon 传一次性 `secret_ref`。
- mock 阶段也要模拟配置读写，保证 UI 行为和真实集成一致。

## 当前实现选择和后续待确认

| 问题 | 当前实现 | 后续需要确认 |
| --- | --- | --- |
| Electron 目录名 | 使用 `desktop/` | 无 |
| UI 状态库 | 使用 React state，不引入 Zustand/Jotai | 复杂度上升后是否引入轻量 store |
| UI 组件库 | 使用自定义组件，基于 prototype 和 `ui-context.md` token 整理 | Round 13 是否引入 Radix/shadcn 等组件基础 |
| Provider 信息架构 | 单个 Provider 页面，分为转写 Provider 和翻译 Provider；API key/Base URL/模型配置内嵌 Provider 卡片 | 是否在 Round 13 做更精细的 provider onboarding |
| 安全存储库 | Electron `safeStorage` + 本地加密 secret store；renderer 只见 alias/masked status | keytar/OS keychain 的打包、ABI 和跨平台兼容验证 |
| SSE 实现 | main/preload controlled fetch-based SSE client；renderer 只订阅 typed event | Electron 打包后长连接和 sleep/wake 行为 smoke |
| 配置存储 | 运行配置通过 daemon `GET/PATCH /v1/config` 持久化；Electron store 只保存 UI 偏好 | 配置迁移和损坏配置恢复 polish |
| 默认 ASR 模型 | Provider 卡片指定兼容默认模型；模型管理阻止不兼容默认模型 | 硬件推荐策略是否自动化 |
| 默认翻译模型 | 翻译 Provider 卡片指定兼容默认模型；主流程翻译/双语字幕需要可用翻译 provider | NLLB 磁盘占用和首次下载提示 polish |
| 批量文件夹 | 主界面支持文件夹添加；默认不递归，设置中可开启嵌套扫描；默认最大数量 100，硬上限 500；只保留媒体扩展 | 是否为超大文件夹提供后台索引队列 |
| 远程 provider | 默认可见但不自动启用；任务 request 必须携带显式上传确认 | 是否默认隐藏到高级设置 |
| Benchmark | 设置中保留规划入口 | 第一版是否完全隐藏 |
