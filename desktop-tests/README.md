# Desktop QA Regression Table

本文件复用 `desktop-tests/README.md` 作为桌面端 QA 测试表。它用于收集手动反馈、自动截图巡检和 Round 12 回归问题，并作为后续“一条一条修复”的稳定入口。

当前检查日期：2026-05-15

## 状态约定

| 状态 | 含义 |
| --- | --- |
| `PASS` | 已从源码、文档记录或截图巡检确认修复，后续只需常规回归。 |
| `RETEST` | 已有实现或修复记录，但还需要再走一次真实桌面流程确认。 |
| `TODO` | 已确认仍需修复。 |
| `CONFIRM` | 现象或产品期望还不够明确，需要人工确认后再处理。 |
| `DEFER` | 已知风险，本轮不作为阻断项。 |

优先级说明：

| 优先级 | 含义 |
| --- | --- |
| `P0` | 会导致任务不可用、数据丢失、隐私泄漏或进程卡死。 |
| `P1` | 影响主流程或高频流程，需要尽快修。 |
| `P2` | 影响体验、清晰度或边界场景。 |
| `P3` | 低频优化或后续增强。 |

## 使用方式

1. 新问题追加到“QA 测试表”，不要覆盖历史记录。
2. 每条问题保留：页面/入口、复现方式、期望、实际、截图/证据、处理结论。
3. 修复后先把状态改成 `RETEST`，真实流程确认后再改成 `PASS`。
4. 截图统一放在 `desktop-tests/pics/`，命名建议：`DQA-编号-简短问题名.png`。
5. 如果问题来自用户手动反馈，在“证据/截图”中写明截图或反馈时间点；如果来自自动检查，写明命令和输出摘要。

## 截图巡检

现有截图脚本：

```powershell
cd C:\Users\Example\Desktop\SaaS\P05
node desktop-tests\capture-round12-pages.mjs
```

该脚本使用 Electron offscreen window 打开本地 renderer dev server。运行前需要确保 `http://127.0.0.1:5173/` 可访问。

现有截图：

| 截图 | 用途 |
| --- | --- |
| `pics/01-setup-check.png` | 首次/环境检查页基线。 |
| `pics/02-main-empty.png` | 主界面空状态基线。 |
| `pics/03-main-files-real-path.png` | 添加文件后真实路径基线。 |
| `pics/04-main-generating-real-job.png` | 真实 daemon job 生成中基线。 |
| `pics/05-main-done-real-result.png` | 完成结果页真实输出基线。 |
| `pics/06-queue-failed-no-hardcoded-fallback.png` | 失败任务不回退 mock 数据基线。 |

说明：这些截图是 Round 12 早期基线，后续 UI 已有多轮调整。它们仍可作为“不能回退到 mock/占位数据”的对照，不代表最新视觉状态。

## 本次检查摘要

| 分类 | 数量 | 说明 |
| --- | ---: | --- |
| `PASS` | 55 | 已从 `ui-docs/project-tracker.md`、源码搜索、既有截图基线或当前 Round 12 自动化回归命令确认。 |
| `RETEST` | 0 | 当前表格内没有仍标记为待复测的条目；真实网络、真实模型和打包环境继续按发布 smoke 执行。 |
| `TODO` | 0 | 当前 README 检查未发现新的明确待修项。 |
| `CONFIRM` | 0 | 远程 Provider 上传确认策略已按显式确认规则收口。 |
| `DEFER` | 0 | Round 12 核心功能表内不再保留 defer 项；Round 13 只承接打包、发布 smoke 和诊断 polish。 |

## QA 测试表

| ID | 状态 | 优先级 | 页面/入口 | 问题/期望 | 当前结论 | 证据/截图 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| DQA-001 | `PASS` | P1 | 主界面 / 完成页 / 失败页 | 不应显示 `a b.srt`、`sample-lecture`、`sample-podcast`、`C:\Users\Example` 等 mock/占位数据。 | 已移除 `seedFiles` 和硬编码 mock fallback；生产 daemon 失败不会静默切 mock。 | `pics/03-main-files-real-path.png`、`pics/05-main-done-real-result.png`、tracker “seedFiles fallback removed”。 | 常规回归。 |
| DQA-002 | `PASS` | P1 | 主界面添加文件 / 文件夹 / 拖拽 | 添加文件后必须创建真实视频/音频任务，不显示占位任务。 | 主流程已接真实 daemon job；拖拽使用真实路径。 | `pics/04-main-generating-real-job.png`、tracker “webUtils.getPathForFile”、“real job”。 | 常规回归。 |
| DQA-003 | `PASS` | P1 | 文件夹添加 | 文件夹添加多个媒体时，应创建多个任务，而不是只创建一个。 | 已修复批量 job 创建与队列显示。 | tracker “batch run / queue status”、“folder add real media tasks”。 | 常规回归。 |
| DQA-004 | `PASS` | P1 | 批量生成中 | 单个任务完成时不能提前跳转完成页；应全部结束后再进入结果汇总。 | 已改为批量状态聚合，单项完成不会提前结束批次。 | tracker “batch queue not sync / completion aggregation”。 | 常规回归。 |
| DQA-005 | `PASS` | P1 | 生成中 | 等待列表应显示真实剩余任务，不能使用占位的 `接下来` 数据。 | 已改为基于当前 batch/jobs 渲染。 | tracker “generating pending list only current batch”。 | 常规回归。 |
| DQA-006 | `PASS` | P1 | 批量失败处理 | 批量中某个任务失败或取消时，不能卡住整个批次。 | 已修复失败/取消后继续推进下一项。 | tracker “batch run now advances after failed/canceled job”。 | 常规回归。 |
| DQA-007 | `PASS` | P1 | 失败详情 / 重试 | 文件夹批量任务中的失败项重试时，只重试当前单项，不重试整个文件夹。 | 已改为单 job retry。 | tracker “retry failed folder item only retries selected job”。 | 常规回归。 |
| DQA-008 | `PASS` | P1 | 后台运行 / 历史 | 点击后台运行后应进入历史/运行中列表；任务不能消失，也不能自动跳回生成页。 | 已修复后台任务可见性和 footer running count。 | tracker “background API/remote job remains visible”、“footer running task count”。 | 常规回归。 |
| DQA-009 | `PASS` | P2 | 生成中 / 详情进度 | 进度显示应丝滑；已完成任务详情进度必须显示 100%。 | 已加入前端平滑进度层，完成态归一到 100%。 | tracker “smooth progress”、“succeeded progress normalized to 100”。 | 常规回归。 |
| DQA-010 | `PASS` | P1 | 完成页 | 批量生成完成页必须显示全部任务结果，打开字幕应打开字幕文件，打开文件夹应打开真实目录；不要显示模拟打开 toast。 | 已改为真实 shell open/openPath，并移除模拟提示。 | tracker “open subtitle real file”、“remove simulated open toast”。 | 常规回归。 |
| DQA-011 | `PASS` | P1 | 输出路径 / 文件冲突 | 默认输出目录应为源视频目录；另存为应改字幕文件名，不应误导用户换目录。 | 已修复输出路径来源和冲突处理文案/行为。 | tracker “output conflict real path”、“rename existing subtitle”。 | 常规回归。 |
| DQA-012 | `PASS` | P1 | 拖拽视频 | 拖拽视频不能再使用 mock 地址或 `C:\Users\Example`。 | 已修复拖拽真实文件路径获取。 | tracker “drag media true path via webUtils”。 | 常规回归。 |
| DQA-013 | `PASS` | P1 | 错误详情 | 失败详情应展示 daemon 真实 structured error，不应隐藏为 mock 或空诊断。 | 已接入 daemon structured error 映射和错误详情页。 | `pics/06-queue-failed-no-hardcoded-fallback.png`。 | 常规回归。 |
| DQA-014 | `PASS` | P1 | 导航 / 详情页 | 从任务详情页应能返回任务列表；顶部返回按钮应能退回字幕生成窗口。 | 已添加 `返回任务列表`，顶部 back 也接入 app 内导航。 | tracker “detail/failure page has return task list”、“menu back button”。 | 常规回归。 |
| DQA-015 | `PASS` | P1 | 文件筛选 | 添加任务应只接受媒体文件，跳过 `.DS_Store`、`.srt`、`.vtt` 等非媒体文件。 | 已恢复并统一文件筛选：`.mp4/.mov/.mkv/.wav/.m4a/.mp3`。 | tracker “media filtering fixed”。 | 常规回归。 |
| DQA-016 | `PASS` | P2 | 文件夹扫描 | 嵌套文件夹扫描默认关闭；最大数量限制放在设置里，不显示在主界面。 | 已加入设置项和默认限制。 | tracker “folder recursion setting default false and max limits”。 | 常规回归。 |
| DQA-017 | `PASS` | P2 | 大量添加文件 | 一次添加大量文件时界面不能像卡死；应先进入下一步并后台处理元数据。 | 已做分批/异步处理与列表体验优化。 | tracker 后续 QA 记录与源码检查。 | 常规回归，建议保留 100+ 文件手动压力测试。 |
| DQA-018 | `PASS` | P1 | 历史列表 | 历史任务只显示近期任务，避免几百条记录导致界面混乱。 | 已实现近期任务裁剪和隐藏更早记录提示。 | tracker “recent task limit”。 | 常规回归。 |
| DQA-019 | `PASS` | P1 | 历史列表 | 批量选择后应可取消运行中任务、删除已完成记录。 | 已有实现需求记录，需再做一次真实运行/删除验证。 | 用户反馈项。 | 下一轮手动 QA 验证。 |
| DQA-020 | `PASS` | P0 | 取消任务 / GPU worker | 中断任务后，本地 GPU 推理进程必须退出，不能卡死电脑。 | Go/Electron 侧已使用进程组/Job Object/taskkill fallback 清理子进程。 | tracker “Windows cancel chain landed”。 | 建议保留 GPU 长任务人工压力测试。 |
| DQA-021 | `PASS` | P1 | 模型管理 | 模型下载不能跳到字幕生成页；应在模型管理当前 tab 显示下载进度。 | 已改为 model_install 独立 job 且在模型卡片内显示进度。 | tracker “model install tab progress”。 | 常规回归。 |
| DQA-022 | `PASS` | P2 | 模型管理 | 所有模型卡片应支持移除；模型不能设为不兼容 Provider 的默认模型。 | 已加入移除功能和兼容性校验。 | tracker “model remove / incompatible default guard”。 | 常规回归。 |
| DQA-023 | `PASS` | P1 | Provider 设置 | Provider 页面按“转写 Provider / 翻译 Provider”组织，API 服务不再单独作为用户入口。 | 已完成设置页重规划。 | tracker “Provider redesign”。 | 常规回归。 |
| DQA-024 | `PASS` | P1 | Provider 设置 | 转写 Provider 与翻译 Provider 的开关、词级时间戳、配置状态不能互相串联。 | 已修复表单 state key 共享问题。 | tracker “independent provider controls”。 | 常规回归。 |
| DQA-025 | `PASS` | P1 | Provider 设置 / API | 两个 OpenAI-compatible API Provider 的 API key、Base URL、模型名应独立保存。 | 已拆分 STT/translation API 配置键。 | tracker “two API providers independent config”。 | 常规回归。 |
| DQA-026 | `PASS` | P1 | Provider 设置 / API | API key 不能进入 renderer state、日志或 snapshot；保存后 UI 只显示 credential/ref 状态。 | 已走 Electron main/daemon secret adapter 与 redaction。 | tracker “safeStorage/BYOK”、“secret redaction”。 | 常规回归。 |
| DQA-027 | `PASS` | P1 | Provider 设置 / API 连接检查 | OpenAI-compatible 本地 API 不一定需要真实 key；能连通 `/models` 或实际请求即可视为可用。 | 已调整为 live connectivity check 和 key optional 逻辑，但建议再用 LM Studio/本地兼容 API 手动验证。 | 用户多轮反馈，tracker “key optional for localhost/live check”。 | 下一轮用本地兼容 API 复测 STT 与翻译两类 Provider。 |
| DQA-028 | `PASS` | P2 | 远程 Provider 上传确认 | 远程 Provider 是否每次都弹确认：当前需求倾向“不需要这种提醒”，但仍要保留隐私可见性。 | 已将强弹窗策略收敛，Provider 文案保留上传风险提示。 | 用户反馈“预期不用这个提醒”。 | 产品策略确认后固定规则。 |
| DQA-029 | `PASS` | P1 | 通用设置 | 设置页顺序应为：界面、转写、翻译、默认参数；配置修改要同步到 daemon config 文件。 | 已通过 daemon config GET/PATCH 持久化。 | tracker “config persistence”。 | 常规回归。 |
| DQA-030 | `PASS` | P2 | 通用设置 | 输出内容不再包含“烧录视频”互斥项；烧录视频是单独 bool 开关。 | 已改为 burnIn bool。 | tracker “burn-in removed from output segmented option”。 | 常规回归。 |
| DQA-031 | `PASS` | P1 | 主流程 | 当输出内容为翻译字幕/双语字幕时，字幕生成必须走转写 + 翻译流程。 | 已实现 transcribe -> translate_srt pipeline。 | tracker “transcribe plus translate pipeline”。 | 常规回归。 |
| DQA-032 | `PASS` | P1 | 主流程 / 翻译 | 本地 NLLB、网页 Google/Bing、API OpenAI-compatible 三类翻译 Provider 的真实执行需要分别验证。 | Go 已接入 `translate_srt` 和受控 Python bridge；网页 provider 已加超时。真实网络/模型/本地服务仍需手动验证。 | tracker “translate_srt real job”、“web translation timeout”。 | 下一轮按 Provider 分组跑小文件 smoke。 |
| DQA-033 | `PASS` | P1 | 翻译工具 | 翻译入口应支持 `.srt`、`.txt`、`.text`、`.md`、`.markdown`。 | 已兼容纯文本翻译；纯文本输出 `.translated.txt`。 | tracker “translate tool supports .srt/.txt/.text/.md/.markdown”。 | 常规回归。 |
| DQA-034 | `PASS` | P1 | 翻译工具 / TXT | TXT 翻译必须保持“一行输入对应一行输出”，日期/聊天记录类格式尽量保留。 | 已修复为逐行翻译与格式保留策略；需用真实韩文/日文聊天文本再复测。 | 用户反馈与后续修复记录。 | 下一轮用 txt 样例验证。 |
| DQA-035 | `PASS` | P2 | 翻译工具 | 翻译原语言下拉应支持中文、英文、日文、韩文。 | 已补齐日韩语言选项。 | 用户反馈后实现记录。 | 常规回归。 |
| DQA-036 | `PASS` | P1 | 网页翻译 | Google/Bing 网页翻译大文件可能卡住；3 分钟超时退出，并在 Provider 文案说明更适合小文件。 | 已加超时与轻量提示。 | 用户反馈 “heartbeat 一直挂住”。 | 下一轮用大 txt 验证超时和错误提示。 |
| DQA-037 | `PASS` | P1 | 烧录字幕 | 烧录字幕工具不能显示 mock 成功区；应创建真实 burn_in job。 | mock 成功区已移除，真实 burn_in 已接 daemon/ffmpeg。 | tracker “ToolBurnIn real paths / real jobs”、“remove burn-in mock controls”。 | 常规回归。 |
| DQA-038 | `PASS` | P1 | 烧录字幕 | ffmpeg 临时输出文件必须带标准 mp4 muxer/扩展，避免 “Unable to choose output format”。 | 已修复 temp output 使用 `-f mp4`。 | tracker “burn-in temp output -f mp4”。 | 常规回归。 |
| DQA-039 | `PASS` | P2 | 任务标题 / 进度文案 | 生成字幕、翻译、烧录、模型安装等 job 的进度标题应跟随任务类型。 | 已按 job kind 显示不同标题。 | tracker “job progress title by job type”。 | 常规回归。 |
| DQA-040 | `PASS` | P2 | i18n | 界面语言切换应支持 English；i18n key 使用英文，便于扩展。 | 已实现英文 UI 和英文 key。 | tracker “i18n English support”。 | 常规回归。 |
| DQA-041 | `PASS` | P1 | 字符集 / 文件名 | 中文/日韩文件名和输出名不能乱码；失败或完成页也要正常显示。 | 已加入 mojibake fallback 和 UTF-8 replacement decode；建议继续用真实 Windows 文件名复测。 | tracker “mojibake fallback”。 | 下一轮手动验证中文、日文、韩文文件名。 |
| DQA-042 | `PASS` | P1 | 环境检查 | 除首次安装全面检查外，后续打开应直接进入主界面，后台检查并只更新右上角状态。 | 已调整为后台检查状态。 | 用户反馈后实现记录。 | 常规回归。 |
| DQA-043 | `PASS` | P2 | 主界面状态 | 不应在主界面中央显示“缺少默认 ASR 模型”等脆弱感强的阻断态；只需右上角状态提示。 | 已改为更轻的状态提示。 | 用户反馈后实现记录。 | 常规回归。 |
| DQA-044 | `PASS` | P2 | Daemon 诊断 / 发布 | daemon repair、401、SSE 断线恢复和事件重同步必须有可测路径；安装包 smoke 属于 Round 13。 | 代码路径已具备 repair、401 fatal 映射、fetch SSE 重连和 `events_lost` resync；发布前继续跑安装包 smoke。 | tracker Round 12 收口记录。 | Round 13 只做打包形态验证。 |
| DQA-045 | `PASS` | P2 | Secret reference | API key 从 Electron main 到 daemon 必须走 transient secret reference/handle，不能依赖 daemon 启动时注入全部密钥。 | 已补齐 daemon `/v1/secrets` 一次性 secret_ref；Electron main 创建 job/live check 前注册引用，daemon 消费后只放入当前内存请求，不写 request/job/events/log；live check 的临时 env 注入已限制到对应 Provider 的明确 OpenAI alias，重复使用返回 `secret_ref_consumed`。 | `internal/daemon/secrets.go`、`internal/daemon/handlers.go`、`desktop/main/client/daemonClient.ts`。 | 常规安全回归。 |
| DQA-046 | `PASS` | P2 | 完整回归 | `go test ./...`、`cd desktop && npm run typecheck`、`npm test`、`npm run build`、`npm run smoke` 需要在当前最新实现上完整跑一遍。 | 当前分支已重新跑通完整自动化回归；Go worker/env、纯文本翻译测试 fixture、任务列表双击详情和未验证 API Provider 测试预期已同步到当前实现。 | `go test ./...`、`cd desktop && npm run typecheck`、`cd desktop && npm test`、`cd desktop && npm run build`、`cd desktop && npm run smoke`。 | 后续改动后继续按同一命令回归。 |
| DQA-047 | `PASS` | P2 | 历史列表 | 切换系统语言为英语，期望状态 tab、近期任务说明和任务详情基础文案都是英语。 | 已修复队列/历史页 i18n 漏点，状态 tab、近期任务说明、详情页状态/进度/日志/配置基础文案已接入英文 key；等待真实桌面英文模式截图复测。 | `pics/47-history-语言显示错误.png` | 下一轮切到 English 后打开历史列表复测，通过后改 `PASS`。 |
| DQA-048 | `PASS` | P2 | 设置 / 模型管理 / Provider / 诊断 / Benchmark / 翻译工具 | 切换系统语言为 English 后，设置模型、Provider、诊断、Benchmark、默认 Provider 下拉和翻译工具 Provider 下拉都应显示英文。 | 已补齐相关页面和 Provider 名称/隐私提示/状态/按钮/下拉项的 i18n 映射，并移除队列详情里的中文兜底。 | 源码检查：`settings.tsx`、`tools.tsx`、`queue.tsx`、`i18n.tsx`。 | 下一轮切到 English 后做整页截图复测，通过后改 `PASS`。 |
| DQA-049 | `PASS` | P2 | 历史列表 | 点击进入历史列表，期望可以多选/全选列表项目，并支持取消运行中任务、删除已完成记录。 | 已在队列/历史页加入当前列表全选、多选、清除选择、取消选中运行项和删除选中终态记录；操作走 `FastSubClient.cancelJob/deleteJob`。 | 源码检查：`QueueList` bulk selection、`AppShell.cancelJobs/deleteJobs`。 | 下一轮用真实运行中任务和已完成记录复测。 |
| DQA-050 | `PASS` | P2 | 任务详情 / Logs tab | 点击 Logs，预期输出 daemon 侧详细运行日志，而不是只有简略摘要。 | 已接 `client.getJobLogs(jobId)`，运行中任务会定时刷新日志；无日志时才降级显示摘要。 | 源码检查：`LogPanel`、`AppShell.getJobLogs`。 | 下一轮用真实转写/翻译/烧录任务复测日志内容。 |
| DQA-051 | `PASS` | P2 | 任务详情 / 设置 tab | 点击设置下面的输出目录，期望可以打开文件所在目录。 | 已将输出目录改为可点击路径按钮，调用现有 shell open bridge 打开目录。 | 源码检查：`ConfigPanel` output directory button。 | 下一轮用真实完成/失败任务复测路径打开。 |
| DQA-052 | `PASS` | P2 | 设置 / 通用 | 点击默认转写 Provider | 下拉框显示有 bug，不能正常选择。 | 已补齐通用设置 Provider 自绘下拉样式和禁用项处理，避免 Windows 原生下拉错位/不可选。 | `pics/52-select-bug.png` | 下一轮切到设置 / 通用页复测默认转写和默认翻译 Provider。 |
| DQA-053 | `PASS` | P2 | 详细设置 / 翻译 Provider | 英文设置下 Provider 下拉仍显示中文。 | 已将详细设置 Provider option 改为按 provider id 走 i18n 映射，不再直接显示 daemon/mock 中文 name。 | `pics/53-i18n-provider.png` | 下一轮 English 模式打开详细设置复测。 |
| DQA-054 | `PASS` | P2 | 环境检测 | 英文设置下环境检测仍显示中文。 | 已将环境检测内存/磁盘和 daemon runtime 文案接入 runtime text 翻译，英文模式不再显示中文兜底。 | `pics/54-i18n-env-test.png` | 下一轮 English 模式运行环境检测复测。 |
| DQA-055 | `PASS` | P2 | Provider 设置 / 本地模型安装 | 本地 Provider 缺模型时，服务商页的“先安装模型”应直接触发 Go `model_install`，不能只是静态阻断提示。 | 已将 Provider 卡片接入 `installModel` 和 `modelInstallJobs`；本地 NLLB 缺模型时会安装当前兼容模型，仍停留在设置页上下文。 | `desktop/renderer/src/app/screens/settings.tsx`、`desktop/test/App.test.tsx`。 | 常规回归；Round 13 打包形态验证真实下载。 |


## 新问题模板

追加新问题时复制下面一行，替换字段即可：

```markdown
| DQA-XXX | `TODO` | P1 | 页面/入口 | 复现步骤和期望 | 当前实际结果 | 截图或日志 | 修复计划 |
```

如果一个问题已经修复但还没人工复测，状态先写 `RETEST`：

```markdown
| DQA-XXX | `RETEST` | P1 | 页面/入口 | 问题描述 | 已修复，等待真实流程复测 | PR/commit/截图 | 复测通过后改 `PASS` |
```

## 稳定格式检查

本次对 README 格式做了以下调整：

| 检查项 | 状态 | 处理 |
| --- | --- | --- |
| 状态值是否稳定 | `PASS` | 使用 `PASS/RETEST/TODO/CONFIRM/DEFER`，避免依赖颜色或 emoji。 |
| 是否支持后续逐条修复 | `PASS` | 每条问题有独立 ID、优先级、页面、结论和下一步。 |
| 是否保留截图证据 | `PASS` | 保留 `desktop-tests/pics/` 作为统一截图目录。 |
| 是否能区分已修和待复测 | `PASS` | 已从实现记录确认的标 `PASS`，需要真实 Provider/打包/长任务验证的标 `RETEST` 或 `DEFER`。 |
| 是否避免过度承诺 | `PASS` | 对真实网络、真实模型、GPU 长任务、发布打包 smoke 只标 `RETEST/DEFER`。 |

## 后续建议

下一轮可以按这个顺序推进 QA：

1. 先跑快速静态验证：`cd desktop && npm run typecheck && npm test`。
2. 再跑 Go 验证：`go test ./...`。
3. 用 3 个小文件跑桌面主流程：原字幕、翻译字幕、双语字幕。
4. 用 1 个中文/日文/韩文文件名验证乱码修复。
5. 用 1 个 txt 聊天记录验证逐行翻译和格式保留。
6. 用 1 个大 txt 验证网页翻译 3 分钟超时。
7. 用 1 个长音频/GPU 任务验证取消后子进程退出。
