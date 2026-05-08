# Desktop Round 12 Manual Regression Notes

本目录用于记录 Electron 接入 Go daemon 后的页面级手动排查。重点不是重复跑单元测试，而是把手动反馈归类成可复现的页面检查项：每个页面是否仍有 Round 11 mock/占位数据、是否使用真实 daemon job/config/result/error、是否把路径和隐私边界处理正确。

截图统一放在 `desktop-tests/pics/`。文件名格式建议：`NN-page-state-short-name.png`。

当前可复现截图可通过以下命令生成：

```powershell
cd C:\Users\Example\Desktop\SaaS\P05
node desktop-tests\capture-round12-pages.mjs
```

该脚本使用 Electron offscreen window 打开本地 renderer dev server。运行前需要确保 `http://127.0.0.1:5173/` 可访问。

## 手动反馈问题类型

| ID | 问题名 | 页面/入口 | 手动现象 | 处理方式 | 截图 |
| --- | --- | --- | --- | --- | --- |
| M01 | mock/占位数据残留 | 完成页、生成中、主界面添加文件夹、失败详情 | 页面显示 `a b.srt`、`sample-lecture.mov`、`sample-podcast.wav`、`C:\Users\Example\Videos`、`media_extract_failed` 等固定样例，而不是当前任务数据。 | 页面数据必须来自 `activeJob`、`jobs`、真实选中文件或 daemon 返回值；保留 mock fixture 只能用于 test/mock client，不应作为真实页面 fallback。 | [03](pics/03-main-files-real-path.png), [04](pics/04-main-generating-real-job.png), [05](pics/05-main-done-real-result.png) |
| M02 | 真实 daemon job 未贯通到 UI 状态 | 生成中、完成页、历史详情 | daemon 已经创建/运行 job，但 renderer 仍按本地文件数组或固定 snapshot 渲染；完成页没有显示真实输出字幕。 | 从 `createJob()` 返回的 `JobDetail`、SSE event、`listJobs()`、`getJob()` 同步页面状态；`events_lost` 后重新拉取 job。 | 待复现截图 |
| M03 | 文件路径来源错误 | 添加视频、添加文件夹、拖拽、输出位置 | 默认输出目录或弹窗路径使用 mock 路径；拖拽文件只拿到文件名，导致 Go 侧输出到错误目录或 mkdir `C:\Users\Example` 失败。 | 文件选择走 preload allowlist；拖拽通过 `webUtils.getPathForFile(file)` 取真实路径；source 输出目录由真实输入路径推导。 | 待复现截图 |
| M04 | 输出冲突语义错误 | 输出冲突弹窗 | 同名字幕已存在时没有正确询问；“另存为”被当成换目录；弹窗目标路径显示 mock 地址。 | 冲突失败时显示真实 `output_path`；覆盖显式传 `options.overwrite=true`；另存为打开 save dialog 选择新的 `.srt` 文件名。 | 待复现截图 |
| M05 | Desktop 到 Go 请求参数与 Go 直测不一致 | Desktop 生成字幕入口、daemon log | Go 脚本直接调用 daemon 可正常生成，但 Desktop 侧失败，说明 Desktop 传入的 input/output/options/provider/model 有差异。 | 开启 redacted transport log，记录 REST/SSE 摘要和 `job.request` 摘要；不记录 token、Authorization、raw secret。 | 待复现截图 |
| M06 | 错误展示不来自真实 daemon error | 失败详情 | 页面固定显示“音频轨无法提取”或固定结构化错误，而不是 daemon 返回的 code/title/message/details/diagnostic。 | 失败页从 `activeJob.error` 渲染；日志/config tab 使用当前任务摘要。 | [06](pics/06-queue-failed-no-hardcoded-fallback.png) |
| M07 | 批量任务队列不同步 | 添加文件夹后生成、生成中页 | 文件夹添加多个文件后，UI 看似有多个任务，但 daemon 只创建一个 job；“接下来”没有真实等待任务，或混入全局历史/fixture 队列。 | 每个媒体文件创建独立 `createJob()` request；生成中页只显示本次 batch job ids 中 queued/running/canceling 的任务。 | [04](pics/04-main-generating-real-job.png) |
| M08 | 远程 provider/secret 隐私边界 | 远程确认、API 设置、诊断、日志 | 不能让远程 provider 静默上传音频/字幕；不能在 renderer state、日志、snapshot 里出现 API key、Authorization、ready token、secret_ref 原文。 | 远程 provider 必须弹确认；renderer 只见 masked/status/alias；日志和事件全部 redacted。 | 待复现截图 |

## 页面排查记录

| 页面 | 操作 | 重点检查 | 状态 | 截图 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 首次启动/环境检查 | 打开 app，进入主界面 | daemon 状态、模型状态、错误恢复文案是否真实；无 token/secret。 | 已截图，未发现占位泄漏 | [01](pics/01-setup-check.png) | offscreen 目前使用 mock-ready 场景；真实 daemon 状态仍需手动窗口确认。 |
| 主界面空状态 | 进入主界面 | 不应显示任何 seed 文件；按钮状态取决于真实 ASR readiness。 | 已截图，未发现 seed 文件 | [02](pics/02-main-empty.png) |  |
| 添加视频 | 选择单个媒体 | 文件名和 output source 目录来自真实文件路径。 | 已截图，未发现 seed 文件；路径通过 synthetic Electron file path 覆盖 | [03](pics/03-main-files-real-path.png) |  |
| 添加文件夹 | 选择目录 | 枚举真实目录媒体文件，不使用 `seedFiles`。 | 代码已修；真实系统目录 picker 待手动确认 |  | offscreen 无法打开系统文件夹对话框。 |
| 拖拽媒体 | 拖入文件 | 通过 Electron 获取真实路径；输出目录不是 mock。 | 待排查 |  |  |
| 详细设置 | 打开高级设置 | provider/model/config 值来自 daemon config/provider/model API。 | 待排查 |  |  |
| 生成中 | 启动多文件任务 | 当前任务和“接下来”来自真实 `jobs`；无固定 `input.mp4`/讲座/播客占位。 | 已修复并截图：单文件时不再显示全局 mock 队列 | [04](pics/04-main-generating-real-job.png) | 多文件 batch 截图待补。 |
| 输出冲突 | 生成已有同名字幕 | 目标路径真实；覆盖/跳过/另存为语义正确。 | 待排查 |  |  |
| 完成页 | 任务成功 | 输出文件名、耗时、打开路径来自 `activeJob.result`。 | 已修复 mock event 硬编码结果并截图 | [05](pics/05-main-done-real-result.png) |  |
| 失败详情 | 任务失败 | 展示真实 daemon error；无固定 `media_extract_failed` fallback。 | 已截图，未见固定 `media_extract_failed` fallback | [06](pics/06-queue-failed-no-hardcoded-fallback.png) | 当前截图为 debug forced state；真实失败 job 还需手动或 daemon fixture 复现。 |
| 历史列表/详情 | 打开历史和任务详情 | 列表/详情从 `listJobs()`/`getJob()` 同步。 | 待排查 |  |  |
| 模型管理 | 安装/重试模型 | 安装走 `model_install` job，完成后刷新 `listModels()`。 | 待排查 |  |  |
| API/Provider 设置 | 修改配置、测试 provider | raw secret 不进入 renderer；远程上传需确认。 | 待排查 |  |  |
| 翻译 SRT | 选择 SRT 并开始 | 走 `translate_srt` job；不静默上传字幕文本。 | 待排查 |  |  |
| 字幕烧录 | 选择视频+字幕并开始 | 走 `burn_in` job；输出路径和冲突处理一致。 | 待排查 |  |  |
| 诊断/日志 | 打开诊断 | redacted daemon REST/SSE/job request 摘要；无 token/secret。 | 待排查 |  |  |

## 已确认并直接修复

- `AppShell.startJob()` 不再在没有选中文件时 fallback 到 `seedFiles` 创建任务。
- `MainFiles` 不再在 `props.files` 为空时显示 `seedFiles`。
- 远程 provider 确认弹窗不再使用 `seedFiles` 作为文件列表 fallback。
- 生成中页面“接下来”不再从全局 `jobs` 混入历史/mock 队列，只展示本次 batch 的 job ids。
- `MockFastSubClient.subscribeJobEvents()` 的完成结果不再硬编码 `C:\Users\Example\Videos\a b.srt`，改为从当前 job output 推导。

## 待人工确认

- mock client 和 debug panel 中仍保留 `seedFiles`/`C:\Users\Example\Videos` 用于 mock-first 场景和测试；后续排查需要确认这些是否仅出现在 debug/mock 场景，还是会泄漏到真实 daemon 模式页面。
