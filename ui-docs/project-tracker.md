# 进度跟踪器

每次进行实质性的实现更改后，请更新此文件。

## 当前阶段

- Round 12 Electron Daemon Integration And Release Feature Closure 实现中

## 当前目标

- 在已完成的 Round 12 contract/fake fixture 基础上，继续补齐真实 model installer、Python CLI resolver、真实 translate/burn bridge、持久 atomic config writer 和 secret channel 消费端。

## 完成的

- 已创建 `ui-docs/project-overview.md`，将项目范围收窄为 Fast Sub Electron 桌面客户端。
- 已创建 `ui-docs/architecture.md`，定义 Electron main/preload/renderer、`FastSubClient`、mock client、daemon client 和页面边界。
- 已创建 `ui-docs/code-standards.md`，定义 Electron 客户端代码标准、TypeScript、Electron、React/UI、client、IPC、存储、隐私和测试规则。
- 已创建 `ui-docs/ai-workflow-rules.md`，定义 AI 编码代理在 Electron 应用开发中的工作方式。
- 已创建 `ui-docs/ui-context.md`，从 prototype 中提取调色板、排版、圆角、状态色和 AI/provider 强调色 token。
- 已确认主线 Round 8 到 Round 10.5 已完成，`ui-docs` 后续只规划 Electron 相关 Round 11、Round 12 和 Round 13。
- 已在 `ui-docs/project-overview.md` 中同步后续三轮安排。
- 已创建 `ui-docs/specs/round11-electron-mock-first-shell.md`，作为 Round 11 Electron Mock-first Shell 的可执行 spec。
- 已细化 Round 11 spec，补充 implementation units、electron-vite 风格骨架、typed contract、job event contract、mock scenario matrix、路径 fixture、安全边界和 Electron smoke 验证。
- 已完成 11.1：创建 `desktop/` Electron/Vite/React/TypeScript 骨架，包含 `desktop/main`、`desktop/preload`、`desktop/renderer`、`desktop/shared` 和 `desktop/test`。
- 已完成 11.2：定义 `FastSubClient` MVP contract、`EnvironmentStatus`、`ModelStatus`、`ProviderStatus`、`ConfigViewModel`、job、event、result、log 和 `UiError` 类型；实现 `MockFastSubClient` 和 deterministic scenarios。
- 已完成 daemon SSE 到 UI `JobEvent` mapping fixture 和测试，覆盖 `created/queued/started/progress/log/warning/completed/failed/canceled/interrupted/events_lost/heartbeat`，并验证 token、Authorization、API key 和 raw envelope 不泄露。
- 已完成 11.3：落地首次启动、环境检查、添加媒体、添加文件夹、默认输出、详细设置折叠、创建 mock job、进度、成功结果、打开字幕和打开输出文件夹 mock 入口。
- 已完成 11.4：落地任务队列、任务详情、失败/取消/重试/删除入口、redacted logs，以及设置页通用、模型管理、API 服务、Provider、诊断和 Benchmark tab。
- 已完成 11.5：配置 Electron `contextIsolation: true`、`nodeIntegration: false`、基础 CSP、preload allowlist API、安全 smoke、renderer flow 测试、远程 provider 阻断确认和诊断 redaction。
- 已修复 dev 模式空白窗口：当 electron-vite 未向 main process 注入 `ELECTRON_RENDERER_URL` 时，main process 会在未打包模式 fallback 到 `http://localhost:5173`，并记录 renderer load failure 诊断；dev CSP 允许 Vite/React refresh 所需的 localhost 和 websocket，生产 CSP 仍保持严格。
- 已更新 `.gitignore`，忽略 `desktop/node_modules/`、`desktop/dist/`、`desktop/dist-electron/`、`desktop/out/`、`desktop/.vite/`、`desktop/coverage/`、`desktop/test-results/` 和 `desktop/playwright-report/`。
- 已生成独立 `desktop/package-lock.json`，Round 11 使用 npm 管理 Electron 依赖。
- 已从 `ui-docs/prototype` 导出 30 张 Round 11 原型视觉参考图，输出到 `ui-docs/prototype/reference/round11/`，并生成 `README.md` 索引。
- 已新增 `ui-docs/prototype/export-artboards.mjs`，可通过本地 Vite 原型服务和 Chrome DevTools Protocol 重新导出 artboard PNG。
- 已按 `ui-docs/prototype/reference/round11/` 视觉参考重做 renderer 主 UI：首次启动、空状态拖拽区、添加文件、详细设置、生成中、完成页、任务队列、设置页均改为原型窗口式布局；移除普通主界面的常驻左侧导航。
- 已新增隐藏调试入口：右下角隐形按钮和 `Ctrl+D` 可打开调试面板，用于切换 mock 场景和主要页面状态，方便逐屏对照原型测试。
- 已修正 Windows 适配：原型中的 macOS 三圆点和 `Fast Sub` 标题不再作为 renderer 内部伪窗口绘制；Electron 使用原生窗口标题栏，隐藏默认 File/Edit/View 菜单栏，内容区不再窗口套窗口。
- 已移除首次启动检查页残留的顶部页面工具条，避免在 Windows 原生标题栏下出现空白横条。
- 已修正 dev 模式文件选择：`添加视频` 现在通过隐藏的原生 `<input type="file">` 触发 Windows 系统文件选择器，不依赖 preload/IPC；Electron main 的 `dialog.showOpenDialog` 仍保留给文件夹选择和后续真实路径 adapter。
- 已将 `添加文件夹` 同步改为隐藏的原生 folder input，通过 Chromium/Electron 的 `webkitdirectory` 触发 Windows 文件夹选择，并在 mock UI 中展示选中文件夹内的媒体文件。
- 已将主界面输出位置的 `修改` 改为可交互目录选择入口，使用隐藏的原生 folder input 触发 Windows 路径选择，并在 mock UI 中回显选中的输出目录名。
- 已将用户可见导航修正为固定应用菜单栏：进入主界面后固定显示 `←`、`→`、`窗口`、`帮助`，`窗口` 只包含 `字幕生成`、`翻译SRT`、`字幕烧录`；设置页、队列页和子功能不再重复渲染顶栏 tab。
- 已将固定应用菜单栏与页面状态条对齐到同一顶栏高度，左侧菜单不再另占一行，右侧状态 chip 保持在同一水平线上。
- 已修复固定应用菜单栏换行问题：`窗口`、`帮助` 保持单行显示，菜单背景不再撑出额外块状区域。
- 已移除顶栏中的页面说明和页面级返回按钮：`任务详情`、`设置`、`翻译字幕`、`字幕烧录` 等不再显示在固定菜单栏旁，返回/前进统一使用全局 `←` / `→`。
- 已收紧固定应用菜单栏高度，从页面标题条节奏改为更窄的菜单栏节奏。
- 已将任务列表 tab 改为可点击筛选：`正在生成`、`已完成`、`失败` 会切换对应任务列表内容。
- 已统一窗口功能页的设置入口：字幕生成、翻译SRT、字幕烧录在左下角显示齿轮 `设置`，字幕生成右下角不再重复显示 `设置`。
- 已将顶部 `帮助` 从跳转诊断页改为预留文档菜单，先显示空链接位 `Fast Sub Document`，后续再接真实文档地址。
- 已将任务详情 tab 改为可点击切换：运行中详情支持 `进度`、`日志`、`详情`，失败详情支持 `问题`、`日志`、`配置`。
- 已修复帮助菜单文档入口换行问题，`Fast Sub Document` 保持单行显示。
- 已修复已添加文件列表的 `移除` 行为，点击后会从当前列表删除文件并更新数量，删空时回到空状态。
- 已实现详细设置中的输出内容、输出冲突、词级时间戳和保留临时文件交互，点击后会更新当前 mock 配置和选中态。
- 已修复完成页结果卡片的 `文件夹` 按钮，点击后会通过 mock open path 打开输出目录。
- 已为 mock 打开路径操作增加可见反馈，点击 `文件夹` 或 `打开字幕` 后会显示已模拟打开的路径提示。
- 已增强 mock 打开路径提示样式：提示居中显示，字号/阴影/色彩更醒目，并区分成功与失败状态。
- 已实现设置 / 通用页的主要选项交互：输出内容、文件冲突策略、默认转写方式、设备和词级时间戳会写入 mock 配置并更新选中态。
- 已补全设置 / 通用页语言选项的本地 UI 状态，`跟随系统`、`简体中文`、`English` 可以切换选中态。
- 已为翻译SRT和字幕烧录工具接入本地文件选择：选择 SRT、选择视频、选择字幕会打开文件选择器并回显选中文件名。
- 已收紧固定应用菜单栏左侧留白，让 `←`、`→`、`窗口`、`帮助` 更靠近窗口左侧。
- 已在缺少默认 ASR 模型的空状态提示中增加 `去下载模型` 入口，直接跳转到设置 / 模型管理页，避免用户只能阅读阻断提示。
- 已修复 Round 11 审阅中剩余 6 个缺口：取消任务会停止订阅并保持取消态，缺 ASR 模型安装后可恢复本地转写，队列详情支持重试/删除/取消，主界面拖拽文件可进入已添加状态，翻译SRT/字幕烧录具备 mock 选择和完成/失败流，smoke 会真实启动 Electron 并验证 renderer/preload allowlist。
- 已完成 Round 11 二次审阅收口：`events_lost` 使用当前 active job 重新同步，mock 场景补齐模型安装中/安装失败，翻译SRT和字幕烧录通过 `FastSubClient.createJob()` 创建 mock 任务，输出冲突策略会写入配置，媒体/文件夹/输出目录选择优先走 preload allowlist，诊断页只展示脱敏的产品级示例信息。
- 已将 `desktop/renderer/src/App.tsx` 重构为轻量入口，实际 shell 迁移到 `desktop/renderer/src/app/AppShell.tsx`，为后续继续拆分页面和组件留下明确边界。
- 已继续拆分 `desktop/renderer/src/app/AppShell.tsx`：抽出 `types.ts`、`fixtures.ts`、`components.tsx`、`renderScreen.tsx` 和 `screens/` 下的 setup/main/queue/settings/tools 页面模块；当前 app 目录内单文件均低于 500 行，最大文件为 `AppShell.tsx` 429 行。
- 已补充 renderer 测试覆盖：preload allowlist 文件/目录选择、`events_lost` 重同步、模型安装中/失败场景、翻译SRT/字幕烧录任务创建、缺 ASR 模型阻断与模型管理跳转、设置和详细设置选项交互。
- 已修复 Round 11 对照审阅剩余缺口：失败任务改为 `MockFastSubClient` 中的真实 job，队列失败详情可真正删除；默认 ASR 安装失败场景会阻断主转写并显示重试；取消任务进入 `canceling` 状态再完成取消；输出冲突 `另存为` 在目录选择取消时不会继续创建任务；任务队列 tab 数字改为根据 mock job 动态计算。
- 已补齐设置页剩余 mock 交互：API 服务启用、上传前确认和连接测试具有本地状态反馈；Provider 刷新会调用 `FastSubClient.testProvider()` 的 mock 静态检查；Provider 状态从 contract enum 映射为用户可读文案，避免显示 `missing_api_key`、`disabled` 等内部状态码。验证：`cd desktop && npm run typecheck`、`cd desktop && npm test`。
- 已修复输出冲突与远程上传确认的状态串用问题：`startJob()` 现在区分 `conflictResolved` 和 `remoteUploadConfirmed`，用户处理同名文件冲突后仍会看到远程 provider 上传确认弹窗；新增回归测试覆盖冲突 + 远程 provider 组合场景。验证：`cd desktop && npm run typecheck`、`cd desktop && npm test`。
- 已通过验证：
  - `cd desktop && npm run typecheck`
  - `cd desktop && npm test`
  - `cd desktop && npm run build`
  - `cd desktop && npm run smoke`
- 已创建 `ui-docs/specs/round12-electron-daemon-integration.md`，将 Round 12 定位为桌面版发布前核心功能闭环：真实 daemon client、独立 `model_install` job、真实转写、翻译 SRT、字幕烧录、配置写入和 main process secret storage。
- 已根据 Round 12 审阅建议细化 spec：初步拆分 12.1 到 12.8，并要求先完成 daemon API contract 和 fake fixtures，避免 Electron adapter 猜测新增 job/config/secret API。
- 已在 Round 12 spec 中明确 fetch-based SSE、Windows 进程清理限制、Python CLI bridge 安全/编码规则、配置 atomic write、keytar 风险和 safeStorage fallback、真实手动 smoke 要求。
- 已按二次审阅调整 Round 12 spec：将 config/secret 提前到 12.4，明确真实 job 使用保存后的配置，补充 `createModelInstallJob()` 语义、CLI resolver、transient secret reference，以及 12.8 前 mock/fake daemon 的开发保留规则。
- 已更新 `go-docs/specs/daemon-api.md`，新增 Round 12 planned extensions：`model_install`、`translate_srt`、`burn_in`、model verify、job result shape、config boundary、secret boundary 和 fake daemon fixture 要求。
- 已按第三次审阅收口 Round 12 文档：配置边界固定为 daemon `GET/PATCH /v1/config`，`secret_ref` 不得原样持久化，`FastSubClient` 类型变更写入 spec，并明确 12.1 contract 未完成前不创建真实 adapter、不切 UI 默认模式。
- 已补齐 Round 12 contract 细节：`GET /v1/config` / `PATCH /v1/config` 的 view model、merge patch 和 validation error shape；`secret_ref` 的生成、消费、TTL、错误码和清理规则；fake daemon fixtures 和手动 smoke 测试资产位置。
- 已完成 12.1/12.2/12.3 的 Electron 侧基础实现：新增 `DaemonFastSubClient` renderer-facing facade、preload typed allowlist、main process daemon lifecycle、ready JSON 读取、token 内存持有、REST envelope 映射和 fetch-based SSE 订阅/取消/resync。
- 已新增 Round 12 fake daemon fixtures：`desktop/test/fixtures/daemon/round12/` 覆盖 `model_install`、`translate_srt`、`burn_in`、config view、secret_ref 错误词表和 redaction。
- 已扩展 `FastSubClient` contract：`JobKind` 增加 `model_install`，`ModelStatus.installJobId`，`createModelInstallJob(modelId)`；`MockFastSubClient` 和 renderer 模型管理入口已改为独立模型安装 job 语义。
- 已完成 12.4 的基础 adapter：main process 增加 Electron `safeStorage` secret store fallback 和 transient secret reference map；renderer 仍只看到 alias/masked/status，不接触 raw secret。
- 已完成 Go daemon 的最小 Round 12 API 扩展：`POST /v1/jobs` 接受 `model_install`、`translate_srt`、`burn_in`，新增 `GET/PATCH /v1/config` 和 `POST /v1/models/{model_id}/verify`。
- 已接入 Go daemon Round 12 job bridge：`model_install` 复用现有 Go model installer 并通过 job/SSE/cancel/result/logs/delete 展示进度；`translate_srt`、`burn_in` 当前仍使用受控 placeholder bridge，真实 Python CLI resolver 和 ffmpeg bridge 仍需后续完善。
- 已修复 Electron dev 启动找不到 `fast-sub-go.exe` 的问题：未打包模式下如果找不到显式二进制，会从仓库根目录用 `go run ./cmd/fast-sub-go` 启动本地 daemon；初始化列表请求在 daemon 不可用时返回空状态，由环境检查页显示可恢复服务错误，避免 main process 连续输出 IPC handler 错误。
- 已新增 dev-only daemon transport log：设置 `FAST_SUB_DEBUG_DAEMON=1`，或创建 `desktop/local/daemon-debug.json` 后，Electron main process 会输出/写入 redacted daemon spawn/ready、REST method/path/status、SSE connect/event/error 摘要；日志不包含 token、Authorization、raw secret 或完整 request body。示例配置见 `desktop/daemon-debug.example.json`。
- 已修复 Desktop 真实转写请求的 source 输出目录推导：当配置为“与源视频相同目录”时，renderer 会用真实输入文件父目录作为 `outputDirectory`，避免把 mock fixture 输出目录带入 daemon 请求；同时在 dev-only transport log 中增加 `job.request` 摘要，记录 job type、input/output path、inputExists、provider/model/language 和失败事件中的 daemon error 摘要，方便定位 Desktop 与 Go 直测参数差异。
- 已修复完成页仍显示 Round 11 占位结果的问题：`main-done` 现在从当前 `activeJob.result` 渲染输出文件名、耗时/摘要、打开字幕路径和输出文件夹，不再固定显示 `a b.srt`、`sample-lecture.srt` 和失败占位项。
- 已修复 Go daemon `completed` SSE 事件到 UI 结果的字段映射：完成事件现在读取真实 `output_path`、推导 `outputFolder`，并用 `elapsed_sec` 生成耗时文案，避免因只识别旧 fixture 的 `subtitle_path` 而回退到占位 `a b.srt`。
- 已修复失败任务详情页仍显示 Round 11 占位错误的问题：`queue-failed` 现在读取当前 `activeJob.error` 的真实 title/message/action/code/details/diagnostic；日志和配置 tab 也改为当前任务摘要，不再固定显示 `media_extract_failed`、`extracting_audio` 或 `meeting.mp4` 占位日志。
- 已接通真实输出冲突确认流程：daemon job 因 `output_exists` 失败且 UI 配置为 `ask` 时，renderer 会显示覆盖/跳过/另存为确认；用户确认覆盖后，Electron main process 会在下一次 `POST /v1/jobs` 中传递 `options.overwrite=true`，Go job runner 仅在该显式选项存在时允许覆盖已有输出。
- 已修复输出冲突弹窗目标路径显示错误：最小 `created/queued` SSE 事件不再用 Round 11 fallback snapshot 覆盖真实 job title/path；`output_exists` 错误会从 daemon message 中提取真实 `output_path` 到 `error.details.output_path`，弹窗优先显示该路径。
- 已修复真实 job 默认输出目录仍可能使用 mock fixture 目录的问题：如果用户没有明确选择自定义输出目录，`C:\Users\Example\Videos` 和 `mock-output://` 这类 mock 默认值不会传给 daemon，renderer 会改用输入媒体所在目录。
- 已修复输出冲突“另存为”语义：按钮现在打开系统保存文件对话框，让用户为字幕选择新的 `.srt` 文件名；renderer 将选择到的完整文件路径作为 `CreateJobRequest.outputPath` 传给 main process，并由 daemon client 直接作为 `output_path` 使用，不再把“另存为”当成换目录。
- 已修复拖拽媒体文件时仍只拿到文件名的问题：preload 通过 Electron `webUtils.getPathForFile(file)` 暴露 allowlist 方法，renderer 的拖拽和 fallback 文件选择会优先使用真实本地路径，从而按输入媒体所在目录生成输出路径。
- 已移除生成中页面的 Round 11 占位等待列表：`接下来` 区域现在从真实 `jobs` 中渲染等待/运行任务，底部任务计数也改为当前 job 在真实列表中的位置和总数；没有真实等待任务时不显示占位文件名。
- 已修复主界面“添加文件夹”仍使用 Round 11 占位文件的问题：新增 main/preload allowlist `selectMediaFolder()`，由 Electron main process 选择目录并枚举真实媒体文件路径返回 renderer；renderer 不再用 `seedFiles` 拼接目录。
- 已修复文件夹批量生成只创建一个真实 daemon job 的问题：renderer 现在会为每个媒体文件分别调用 `FastSubClient.createJob()`，每个 request 只包含一个 `input_path`，后续文件会真实进入 daemon job 队列并可在生成中页面的“接下来”显示。
- 新增桌面端 Round 12 快速回归脚本 `npm run test:round12`：串行执行 typecheck、Round 12 相关 Vitest 和 preload/main smoke；需要更完整验证时可运行 `npm run test:round12 -- --full` 追加 desktop build。
- 新增 `desktop-tests/` 手动反馈专项排查记录：`README.md` 归纳 mock/占位残留、真实 job 未贯通、路径来源错误、输出冲突、错误展示、批量队列和隐私边界等问题类型；`pics/` 保存 Electron offscreen 复现截图，`capture-round12-pages.mjs` 可重新生成关键页面截图。
- 已按第一轮页面排查继续修复占位数据风险：`startJob()`、`MainFiles`、远程确认弹窗不再在空文件时 fallback 到 `seedFiles`；生成中“接下来”只展示本次 batch job ids，不再混入全局历史/mock 队列；`MockFastSubClient` 成功事件不再硬编码 `a b.srt`。
- 已同步 `go-docs/specs/daemon-api.md`，将 Round 12 扩展从 planned 更新为当前接入边界，并记录 placeholder/降级路径。
- 已通过验证：
  - `go test ./...`（首次 sandbox 访问 Go build cache 被拒，提权重跑通过）
  - `cd desktop && npm run typecheck`
  - `cd desktop && npm test`（首次 sandbox 解析 Vitest config 被拒，提权重跑通过）
  - `cd desktop && npm run build`
  - `cd desktop && npm run smoke`
- 追加验证：
  - `cd desktop && npm run typecheck`
  - `cd desktop && npm test`（sandbox 解析 Vitest config 被拒，提权重重跑通过）
  - `cd desktop && npm run typecheck`
  - `cd desktop && npm test`（完成页真实 job result 渲染修复后重跑通过）
  - `cd desktop && npm run typecheck`
  - `cd desktop && npm test`（Go daemon completed event `output_path` 映射修复后重跑通过）
  - `cd desktop && npm run typecheck`
  - `cd desktop && npm test`（失败详情真实 error/log/config 渲染修复后重跑通过）
  - `cd desktop && npm run typecheck`
  - `cd desktop && npm test`（输出冲突确认和 request contract 修改后重跑通过）
  - `go test ./...`（新增 `validateOutput` 显式 overwrite 测试后重跑通过）
  - `cd desktop && npm run typecheck`
  - `cd desktop && npm test`（输出冲突目标路径和 SSE snapshot 合并修复后重跑通过）
  - `cd desktop && npm run typecheck`
  - `cd desktop && npm test`（默认输出目录去 mock fixture 修复后重跑通过）
  - `cd desktop && npm run typecheck`
  - `cd desktop && npm test`（输出冲突“另存为”改为保存字幕文件路径后重跑通过）
  - `cd desktop && npm run typecheck`
  - `cd desktop && npm test`（拖拽文件真实路径解析修复后重跑通过）
  - `cd desktop && npm run typecheck`
  - `cd desktop && npm test`（生成中等待任务列表改为真实 jobs 数据后重跑通过）
  - `cd desktop && npm run typecheck`
  - `cd desktop && npm test`（添加文件夹改为真实媒体文件列表后重跑通过）
  - `cd desktop && npm run typecheck`
  - `cd desktop && npm test`（文件夹批量生成每个媒体文件创建独立 job 后重跑通过）
  - `cd desktop && npm run test:round12`
  - `node desktop-tests\capture-round12-pages.mjs`
  - `cd desktop && npm run test:round12`（desktop-tests 第一轮排查修复和新增 batch 队列测试后重跑通过）

## 进行中

- Round 12 真实能力收口：真实 model installer job、Python CLI resolver、translate_srt/burn_in bridge、持久 atomic config writer、secret_ref 消费通道和真实小媒体 smoke。

## 接下来

- 确保模型页/首次启动页在真实 `model_install` job 完成后从 `listModels()` 重新同步真实状态。
- 实现 Python CLI resolver 和参数白名单 runner，替换 `translate_srt` / `burn_in` 当前 placeholder bridge。
- 将 daemon config PATCH 落到 validate + atomic write + corrupt recovery 的真实持久实现。
- 补齐 transient `secret_ref` 的 daemon/job runner 消费端；当前 main process 已有引用生成/消费结构，但 daemon 还未通过该通道取 secret。
- 准备 `local_tests/round12/` 手动真实 smoke 资产并记录真实 transcribe/translate/burn 结果。

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
- Round 11 Electron 应用目录：使用 `desktop/`。
- Round 11 文档/原型整理分支可以继续使用 `codex/ui-prototype`；生产 Electron 实现分支从 `master` 切出 `codex/fast-sub-desktop-mock-shell`。
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
- 用户可见导航采用固定应用菜单栏方案，而不是恢复 Electron/Windows 系统菜单、复刻 macOS chrome，或只依赖隐藏调试 tab。
- 固定应用菜单栏在首次启动检查阶段隐藏；进入主界面后提供 `←`、`→`、`窗口` 和 `帮助`，其中 `窗口` 菜单只包含 `字幕生成`、`翻译SRT`、`字幕烧录`。
- 隐藏调试面板继续保留全页面 mock 状态跳转，但只作为开发测试工具。
- Round 12 模型安装走独立 `model_install` job，通过同一套 job/SSE/取消/失败/结果模型展示进度。
- Round 12 真实翻译 SRT 和字幕烧录通过 Go daemon 新增 job type 接入；本轮允许 Go daemon 受控调用现有 `fast-sub` Python CLI，后续再逐步 Go 原生化。
- Round 12 API key 和 provider secret 使用 Electron main process 管理的 secret storage；首选 `keytar`，实现前必须确认 Electron/Node ABI 兼容性，必要时使用 Electron `safeStorage` + 本地加密 secret store fallback。
- Round 12 SSE 固定使用 main process fetch-based SSE，不使用 renderer 原生 `EventSource`。
- Round 12 实现顺序：12.1 daemon API contract，12.2 daemon lifecycle，12.3 REST/SSE client，12.4 config/secret 基础 adapter，12.5 transcribe，12.6 model_install，12.7 translate/burn bridge，12.8 UI 回归收口。
- Round 12 `model_install` 应新增 `createModelInstallJob(modelId): Promise<JobDetail>`；旧 `installModel(modelId)` 只保留兼容语义，返回带 install job id 的 installing 状态。
- Round 12 secret 从 Electron 到 daemon 必须使用 main-controlled transient secret channel，推荐一次性 secret reference / handle；如果该 channel 尚未实现，API job 只能临时继续走 `api_key_env`，但不能作为最终验收路径。
- Round 12 Python CLI bridge 必须定义 CLI resolver：显式配置、环境变量、开发环境 `uv run fast-sub`、PATH `fast-sub`、打包内置入口；缺失时返回结构化 missing runtime 错误。
- Round 12 Python CLI bridge 必须使用参数白名单、`exec.CommandContext`、环境变量 scrub、UTF-8/replacement 解码、JSON/log 分离和 redacted logs。
- Round 12 配置写入必须 validate、atomic write、schema version、损坏配置恢复，并防止 masked key 被当作 raw key 写回。
- Round 12 Fast Sub runtime 配置统一通过 daemon `GET /v1/config` 和 `PATCH /v1/config` 管理；Electron 本地只保存窗口状态、debug/mock 偏好等纯 UI 偏好。
- Round 12 `secret_ref` 不得原样持久化到 job metadata、events、logs、stdout、stderr 或 renderer state；需要落盘时只能写入脱敏占位。
- 生产模式不能因 daemon 失败静默切 mock；mock/fake daemon 只能通过明确开发/测试入口启用。
- Round 12 配置读写真实落地，普通设置通过 daemon config API 写入 Fast Sub runtime 配置。

### 实现前必须确认

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
- Round 11 审阅反馈：顶部栏必须固定且不重复；菜单项位置保持为 `←`、`→`、`窗口`、`帮助`，`窗口` 只承载字幕生成、翻译SRT、字幕烧录三个页面入口。
- Round 11 审阅反馈：缺少默认 ASR 模型时，全局状态必须显示本地转写未就绪，并阻断添加媒体、选择输出路径和开始生成等后续任务操作；隐藏调试面板切换页面也不能绕过该状态。
- Round 11 审阅反馈修复：需要补齐任务取消/重试/删除、拖拽添加、翻译SRT/字幕烧录 mock 流和真实 Electron smoke；当前实现仍保持 mock-first，不接真实 daemon、真实网络、模型下载、ffmpeg、Python worker 或 provider runtime。
- Round 11 review 收口修复：去除用户可见 `daemon` 文案，API 服务设置将 `Base URL` 产品化为高级服务地址；任务队列的进行中/等待中示例改为来自 `MockFastSubClient` 的 job 数据，列表计数、筛选和详情入口共用同一 mock contract。验证：`cd desktop && npm run typecheck`、`cd desktop && npm test`、`cd desktop && npm run build`、`cd desktop && npm run smoke`。
- Round 12 审阅反馈：当前 spec 范围较大，必须拆成 12.1 到 12.8；实现前先补 daemon API contract 和 fake fixtures，避免 Electron adapter 猜测新增 job/config/secret API。
- Round 12 审阅反馈：SSE 采用 fetch-based SSE 以支持 Authorization header、AbortController、Last-Event-ID、heartbeat timeout、退避重连和 fatal error 分类。
- Round 12 审阅反馈：`keytar` 是 native module 且上游已归档，仍可作为首选，但必须记录 Electron ABI 风险和 `safeStorage` fallback；Linux `basic_text` 不可静默当作安全存储。
- Round 12 二次审阅反馈：Goals 不应写死 keytar，应改成 main process 管理的 secret storage；Workstream 顺序应与 12.1-12.8 对齐；transient secret channel 必须在 daemon API contract 中明确；12.8 验收时才切真实 daemon 为默认。
- Round 12 三次审阅反馈：配置边界必须二选一，最终确定为 daemon config API；`secret_ref` 不能作为可重放秘密引用落盘；`FastSubClient` 类型变更必须显式写入；12.1 未完成前不得创建真实 adapter 或切默认模式。
- Round 12 四次审阅反馈：config API shape 和 `secret_ref` 生成/消费契约必须在 12.1 前定死；fake daemon fixtures 和手动 smoke 资产需要明确推荐位置。
