# Fast Sub Electron Code Standards

本文档定义 Fast Sub Electron 应用的代码标准。它只约束 Electron 客户端代码：main process、preload、renderer、client、mock 数据、UI 状态、设置和测试。Go daemon、Python worker、ffmpeg、whisper.cpp 和模型 runtime 的实现标准不在本文档范围内。

## General

- 保持 Electron 应用边界清晰：UI 负责展示和用户交互，后端能力只能通过 `FastSubClient` 访问。
- 优先修复根因，不通过堆叠 UI workaround 掩盖 contract、状态或权限问题。
- 不在一个组件中混合页面布局、后端请求、状态转换、隐私判断和样式细节。
- 普通用户流程优先：主界面不展示 daemon、SSE、job id、JSON envelope、worker 或 provider runtime 细节。
- 复杂能力放到设置、诊断或独立工具页，不挤进“一键生成字幕”主路径。
- 所有远程 provider 使用都必须显式显示上传内容、provider 名称、API key 要求和可能费用。
- Mock-first 不是临时假 UI；mock client 必须覆盖真实用户会遇到的成功、失败、取消、缺模型、远程确认和 daemon disconnected 状态。
- 所有错误都要收敛成用户可执行的恢复动作，例如重试、安装模型、查看诊断、打开设置或取消。

## TypeScript

- 使用 TypeScript strict mode。
- 禁止使用宽泛 `any`；确实无法避免时必须限制在 adapter 边界，并写清转换原因。
- 后端返回、IPC payload、SSE event、配置文件和本地存储读取结果都必须先作为 `unknown` 处理，再解析成明确类型。
- 为 `FastSubClient`、job、model、provider、settings、privacy confirmation、error contract 定义显式 interface/type。
- UI 组件 props 必须有明确类型，不使用隐式 object shape。
- 不在业务代码中散落字符串状态；job status、job stage、provider status、model status、output type 应使用 union type 或 enum-like 常量。
- 不直接把 daemon contract 原样暴露给页面组件；通过 view model 映射成用户可见状态。
- 所有 exhaustiveness-sensitive switch 都必须处理默认未知状态，并展示安全 fallback。
- 时间、大小、百分比、路径、错误码等展示格式应通过 shared formatter/helper 统一处理。
- 禁止在 renderer 类型中包含 raw API key、daemon token、Authorization header 或 raw secret 字段。

## Electron

- Main process 负责窗口、daemon lifecycle、系统 dialog、安全存储和受控系统能力。
- Preload 只暴露 allowlist API，例如选择文件、打开目录、调用 client、订阅任务事件。
- Renderer 不直接访问 Node.js、shell、`child_process`、文件系统、环境变量或 OS keychain。
- Renderer 不持有 daemon ready token；token 只保存在 main process 内存中。
- 非 `health/version` daemon API 的 bearer token 由 main/preload controlled client 添加。
- 默认禁用 CORS，不为本地 daemon UI 添加通配 origin。
- 不在 renderer 中构造任意 shell command。
- 不把 daemon base URL、token、API key、Authorization 或 signed URL 写入 console、日志、UI state 或错误对象。
- Electron IPC channel 必须命名明确、单一职责、请求/响应类型固定。
- IPC handler 必须校验输入，不信任 renderer 传入的路径、provider id、model id 或 job id。
- 文件选择必须通过系统 dialog 或用户 drag-and-drop 授权；应用不扫描未选择目录。

## React And UI

- 组件保持单一职责：页面组件负责布局，container/view-model 负责数据组合，基础组件只负责展示。
- 不在通用 UI 组件中发起后端请求。
- 主界面组件不能展示内部 job 状态名；必须映射为“等待中、正在生成、已完成、已失败、已取消”等用户状态。
- 详细设置默认折叠；新增高级选项时优先放入详细设置、设置页或诊断页。
- 翻译已有 SRT 和字幕烧录必须保持独立入口，不阻塞主生成流程。
- 远程 provider 确认必须是明确阻断式流程，不能只用非阻塞 toast。
- 失败状态必须展示问题说明、建议操作和至少一个恢复动作。
- 日志默认折叠；结构化错误优先于 raw log。
- `events_lost`、daemon disconnected、401、job interrupted 都必须映射为用户可恢复状态。
- 按钮文案使用用户动作，例如“下载默认模型”“重试任务”“打开输出文件夹”，避免“调用接口”“发送请求”等技术文案。

## Client Boundary

- 所有后端访问必须经过 `FastSubClient`。
- `MockFastSubClient` 和 `DaemonFastSubClient` 必须实现同一个接口。
- UI 不应该知道当前启用的是 mock client 还是真实 daemon client。
- `FastSubClient` 返回 UI 需要的 typed result，不返回未解析 raw HTTP response。
- `DaemonFastSubClient` 的真实 adapter 负责 REST/SSE 细节、auth、reconnect、401、events_lost、JSON parsing 和配置文件同步；renderer-facing facade 只暴露 typed 方法。
- `MockFastSubClient` 必须模拟异步延迟、进度、失败、取消和安装状态，不只返回静态成功数据。
- 页面组件不直接拼接 daemon URL，不直接设置 Authorization header。
- Client adapter 中的错误必须转换成统一 UI error model。
- 任何新增 daemon endpoint 都必须先更新 client interface、mock implementation 和 contract mapping 测试。

## Styling

- 原型视觉来自 `ui-docs/prototype`，生产 UI 应保留其信息架构和用户可见状态，但实现可整理为正式组件。
- 使用语义化 design tokens，例如 color、spacing、radius、font size、shadow、border。
- 避免在组件中散落 hardcoded hex；颜色应来自 token。
- 状态颜色必须一致：ready/success、warning/failure、running/progress、muted/disabled 不得各页随意变化。
- 卡片、按钮、状态标签、进度条、文件列表、设置分组和确认弹窗应复用基础组件。
- 主界面保持安静、清晰、工具化，不做营销页式 hero。
- 不使用可见文本解释内部技术实现，例如 daemon、SSE、worker protocol，除非在诊断页。
- 文本必须适配中英文、长文件名、中文路径和 UNC 路径；长路径默认截断并提供 tooltip 或详情展开。
- 重要按钮必须在 disabled/loading/error 状态下保持布局稳定。

## API And IPC

- REST、SSE、IPC payload 都必须验证和解析后再进入 UI state。
- 所有 API response 必须按统一 shape 处理：success result、warnings、structured error。
- HTTP status 和 JSON error code 都要保留；UI 显示时用用户文案。
- 401 必须触发 daemon reconnect 或重新启动流程，不能显示裸 “Unauthorized”。
- 404 unknown job 必须提示任务不存在或已清理。
- 409 invalid state 必须提示当前状态下不能执行该操作。
- SSE progress/status event 可以驱动 UI 状态；log event 只能用于诊断展示。
- SSE reconnect 后如果收到 `events_lost`，必须重新 `getJob(jobId)` 同步状态。
- IPC handler 不能返回 raw Error object；必须返回可序列化、redacted 的错误。
- 所有 API/IPC 测试必须覆盖成功和失败 shape。

## Data And Storage

- Electron 第一版不引入数据库。
- UI 设置可以保存在 Electron store 或本地配置 adapter 中，但只能保存非敏感数据。
- API key 和 provider secret 必须保存在 OS keychain 或等效安全存储中。
- localStorage 不允许保存 secret、daemon token、Authorization header 或 signed URL。
- Renderer state 只保存当前 UI 状态、表单草稿、筛选条件和用户可见数据。
- Job、model、provider 的真实状态来自 daemon client，不来自 renderer 缓存。
- 最近文件、最近输出目录和窗口偏好可以本地保存，但用户必须可以清除。
- Mock 数据只用于开发和测试，不作为生产默认数据源。
- 不提交真实模型、真实媒体、任务产物、本机路径、本地 benchmark 报告或 secret。

## Privacy And Security

- 默认本地处理；远程 provider 默认不启用。
- 使用远程 ASR 前必须提示会上传音频。
- 使用网页/API 翻译前必须提示会上传字幕文本。
- 远程 provider 确认必须包含 provider 名称、上传内容、API key 要求和可能费用。
- 诊断、日志、错误、toast、console、测试快照必须 redacted API key、token、Authorization、signed URL 和 proxy credential。
- Provider 页面必须展示 local/api/web/native 分类和 privacy note。
- `auto` 或“一键生成”不能因本地 provider 不可用而自动切到 API provider。
- Live provider test 必须和 static provider test 区分；默认测试不能上传音频或字幕文本。

## Testing

- Mock client flow 必须覆盖首次启动、模型缺失、模型安装失败、主生成成功、主生成失败、取消、输出冲突、远程确认和 daemon disconnected。
- Daemon client 测试必须覆盖 REST success、REST error、401、unknown job、invalid state、SSE reconnect 和 events_lost；这些测试使用 fake HTTP/SSE server 和 contract fixtures，不启动真实 daemon。
- UI 测试必须验证主界面不显示 daemon token、job id、SSE event 名称或 raw JSON。
- 隐私测试必须验证 API key、Authorization、daemon token、signed URL 不出现在 UI 文案、日志摘要和错误消息中。
- 任务队列测试必须覆盖等待中、正在生成、已完成、已失败、已取消和服务中断。
- 设置页测试必须覆盖 API key masked 状态、远程上传确认和 provider privacy note。
- 不在默认测试中调用真实 daemon、真实模型、真实 ffmpeg、真实 API 或真实网络。

## File Organization

- `ui-docs/` — UI 规划、项目总览、架构、代码标准和产品流程文档。
- `ui-docs/prototype/` — 当前 Vite/React 原型和 artboards，仅作为设计参考。
- `electron/` — Electron 应用根目录。Round 11 已确定使用此目录名。
- `electron/main/` — Electron main process、窗口、daemon lifecycle、系统 dialog、安全存储。
- `electron/preload/` — 安全 IPC bridge 和受控 API 暴露。
- `electron/renderer/` — React UI、页面、组件、状态和样式。
- `electron/renderer/pages/setup/` — 首次启动和环境检查流程。
- `electron/renderer/pages/main/` — 主界面、一键生成、详细设置和结果状态。
- `electron/renderer/pages/jobs/` — 任务列表、任务详情、失败详情和日志摘要。
- `electron/renderer/pages/tools/` — 翻译已有 SRT、字幕烧录等独立工具。
- `electron/renderer/pages/settings/` — 通用、模型、API、Provider、诊断、Benchmark 设置页。
- `electron/renderer/components/` — 按钮、输入、状态标签、进度条、文件卡片、确认弹窗等基础组件。
- `electron/renderer/client/` — `FastSubClient` interface、mock client、daemon client renderer-facing facade、hooks 和 view-model adapter。
- `electron/main/client/` — 真实 daemon adapter、REST/SSE、auth、daemon lifecycle、配置文件同步。
- `electron/preload/client/` — 受控 IPC client bridge。
- `electron/renderer/state/` — UI store、view model、form state 和 derived state。
- `electron/shared/contracts/` — TypeScript contract types、schema adapter、错误码映射。
- `electron/shared/privacy/` — provider privacy 文案、远程上传确认模型、redaction UI helper。
- `electron/test/` — UI、client、mock flow、contract mapping 和隐私测试。

## Round 11 Decisions And Later Choices

| 决策 | Round 11 选择 | 后续需要确认 |
| --- | --- | --- |
| Electron 应用目录 | 使用 `electron/` | 无 |
| UI 状态库 | 使用 React state，不引入 Zustand/Jotai | 复杂度上升后是否需要轻量 store |
| UI 组件库 | 使用自定义组件，基于 prototype 和 `ui-context.md` token 整理 | Round 13 是否引入 Radix/shadcn |
| 安全存储库 | Round 11 只实现 mock 安全存储 | Round 12/13 选择具体 Electron keychain 依赖 |
| 设置存储 | 用户设置映射到 Fast Sub 配置文件；纯 UI 偏好可用 Electron store | 配置文件路径和真实写入 adapter 细节 |
| SSE client | Round 11 只模拟 job event/progress | Round 12 确认 EventSource 代理、fetch-based SSE 或 main process stream bridge |
| 测试栈 | React Testing Library + fake client + contract fixture | 是否加入 Playwright/Electron E2E |
| 样式方案 | CSS tokens + 组件样式 | 是否使用 CSS Modules、Tailwind 或纯 CSS |
