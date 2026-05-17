# Round 13: Electron Productization And Release Readiness

## Summary

Round 13 是 Fast Sub 桌面版的产品化和发布准备轮。Round 12 已完成真实 daemon client、模型安装、转写、翻译、烧录、配置持久化、secret storage、任务队列、取消链路、FFmpeg/FFprobe 自动修复和当前自动化回归；Round 13 不再补核心业务架构。

本轮目标是把当前桌面应用从“功能闭环可运行”推进到“可以交给真实用户试用”：打包 Windows 和 macOS 应用、验证安装包/便携包形态、补齐发布 smoke、整理诊断入口、确认真实 Provider 和本机依赖路径，并形成可重复执行的发布检查清单。

## Goals

- 明确 Windows 和 macOS 桌面发布形态：开发 build、打包 build、安装包或便携包的边界、输出目录和验证方式。
- 使用 `electron-builder` 作为 Round 13 默认打包工具；它负责 Electron app packaging、platform targets、extra resources、Windows/macOS artifact 配置，并为后续 signing/notarization 保留标准入口。
- 将 Go daemon 作为平台二进制随包分发；Electron main 在打包态从 `process.resourcesPath` 下的平台目录定位 `fast-sub-go`。
- 将受控 Python runtime、Python CLI bridge 和 worker 作为 app 私有 runtime 随包分发，普通用户不需要系统 Python、uv 或已安装的 `fast-sub` CLI。
- 验证打包后 Electron main process 能启动和管理 Go daemon，并且 renderer 仍无法接触 daemon token、Authorization、raw HTTP/SSE 或 raw secret。
- 验证打包后 `fast-sub-go`、Python CLI bridge、FFmpeg/FFprobe、aria2、whisper.cpp binary、模型目录和配置文件路径都能被稳定发现或修复。
- 模型不随安装包分发；首次启动根据本机环境引导安装默认转写模型和默认翻译模型，安装完成后才能标记本地转写/本地翻译环境就绪。
- 验证首次启动、后续启动、daemon repair、401、disconnect、events_lost、app 退出取消任务、Windows 进程树清理在打包形态下可恢复。
- 运行真实 Provider smoke：本地 NLLB、本地兼容 OpenAI API 作为 release blocker；真实 OpenAI、web Google/Bing 作为外部服务记录项，不默认阻塞本地桌面版发布。
- 运行真实文件和环境 smoke：中文/日文/韩文路径、空格路径、长文件名、TXT 逐行翻译、大 TXT 网页翻译超时、GPU 长任务取消。
- 收口诊断和隐私提示：发布 build 的日志、错误、诊断导出和 UI 文案必须 redacted，且普通用户能找到下一步操作。
- 建立 `desktop-tests` 下的 Round 13 发布验收记录，保留每条 smoke 的日期、环境、输入、结果、阻塞原因和后续动作。

## Non-goals

- 不新增核心业务能力。
- 不重写 Go daemon job orchestration。
- 不重写 Python worker、Python translation service 或 provider runtime。
- 不在 Round 13 为了免 Python 安装而全量迁移 STT/translation 到 Go；本轮采用 app 私有 Python runtime，Go/native 化另开后续轮次评估。
- 不新增默认远程 Provider，不静默启用 API/Web 上传。
- 不把 renderer 直接接到 Python、ffmpeg、whisper.cpp、模型下载器或 provider runtime。
- 不引入 Web 版、云同步、多用户账户、远程控制本机 daemon 或公网 daemon。
- 不把 benchmark 放入主流程。
- 不要求第一版发布就完成正式代码签名、商店分发或自动更新；如缺少证书，内部试用包可以是未签名 build，但发布记录必须明确风险和安装提示。

## Branch Plan

推荐分支：

```text
codex/fast-sub-round13-release-readiness
```

Round 13 会同时触及打包配置、诊断、smoke 脚本、发布文档和少量 UI polish。建议仍使用一个主分支推进，每个实现单元完成后同步更新 `ui-docs/project-tracker.md` 和 `desktop-tests` 发布验收记录。

## Current Input State

Round 13 从以下状态开始：

- `ui-docs/specs/round12-electron-daemon-integration.md` 已记录 Round 12 当前实现口径。
- `ui-docs/project-tracker.md` 显示 Round 12 核心功能和自动化回归已收口。
- `desktop-tests/README.md` 当前 QA 表为 `PASS=55 / RETEST=0 / TODO=0 / DEFER=0`，但真实网络、真实模型、GPU 长任务和安装包形态仍需要 Round 13 smoke。
- `desktop/package.json` 当前已有 `dev`、`typecheck`、`test`、`build`、`smoke`，尚未记录正式 packaging script。
- 当前 Electron 依赖版本为 npm 管理的独立 `desktop/` 应用；生产应用代码仍只放在 `desktop/`。

## Confirmed Decisions

- 发布平台：Windows 和 macOS 都进入 Round 13 范围。
- 打包工具：使用 `electron-builder`，因为本项目需要跨平台 artifact、installer/portable/dmg/zip target、`extraResources` 打包 Go/Python/native binaries，以及后续 Windows signing、macOS signing/notarization 的标准配置入口。
- Windows artifact：默认至少提供 x64 installer 或 portable；具体 installer/portable 是否都出由 13.1 inventory 后确认。
- Windows artifact：第一版同时提供 x64 installer 和 portable zip。
- macOS artifact：第一版只做 arm64 dmg。x64/universal 和 macOS zip 不进入 Round 13 第一版范围，后续根据用户机器覆盖情况另开任务。macOS 分发时 signing/notarization 是正式发布要求；内部试用可以先记录未签名风险。
- Go daemon：随 app 作为平台二进制分发，推荐路径为 `desktop/resources/bin/<platform>-<arch>/fast-sub-go(.exe)`，打包后复制到 app resources。
- Python runtime：随 app 作为受控私有 portable runtime 分发，包含 Python CLI bridge 和必要 worker/translation 依赖；普通用户不需要安装 Python、uv 或全局 `fast-sub` CLI。Round 13 推荐优先使用“便携 Python 目录 + 预装依赖/site-packages/wheelhouse”的方式，避免 PyInstaller one-file 的临时解压和子进程生命周期问题。Windows 可评估 Python embeddable 或 python-build-standalone；macOS 优先评估 python-build-standalone。PyInstaller 仅作为窄 CLI fallback，不作为默认策略。
- 模型：不随包分发；首次启动负责安装默认 ASR 模型和默认翻译模型，并根据环境展示就绪、安装中、失败、重试和稍后处理状态。默认 ASR 模型优先使用小模型，不做复杂硬件推荐；默认翻译模型使用当前默认 NLLB manifest。
- Provider smoke：默认本地 ASR Provider、默认本地翻译 Provider 和本地兼容 OpenAI API smoke 作为 blocker；真实 OpenAI、Bing、Google 作为外部服务记录项，失败不默认阻塞本地桌面发布。
- 本地兼容 OpenAI API blocker 不指定唯一服务；由测试者手动提供任意 OpenAI-compatible endpoint，并在 `desktop-tests/round13-release-smoke.md` 中记录 base URL 类型、模型名、是否需要 key、服务版本或项目名。

## Implementation Units

| 单元 | 名称 | 范围 | 验收 |
| --- | --- | --- | --- |
| 13.1 | Release inventory and packaging decision | 盘点当前 build 产物、daemon binary、Python runtime/CLI bridge、native binaries、模型目录、配置目录、日志目录和 userData 路径；确认 Windows x64 installer/portable 和 macOS arm64 artifact target | 文档写明 release artifact、目录、运行时查找顺序和不打包内容 |
| 13.2 | Packaged app build pipeline | 使用 `electron-builder` 增加或整理 packaging 配置和 npm script；确保打包后 main/preload/renderer、daemon binary、Python runtime、必要静态资源和 license/notice 文件可用 | 可在本机生成 release artifact；打包产物启动不依赖 dev server 或系统 Python |
| 13.3 | Packaged daemon and dependency smoke | 在打包形态验证 daemon ready JSON、repair、401、disconnect、events_lost、FFmpeg/FFprobe 首装、aria2 fallback、whisper.cpp binary 准备和 app 退出清理 | `desktop-tests` 记录每个 smoke 的环境、步骤、结果和日志摘要 |
| 13.4 | Real provider and file smoke | 用小媒体、小 SRT/TXT、中文/日文/韩文路径、本地兼容 API、web provider 和 GPU 长任务验证真实流程 | 真实 smoke 表覆盖原字幕、翻译字幕、双语字幕、translate text、burn-in、取消和超时 |
| 13.5 | Diagnostics and privacy polish | 整理诊断页、错误恢复、日志导出、redaction、自检结果和用户可执行动作；确保普通页面不出现内部术语 | 诊断可解释失败原因；token/API key/Authorization/signed URL 不进 UI、日志导出或测试快照 |
| 13.6 | Release E2E and screenshot baseline | 建立打包形态 smoke/E2E 或手动脚本；更新截图基线，覆盖首次启动、主界面、生成中、完成、失败、设置、诊断 | 新增 Round 13 截图/记录，明确哪些是自动验证，哪些是人工验证 |
| 13.7 | Release checklist and handoff | 输出发布检查清单、已知限制、隐私说明、安装说明、回滚/清理说明和下一轮候选项 | `ui-docs/project-tracker.md` 和 `desktop-tests` 可作为发布验收入口 |

实现顺序固定为 13.1 -> 13.7。13.1 未完成前，不应直接选择新打包依赖或修改 build pipeline；13.2 未完成前，不应声称安装包 smoke 已通过；13.4 的真实 Provider smoke 不应阻塞默认自动化测试。

## Workstream 1: Release Inventory

13.1 先做发布资产和运行时路径盘点。

必须记录：

- Electron app build 输出目录。
- Go daemon binary 的来源、名称、平台、架构和打包位置；推荐开发态输出到 `desktop/resources/bin/<platform>-<arch>/fast-sub-go(.exe)`。
- Electron main process 在开发态和打包态如何定位 daemon。
- Python runtime、Python CLI bridge 和 worker 依赖的开发态/打包态 resolver 顺序；打包态必须优先 app 私有 runtime，不要求系统 Python。
- Python runtime 打包策略：默认使用 app 私有 portable Python runtime 目录，路径建议为 `desktop/resources/python/<platform>-<arch>/`；其中包含 Python executable、必要 stdlib、site-packages、Fast Sub Python package、workers 和 translation 依赖。13.1 必须记录 runtime 来源、版本、构建命令、是否可离线复现、依赖锁定方式和是否包含 GPL/特殊 license 依赖。
- FFmpeg/FFprobe、aria2、whisper.cpp binary 的 app 私有安装目录和 PATH 注入方式。
- 模型 store、job store、logs、config、secret store、UI prefs 的 userData 路径。
- 哪些内容绝不打包：真实模型、真实媒体、API key、本机任务产物、本机 benchmark 报告。
- 发布包是否包含 sample media；默认不包含真实媒体，只保留小型 synthetic fixture 或文档说明。
- 第三方 license/notice inventory：必须输出或更新 `THIRD_PARTY_NOTICES.md` 或等效清单，记录随包分发或运行时下载的 Go daemon、Electron、Node dependencies、Python runtime、Python dependencies、FFmpeg/FFprobe、aria2、whisper.cpp、模型来源和 license。缺少 license/notice inventory 视为 Round 13 release blocker。
- 第三方 license policy：13.1 必须把每个第三方组件标为 `bundle-ok`、`download-only`、`manual-user-install`、`blocked` 或 `needs-review`。GPL/LGPL、模型 license、带商用限制的模型或 native binary 不能只列清单；必须说明是否允许随包分发、是否只能运行时下载、是否需要展示 notice/source offer、是否阻断 release。

输出建议：

```text
ui-docs/specs/round13-electron-productization-release.md
desktop-tests/round13-release-smoke.md
```

## Workstream 2: Packaging Pipeline

13.2 使用 `electron-builder` 落地第一版 packaging pipeline。

需要确认：

- Windows 第一版固定生成 x64 installer 和 portable zip。
- macOS 第一版固定只生成 arm64 dmg。macOS zip、x64 和 universal 不作为 Round 13 第一版目标。
- macOS build、signing、notarization 和 smoke 必须在 macOS host 或 macOS CI runner 上执行；Windows 构建机上的配置检查不能作为 macOS artifact 验收。
- macOS 范围拆分为“可构建”和“可分发”：
  - Round 13 blocker：unsigned macOS build 能生成、启动、定位 resources、启动 daemon、运行 smoke。
  - 正式公开分发 blocker：完成 signing/notarization。
  - 如果本轮没有证书，发布记录必须明确 Gatekeeper/quarantine 风险、内部试用打开方式和不可公开分发限制。
- 未签名包的安装提示和风险说明。
- release artifact 命名规则，例如 `FastSub-Desktop-0.13.0-windows-x64`、`FastSub-Desktop-0.13.0-macos-arm64`。
- 打包输出是否包含 license/notice、版本信息、app icon、product name。
- Go daemon、Python runtime、Python CLI bridge、worker 依赖和必要 native binary 是否通过 `extraResources` 或等效机制进入 app resources。
- 所有需要 `child_process.spawn` 或系统加载的可执行 runtime 必须位于 ASAR 外，包括 `fast-sub-go`、Python executable、Python CLI bridge、worker runtime、FFmpeg/FFprobe、aria2、whisper.cpp 和任何 native executable。Electron main 只能通过 `process.resourcesPath` 或 app 私有 userData/native-binaries 查找这些文件，不得从 `app.asar` 内执行二进制。
- `electron-builder` 配置必须显式声明 runtime resources 的复制规则，优先使用 `extraResources`；如需 ASAR，必须确保 executable/native resources 被排除或 unpack。打包 smoke 必须同时验证 unpacked 目录和安装/便携运行路径。
- 打包后不依赖 `electron-vite dev` 或 Vite dev server。
- 打包后不依赖用户系统 Python、uv 或全局 `fast-sub` CLI。
- 打包配置不得把 `.env`、secret store、本机 userData、模型文件、local_tests 产物打进包。

验收命令应至少包含：

```powershell
cd desktop
npm run typecheck
npm test
npm run build
npm run smoke
npm run package:dir
npm run package
```

`npm run package:dir` 应映射到 `electron-builder --dir` 或等效 unpacked app 构建，作为 installer/dmg/portable 前的快速 smoke 层。`package:dir` 通过后，才继续验证 installer、portable、dmg 或 zip artifact。

如果 `npm run package` 需要新增依赖或下载工具，必须记录依赖来源、锁文件变化和离线/网络失败处理。

## Workstream 3: Packaged Runtime Smoke

13.3 在打包产物上验证运行时能力。

必须覆盖：

- 首次启动能进入环境检查或主界面。
- 后续启动不重复强制 onboarding，后台刷新环境状态。
- 打包后自管 daemon 能启动，ready JSON 解析成功。
- daemon token 不进入 renderer、console、日志、诊断导出或错误详情。
- `repairDaemon()` 能重启 daemon 并重新同步 health/models/providers/jobs。
- 401 映射为本地服务认证失效，并提供恢复动作。
- daemon disconnect 映射为本地服务中断，并提供恢复动作。
- SSE reconnect 和 `events_lost` 后能通过 `getJob()` 重新同步状态。
- app 退出时 running job 进入取消或中断路径，不遗留 `fast-sub-go`、Python worker、ffmpeg、whisper.cpp 子进程。
- macOS arm64 打包产物必须验证 app resources 下的 `fast-sub-go`、Python executable、ffmpeg/ffprobe、aria2、whisper.cpp 具有可执行权限，没有被 quarantine 阻断，并且 Electron main 能在 app bundle 内正确定位它们。
- macOS arm64 必须验证 app 退出、取消 job 和 repair 后不会遗留 daemon/Python/ffmpeg/whisper.cpp 子进程；sleep/wake 后 SSE 或 job 状态必须能恢复或显示可恢复错误。
- FFmpeg/FFprobe 缺失时，私有安装、包管理器 fallback 和 PATH 注入路径可用。
- aria2 bootstrap 失败时能 fallback 到普通 HTTPS 下载。
- whisper.cpp native binary 缺失时，Provider 页安装依赖路径可用或显示明确阻塞。

## Workstream 4: Real Provider And File Smoke

13.4 不进入默认 CI，但必须形成可重复手动记录。

建议 smoke 矩阵：

| 场景 | 输入 | Provider | 验证点 |
| --- | --- | --- | --- |
| 原字幕生成 | 小音频/视频 | `local-faster-whisper` | 生成 SRT、进度、完成页、打开文件 |
| Native ASR | 小音频/视频 | `local-whisper-cpp` | binary/model readiness、错误提示或成功输出 |
| API STT blocker | 小音频 | 本地兼容 OpenAI API | Base URL/model/key alias 隔离、无 key/有 key路径、401/403 映射 |
| API STT external record | 小音频 | 真实 OpenAI-compatible 服务 | 记录账号/网络/服务可用性；失败不默认阻塞 |
| 本地翻译 | 小 SRT/TXT | `local-nllb-ct2` | 模型 readiness、逐行 TXT 输出 |
| Web 翻译 external record | 小 SRT/TXT | `web-bing` / `web-google` | 成功或 provider_failed；不无限卡住；失败不默认阻塞 |
| Web 大文件超时 | 大 TXT | `web-bing` / `web-google` | 3 分钟硬超时和用户提示 |
| API 翻译 blocker | 小 SRT/TXT | 本地兼容 OpenAI API | 无 key 本地端点、401/403、模型名隔离 |
| API 翻译 external record | 小 SRT/TXT | 真实 OpenAI-compatible 服务 | 记录账号/网络/服务可用性；失败不默认阻塞 |
| 双语字幕 | 小媒体 | local/API translation | 同一 `transcribe` job 内转写加翻译 |
| 烧录字幕 | 小视频 + SRT | `burn_in` | ffmpeg 输出、取消、失败日志 redaction |
| 路径兼容 | 中文/日文/韩文/空格路径 | 任意本地流程 | 文件名、输出名和错误页不乱码 |
| GPU 取消 | 长音频/视频 | local ASR GPU | 取消后子进程树和显存释放 |

默认本地 ASR Provider 的真实 packaged smoke 是 release blocker。Round 13 默认 ASR 模型优先安装小模型，避免首次启动下载和磁盘压力过大；不做复杂硬件推荐策略。若 13.1 最终选择 `local-faster-whisper` 作为默认 ASR，则 `local-faster-whisper` 小媒体转写必须通过；若根据环境选择 `local-whisper-cpp` 作为默认 ASR，则对应 native binary、小模型和小媒体转写必须通过。不能只验证 API STT 或 mock 流程。

首次默认模型安装策略：

- 默认 ASR 模型安装失败时，本地转写环境不能标记为就绪，并阻断默认本地转写主流程；UI 必须提供重试、诊断和稍后处理入口。
- 默认翻译模型使用当前默认 NLLB manifest。默认 NLLB 模型安装失败时，本地翻译环境不能标记为就绪，并阻断翻译字幕/双语字幕/本地翻译工具；但不阻断原字幕生成主流程。
- 下载前必须展示模型大小或空间需求摘要，并检查模型目录可写和可用磁盘空间。
- 下载失败、校验失败、用户取消、网络中断、磁盘不足必须进入可恢复状态，不得把 onboarding 标记为完成。
- 模型不进入安装包；首次安装 smoke 必须从无默认模型环境开始验证。

Python runtime packaged smoke 必须拆成以下层次：

- app 私有 Python executable 能启动并输出版本。
- app 私有 Python runtime 下 `fast-sub --help` 或等效 CLI entry 可运行。
- faster-whisper worker import/check 可运行，不依赖系统 Python/uv。
- translation bridge import/check 可运行，至少覆盖 `ctranslate2` 和 `sentencepiece` 的 import 或等效 runtime check。
- 在 PATH 中移除系统 Python/uv 或使用隔离环境后，仍能完成默认本地 ASR 和本地翻译 smoke。

本地兼容 OpenAI API blocker 由测试者手动提供任意 OpenAI-compatible endpoint。记录中必须写明 endpoint 类型、服务项目或版本、base URL 是否本机 loopback、模型名、是否需要 API key、`/v1/models` 是否可用、STT/chat 分别使用的 provider id。不得把 API key 或 Authorization 写入记录。

测试资产建议位置：

```text
local_tests/round13/media/
local_tests/round13/subtitles/
local_tests/round13/text/
```

`desktop-tests/round13-release-smoke.md` 只记录测试结果、输入来源和路径摘要，不提交真实大媒体、真实任务输出、模型文件或 secret。

每条记录必须包含：

- 日期。
- 操作系统和架构。
- app build 类型和版本。
- 输入文件来源和是否可提交。
- Provider 和模型。
- 配置摘要，不包含 secret。
- 结果：PASS / RETEST / TODO / BLOCKED。
- 失败时的 redacted 日志摘要和下一步。

## Workstream 5: Diagnostics And Privacy

13.5 聚焦发布可用性，不扩大核心功能。

诊断页必须清楚展示：

- App 版本、daemon 版本、platform、arch。
- Daemon health、ready pid、repair 状态。
- Config 路径、model store 路径、job/log 路径的 redacted 或用户友好摘要。
- FFmpeg/FFprobe、aria2、whisper.cpp、Python CLI bridge 的状态和修复动作。
- Provider 状态：local/api/web/native、是否需要模型、是否需要 key、live/static check 结果。
- 最近错误和日志 tail，默认 redacted。
- 复制诊断摘要时必须过滤 API key、Authorization、daemon token、secret_ref、signed URL、proxy credential、本机完整敏感路径。

普通主流程仍不得展示 daemon、SSE、job id、JSON envelope、worker protocol 或 raw command。只有诊断页可以使用必要技术词，并且必须有用户可执行动作。

## Workstream 6: Release E2E And Screenshot Baseline

13.6 建立发布验证入口。

建议新增或整理：

```text
desktop-tests/round13-release-smoke.md
desktop-tests/pics/round13/
```

截图/记录至少覆盖：

- 首次启动环境检查。
- 主界面空状态。
- 添加真实媒体后主界面。
- 真实 job 生成中。
- 完成页。
- 失败任务详情。
- 模型管理。
- Provider 设置。
- 诊断页。
- English UI smoke。

自动化优先覆盖不依赖真实网络、模型和 GPU 的路径。真实网络、真实模型和 GPU 压力测试只作为手动发布 smoke 记录。

## Workstream 7: Release Checklist

13.7 输出最终发布检查清单。

清单必须包含：

- 版本号和 release artifact 名称。
- Git branch 和 commit。
- 自动化验证命令和结果。
- 打包命令和产物路径。
- 手动 smoke 矩阵结果。
- 已知限制。
- 隐私说明：默认本地处理，远程 Provider 使用前需显式选择和确认。
- Secret 处理说明：renderer 不接触 raw secret，配置文件不保存 raw key，daemon secret_ref 一次性短 TTL。
- 安装和卸载/清理说明，包括 userData、model store、job logs、native-binaries。
- 未签名包或安全软件误报风险。
- macOS 未签名 build 说明：如果未完成 signing/notarization，必须明确该 artifact 只能用于内部试用，记录 Gatekeeper/quarantine 风险和用户打开方式；不得把 unsigned macOS build 标记为正式可分发。
- 第三方 license/notice 清单路径和状态。
- 下一轮候选项，必须和 Round 13 release blocker 分开。

## Testing

默认自动化验证：

```powershell
go test ./...
cd desktop
npm run typecheck
npm test
npm run build
npm run smoke
```

Round 13 新增打包验证后，追加：

```powershell
cd desktop
npm run package:dir
npm run package
```

如果新增 E2E/screenshot 脚本，应记录命令和依赖条件，例如需要先启动 dev server 或使用打包产物。

默认测试仍不得访问真实网络、真实 OpenAI、真实模型、真实 ffmpeg、真实 whisper.cpp 或 GPU。真实环境验证必须归入 `desktop-tests` 手动 smoke 表。

## Acceptance Criteria

- 有明确的 Windows release artifact 形态和生成命令。
- Windows 第一版同时生成 x64 installer 和 portable zip。
- 有明确的 macOS arm64 dmg 生成命令；macOS zip、x64 和 universal 明确不属于 Round 13 第一版。
- macOS artifact 在 macOS host 或 macOS CI runner 上完成 build/smoke 记录。
- macOS “可构建”与“可分发”状态已分开记录；未签名/未 notarize 的 macOS build 不标记为正式可分发。
- Round 13 默认使用 `electron-builder`，并记录 Windows/macOS target、extraResources 和 signing/notarization 状态。
- `npm run package:dir` 或等效 unpacked app smoke 通过后，才记录 installer/portable/dmg smoke。
- 打包产物可以启动，不依赖 dev server。
- 打包产物不依赖用户系统 Python、uv 或全局 `fast-sub` CLI；app 私有 Python runtime/CLI bridge 可被 daemon 定位。
- Go daemon、Python runtime、FFmpeg/FFprobe、aria2、whisper.cpp 等可执行资源都位于 ASAR 外，并通过 `process.resourcesPath` 或 app 私有 native-binaries 目录定位。
- Go daemon 作为平台二进制随包分发，并在诊断页显示 app/daemon 版本。
- 打包后自管 daemon、REST/SSE、config、secret storage、job queue、repair、cancel 和 result view 可运行。
- 打包后 FFmpeg/FFprobe、aria2、whisper.cpp、Python CLI bridge 的缺失/安装/诊断路径清晰。
- 模型不随包分发；首次启动能引导安装小型默认 ASR 模型和当前默认 NLLB 翻译模型，并准确显示就绪/失败/重试状态。
- 默认 ASR Provider 的真实 packaged smoke 通过；默认翻译模型失败不阻断原字幕生成但阻断本地翻译路径。
- 自动化回归通过：`go test ./...`、`npm run typecheck`、`npm test`、`npm run build`、`npm run smoke`。
- 打包 smoke 有记录：启动、daemon repair、401/disconnect/events_lost、FFmpeg 首装、模型安装、主转写、翻译、烧录。
- 真实 Provider smoke 有记录；本地兼容 OpenAI API 失败按 blocker 处理，真实 OpenAI/Bing/Google 失败默认按外部服务记录，除非暴露产品缺陷。
- 诊断导出和 UI 文案不泄露 API key、Authorization、daemon token、secret_ref、signed URL 或 proxy credential。
- `THIRD_PARTY_NOTICES.md` 或等效 license/notice inventory 已更新，覆盖随包分发和运行时下载的第三方组件。
- 第三方 license policy 已明确；所有组件都有 `bundle-ok`、`download-only`、`manual-user-install`、`blocked` 或 `needs-review` 结论，且没有 `blocked` 组件进入发布包。
- `desktop-tests` 中有 Round 13 发布验收记录，可作为后续逐条修复入口。
- Round 13 结束时能给出明确结论：可以内部试用、需要补哪些 blocker、哪些非 blocker 延后。
