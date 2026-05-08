# Fast Sub Electron UI Context

本文档记录 Fast Sub Electron 应用的基础 UI token。当前 token 参考 `ui-docs/prototype/index.html` 和 `ui-docs/prototype/FastSub UI v2.html` 中的原型设计。生产实现可以整理命名，但视觉语义应保持一致。

生产 UI 不使用原型手绘字体作为默认字体。`Kalam`、`Architects Daughter` 等只保留为设计稿注释或 prototype 风格参考；正式 Electron 客户端默认使用系统 UI sans 字体。

## 调色板

### 基础颜色

| 语义标记 | CSS 变量 | 十六进制值 | 用途 |
| --- | --- | --- | --- |
| Ink / 主文字 | `--color-ink` | `#1f1d1a` | 主文字、主边框、主按钮背景、活动导航 |
| Ink Muted / 次级文字 | `--color-ink-muted` | `#4a463f` | 次级标题、说明文字、弱化但仍重要的信息 |
| Ink Subtle / 辅助文字 | `--color-ink-subtle` | `#7a7368` | 小号说明、占位、禁用、弱状态、虚线分隔 |
| Canvas / 应用背景 | `--color-canvas` | `#f0eee9` | 设计画布和应用外层背景 |
| Surface / 主面板 | `--color-surface` | `#fbfaf6` | 主窗口、卡片、输入、按钮默认背景 |
| Surface Muted / 次级面板 | `--color-surface-muted` | `#f3f0e8` | 顶栏、底栏、拖拽区、设置侧栏、轻量分组背景 |
| Surface Stripe / 占位纹理 | `--color-surface-stripe` | `#ece8df` | 占位框斜纹背景 |
| Border Strong / 主边框 | `--color-border-strong` | `#1f1d1a` | 卡片、按钮、输入、进度条、窗口分隔 |
| White / 反白文字 | `--color-white` | `#ffffff` | 蓝色按钮文字或需要白字的强调面 |

### 状态颜色

| 语义标记 | CSS 变量 | 十六进制值 | 用途 |
| --- | --- | --- | --- |
| Accent / 进行中 | `--color-accent` | `#2a6fdb` | 进行中任务、主进度、下载中、当前步骤、API/模型高亮 |
| Accent Soft / 进行中背景 | `--color-accent-soft` | `#dde8fb` | 运行中 job 卡片、下载中模型卡片、进度状态背景 |
| Accent Strong Text | `--color-accent-text` | `#13315c` | accent chip 内文字 |
| Accent Stripe | `--color-accent-stripe` | `#4988e6` | accent 进度条斜纹第二色 |
| Success / 成功 | `--color-success` | `#2f7a4a` | 已就绪、已完成、校验通过、本地可用 |
| Success Soft / 成功背景 | `--color-success-soft` | `#d8ead9` | 成功 chip、完成卡片背景 |
| Success Soft Alt | `--color-success-soft-alt` | `#f4faf3` | 已完成 job 卡片的浅背景 |
| Success Text | `--color-success-text` | `#1c4d2e` | success chip 内文字 |
| Warning / 警告失败 | `--color-warning` | `#c44a2a` | 缺模型、安装失败、上传确认、危险操作、失败状态 |
| Warning Soft / 警告背景 | `--color-warning-soft` | `#f4dccd` | 失败卡片、警告面板、上传确认提示 |
| Warning Text | `--color-warning-text` | `#6b2210` | warning chip 内文字 |

### 日志和诊断颜色

| 语义标记 | CSS 变量 | 十六进制值 | 用途 |
| --- | --- | --- | --- |
| Log Background | `--color-log-bg` | `#1f1d1a` | 诊断日志代码块背景 |
| Log Success | `--color-log-success` | `#8ca88c` | 诊断日志中的成功/health ok 行 |
| Log Info | `--color-log-info` | `#a8b8c8` | 诊断日志中的普通信息、SSE、heartbeat |
| Log Error | `--color-log-error` | `#c8a088` | 诊断日志中的错误摘要 |

## AI 和远程能力强调色

Fast Sub 默认本地处理。AI/API/Web provider 的颜色不能暗示默认启用；远程能力应使用 warning 或受控 accent，且必须配合上传确认文案。

| 语义标记 | CSS 变量 | 十六进制值 | 用途 |
| --- | --- | --- | --- |
| Local AI Ready | `--color-ai-local` | `#2f7a4a` | 本地 ASR、本地翻译、本地模型就绪 |
| Local AI Soft | `--color-ai-local-soft` | `#d8ead9` | 本地模型就绪卡片、离线能力提示 |
| Running AI | `--color-ai-running` | `#2a6fdb` | 正在转写、正在翻译、正在加载模型 |
| Running AI Soft | `--color-ai-running-soft` | `#dde8fb` | 当前 AI 任务背景 |
| Remote Provider Warning | `--color-remote-warning` | `#c44a2a` | API ASR、网页/API 翻译上传确认、费用提示 |
| Remote Provider Soft | `--color-remote-warning-soft` | `#f4dccd` | 上传确认面板、远程 provider 未确认状态 |
| Secret Redacted | `--color-secret-redacted` | `#7a7368` | masked API key、token redacted、敏感字段占位 |

## 字体排版

### 字体族

| 语义标记 | CSS 变量 | 字体建议 | 用途 |
| --- | --- | --- | --- |
| UI Sans | `--font-sans` | `Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | 生产 UI 默认字体 |
| Prototype Sketch | `--font-sketch` | `Kalam, "Architects Daughter", cursive` | 原型手绘风格，仅用于设计稿或注释，不建议生产默认使用 |
| Annotation | `--font-annotation` | `"Architects Daughter", cursive` | 原型注释或设计说明 |
| Mono | `--font-mono` | `"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | 路径、日志、错误码、结构化诊断 |

### 字号和文本样式

| 语义标记 | CSS 变量 | 字号 | 字重 | 行高建议 | 用途 |
| --- | --- | --- | --- | --- | --- |
| Display / 主状态标题 | `--text-display` | `22px` | `700` | `1.2` | “字幕生成完成”“正在生成字幕”等主状态 |
| Heading 1 | `--text-h1` | `17px` | `700` | `1.25` | 页面标题、主要分区标题 |
| Heading 2 | `--text-h2` | `14px` | `700` | `1.3` | 卡片标题、设置小节标题 |
| Heading 3 / Label Group | `--text-h3` | `12.5px` | `700` | `1.35` | 分组小标题、配置区标题 |
| Body | `--text-body` | `13px` | `400` | `1.45` | 默认正文、文件名、主要信息 |
| Body Small | `--text-body-sm` | `11.5px` | `400` | `1.45` | 次级说明、配置摘要 |
| Caption | `--text-caption` | `10.5px` | `400` | `1.45` | 状态说明、按钮 small、辅助文案 |
| Mono | `--text-mono` | `10.5px` | `400` | `1.5` | 文件路径、输出路径、诊断字段 |
| Mono Small | `--text-mono-sm` | `9.5px` | `400` | `1.5` | 错误码、provider status、日志摘要 |
| Log Line | `--text-log` | `10px` | `400` | `1.5` | 诊断日志行 |

### 排版规则

| 规则 | 值 |
| --- | --- |
| 默认 letter spacing | `0` |
| 原型标题轻微 letter spacing | `0.005em`，仅限 display 风格 |
| 分组标题 letter spacing | `0.04em`，仅限 uppercase 小标题 |
| 主界面最大文字层级 | Display + Body + Caption，不叠加过多层级 |
| 路径展示 | 使用 mono 字体，长路径截断，提供 tooltip 或详情展开 |
| 技术日志 | 使用 mono 字体，只出现在诊断页或日志 tab |

## 边框半径缩放

| 语义标记 | CSS 变量 | 半径 | 用途 |
| --- | --- | --- | --- |
| Radius None | `--radius-none` | `0` | 表格、分隔线、贴边区域 |
| Radius Checkbox | `--radius-checkbox` | `3px` | checkbox 方框 |
| Radius XS | `--radius-xs` | `4px` | thin border 小容器、日志块 |
| Radius SM | `--radius-sm` | `5px` | 设置侧边栏 nav item |
| Radius MD | `--radius-md` | `6px` | 默认卡片、输入框、按钮、虚线框 |
| Radius LG | `--radius-lg` | `8px` | job card、较大的状态卡片 |
| Radius Pill | `--radius-pill` | `99px` | chip、segmented control、toggle、progress bar |
| Radius Round | `--radius-round` | `50%` | spinner、状态圆点、单选按钮、完成图标 |

## 边框和线条

| 语义标记 | CSS 变量 | 值 | 用途 |
| --- | --- | --- | --- |
| Border Thin | `--border-thin` | `1px solid var(--color-border-strong)` | 小型细边框容器 |
| Border Normal | `--border-normal` | `1.5px solid var(--color-border-strong)` | 卡片、按钮、输入、主要控件 |
| Border Divider | `--border-divider` | `1.2px solid var(--color-border-strong)` | 顶栏、底栏、tab 分隔 |
| Border Dashed | `--border-dashed` | `1.5px dashed var(--color-border-strong)` | 拖拽区、ghost button、占位区域 |
| Border Dotted | `--border-dotted` | `1.5px dotted var(--color-ink-subtle)` | 弱占位或注释边框 |
| Border Subtle Dashed | `--border-subtle-dashed` | `1.2px dashed var(--color-ink-subtle)` | 分组内虚线分隔 |

## 组件状态 token

| 组件/状态 | 背景 | 边框 | 文字 | 用途 |
| --- | --- | --- | --- | --- |
| Button Default | `#fbfaf6` | `#1f1d1a` | `#1f1d1a` | 次要按钮 |
| Button Primary | `#1f1d1a` | `#1f1d1a` | `#fbfaf6` | 主生成按钮、主要确认动作 |
| Button Accent | `#2a6fdb` | `#2a6fdb` | `#ffffff` | 下载中/安装中相关强调按钮，谨慎使用 |
| Button Ghost | `#fbfaf6` | `#1f1d1a dashed` | `#1f1d1a` | 次要、返回、设置、诊断入口 |
| Chip Muted | `#fbfaf6` | `#7a7368` | `#7a7368` | 未配置、可跳过、等待中 |
| Chip Running | `#dde8fb` | `#2a6fdb` | `#13315c` | 正在生成、下载中、检查中 |
| Chip Success | `#d8ead9` | `#2f7a4a` | `#1c4d2e` | 已就绪、已完成 |
| Chip Warning | `#f4dccd` | `#c44a2a` | `#6b2210` | 缺失、失败、上传确认 |
| Progress Default | `#fbfaf6` | `#1f1d1a` | `#1f1d1a` | 普通进度条 |
| Progress Accent | `#fbfaf6` | `#1f1d1a` | `#2a6fdb` | 转写、翻译、下载进度 |
| Job Running | `#dde8fb` | `#2a6fdb` | `#1f1d1a` | 运行中任务卡片 |
| Job Done | `#f4faf3` | `#2f7a4a` | `#1f1d1a` | 完成任务卡片 |
| Job Failed | `#f4dccd` | `#c44a2a` | `#1f1d1a` | 失败任务卡片 |

## 固定应用菜单栏

Round 11 的普通用户导航采用固定应用菜单栏。它不是 Electron/Windows 默认系统菜单，也不是开发调试 tab；它只承载少量产品级跳转，并保持位置稳定。

| 项目 | 约定 |
| --- | --- |
| 显示时机 | 首次启动 / 环境检查阶段不显示；进入主界面后显示 |
| 固定入口 | `←`、`→`、`窗口`、`帮助`，顺序和位置不随页面变化 |
| 窗口菜单 | 只包含 `字幕生成`、`翻译SRT`、`字幕烧录` |
| 返回/前进 | 使用应用内历史栈；禁用态降低透明度但保留位置 |
| 背景 | 使用 `Surface Muted`，与页面内容之间使用 `Border Divider` |
| 按钮 | 顶栏使用透明/default menu button；hover/active 使用 Ink 反白 |
| 文案 | 面向普通用户，不出现 daemon、SSE、job id、JSON、worker、provider runtime 等技术词 |
| Windows 适配 | 不恢复 Electron 默认菜单栏，不复刻 macOS 三圆点或窗口标题 chrome |
| 调试入口 | 隐藏调试面板仍可切换所有 mock 页面状态，但不作为普通用户导航 |

## 使用规则

| 规则 | 说明 |
| --- | --- |
| 默认页面不使用强烈渐变 | Fast Sub 是工具型桌面应用，避免营销式视觉 |
| 主流程保持低饱和 | `ink`、`paper`、`paper-muted` 是主色，accent 只用于进度和当前状态 |
| 远程 provider 使用 warning | 任何上传音频/文本的路径都必须有 warning 语义，不只用普通 accent |
| 成功状态使用 green | 就绪、完成、verify 通过统一使用 success |
| 失败/危险操作使用 warn | 缺模型、安装失败、删除凭据、上传确认、失败任务统一使用 warning |
| 诊断日志使用深色块 | 日志只在诊断或任务日志 tab 出现，不进入主界面默认视图 |
| 圆角保持克制 | 默认 `6px`，job card 可用 `8px`，pill 只用于 chip/toggle/segmented/progress |
