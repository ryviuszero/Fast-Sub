# Round 11: Electron Mock-first Shell

## Summary

Round 11 是 Fast Sub 桌面 UI 的第一轮实现 spec。目标是先搭建 Electron 应用骨架，用 mock-first 方式跑通主要用户流程和状态模型，再为 Round 12 接入真实 Go daemon 做准备。

Round 11 不接真实 daemon，不做真实模型安装，不调用 Python worker、ffmpeg、whisper.cpp、模型下载器或 provider runtime。所有后端能力都通过 `FastSubClient` 的 mock 实现提供。

## Goals

- 创建 Electron 应用骨架，目录使用 `desktop/`。
- 建立 main、preload、renderer 的安全边界。
- 建立 `FastSubClient` MVP contract。
- 实现 `MockFastSubClient`，覆盖主要 mock 数据、进度、失败、取消和恢复状态。
- 落地 prototype 中的主要页面结构：首次启动、主界面、任务队列、设置页。
- 让用户在 mock 模式下完整走通：首次启动、添加媒体、生成字幕、查看结果、取消任务、失败重试和查看设置。
- 保持主界面简洁，不展示 daemon、SSE、job id、JSON envelope、worker 或 provider runtime 细节。

## Non-goals

- 不接入真实 Go daemon REST/SSE API。
- 不启动、停止或修复真实 daemon 进程。
- 不做真实 ASR、翻译、字幕烧录或 benchmark。
- 不下载、校验或删除真实模型。
- 不调用 Python CLI、Python worker、ffmpeg、ffprobe、whisper.cpp 或 provider runtime。
- 不实现真实 OS keychain 依赖。
- 不做 Electron 打包、签名、安装器或发布流程。
- 不引入数据库、外部队列、WebSocket、高级任务调度、worker pool 或 warm model pool。

## Implementation Defaults

- Electron 应用目录使用 `desktop/`。
- Electron 骨架采用 `electron-vite` 风格结构：`desktop/main`、`desktop/preload` 和 Vite/React/TypeScript renderer 分层。
- Electron 应用使用独立 `desktop/package.json` 和独立 lockfile；Round 11 默认使用 `npm`，提交 `desktop/package-lock.json`，不在仓库根目录混入 UI 依赖。
- 推荐分支名为 `codex/fast-sub-desktop-mock-shell`。Round 11 建议一个分支完成，不切并行分支，避免 Electron main/preload/renderer contract 漂移。
- `desktop/package.json` 至少提供以下 scripts：
  - `dev`：启动 Electron/Vite 开发模式。
  - `typecheck`：检查 main、preload、renderer TypeScript 类型。
  - `test`：运行 mock client、contract、renderer flow 和安全边界单元测试。
  - `build`：构建 main、preload、renderer，不做 installer/package。
  - `smoke`：启动应用到 renderer 并验证基础窗口安全配置；不得启动真实 daemon 或访问真实网络。
- `.gitignore` 必须覆盖 Electron 生成物：`desktop/node_modules/`、`desktop/dist/`、`desktop/dist-electron/`、`desktop/out/`、`desktop/.vite/`、`desktop/coverage/`、`desktop/test-results/`、`desktop/playwright-report/`。
- 不提交 Electron 构建产物、运行日志、截图快照、用户配置、真实媒体、真实模型、任务产物、API key 或本机绝对路径。
- Round 11 允许提交源代码、测试 fixtures、mock fixtures、`desktop/package.json` 和 `desktop/package-lock.json`。
- UI 首轮使用 React state，不引入 Zustand、Jotai 或其他状态库。
- 组件策略使用自定义组件，基于 `dev-docs/ui-docs/prototype` 的信息架构和 `dev-docs/ui-docs/ui-context.md` 的 token 整理。
- Round 11 只实现 mock 安全存储，不选定真实 OS keychain 依赖。
- Round 11 不实现真实 SSE，只在 mock client 中模拟 job event/progress。
- 设置 UI 使用配置 view model，mock 阶段模拟写入 Fast Sub 配置文件。
- 默认 ASR 使用 `whisper-small` 占位。
- 默认翻译模型使用 NLLB 占位；NLLB 安装失败不阻断主转写流程。
- Benchmark 在设置 / 诊断后方保留入口，不进入主流程。

## Branch Plan

Round 11 分支策略分成两步：

1. 规划/原型分支：
   - 当前 UI 文档和原型整理可以继续保留在 `codex/ui-prototype`。
   - 该分支用于审阅 `dev-docs/ui-docs`、prototype、UI context、Round 11 spec 和 tracker。
   - 不在该分支直接实现生产 Electron 应用，除非用户明确要求。

2. 实现分支：
   - Round 11 实现推荐从 `master` 切出：

```text
codex/fast-sub-desktop-mock-shell
```

实现分支策略：

- 一个分支完成 Round 11，不拆成多个并行分支。
- 不创建多个 worktree；除非后续 UI 实现明显拆成互不重叠的独立包。
- 每个 implementation unit 可以形成一个小提交，便于 review：
  - `11.1 Electron/Vite 骨架`
  - `11.2 Contract 和 mock fixtures`
  - `11.3 首次启动和主界面核心流`
  - `11.4 任务队列和设置入口`
  - `11.5 安全和测试收口`
- 合并到 `master` 前，优先 squash 成一个 reviewable commit，除非用户要求保留阶段提交。
- 分支内每完成一个 unit，都必须更新 `dev-docs/ui-docs/project-tracker.md`，记录完成内容、验证命令、剩余问题和下一步。
- 分支内不得混入 Go daemon、Python worker、真实模型下载、真实 provider runtime 或发布打包工作。
- 分支内如果发现 daemon API 缺口，只记录到 Round 12 follow-up，不在 Round 11 直接补 Go 代码。

实现分支启动前置条件：

- `dev-docs/ui-docs/specs/round11-electron-mock-first-shell.md` 已经完成审阅。
- `.gitignore` 已准备好 Electron 生成物规则，或 11.1 首个提交必须先补齐。
- `desktop/` 目录尚不存在时，由 11.1 创建。
- 当前工作树中未审阅的 prototype/docs 改动不得被无意带入实现分支。

实现分支合并门槛：

- `cd desktop && npm run typecheck`
- `cd desktop && npm test`
- `cd desktop && npm run build`
- `cd desktop && npm run smoke`
- Review 确认没有提交 `desktop/node_modules/`、构建产物、截图产物、真实媒体、真实模型、任务产物、secret 或本机私有路径。
- Review 确认 renderer 不访问 Node.js、shell、文件系统、daemon token、API key 或 raw secret。

## Implementation Units

Round 11 拆成以下小单元推进。每个单元完成后都要更新 `dev-docs/ui-docs/project-tracker.md`。

| 单元 | 名称 | 范围 | 验收 |
|---|---|---|---|
| 11.1 | Electron/Vite 骨架 | 创建 `desktop/`，配置 main、preload、renderer、开发脚本和基础窗口 | 应用能启动到 renderer，窗口安全配置符合本 spec |
| 11.2 | Contract 和 mock fixtures | 定义 `FastSubClient` MVP types、UI error model、mock scenarios 和 fixtures | mock client 可独立单测，fixtures 覆盖成功/失败/取消/缺模型/远程确认 |
| 11.3 | 首次启动和主界面核心流 | 落地首次启动、环境检查、添加媒体、详细设置折叠、创建 mock job、进度和结果 | 用户能从首次启动进入主界面，并完成一次 mock 生成 |
| 11.4 | 任务队列和设置入口 | 落地任务列表、任务详情、失败详情、设置页主要 tab 和配置 view model | 用户能查看、取消、重试、删除 mock job，并编辑 mock 设置 |
| 11.5 | 安全和测试收口 | 补 mock client、renderer flow、preload 安全边界和 Electron smoke 验证 | 默认测试不访问真实网络/daemon/model，安全边界检查通过 |

## Deliverables

- `desktop/` 应用骨架。
- Electron main process：窗口创建、应用生命周期、受控系统能力占位。
- Electron preload：只暴露 allowlist API，不暴露 Node.js、shell、任意文件读写、token 或 raw secret。
- React renderer：页面路由或等效导航、基础布局、共享组件和 mock 页面状态。
- `FastSubClient` MVP contract。
- `MockFastSubClient`，支持异步延迟、进度模拟、失败、取消、缺模型、安装失败、远程确认和 daemon disconnected 场景。
- 基础设置 view model，模拟配置读取和写入。
- 基础测试覆盖 mock client、主要 UI 流程和安全边界。

## FastSubClient MVP

Round 11 的 `FastSubClient` 只定义 UI 所需的最小能力，真实 daemon adapter 留到 Round 12。

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

Round 11 的 renderer 只能消费 typed result 和 UI error model。页面组件不能拼接 URL、设置 Authorization header、读取 raw config 文件或访问 raw secret。

`subscribeJobEvents(jobId, handlers)` 必须返回 `unsubscribe()` 函数。UI 离开任务详情、取消订阅或组件卸载时必须调用它，避免 mock 计时器或后续 SSE 连接泄漏。

### Typed Contract

Round 11 至少定义以下 TypeScript 类型。可以在后续实现中用 Zod 或等效 schema 做运行时校验，但页面组件不能依赖 `any` 或 raw JSON。

| 类型 | 用途 |
|---|---|
| `FastSubClient` | UI 唯一后端访问接口 |
| `EnvironmentStatus` | 首次启动和诊断展示 |
| `ModelStatus` | ASR/NLLB 模型状态展示 |
| `ProviderStatus` | provider 可用性、隐私分类和确认状态 |
| `ConfigViewModel` | 设置页读写的 UI 配置模型 |
| `CreateJobRequest` | 主生成、翻译SRT、烧录入口创建任务的请求 |
| `JobSummary` | 任务队列列表项 |
| `JobDetail` | 任务详情、失败详情和结果展示 |
| `JobEvent` | mock 进度和 Round 12 SSE 映射目标 |
| `JobResult` | 完成后的字幕、文件夹和输出摘要 |
| `JobLogEntry` | redacted 日志行 |
| `UiError` | 用户可理解错误、恢复动作和 redacted diagnostic |

### Job Event Contract

Round 11 的 mock event 类型要提前贴近 Round 12 daemon/SSE 映射。

| Event | 含义 | UI 行为 |
|---|---|---|
| `snapshot` | 当前 job 全量状态 | 初始化或重新同步任务详情 |
| `progress` | 阶段、百分比、当前文件、预计剩余时间 | 更新进度条和阶段文案 |
| `log_tail` | redacted 日志摘要 | 只显示在详情/诊断区域 |
| `succeeded` | 任务完成 | 展示打开字幕、打开文件夹、继续添加 |
| `failed` | 任务失败 | 展示问题说明、恢复动作、重试和诊断入口 |
| `canceled` | 任务取消 | 展示可重试或移除 |
| `events_lost` | 事件流不连续 | UI 重新调用 `getJob(jobId)` 获取快照 |

Round 12 daemon SSE 到 UI event 的目标映射必须在 Round 11 先用 fixture 固化：

| Daemon SSE event | UI `JobEvent` | 映射规则 |
|---|---|---|
| `created` | `snapshot` | 用最新 job metadata 初始化 UI 任务详情 |
| `queued` | `snapshot` 或 `progress` | 列表显示等待中；如果已有完整 job payload，优先产出 `snapshot` |
| `started` | `progress` | 状态切到正在生成，stage 可映射为用户文案 |
| `progress` | `progress` | 保留 stage、percent、current file 和 ETA view model |
| `log` | `log_tail` | 只进入详情/诊断日志，不驱动状态机 |
| `warning` | `log_tail` 或 `progress` warning | 显示非阻断 warning，不改变 terminal state |
| `completed` | `succeeded` | 展示输出路径、打开字幕和打开文件夹 |
| `failed` | `failed` | 展示用户说明、恢复动作和 redacted diagnostic |
| `canceled` | `canceled` | 展示可重试或移除 |
| `interrupted` | `failed` | 用户文案为服务中断；提供一键修复和重新同步 |
| `events_lost` | `events_lost` | 立即调用 `getJob(jobId)` 重新同步 |
| `heartbeat` | ignored | 不改变 UI state，只维持连接活性 |

Contract fixtures 至少包含：

- daemon SSE raw fixture：覆盖 `created/queued/started/progress/log/warning/completed/failed/canceled/interrupted/events_lost/heartbeat`。
- UI `JobEvent` expected fixture：覆盖 `snapshot/progress/log_tail/succeeded/failed/canceled/events_lost`。
- mapping test：验证 daemon event 到 UI event 的转换不会泄露 token、Authorization、API key 或 raw JSON envelope。
- `events_lost` fixture：验证 UI 会触发 `getJob(jobId)` 快照同步，而不是继续相信旧进度。

## Mock Flows

Mock client 必须可控、可复现，不使用随机失败作为默认行为。测试和开发可以显式选择 `MockScenario`。

| Scenario | 目标 | 关键状态 |
|---|---|---|
| `setupReady` | 首次启动成功 | 环境检查通过，默认 ASR 和 NLLB 都已就绪 |
| `missingAsr` | ASR 缺失 | 主转写不可用，提供安装/模型管理入口 |
| `nllbInstallFailed` | 翻译模型失败 | NLLB 失败但主转写仍可继续，提供稍后处理和诊断 |
| `modelInstalling` | 模型安装中 | 显示进度、禁止重复安装 |
| `modelInstallFailed` | 模型安装失败 | 显示重试、稍后处理和诊断入口 |
| `jobSuccess` | 主生成成功 | job 从等待中推进到已完成 |
| `jobFailed` | 主生成失败 | 显示失败说明、建议操作、重试、日志和诊断 |
| `jobCanceled` | 取消任务 | running job 进入正在取消，再进入已取消 |
| `outputConflict` | 输出文件已存在 | 显示覆盖、跳过、另存为和取消 |
| `remoteProviderConfirmRequired` | 远程 provider 确认 | 确认前不创建任务，显示上传内容和 provider 信息 |
| `daemonDisconnected` | daemon 中断 | 显示一键修复和重新同步，但只使用 mock 行为 |

Mock fixture 必须包含 Windows 本地路径、中文路径、空格路径和 UNC 路径示例，例如 `C:\Users\Example\Videos\a b.mp4`、`D:\SampleMedia\片段.mp4`、`\\NAS\share\media\clip.mp4`。

## UI Screens

- 固定应用菜单栏：
  - 首次启动 / 环境检查阶段不显示固定菜单，避免绕过必要检查。
  - 进入主界面后显示固定位置的应用菜单栏，菜单项顺序固定为 `←`、`→`、`窗口`、`帮助`。
  - `←` 和 `→` 使用应用内历史栈做返回/前进，不随页面切换改变位置。
  - `窗口` 菜单包含 `字幕生成`、`翻译SRT`、`字幕烧录` 三个入口。
  - `帮助` 进入用户可理解的诊断/帮助入口。
  - 不恢复 Windows/Electron 默认系统菜单栏，不把 prototype 中的 macOS 三圆点或窗口标题作为 renderer 内部 UI。
  - 隐藏调试面板可继续提供全页面 mock 状态跳转，但不能作为普通用户导航。
- 首次启动 / 环境检查：
  - 检查环境、依赖、模型目录、默认 ASR、默认 NLLB。
  - 展示安装中、已就绪、缺失、失败、可稍后处理。
- 主界面 / 一键生成：
  - 拖拽或添加媒体、文件夹入口、默认输出、主按钮、详细设置折叠面板。
  - 生成中显示整体进度、当前文件、等待任务和取消入口。
  - 完成后显示打开字幕、打开输出文件夹、继续添加。
- 任务队列：
  - 展示等待中、正在生成、已完成、已失败、已取消。
  - 支持取消、重试、删除、查看详情和 redacted 日志。
- 设置页：
  - 通用、模型管理、API 服务、Provider、诊断、Benchmark 入口。
  - 用户设置编辑后写入配置 view model。
  - API key 只显示 alias/masked 状态。
- 子功能入口：
  - 翻译已有 SRT 和字幕烧录作为独立入口可见。
  - Round 11 只做 mock 流程，不执行真实翻译或烧录。

## Security Boundaries

- Renderer 不直接访问 Node.js、shell、`child_process`、文件系统、环境变量、daemon token、API key 或 OS keychain。
- Electron window 必须启用 `contextIsolation: true`。
- Electron window 必须禁用 `nodeIntegration`。
- Electron window 必须设置基础 Content Security Policy。
- Preload 只暴露明确 allowlist API。
- Preload 不直接暴露 `ipcRenderer`、`ipcRenderer.send`、`ipcRenderer.on` 或 `ipcRenderer.invoke`。
- Preload 暴露的方法必须是一组业务方法，例如选择文件、读取 mock 配置、创建 job、订阅 job 事件。
- Main process 只提供受控系统能力占位，不承载页面业务状态。
- `MockFastSubClient` 和后续 `DaemonFastSubClient` 必须共享同一套 interface。
- 主界面不显示 daemon base URL、token、job id、SSE event 名称、JSON envelope 或 worker 细节。
- 诊断页只展示 redacted 示例信息。
- 远程 provider 使用前必须有阻断式确认。

## File Selection And Paths

- 添加媒体和添加文件夹必须通过受控入口：Electron dialog 或用户拖拽。
- Round 11 的系统 dialog 可以返回 mock 路径，但调用形状要贴近真实 main/preload API。
- Drag-and-drop 只把用户拖入的文件加入 UI 列表，不扫描未授权目录。
- 添加文件夹在 Round 11 只模拟目录选择和目录内文件列表，不做真实递归扫描。
- UI 必须能展示 Windows 路径、中文路径、空格路径和 UNC 路径，不截断到无法识别文件名。
- 路径只作为用户授权的输入传给 `FastSubClient`，页面组件不能直接访问文件系统。

## Test Plan

Round 11 实现分支最终必须提供并通过以下命令。脚本名称可以在实现中等价调整，但需要在 `desktop/package.json` 中固定下来：

```bash
cd desktop
npm run typecheck
npm test
npm run build
npm run smoke
```

这些命令的默认行为必须满足：

- 不启动真实 Go daemon。
- 不访问真实网络。
- 不调用真实模型、真实 ffmpeg、真实 Python worker、真实 whisper.cpp 或真实 API。
- 不读取或写入真实 API key、daemon token、OS keychain 或用户配置。
- 不依赖 GPU、真实媒体、大文件或本机私有路径。
- 运行后不留下需要提交的生成物。

- Mock client 单元测试：
  - 环境检查成功/失败。
  - 默认 ASR 缺失、安装中、安装失败、已就绪。
  - 默认 NLLB 缺失、安装失败但不阻断主流程。
  - job queued/running/succeeded/failed/canceled/interrupted。
- Renderer/UI 测试：
  - 首次启动流程可走完。
  - 首次启动检查页不显示固定应用菜单栏。
  - 进入主界面后固定应用菜单栏显示 `←`、`→`、`窗口`、`帮助`，且菜单项位置不随页面变化。
  - `窗口` 菜单可进入字幕生成、翻译SRT 和字幕烧录。
  - 任务详情的 `返回` 回到任务队列；子功能的 `返回` 回到主界面。
  - 主界面添加文件后可创建 mock job。
  - 生成进度可推进到完成。
  - 输出冲突、缺模型、远程 provider 确认可见。
  - 任务队列筛选、取消、重试可见。
  - 设置页通用、模型、API 服务、Provider、诊断、Benchmark 入口可访问。
- Contract 测试：
  - `FastSubClient` mock fixtures 满足 typed contract。
  - `JobEvent` 的 `snapshot/progress/log_tail/succeeded/failed/canceled/events_lost` 都能被 UI 状态机处理。
  - `subscribeJobEvents()` 返回的 `unsubscribe()` 可以停止后续 mock event。
- 安全测试：
  - Renderer 不包含 raw API key、daemon token、Authorization。
  - 主界面不显示 daemon、SSE、job id 或 raw JSON。
  - 诊断信息使用 redacted 示例。
  - Preload 不暴露 raw `ipcRenderer`。
  - Renderer 不能访问 `process`、`require`、Node.js 文件系统或 shell。
- Electron smoke：
  - 开发模式下应用可以启动到 renderer。
  - main/preload/renderer 构建入口可被 TypeScript 检查。
  - smoke 验证不启动真实 daemon，不访问真实网络。
  - smoke 验证 `contextIsolation=true`、`nodeIntegration=false`、preload API allowlist 和基础 CSP。

默认测试不启动真实 daemon，不调用真实模型、真实 ffmpeg、真实 API 或真实网络。

## Acceptance Criteria

- Electron 应用可以启动到 renderer。
- Mock 模式下，普通用户可以从首次启动进入主界面。
- 首次启动检查阶段不显示固定应用菜单栏；进入主界面后可见 `←`、`→`、`窗口`、`帮助`。
- `窗口` 菜单可快速进入字幕生成、翻译SRT 和字幕烧录，菜单项位置固定。
- 隐藏调试面板仍可切换全部 mock 页面状态，但不替代普通用户导航。
- 用户可以添加媒体并创建 mock 字幕生成任务。
- 任务进度、完成、失败、取消和重试状态可见。
- 任务队列可以展示当前任务和历史任务。
- 设置页主要入口可访问，并能编辑 mock 配置 view model。
- 远程 provider 路径有显式上传确认。
- 主界面不暴露内部技术细节。
- 所有后端数据访问都通过 `FastSubClient`。
- Round 12 需要真实接入的 daemon API 缺口已记录在后续工作中。
- Round 11 拆分单元的完成状态已同步到 `dev-docs/ui-docs/project-tracker.md`。

## Follow-up To Round 12

- 实现 `DaemonFastSubClient` 的 main/preload controlled adapter。
- 接入 Go daemon ready JSON、REST、SSE、auth、401、events_lost 和 reconnect。
- 将 mock job 创建映射到真实 `POST /v1/jobs`。
- 将 mock models/providers 映射到真实 daemon API。
- 根据 UI 需要补充 `translate_srt`、`burn_in`、`transcribe_translate`、model install/verify、provider test 和 config API。
- 接入真实配置文件读写和真实安全存储。
