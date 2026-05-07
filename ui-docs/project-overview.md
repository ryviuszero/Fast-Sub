# Fast Sub Electron 项目总览

Fast Sub Electron 是 Fast Sub 的桌面客户端项目。它为普通本地用户提供一个可视化字幕工作台：首次启动时检查环境和准备默认能力，日常使用时通过拖拽视频或音频生成 SRT 字幕，并提供已有 SRT 翻译、字幕烧录、任务队列、模型管理、provider 设置和诊断入口。Electron 应用不直接运行 ASR、翻译、ffmpeg 或模型下载逻辑，而是通过 `FastSubClient` 访问 mock client 或本机 Go daemon。任何远程 API 或网页 provider 的使用都必须在 UI 中明确展示上传内容，并由用户确认。

## 文档阅读顺序

Electron 实现前固定按以下顺序阅读 `ui-docs` 顶层文档：

1. `ui-docs/project-overview.md`：产品定义、目标、功能和范围。
2. `ui-docs/architecture.md`：Electron 应用结构、边界、存储模型和不变式。
3. `ui-docs/code-standards.md`：实现规则和代码约定。
4. `ui-docs/ui-context.md`：主题、颜色、排版和组件约定。
5. `ui-docs/ai-workflow-rules.md`：开发工作流、范围规则和交付方式。
6. `ui-docs/project-tracker.md`：当前阶段、决策清单、进度和下一步。

`ui-docs/project-overview.md` 是 Electron 规划和实现的入口文档。

## 后续实现轮次

Round 8 到 Round 10.5 已经完成，`ui-docs` 后续只规划 Electron 相关实现。后续收敛为三轮：

| 轮次 | 名称 | 目标 | 主要交付物 |
|---|---|---|---|
| Round 11 | Electron Mock-first Shell | 先把桌面应用壳、页面结构、状态流和 mock client 跑通 | Electron 项目骨架、`FastSubClient` MVP contract、`MockFastSubClient`、首次启动、主界面、任务队列和设置页 mock 流程 |
| Round 12 | Electron 接入 Go Daemon | 将 UI 从 mock client 切换到真实本机 daemon 能力 | `DaemonFastSubClient`、daemon 启动和健康检查、任务创建、进度订阅、取消、结果查看、daemon 异常恢复 |
| Round 13 | 产品化与发布准备 | 让桌面应用具备可交给真实用户试用的质量 | Electron 打包、本地依赖检查、诊断和隐私提示完善、基础 smoke/E2E、发布检查清单 |

Round 11 不接真实 daemon，不做真实模型安装，不直接调用 ffmpeg、Python worker 或 provider runtime。Round 12 才接入 Go daemon REST/SSE contract。Round 13 聚焦安装、诊断、测试和发布质量，不再引入新的核心业务架构。

## 目标

1. 将 `ui-docs/prototype` 中的桌面原型落地为 Electron 应用。
2. 让普通用户可以通过拖拽媒体文件和点击一个主按钮生成字幕。
3. 首次启动时完成环境检查、依赖状态展示、默认 ASR 模型准备和默认设置写入。
4. 用 mock-first 的方式先跑通完整 UI 流程，再接入真实 daemon API。
5. 通过 `FastSubClient` 统一 mock client 和 daemon client，避免 UI 绑定后端实现细节。
6. 在主界面隐藏 daemon、worker、provider runtime、SSE、JSON envelope 等技术细节。
7. 在任务队列中清楚展示等待中、正在生成、已完成、已失败和已取消状态。
8. 将翻译已有 SRT 和字幕烧录作为独立子功能，不干扰主生成流程。
9. 在设置页提供模型、API 服务、provider、诊断和 benchmark 入口。
10. 对远程音频上传或字幕文本上传提供明确、不可绕过的确认流程。

## 核心用户流程

1. 用户打开 Fast Sub Electron 应用。
2. 应用进入首次启动流程，检查本机环境、daemon 可用性、ffmpeg/ffprobe 状态、模型目录、默认 ASR 模型和默认 NLLB 翻译模型。
3. 如果缺少组件或模型，UI 展示“缺失、正在安装、安装失败、已就绪、可跳过”等普通用户可理解的状态。
4. 用户按需安装默认模型；默认 NLLB 翻译模型安装失败时不阻断主转写流程，UI 提供稍后处理入口。
5. 首次启动完成后，应用进入主界面。
6. 用户拖入视频/音频，或点击“添加视频”“添加文件夹”。
7. UI 显示已添加文件、默认输出位置、输出格式和“生成字幕”主按钮。
8. 用户可展开详细设置，调整语言、ASR 模型、设备、输出类型、输出冲突策略、是否保留临时文件等。
9. 如果模型未准备好，UI 提示“还不能生成字幕”，并提供下载默认模型或打开模型管理的操作。
10. 如果输出文件已存在，UI 弹出冲突处理选择：覆盖、跳过、另存为或取消生成。
11. 用户点击生成字幕。
12. UI 通过 `FastSubClient.createJob()` 创建任务。
13. UI 订阅任务事件，并以用户文案显示进度，例如“正在检查文件”“正在分析媒体”“正在提取音频”“正在转写音频”“正在生成文件”。
14. 用户可以取消当前任务或全部取消。
15. 任务完成后，UI 展示生成结果，并提供打开字幕、打开输出文件夹、继续添加等操作。
16. 如果任务失败，UI 展示问题说明、建议操作、重试按钮、移除记录和查看诊断入口。
17. 用户可以进入任务队列查看历史、当前任务、失败详情和 redacted 日志。
18. 用户可以从子功能入口翻译已有 SRT 或烧录字幕到视频。
19. 用户如果选择网页或 API provider，UI 先展示上传内容、provider 名称、API key 要求和可能费用，再允许继续。

## 功能

### 首次启动和环境检查

- 检查操作系统、CPU 架构、可用内存、可用磁盘空间和 GPU/CUDA 粗略状态。
- 检查 daemon 是否可以启动。
- 检查 ffmpeg 和 ffprobe 是否可用。
- 检查模型目录是否存在且可写。
- 检查默认 ASR 模型和默认 NLLB 翻译模型是否准备好。
- 引导安装缺失组件或下载默认模型。
- 显示环境总结：本地转写、本地翻译、ffmpeg、默认模型、远程 API 配置状态。
- 技术错误码只放入诊断详情，不作为普通用户主文案。

### 主界面和一键生成

- 支持拖拽媒体文件。
- 支持添加单个视频/音频文件。
- 支持添加文件夹。
- 默认输出原语音 SRT。
- 默认输出到源文件所在目录。
- 显示当前文件数量、输出位置、输出格式和生成按钮。
- 详细设置默认折叠。
- 生成中显示整体进度、当前文件、预计剩余时间和后续等待任务。
- 完成后显示每个文件的结果、耗时、打开字幕和打开文件夹操作。

### 详细设置

- 字幕语言：自动识别或指定语言。
- ASR 模型选择。
- 翻译模型选择。
- 设备选择：自动、CPU、GPU。
- 输出内容：原字幕、翻译字幕、双语字幕、烧录视频。
- 生成模式：只转写、转写后翻译、只翻译 SRT。
- 转写方式：本地或远程。
- 翻译方式：本地、网页或 API。
- 音频流、VAD、速度/质量模式。
- 输出冲突策略：询问、覆盖、跳过。
- 词级时间戳和保留临时文件开关。

### 任务队列

- 展示全部任务、正在生成、已完成和失败筛选。
- 展示当前任务进度和等待任务。
- 支持取消当前任务和全部取消。
- 支持打开完成结果。
- 支持失败任务重试。
- 支持查看任务详情、日志、配置和结构化错误。
- 将内部状态映射为普通用户状态：等待中、正在生成、已完成、已失败、已取消。

### 翻译已有 SRT

- 独立入口，不影响主生成流程。
- 支持选择或拖入 `.srt` 文件。
- 支持源语言和目标语言选择。
- 支持替换和双语输出。
- 支持本地、网页和 API 翻译方式。
- 支持 checkpoint/resume。
- partial failure 保留原文并写 `.errors.json`。
- 网页/API 翻译必须显示字幕文本上传提示。

### 字幕烧录

- 独立入口，不影响主生成流程。
- 支持选择视频和字幕文件。
- 支持字体、字号和编码 preset。
- 输出带硬字幕视频。
- 显示烧录进度。
- 完成后可打开输出文件夹。

### 设置

- 通用设置：默认语言、输出位置、输出冲突、设备、输出类型。
- 模型管理：安装、校验、维护、重试、占用空间。
- API 服务：API key alias、base URL、模型、上传格式、静态检查/live 测试、上传前确认；用户设置直接映射到 Fast Sub 配置文件，secret 只保存 alias/masked 状态。
- Provider 管理：STT/translation provider、local/api/web/native 分类、可用性、隐私说明。
- 诊断：daemon 状态、一键修复、redacted logs、结构化错误、最近事件。
- Benchmark：第一版只保留规划入口或诊断入口，不进入主流程。

### Client 和后端连接

- `MockFastSubClient` 支持无 daemon 的完整 UI 开发。
- `DaemonFastSubClient` 通过本机 daemon REST API 查询 health、version、models、providers、jobs。
- 任务进度通过受控 SSE client 订阅。
- renderer 不直接持有 daemon token。
- daemon disconnected、401、SSE reconnect、events_lost 都必须映射为 UI 可恢复状态。
- 设置页保存时同步写入 Fast Sub 配置文件；mock 阶段使用同一份配置 view model，真实阶段由 client adapter 映射到配置文件。

### 安全和隐私

- 默认本地处理。
- renderer 不直接访问 Node.js、shell、daemon token 或 API key。
- API key 使用 OS keychain 或等效安全存储。
- localStorage 不保存 secret。
- 远程 provider 使用前必须确认上传内容。
- 诊断信息必须 redacted token、API key、Authorization、signed URL 和 proxy credential。

## 范围内

- 基于 `ui-docs/prototype` 的 Electron 桌面应用。
- 首次启动 / 环境检查流程。
- 主界面 / 一键生成字幕流程。
- 详细设置折叠面板。
- 模型未准备、输出冲突、生成中、完成、失败等状态。
- 任务队列和任务详情。
- 翻译已有 SRT 子功能。
- 字幕烧录子功能。
- 设置页：通用、模型管理、API 服务、Provider、诊断、Benchmark 入口。
- `FastSubClient` 接口设计。
- `MockFastSubClient` 实现，用于完整 mock 流程。
- `DaemonFastSubClient` 设计和后续接入。
- Electron main/preload 安全边界。
- 本地设置和安全存储策略。
- 远程 provider 上传确认 UI。
- Windows 本地路径体验，包括空格路径、中文路径和 UNC 路径的展示与传递。

## 范围外

- Electron renderer 直接调用 Python worker。
- Electron renderer 直接调用 ffmpeg、ffprobe、whisper.cpp、模型下载器或 provider runtime。
- 在 Electron 应用中实现 ASR、翻译、模型下载或 ffmpeg 编排逻辑。
- 替换现有 Python CLI。
- 实现 Go daemon 内部业务逻辑。
- 实现生产 Web 版。
- 实现多用户账户、云同步、团队共享或托管 SaaS。
- 默认启用远程 provider。
- 静默上传音频、视频或字幕文本。
- 默认公开本机 daemon 给局域网或公网。
- 在第一版 UI 中实现 WebSocket、高级任务调度、worker pool、warm model pool、priority queue、retry/DLQ。
- 在第一版 UI 中实现 aria2、镜像测速、多连接下载等高级下载管理。
- 提交真实模型、真实媒体、任务产物、API key、本机路径或本地 benchmark 报告。

## 成功标准

1. Electron 应用可以跑通 `ui-docs/prototype` 覆盖的主要页面和状态。
2. Mock 模式下，用户可以完成首次启动、添加媒体、生成字幕、查看结果、失败重试、取消任务和查看任务队列。
3. UI 所有后端数据访问都通过 `FastSubClient`。
4. `MockFastSubClient` 和 `DaemonFastSubClient` 共享同一套接口。
5. 主界面不暴露 daemon、worker、SSE、job id、JSON envelope 等技术细节。
6. 任务队列能展示等待中、正在生成、已完成、已失败和已取消状态。
7. 缺模型、模型安装失败、输出冲突、daemon disconnected、远程 provider 确认都有明确 UI 状态。
8. 翻译已有 SRT 和字幕烧录作为独立入口可访问，不干扰一键生成主流程。
9. 设置页能展示通用、模型、API、Provider、诊断和 Benchmark 入口。
10. Renderer 不直接持有 daemon token、API key 或 raw secret。
11. 远程 provider 使用前，UI 明确说明上传内容、provider 名称和可能费用。
12. 诊断页展示 redacted 信息，不泄露 token、API key、Authorization 或 signed URL。
13. 第一版 Electron mock 阶段完成的标准是：普通用户可以在不理解 daemon、worker、provider runtime 的情况下，从打开应用到生成字幕完整走通，并能在常见失败场景中看到下一步操作。
