# Fast Sub Agent 指南

## 项目概览

Fast Sub 是一个本地优先的视频和音频字幕工具。

当前产品形态：

```text
当前：Windows x64 Electron desktop release candidate
已完成：Python v0 CLI、Go product core、Go daemon/job API、Electron UI Round 11-13
当前发布形态：Windows x64 installer + portable zip，unsigned internal build
待完成：macOS arm64 dmg 需要在 macOS release machine 上打包和 smoke
长期：继续瘦身 app 私有 Python runtime，并评估 native worker / Go orchestration 边界
```

主要用户目标：

- 快速生成本地原语音字幕。
- 通过显式选择的本地、网页或 API provider 翻译 SRT 字幕。
- 默认保护本地工作流隐私。
- 提供可复现的 STT 和翻译质量/性能 benchmark 工具。
- 在迁移到 Go 的过程中，保持 CLI、JSON、退出码、provider、model、worker 和 benchmark contract 稳定。

## 当前进度

主线 Round 1 到 Round 13 当前状态：

- 项目已重命名为 `fast-sub`，包路径为 `src/fast_sub`。
- Python v0 CLI 可用。
- `auto`、裸命令和 `run` 都进入本地字幕 pipeline。
- `transcribe` 使用本地 faster-whisper worker 路径。
- `translate` 支持 `web-bing`、`web-google`、`api-openai-chat` 和 `local-nllb-ct2`。
- `models list/install/verify` 支持 ASR 和翻译模型。
- `bench` 支持媒体转写 benchmark。
- `bench-translate` 支持字幕翻译质量和运行时间 benchmark。
- Round 7.75 Python 分层清理已完成：
  - CLI command shell 已拆到 `fast_sub.cli.commands`。
  - service、client、provider、model-store、benchmark、STT、translation 包边界已明确。
  - `mypy src` baseline 已清理。
- Round 8 Go migration foundation 已完成。
- Round 9 Go transcribe/auto main path 已完成。
- Round 10 Go product core before UI 已完成。
- Round 10.5 Go daemon/job API gate 已完成。
- Round 11 Electron mock-first shell 已完成。
- Round 12 Electron 接入 Go daemon 已完成。
- Round 13 Windows x64 产品化和发布准备已完成当前可验证范围。
- Windows x64 installer / portable zip 已通过 packaged smoke、真实本地 Provider/file smoke、license inventory、截图 baseline 和发布 checklist。
- macOS arm64 dmg 打包、权限、Gatekeeper、签名/公证和进程清理 smoke 仍需在 macOS arm64 release machine 上执行。
- 当前文档整理分支已将历史计划和工程文档归档到 `dev-docs/`，并将用户帮助 / GitHub Pages 文档放到 `help-docs/`；根目录新增 `README.md`、`CHANGELOG.md`、`CONTRIBUTING.md` 和 `SECURITY.md`。

`dev-docs/ui-docs` 当前进度：

- 已建立 Electron UI 规划入口：`dev-docs/ui-docs/project-overview.md`。
- 已将 Electron 项目范围写入 `dev-docs/ui-docs/project-overview.md`。
- 已将 Electron 应用架构写入 `dev-docs/ui-docs/architecture.md`。
- 已从 prototype 提取 UI token 并写入 `dev-docs/ui-docs/ui-context.md`。
- 已写入 Electron 客户端代码标准：`dev-docs/ui-docs/code-standards.md`。
- 已写入 AI 编码代理工作规则：`dev-docs/ui-docs/ai-workflow-rules.md`。
- 已建立 Electron 进度跟踪器：`dev-docs/ui-docs/project-tracker.md`。
- `dev-docs/ui-docs/prototype/` 已覆盖首次启动、主界面、子功能、任务队列和设置等主要 UI 状态。
- Round 11、Round 12、Round 13 的 Electron specs 已完成并保存在 `dev-docs/ui-docs/specs/`。

已完成 UI 阶段：

```text
Round 11: Electron Mock-first Shell
Round 12: Electron 接入 Go Daemon
Round 13: 产品化与发布准备（Windows x64 已完成；macOS arm64 需跨机器 follow-up）
```

Round 11 已完成 Electron shell、mock client 和完整 mock-first UI 流程。Round 12 已完成 `DaemonFastSubClient`、daemon 启动、健康检查、任务创建、进度订阅、取消和结果查看。Round 13 已完成 Windows x64 打包、本地依赖检查、诊断、隐私提示、基础 smoke/E2E 和发布检查清单；macOS arm64 打包和 smoke 单独在 macOS release machine 上继续。

## 关键文档

- `dev-docs/ui-docs/prototype/desktop-ui-functional-plan.md`：桌面 UI 功能规划和原型范围。
- `dev-docs/ui-docs/project-overview.md`：Electron 产品定义、目标、功能和范围。
- `dev-docs/ui-docs/architecture.md`：Electron 应用结构、边界、存储模型和不变式。
- `dev-docs/ui-docs/ui-context.md`：Electron UI 主题、颜色、排版和组件约定。
- `dev-docs/ui-docs/code-standards.md`：Electron 实现规则和代码约定。
- `dev-docs/ui-docs/ai-workflow-rules.md`：Electron 开发工作流、范围规则和交付方式。
- `dev-docs/ui-docs/project-tracker.md`：Electron 当前阶段、决策清单、进度和下一步。
- `dev-docs/README.md`：项目文档入口和目录说明。
- `dev-docs/current-status.md`：当前项目状态、发布状态和后续工作。
- `help-docs/help/README.md`：用户帮助入口，覆盖安装、首次运行、生成字幕、翻译、双语、烧录、Provider、隐私和排障。
- `README.md`：开源仓库入口和快速说明。
- `CHANGELOG.md`：用户可读的版本变化记录。
- `CONTRIBUTING.md`：贡献规则、范围约束和验证命令。
- `SECURITY.md`：安全报告、隐私和 secret 处理规则。
- `help-docs/privacy.md`：隐私和远程 Provider 使用说明。
- `help-docs/troubleshooting.md`：用户排障入口。
- `dev-docs/release/windows.md` / `dev-docs/release/macos.md`：平台发布说明。
- `dev-docs/product/plan.md`：整体产品和里程碑计划。
- `dev-docs/product/mvp.md` / `dev-docs/product/mvp.zh.md`：Fast Sub v0 MVP 英文/中文说明。
- `dev-docs/product/go-migration-plan.md`：Go 迁移路线图。
- `dev-docs/archive/python-rounds/round7-75.md`：Python 分层清理计划归档。
- `dev-docs/archive/python-rounds/round7-75-implementation.md`：Round 7.75 已完成实现记录归档。
- `dev-docs/architecture/python-architecture.md`：当前 Python 架构图。
- `dev-docs/api/README.md`：API/reference 文档入口、生成规则和更新约束。
- `dev-docs/go-docs/project-standards.md`：Go 迁移阶段的项目标准和代码风格。
- `dev-docs/development.md`：Python 开发说明。
- `dev-docs/project-standards.md`：Python 包和代码风格标准。

## 工作规则

- 优先在 PM 线程中做规划和审查；代码实现放到专门 feature branch 或 worktree。
- 除非用户明确批准 contract 变更，否则保持公开行为稳定。
- 不要静默修改 CLI 命令名、参数、默认值、JSON schema、退出码、报告 schema 或 worker/provider contract。
- 不要让 API 或网页 provider 行为变成隐式行为。任何远程上传音频或文本都必须显式发生。
- 不要提交大型本地媒体、真实 benchmark 输出、模型文件、API key 或本机路径。
- 尊重 dirty worktree。不要回滚无关的用户改动。
- 搜索时优先使用 `rg`；如果 `rg` 被阻止，使用 PowerShell 等替代命令。
- 手动文件编辑使用 `apply_patch`。
- 修改范围保持在当前请求内。

## 应用构建上下文

在实现 Electron 应用或做任何架构决策前，按顺序阅读以下文件：

1. `dev-docs/ui-docs/project-overview.md`：产品定义、目标、功能和范围。
2. `dev-docs/ui-docs/architecture.md`：Electron 应用结构、边界、存储模型和不变式。
3. `dev-docs/ui-docs/code-standards.md`：实现规则和代码约定。
4. `dev-docs/ui-docs/ui-context.md`：主题、颜色、排版和组件约定。
5. `dev-docs/ui-docs/ai-workflow-rules.md`：开发工作流、范围规则和交付方式。
6. `dev-docs/ui-docs/project-tracker.md`：当前阶段、决策清单、进度和下一步。

每次进行有意义的 Electron 实现更改后，更新 `dev-docs/ui-docs/project-tracker.md`。

如果实现更改了上下文文件中记录的架构、范围、UI 设计上下文或代码标准，先更新对应文档，再继续实现。

后续 Electron 开发采用 specs-driven 方式推进。每个主要实现单元开始前，先确认对应 spec 或补充 spec；每个主要实现单元完成后，将进度、结果、未决问题和下一步同步更新到 `dev-docs/ui-docs/project-tracker.md`。

## 分支和合并风格

- Codex 工作的默认分支前缀是 `codex/`。
- 每个实现轮次优先使用一个清晰分支。
- 大轮次合并到 `master` 前，优先 squash 成一个可审查提交。
- 可能时优先 fast-forward merge 到 `master`。
- 最终回复中记录验证结果。

## Python 开发

当前定位：

- Python v0 CLI 已经可用，并继续作为稳定入口保留。
- Python 仍负责 `fast-sub` CLI、翻译、benchmark、model store、provider contract 和本地 worker 生态中的一部分能力。
- Python 长期定位是模型 worker / AI adapter / 生态适配层，不再承担未来桌面 UI 的主业务编排。
- Go 侧已经接管并行 CLI、product core 和 daemon/job API；Electron UI 不直接调用 Python 内部模块。
- 新增 Python 改动应优先服务于 worker、adapter、contract、测试 fixture 或兼容修复，不要绕过 Go daemon/UI client 边界。

Python 包入口：

```text
fast-sub = fast_sub.app:main
fast-sub-worker-faster-whisper = fast_sub_workers.faster_whisper:main
```

默认 Python 检查：

```bash
uv run ruff format --check src\fast_sub tests
uv run ruff check src\fast_sub tests
uv run mypy src
uv run pytest
```

已知本地说明：

- Windows 上 pytest 可能提示 `.pytest_cache` 无法写入。这个 warning 本身不代表测试失败。

Python 包职责：

- `fast_sub/cli/`：Typer 命令、JSON/stdout/stderr 策略、redaction、退出码。
- `fast_sub/clients/`：网络和第三方服务 client。
- `fast_sub/infrastructure/`：ffmpeg、ffprobe、worker subprocess、本地 runtime adapter。
- `fast_sub/providers/`：provider registry、metadata、availability、resolution。
- `fast_sub/stt/`：转写 options/results、worker orchestration、STT errors/constants。
- `fast_sub/translation/`：翻译 options/results、语言映射、解析、service。
- `fast_sub/subtitles/`：字幕 model、SRT parse/render、refine。
- `fast_sub/media/`：probe/extract/analyze 和媒体规则。
- `fast_sub/model_store/`：model manifest、install、verify、download、status。
- `fast_sub/output/`：输出路径和字幕烧录行为。
- `fast_sub/pipeline/`：跨模块 auto/run orchestration。
- `fast_sub/benchmark/`：benchmark options、metrics、reports、execution。
- `fast_sub/contracts/`：稳定 provider/worker/error contract。

Python 修改规则：

- 不要因为 Electron UI 需求而让 UI 直接调用 Python CLI 或 Python 内部函数。
- 不要在 Python worker 中读取主配置、下载模型、决定输出路径或直接写最终 SRT/ASS/MP4。
- 不要把 API key 传给本地模型 worker，除非 worker 是明确命名的 API worker。
- 修改 worker request/response/error schema 时，同步更新 Go contract、daemon client 和相关文档。
- 修改 Python CLI 公开行为时，保持命令名、参数、默认值、JSON schema 和退出码兼容，除非用户明确批准。

## Go 迁移规则

当前定位：

- Round 8 Go migration foundation 已完成。
- Round 9 Go transcribe/auto main path 已完成。
- Round 10 Go product core before UI 已完成，Go 已负责模型下载、provider runtime、OpenAI STT 和 whisper.cpp native backend。
- Round 10.5 Go daemon/job API gate 已完成，Go 已提供 `serve/daemon`、REST job API、SSE events、job store、cancel/restart 语义和 loopback auth。
- 下一阶段是 Round 11 Electron Mock-first Shell；Go 不再只是迁移试验，而是 Electron UI 的本机产品核心和 daemon 边界。

Go 代码主要目录包括：

```text
cmd/fast-sub-go/
internal/cli/
internal/contracts/
internal/daemon/
internal/downloads/
internal/events/
internal/errors/
internal/ffmpeg/
internal/jobs/
internal/logging/
internal/media/
internal/models/
internal/paths/
internal/providers/
internal/runtime/fasterwhisper/
internal/runtime/openai/
internal/runtime/whispercpp/
internal/subtitle/
internal/testutil/
internal/worker/
```

当前 Go 边界：

- `fast-sub-go` 作为并行 Go CLI 和本机 daemon；不要在未明确批准前替换 Python `fast-sub`。
- Go 负责 product core、下载、provider runtime、job orchestration、daemon API、UI contract 和本机进程控制。
- Go daemon 默认只监听 `127.0.0.1`，非 health/version API 需要 ready token。
- Go daemon REST/SSE contract 是 Electron `DaemonFastSubClient` 的真实后端边界。
- 匹配并稳定 JSON、错误码、路径、stdout/stderr、redaction 和 provider/model/job contract。
- 使用 `exec.CommandContext` 调用 `ffmpeg` / `ffprobe`；不要使用 CGo ffmpeg binding。
- 不要在 Go 中直接运行 faster-whisper 推理；继续通过 Python worker 或 native binary provider 边界调用。
- 不要让 Go runtime 包依赖 Electron UI、renderer、preload 或页面代码。
- 不要默认启用 API provider，不要静默上传音频或字幕文本。
- 默认测试不得访问真实网络、真实 OpenAI、真实模型、真实 ffmpeg、真实 whisper.cpp 或 GPU。

Go 检查命令：

```bash
gofmt -w <changed-go-files>
go test ./...
```

Go 修改规则：

- 修改 daemon API、event schema、job status、provider metadata 或 model metadata 时，同步更新 `dev-docs/go-docs/specs/daemon-api.md`、`dev-docs/ui-docs/architecture.md` 或相关 client contract 文档。
- 修改 Electron 依赖的 JSON contract 时，同步更新 `dev-docs/ui-docs/project-tracker.md` 的会议记录或未解决问题。
- 保持 JSON stdout 纯净，日志和第三方输出不能混入 JSON。
- 所有 secret、Authorization、ready token、signed URL 和 proxy credential 必须 redacted。

## 桌面 UI 和 Electron

- 将 `dev-docs/ui-docs/project-overview.md` 作为 Electron 规划和实现顺序的入口文档。
- Round 8 到 Round 10.5 已完成；Electron 相关后续实现从 Round 11 开始。
- Round 11 做 Electron mock-first shell：项目骨架、`FastSubClient` MVP contract、`MockFastSubClient`、首次启动、主界面、任务队列和设置页 mock 流程。
- Round 12 接入 Go daemon：`DaemonFastSubClient`、daemon 生命周期、健康检查、任务创建、事件订阅、取消、结果查看和异常恢复。
- Round 13 做产品化与发布准备：打包、本地依赖检查、诊断、隐私提示、基础 smoke/E2E 和发布检查清单。
- Electron 客户端采用 mock-first：先完成 UI 流程和状态管理，再接入真实 daemon。
- 保持后端 client 边界，让 UI 可以从 `MockFastSubClient` 切换到 `DaemonFastSubClient`，避免页面级重写。
- 不要因为当前 daemon API 尚未暴露某些能力就删除 UI 原型功能；按需要补充小范围 daemon API。
- 远程 API 使用必须对用户显式、可见。

## 审查优先级

按以下顺序审查：

1. 公开行为兼容性。
2. JSON 纯净性和退出码稳定性。
3. 隐私和 secret redaction。
4. 是否引入了新的副作用。
5. 高风险路径的测试覆盖。
6. 包职责和依赖方向是否正确。
7. 命名、类型、错误、注释/docstring 和格式。
