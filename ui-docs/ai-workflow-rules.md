# Fast Sub Electron AI Workflow Rules

本文档是给 AI 编码代理的直接指令。构建 Fast Sub Electron 应用时，必须遵守这些规则。使用命令式规则，不把它们当作建议。

## 总体方法

- 按规范驱动开发。
- 按固定顺序先阅读 `ui-docs/project-overview.md`、`ui-docs/architecture.md`、`ui-docs/code-standards.md`、`ui-docs/ui-context.md`、`ui-docs/ai-workflow-rules.md`、`ui-docs/project-tracker.md` 和相关原型文件，再修改代码。
- 先确认当前工作单元的目标、输入、输出、边界和验收标准。
- 采用增量式开发。
- 一次只完成一个可验证的小单元。
- 先实现 mock-first UI 流程，再接入真实 daemon client。
- 保持用户主流程简单。
- 不把 daemon、worker、SSE、JSON envelope、provider runtime 等内部细节暴露到普通主界面。
- 优先复用现有原型的信息架构和文案语义。
- 优先修复根因，不通过临时 UI workaround 掩盖 contract、状态或权限问题。

## 范围规则

- 一次只修改一个工作单元。
- 将工作单元限定为一个页面、一个组件组、一个 client adapter、一个状态模型、一个测试场景或一个文档主题。
- 不在同一轮同时修改主界面、任务队列、设置页、client contract 和样式系统。
- 不随意重命名公共接口、页面入口、状态名、文件夹结构或文档标题。
- 不修改与当前工作单元无关的文件。
- 不做顺手重构。
- 不把原型代码直接搬成生产代码而不整理边界。
- 不引入新的框架、状态库、组件库、安全存储库或测试框架，除非任务明确要求或文档已做出决策。
- 不新增远程 provider 行为，除非 UI 中同时实现显式上传确认。
- 不让 renderer 直接访问 Node.js、shell、文件系统、daemon token、API key 或 raw secret。
- 不让 renderer 直接调用 Python worker、ffmpeg、ffprobe、whisper.cpp、模型下载器或 provider runtime。

## 何时拆分工作

- 当修改会跨越两个以上页面时，先拆分。
- 当修改会同时影响 UI、client、IPC、存储和测试时，先拆分。
- 当需求包含多个用户流程时，按流程拆分。
- 当一个组件超过单一职责时，先拆成容器、展示组件和 helper。
- 当一个任务需要新增 contract、mock 数据和真实 adapter 时，先实现 contract 和 mock，再实现 adapter。
- 当实现前需要技术选型时，先提出待决策项，不直接编码。
- 当错误处理、隐私确认或权限边界不清楚时，先停下来澄清。
- 当无法在一次 review 中清楚说明改动范围时，先拆小。

## 处理缺失或模糊需求

- 先查阅 `ui-docs/project-overview.md`、`ui-docs/architecture.md`、`ui-docs/code-standards.md`、`ui-docs/ui-context.md`、`ui-docs/ai-workflow-rules.md`、`ui-docs/project-tracker.md` 和 `ui-docs/prototype/`。
- 如果文档已有明确规则，按文档执行。
- 如果文档冲突，优先遵守安全、隐私和 client 边界规则。
- 如果需求仍然模糊，先提出具体问题。
- 如果可以安全假设，写明假设并把实现限制在 mock 或 UI 层。
- 不根据个人偏好选择新依赖。
- 不自动扩大范围。
- 不把后端能力假设为已经存在；先通过 `FastSubClient` contract 表达 UI 需求。
- 不把诊断能力放进普通用户主流程。
- 不把远程 provider 作为默认路径。

## 未经明确指示不得修改的文件

- 不修改 Go daemon 实现文件。
- 不修改 Python CLI 或 Python worker 实现文件。
- 不修改模型 manifest 或真实模型文件。
- 不修改 benchmark 原始数据、真实报告或 `local_tests/` 中的本地文件。
- 不修改 `ui-docs/prototype/dist/`。
- 不修改 `ui-docs/prototype/node_modules/`。
- 不修改 `package-lock.json` 或 lockfile，除非任务明确涉及依赖安装。
- 不修改现有 daemon API contract，除非任务明确要求并同步更新 UI client contract。
- 不修改 `go-docs/`，除非任务明确要求更新 daemon/UI contract。
- 不修改安全、隐私、上传确认相关规则以放宽限制，除非用户明确批准。
- 不提交或生成 API key、token、Authorization header、signed URL、真实本地路径、真实媒体或模型文件。

## 生成 UI 组件的指令

- 将通用 UI 元素放入组件目录。
- 将页面级流程放入页面目录。
- 将后端数据映射放入 view model、client adapter 或 helper，不放进基础组件。
- 使用语义化组件名，例如 `JobStatusPill`、`RemoteProviderConfirmDialog`、`ModelStatusCard`。
- 不在通用组件中发起网络请求。
- 不在通用组件中读取全局设置。
- 不在基础组件中写死 provider id、model id 或 job id。
- 为 loading、disabled、empty、error 和 success 状态编写组件表现。
- 为长文件名、中文路径、UNC 路径和窄窗口处理布局。
- 不让按钮、标签或路径文本溢出容器。
- 保持主界面文案面向普通用户。
- 将 daemon、SSE、worker、JSON 等术语限制在诊断页。
- 远程 provider 相关组件必须展示上传内容和确认动作。

## Client 和 IPC 指令

- 所有后端访问都必须经过 `FastSubClient`。
- 同步更新 `MockFastSubClient` 和 `DaemonFastSubClient` 的接口。
- 先更新类型和 mock 数据，再更新页面调用。
- 在 daemon client 中处理 REST、SSE、auth、reconnect、401、events_lost 和 JSON parsing。
- 在 renderer 页面中只消费 typed result 和 UI error model。
- 不在页面组件中拼接 daemon URL。
- 不在页面组件中设置 Authorization header。
- 不在 IPC 中暴露任意 shell 命令。
- 不在 IPC 中暴露任意文件读写能力。
- 对 IPC 输入做校验。
- 对 IPC 输出做 redaction。

## 隐私和安全指令

- 默认使用本地能力。
- 不静默启用远程 provider。
- 使用 API ASR 前必须提示会上传音频。
- 使用网页/API 翻译前必须提示会上传字幕文本。
- API key 必须通过安全存储处理。
- 不把 secret 存入 localStorage、普通 UI state 或未加密配置文件。
- 不在 console、toast、日志、错误、测试快照中输出 secret。
- 对 token、API key、Authorization、signed URL、proxy credential 做 redaction。
- 默认不启用 CORS。
- 默认不连接非 `127.0.0.1` daemon。

## 文档与实现同步

- 修改 UI 架构边界时，同步更新 `ui-docs/architecture.md`。
- 修改产品范围或用户流程时，同步更新 `ui-docs/project-overview.md`。
- 修改代码规范、依赖规则、测试策略或文件组织时，同步更新 `ui-docs/code-standards.md`。
- 修改 AI 代理工作方式时，同步更新本文件。
- 修改 daemon API 需求时，记录具体 adapter 需求，并在需要时同步 `go-docs/specs/daemon-api.md` 或相关 Round 文档。
- 新增页面时，更新页面边界说明或至少在实现说明中记录其职责。
- 新增 client 方法时，更新 `FastSubClient` contract、mock client、daemon client 和相关测试。
- 新增远程 provider UI 时，更新隐私确认文案和 provider 状态说明。
- 不让文档描述和实现行为长期不一致。

## 进入下一单元前的核查清单

- 确认本次只修改了当前工作单元相关文件。
- 确认 renderer 没有直接访问 Node.js、shell、文件系统、daemon token、API key 或 raw secret。
- 确认所有后端访问都经过 `FastSubClient`。
- 确认 mock client 和真实 client contract 没有漂移。
- 确认普通主界面没有暴露 daemon、SSE、job id、JSON envelope、worker 或 provider runtime 细节。
- 确认远程 provider 使用路径有显式上传确认。
- 确认错误状态包含用户可执行恢复动作。
- 确认 loading、empty、success、failure、canceled 状态可见。
- 确认长文件名、中文路径、空格路径和 UNC 路径不会破坏布局。
- 确认没有把 secret 写入日志、UI state、测试快照或文档示例。
- 确认相关文档已同步更新。
- 确认测试或手动验证覆盖了本工作单元的关键状态。
- 确认没有修改未经明确允许的文件。
- 确认下一步工作单元足够小，可以独立验证。
