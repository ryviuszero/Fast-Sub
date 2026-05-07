# 进度跟踪器

每次进行实质性的实现更改后，请更新此文件。

## 当前阶段

- Round 11 Electron Mock-first Shell 准备阶段

## 当前目标

- 按已细化的 Round 11 spec，从 11.1 Electron/Vite 骨架开始实现 mock-first 桌面应用。

## 完全的

- 已创建 `ui-docs/project-overview.md`，将项目范围收窄为 Fast Sub Electron 桌面客户端。
- 已创建 `ui-docs/architecture.md`，定义 Electron main/preload/renderer、`FastSubClient`、mock client、daemon client 和页面边界。
- 已创建 `ui-docs/code-standards.md`，定义 Electron 客户端代码标准、TypeScript、Electron、React/UI、client、IPC、存储、隐私和测试规则。
- 已创建 `ui-docs/ai-workflow-rules.md`，定义 AI 编码代理在 Electron 应用开发中的工作方式。
- 已创建 `ui-docs/ui-context.md`，从 prototype 中提取调色板、排版、圆角、状态色和 AI/provider 强调色 token。
- 已确认主线 Round 8 到 Round 10.5 已完成，`ui-docs` 后续只规划 Electron 相关 Round 11、Round 12 和 Round 13。
- 已在 `ui-docs/project-overview.md` 中同步后续三轮安排。
- 已创建 `ui-docs/specs/round11-electron-mock-first-shell.md`，作为 Round 11 Electron Mock-first Shell 的可执行 spec。
- 已细化 Round 11 spec，补充 implementation units、electron-vite 风格骨架、typed contract、job event contract、mock scenario matrix、路径 fixture、安全边界和 Electron smoke 验证。

## 进行中

暂无。

## 接下来

- 开始 11.1：创建 Electron/Vite 骨架，配置 `electron/main`、`electron/preload`、React renderer、开发脚本和基础窗口安全配置。
- 11.1 完成后更新本文件，记录启动方式、验证结果和剩余问题。
- 确认 OS keychain 具体依赖，留给 Round 12/13 真实 secret 存储接入。
- 确认 SSE client 具体实现方式，留给 Round 12 真实 daemon 接入。

## 决策清单

### 已确定

- 后续 UI 实现轮次：Round 11 做 Electron mock-first shell，Round 12 接入 Go daemon，Round 13 做产品化与发布准备。
- Round 11 spec 路径：`ui-docs/specs/round11-electron-mock-first-shell.md`。
- Round 8 到 Round 10.5 已完成，不再把 Go/Python 主线迁移任务混入 `ui-docs` 的后续 UI 计划。
- Electron 规划入口：使用 `ui-docs/project-overview.md`，不再使用 `ui-docs/readme.md`。
- 文档阅读顺序：`project-overview` -> `architecture` -> `code-standards` -> `ui-context` -> `ai-workflow-rules` -> `project-tracker`。
- 实现策略：mock-first，先完整跑通 UI 流程，再接真实 daemon API。
- Client 边界：所有后端访问通过 `FastSubClient`，renderer 不直接访问 daemon、Python worker、ffmpeg、模型下载器或 provider runtime。
- 默认翻译模型：首次启动默认准备 NLLB；如果 NLLB 安装失败，不阻断主转写流程，UI 提供稍后处理和诊断入口。
- 配置策略：用户设置直接映射到 Fast Sub 配置文件；API key 和 provider secret 只保存到安全存储，配置文件只保留 alias、环境变量名、masked 状态或 keychain reference。
- Benchmark：第一版保留在设置 / 诊断后面的规划入口，不进入主流程。
- Daemon client 测试：使用 fake HTTP/SSE server 和 contract fixtures，不启动真实 daemon。
- Round 11 Electron 应用目录：使用 `electron/`。
- Round 11 文档/原型整理分支可以继续使用 `codex/ui-prototype`；生产 Electron 实现分支从 `master` 切出 `codex/fast-sub-electron-mock-shell`。
- Round 11 实现使用单分支推进，不拆并行 worktree；11.1 到 11.5 可作为阶段提交，合并前按用户要求 squash 或保留。
- Round 11 UI 状态管理：使用 React state，不引入 Zustand/Jotai。
- Round 11 组件策略：使用自定义组件，基于 prototype 和 `ui-docs/ui-context.md` token 整理。
- Round 11 安全存储：只实现 mock 安全存储，不选定真实 OS keychain 依赖。
- Round 11 任务事件：不实现真实 SSE，只在 mock client 中模拟 job event/progress。
- Round 11 默认 ASR：使用 `whisper-small` 占位。
- Round 11 默认翻译模型：使用 NLLB 占位，失败不阻断主转写流程。
- Round 11 实现单元：11.1 Electron/Vite 骨架，11.2 contract 和 mock fixtures，11.3 首次启动和主界面核心流，11.4 任务队列和设置入口，11.5 安全和测试收口。
- Round 11 job event contract：`snapshot`、`progress`、`log_tail`、`succeeded`、`failed`、`canceled`、`events_lost`。
- Round 11 mock scenarios 必须可控、可复现，不使用随机失败作为默认行为。

### 实现前必须确认

- OS keychain 具体依赖。
- SSE client 具体实现方式：EventSource 代理、fetch-based SSE，或 main process stream bridge。
- 配置文件路径、格式和真实写入 adapter 细节。
- 默认 ASR 真实 manifest id，以及是否根据硬件推荐更小/更大模型。
- 默认 NLLB 真实 manifest id、磁盘占用提示和安装失败文案。

## 架构决策

- Electron 应用只负责 UI、用户交互、daemon 生命周期管理、安全桥和 client adapter。
- Renderer 只能通过 `FastSubClient` 访问后端能力。
- 先实现 `MockFastSubClient` 跑通完整 UI，再接入 `DaemonFastSubClient`。
- `DaemonFastSubClient` 的真实 REST/SSE、token、配置文件同步逻辑放在 main/preload controlled client 中；renderer 只使用 typed facade。
- Go daemon、Python worker、ffmpeg、whisper.cpp 和远程 API 都是 Electron 应用边界外的能力。
- 普通主界面不得暴露 daemon、SSE、job id、JSON envelope、worker 或 provider runtime 细节。
- 默认本地处理，远程 provider 必须显式确认上传内容。
- API key 和 provider secret 必须使用安全存储，不进入 renderer state 或 localStorage。
- 默认不引入数据库、外部消息队列、WebSocket、aria2、高级调度或 worker pool。

## 会议记录

- 用户明确：Round 8 到 Round 10.5 已经完成，`ui-docs` 后续主要从 Round 11 开始。
- 后续安排收敛为三轮：Round 11 Electron Mock-first Shell，Round 12 Electron 接入 Go Daemon，Round 13 产品化与发布准备。
- 用户明确：`ui-docs` 中的文档应聚焦 Electron 应用，而不是整个 Fast Sub 项目。
- `ui-docs/prototype/v2` 是当前 UI 信息架构和状态设计的主要参考。
- 原型覆盖五大区域：首次启动 / 环境检查、主界面 / 一键生成字幕、子功能、任务队列、设置。
- Electron 实现策略采用 mock-first：先完整跑通 UI 状态和流程，再接真实 daemon API。
- 后续实现前需要先完成剩余技术选择，重点是真实安全存储、真实 SSE client、配置文件 adapter 和默认模型 manifest 细节。
- 用户明确：Round 11 spec 创建后需要同步更新 `ui-docs/project-tracker.md`，不作为可选项。
- 已根据 GitHub 调查和审查建议细化 Round 11 spec：参考 electron-vite-react 的目录骨架、Electron 官方 contextBridge/contextIsolation 安全建议、类型化 IPC/schema 思路、本地 AI 桌面应用的 daemon/client 分层和可复现 mock 场景。
