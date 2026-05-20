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

### 13.1 Inventory Result - 2026-05-17

当前分支：`codex/fast-sub-round13-release-readiness`。起点提交：`dc10f2e docs: plan round 13 release readiness`。

13.1 结论：当前仓库具备 Electron dev/build 输出、Go daemon 源码、Python CLI/worker 源码、Windows FFmpeg/aria2/whisper.cpp 运行时下载逻辑和 userData secret/config 存储，但尚未具备可发布打包形态。13.2 必须先补 packaged resource resolver 和 app 私有 Python runtime，再落 `electron-builder`。

#### Release artifacts and build outputs

| 项 | 当前状态 | Round 13 决策 / gap |
| --- | --- | --- |
| Electron dev run | `desktop/package.json` 提供 `npm run dev`，使用 `electron-vite dev` | 保留为开发入口，不作为 release artifact。 |
| Electron build output | `npm run build` 生成 `desktop/dist/main`、`desktop/dist/preload`、`desktop/dist/renderer` | 仅是 electron-vite build，不是 installer/portable/dmg。 |
| Packaging scripts | 当前没有 `package:dir` / `package` script，也没有 `electron-builder` 依赖 | 13.2 新增。 |
| Windows artifact | 未配置 | 13.2 固定 x64 installer + portable zip。 |
| macOS artifact | 未配置 | 13.2 固定 arm64 dmg；必须在 macOS host/runner 构建和 smoke。 |
| Artifact name | 未配置 | 建议 `FastSub-Desktop-0.13.0-windows-x64-*`、`FastSub-Desktop-0.13.0-macos-arm64.dmg`。 |
| App version | `desktop/package.json` 当前为 `0.11.0` | 13.2/13.7 需要明确是否升到 Round 13 release 版本。 |

#### Runtime resource inventory

| Runtime | 当前开发态来源 | 目标打包位置 | 当前 resolver | Gap |
| --- | --- | --- | --- | --- |
| Go daemon | `go run ./cmd/fast-sub-go` fallback，或 `FAST_SUB_GO`，或若干 cwd/app path 候选 `fast-sub-go(.exe)` | `desktop/resources/bin/<platform>-<arch>/fast-sub-go(.exe)`，打包后进入 `process.resourcesPath/bin/<platform>-<arch>/` | `desktop/main/client/daemonProcess.ts` 尚未使用 `process.resourcesPath` / platform-arch 目录 | 13.2 必须补 packaged resolver，并增加 build/copy 脚本生成平台 daemon。 |
| Python CLI bridge | 系统 `fast-sub`，或系统 `uv run fast-sub`，或 `FAST_SUB_PYTHON_CLI` | `desktop/resources/python/<platform>-<arch>/` app 私有 runtime + installed `fast-sub` entry | Go `runner_translate.go` 只解析 env/PATH/system uv | 13.2 必须由 Electron main 向 daemon env 注入 app 私有 `FAST_SUB_PYTHON_CLI`，不得要求系统 Python/uv/global CLI。 |
| Faster Whisper worker | 系统 `uv run --extra local-asr fast-sub-worker-faster-whisper`，或 `FAST_SUB_STT_WORKER_COMMAND` | 同一 app 私有 Python runtime | Go `worker/stt.go` 只解析 env/PATH/system uv | 13.2 必须注入 app 私有 `FAST_SUB_STT_WORKER_COMMAND` 并 smoke import `faster_whisper`。 |
| FFmpeg/FFprobe | Windows runtime download to `app.getPath("userData")/native-binaries/ffmpeg/bin`，或 PATH/package manager | userData runtime install；不随包分发，除非后续 license review 改变 | `nativeDependencies.ts` prepends userData bin to daemon env | Windows 可用；macOS 自动安装/检测路径未实现。 |
| aria2 | Windows runtime download to `userData/native-binaries/aria2/bin/aria2c.exe`，或 system PATH | userData runtime install；download-only | FFmpeg download helper only | Windows 加速器可回退 HTTPS；macOS 未实现。 |
| whisper.cpp binary | Windows runtime download to `userData/native-binaries/whisper-cpp/bin` | userData runtime install；download-only | Provider dependency installer only | Windows x64 only；macOS arm64 binary path/permission smoke 未实现。 |
| Models | Go-managed model store, default `%LOCALAPPDATA%/fast-sub/models` on Windows or `$XDG_DATA_HOME/fast-sub/models` / `~/.local/share/fast-sub/models` | 不进入 package；首次启动/模型页下载 | `models.DefaultStore()` | 13.4 从无默认模型环境验证默认小 ASR 和默认 NLLB 安装。 |
| Job store/logs | `jobs.NewManager("")` 默认相对 `.fast-sub/jobs` | 应落到 userData 或明确 daemon-owned app data path | `serve` 未向 daemon 传 `JobRoot`，Electron daemon cwd 决定实际位置 | 13.2/13.5 需要固定 packaged job/log root，避免写入 app bundle/resources/cwd。 |
| Config | Electron sets `FAST_SUB_GO_CONFIG` to `app.getPath("userData")/fast-sub-go.toml` | userData | 已有 | 保留；诊断页需展示摘要。 |
| Secret store | `app.getPath("userData")/provider-secrets` with Electron `safeStorage` | userData | 已有 | 13.5 验证导出/redaction，不迁移 raw secret。 |
| UI onboarding prefs | renderer `localStorage` key `fast-sub:onboarding-complete` | Electron profile storage | 已有 | 可保留为 UI-only preference；不得保存 secret。 |

#### Content that must not be packaged

- Real model files.
- Real media/subtitles/task outputs.
- Real benchmark reports.
- `.env`, local secret stores, `desktop/local/daemon-transport.log`, `local_tests/`, `.fast-sub/`, `.uv-cache/`, `.gocache/`, and userData contents.
- API keys, Authorization headers, daemon ready tokens, `secret_ref` values, signed URLs, proxy credentials.
- Any executable/native runtime inside ASAR.

#### License and notice inventory

Round 13 license inventory now starts at `THIRD_PARTY_NOTICES.md`. Current policy summary:

| Component group | Policy |
| --- | --- |
| Electron runtime and runtime npm dependencies | `bundle-ok`, with exact transitive lockfile notices to generate in 13.2. |
| Go daemon binary | `bundle-ok`, with Go license notice. |
| App private Python runtime | `needs-review` until source/version/reproducible build command are pinned. |
| Python site-packages | `needs-review` until lockfile license inventory is generated. |
| FFmpeg/FFprobe | `download-only` until variant/source-offer obligations are reviewed. |
| aria2 | `download-only`; do not bundle without GPL obligations review. |
| whisper.cpp binary | `download-only`. |
| Whisper / whisper.cpp models | `download-only`. |
| NLLB model | `download-only` / `needs-review` because manifest license is `CC-BY-NC-4.0`. |
| Secrets, real media, task outputs, bundled model files, executable inside ASAR | `blocked`. |

#### Packaging and runtime gap list

1. Add `electron-builder` config and scripts only after packaged runtime resolvers are defined.
2. Build/copy `fast-sub-go(.exe)` into `desktop/resources/bin/<platform>-<arch>/`.
3. Change Electron daemon resolver to prefer `process.resourcesPath/bin/<platform>-<arch>/fast-sub-go(.exe)` when packaged.
4. Add app-private Python runtime layout under `desktop/resources/python/<platform>-<arch>/`, with pinned source/version and install command.
5. Inject packaged `FAST_SUB_PYTHON_CLI` and `FAST_SUB_STT_WORKER_COMMAND` into daemon env; do not rely on system `python`, `uv`, or global `fast-sub`.
6. Set packaged job/log root explicitly under `app.getPath("userData")`, while preserving config and secret paths.
7. Keep FFmpeg/aria2/whisper.cpp outside ASAR and prefer userData runtime install; add macOS arm64 download/permission strategy or clear blocker.
8. Generate exact npm/Python transitive license report before package smoke is considered complete.
9. Ensure `desktop/local/`, logs, caches, model stores, local tests, `.env`, and task outputs are excluded from package files.

#### Minimal implementation order after 13.1

1. 13.2a: add resource layout and copy/build scripts for Go daemon and placeholder-checked Python runtime without changing daemon/UI API contract.
2. 13.2b: update Electron main runtime resolver/env injection for packaged daemon, Python CLI, STT worker, and job/log root.
3. 13.2c: add `electron-builder` config, `package:dir`, `package`, and artifact naming.
4. 13.2d: add license generation/check script or documented command, then run `typecheck`, `test`, `build`, `smoke`, `package:dir`, and package smoke.

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

### 13.2 Implementation Result - 2026-05-17

已完成：

- 新增 `desktop/main/client/runtimeResources.ts`，统一生成 `<platform>-<arch>` resource path。
- `DaemonProcessManager` packaged mode 现在优先从 `process.resourcesPath/bin/<platform>-<arch>/fast-sub-go(.exe)` 启动 daemon。
- packaged daemon cwd 设为 `app.getPath("userData")`，因此 daemon 默认 `.fast-sub/jobs` 不会写入 app bundle 或 install directory。
- `scrubbedEnv()` 在 app 私有 Python scripts 存在时注入 `FAST_SUB_PYTHON_CLI` 和 `FAST_SUB_STT_WORKER_COMMAND`，并把 Python scripts/bin 目录 prepend 到 daemon PATH。
- 新增 `desktop/scripts/prepare-release-resources.mjs`，构建 Go daemon 到 `desktop/resources/bin/<platform>-<arch>/`。
- 新增 `desktop/scripts/prepare-python-runtime.mjs`，显式使用 uv managed CPython 3.11 构造 app 私有 `desktop/resources/python/win32-x64/`，安装 `fast-sub[local-asr,local-translate]`，并验证 `fast-sub.exe`、`fast-sub-worker-faster-whisper.exe` 和 `fast_sub/faster_whisper/ctranslate2/sentencepiece` import。
- 新增 `desktop/scripts/clean-release-output.mjs`，让 `package:dir` / `package` 从干净 `dist-release` 开始，避免旧版本 artifact 污染 smoke。
- 新增 `desktop/scripts/smoke-packaged-runtime.mjs`，可重复验证 packaged app 启动、Go daemon ready JSON、ASAR 外 Python CLI/worker 和 Python imports。
- 新增 `electron-builder`、`prepare:python-runtime`、`smoke:packaged`、`package:dir` 和 `package` scripts。
- Windows target 固定为 x64 NSIS installer + zip portable。
- macOS config 固定为 arm64 dmg；本 Windows host 不能验收 macOS build/smoke。
- `THIRD_PARTY_NOTICES.md` 作为 package extraResource 进入 `resources/`。
- `prepare-release-resources` 默认拒绝缺 app 私有 Python runtime，避免生成依赖系统 Python/uv/global `fast-sub` 的 release package。仅可用 `FAST_SUB_RELEASE_ALLOW_MISSING_PYTHON=1` 做 shell-only packaging diagnostics。

当前 Windows 产物：

```text
desktop/dist-release/win-unpacked/
desktop/dist-release/FastSub-Desktop-0.13.0-windows-x64.exe
desktop/dist-release/FastSub-Desktop-0.13.0-windows-x64.zip
```

当前 packaged resources 验证：

- `resources/app.asar` 存在。
- `resources/bin/win32-x64/fast-sub-go.exe` 位于 ASAR 外。
- `resources/python/win32-x64/Scripts/fast-sub.exe` 位于 ASAR 外。
- `resources/python/win32-x64/Scripts/fast-sub-worker-faster-whisper.exe` 位于 ASAR 外。
- packaged app `FAST_SUB_SMOKE=1` 启动通过。
- packaged Go daemon `serve --json-ready --host 127.0.0.1 --port 0` ready smoke 通过，记录中不输出 token；`/v1/health` 返回 200，`/v1/config` 无 Authorization 返回 401，带 ready token 返回 200。
- packaged Python runtime `fast-sub.exe --version` 输出 `0.1.0`，worker `--help` 通过，`fast_sub/faster_whisper/ctranslate2/sentencepiece` import 通过。
- `npm run smoke:packaged` 通过，可作为 13.3 packaged runtime baseline。
- Windows portable zip 解压到独立目录后，设置 `FAST_SUB_PACKAGED_ROOT` 运行 `npm run smoke:packaged` 通过。

验证：

```powershell
go test ./...
cd desktop
npm run prepare:python-runtime
npm run typecheck
npm test
npm run build
npm run smoke
npm run package:dir
npm run package
npm run smoke:packaged
```

已知 13.2/13.3 风险：

- 当前 Windows app 私有 Python runtime 使用 uv managed CPython 3.11.15 + `fast-sub[local-asr,local-translate]` 直接安装到 portable runtime；macOS 对应 runtime 构造仍需在 macOS release host 上补齐。
- 当前 Windows package 使用 `win.signAndEditExecutable=true` 写入 icon/version resource，但按用户决策保持 unsigned；`Get-AuthenticodeSignature` 对 app exe 和 installer 均为 `NotSigned`。Windows unsigned 是当前 Round 13 Windows 发行形态，风险记录到 release checklist。
- 当前使用默认 Electron icon；正式试用包需要 app icon。
- Windows installer 和 portable zip 已用最新 RC artifact 复测：installer 静默安装、已安装 app daemon repair smoke、静默卸载通过；portable zip 解压到独立目录后用 `FAST_SUB_PACKAGED_ROOT` 执行 `npm run smoke:packaged` 通过。
- macOS arm64 dmg 只能在 macOS host 或 CI runner 验收。

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

### Round 13 Translation Batching Blocker

2026-05-19 用户实测长翻译任务会逐条提交，导致整体效率过慢并造成机器明显卡顿。该问题影响 packaged app 真实用户体验，因此纳入 Round 13 发布前 blocker，而不是延后到性能优化轮。

修复口径：

- `local-nllb-ct2` 桌面/daemon 任务默认使用 `--batch-size 32`。
- `api-openai-chat` 桌面/daemon 任务默认使用 `--batch-size 16`，降低请求次数，同时避免默认 prompt 过大。
- `web-bing` / `web-google` 默认保持 `--batch-size 1`，因为网页 provider 更容易被限流或卡住。
- daemon request 中显式传入的 `batch_size` 仍优先于默认值，便于后续 UI 设置或 smoke 手动覆盖到 10、100 等值。
- Python NLLB provider 批量失败时必须递归拆半降级，最后降到单条；大 batch 失败不得导致整批 cue 丢失。
- 进度和输出语义仍按 cue 数保持不变：cue 顺序、时间轴、TXT 逐行结构和 bilingual/replace 语义不变。

验证：

```powershell
$env:GOCACHE=(Join-Path (Get-Location) '.gocache'); go test ./internal/jobs
$env:UV_CACHE_DIR='.uv-cache'; $env:PYTHONPATH='src'; uv run pytest tests\test_translate.py -q
```

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

### 13.3 Implementation Result - 2026-05-17

已完成 packaged runtime baseline：

- 新增 `npm run smoke:packaged`，默认检查 `desktop/dist-release/win-unpacked`，也可用 `FAST_SUB_PACKAGED_ROOT` 指向解压后的 portable 目录。
- smoke 覆盖 packaged app `FAST_SUB_SMOKE=1` 启动、`app.asar` 存在、Go daemon/Python executable/CLI/worker 均位于 ASAR 外、daemon ready JSON、`/v1/health`、`/v1/config` 401/auth、Python CLI/worker/import checks。
- Windows portable zip 已解压到独立目录并通过 `FAST_SUB_PACKAGED_ROOT=<portable-dir> npm run smoke:packaged`。
- Python Provider 依赖动作已按 packaged runtime 策略收口：`local-faster-whisper` 和 `local-nllb-ct2` 不再尝试下载/安装 Python 依赖，按钮改为重新检查内置 runtime，main process 执行 daemon repair + static provider check；`local-whisper-cpp` 仍保留 native binary 安装路径。
- Electron main 现在向 daemon 注入 `FAST_SUB_PYTHON`，显式指向 app 私有 Python executable；Go provider static check 优先使用该 Python 做依赖 import 检查，避免 packaged app 因 PATH 或系统 Python/uv 漂移继续显示 `missing_dependency`。
- 新增 `npm run smoke:native-deps`，使用 packaged `dist-release/win-unpacked/Fast Sub.exe` 和隔离 userData 验证 native dependency 首装路径。2026-05-19 真实网络 smoke 结果已记录到 `desktop-tests/round13-release-smoke.md`：FFmpeg/FFprobe 首装通过，aria2 bootstrap + aria2 FFmpeg 下载通过，禁用 aria2 后普通 HTTPS fallback 通过，whisper.cpp Windows x64 binary 下载/解压/发布通过。
- `ensureWhisperCPPInstalled()` 首装状态修正为与 FFmpeg 一样的轮询语义，避免安装完成后 `installedNow/logs` 被二次静态检查覆盖；`npm run smoke:native-deps -- whisper-cpp` 验证 `available=true`、`installedNow=true`。
- `npm run smoke:packaged` 已增强 packaged daemon SSE 验证：在隔离 job root 创建受控失败 job，验证 SSE 连接可中断、终态 job 可通过 REST 重新查询，并通过裁剪 event log + `Last-Event-ID` 触发 `events_lost` replay gap。该 smoke 不访问真实模型、真实 ffmpeg、真实 whisper.cpp 或 GPU。
- `npm run smoke:packaged` 已增强 packaged daemon repair 验证：以无窗口 smoke 模式启动 packaged `Fast Sub.exe`，通过 Electron main 的 `DaemonProcessManager` 从 packaged resources 定位 Go daemon，在隔离 userData 下启动自管 daemon，执行 `repair()` 后确认新 daemon session health=200 且 pid 变化。
- Windows installer smoke 已通过：`FastSub-Desktop-0.13.0-windows-x64.exe` 静默安装到 `desktop/test-results/round13-installer/Fast Sub`，已安装 app 的 daemon repair smoke 通过，随后静默卸载且安装目录移除。
- 真实长任务退出 smoke 暴露旧安装包的 Python console script launcher 不可迁移：`fast-sub-worker-faster-whisper.exe` 会启动构建目录下的 Python，退出 app 后残留 `fast-sub.exe` / `python.exe`。已修复为 packaged runtime 使用 `python.exe -m fast_sub.app` 和 `python.exe -m fast_sub_workers.faster_whisper`，并让 `python -m fast_sub.app` 可直接进入 CLI。新 installer/zip 已重新生成并通过 `npm run smoke:packaged`；新包真实本地 Faster Whisper 长任务复测通过，运行中 worker 子 Python 来自安装目录，退出 app 后无 daemon/worker/Python/native 残留。

仍待 13.3 手动或后续自动化验证：

- Windows/macOS 跨机器复测可作为发布候选补充记录；当前 Windows 13.3 blocker 项已通过。

### 13.4 Implementation Result - 2026-05-19

已完成 Windows x64 packaged real provider/file smoke，结果写入 `desktop-tests/round13-release-smoke.md`：

- 默认本地 ASR blocker 通过：packaged `fast-sub-go.exe` 使用 app 私有 Python worker、`local-faster-whisper`、`whisper-small`、CPU，对 `local_tests/media/light/en-podcast-1m.wav` 生成 SRT，15 segments，未依赖 API/mock/system Python/uv。
- Native ASR 通过：app 私有 whisper.cpp binary + `whispercpp-large-v3-turbo-q5_0` 对同一小音频生成 SRT，13 segments。
- 本地翻译通过：packaged Python bridge + `local-nllb-ct2` + `nllb-200-distilled-600m-ct2-int8` 完成小 SRT 翻译；daemon `translate_srt` 对 TXT 输入输出逐行翻译并保留空行。
- 双语字幕通过：单个 daemon `transcribe` job 内完成 `local-faster-whisper` 转写和 `local-nllb-ct2` 翻译，输出双语 SRT。
- burn-in 通过：daemon `burn_in` 使用 app 私有 FFmpeg 输出硬字幕 MP4，未记录 raw command、daemon token 或敏感 header。
- 路径兼容通过：中文、日文、韩文和空格路径下的本地 Faster Whisper ASR 输出路径和文件名正常。
- 本地 OpenAI-compatible blocker 通过：启动本机 loopback mock `http://127.0.0.1:8765/v1`，无 API key，分别验证 `api-openai-transcription` 和 `api-openai-chat`；该 smoke 不访问真实 OpenAI，不产生费用，不记录 Authorization。
- 默认模型安装通过：先前 `nllb-200-distilled-600m-ct2-int8` 从 missing 安装并 verify 通过；随后使用隔离 `FAST_SUB_MODEL_STORE_DIR=desktop/test-results/round13-clean-model-store-20260519` 从空 store 安装并 verify `whisper-small` 和 `nllb-200-distilled-600m-ct2-int8`，两者均 4 files verified。该复测未删除用户当前模型 store。

未纳入默认阻塞项：

- 真实 OpenAI/Bing/Google external record 按用户决策不执行，记录为 `DEFER`；这些结果不默认阻塞本地桌面发布。
- GPU 长任务取消已在 Windows installed package 上手动执行并通过：运行中 `nvidia-smi` 显示 packaged `python.exe` 为 compute 进程；退出/取消清理路径取消后立即和 8 秒后复查均无 Fast Sub daemon/worker/Python/native 残留；应用内取消路径取消后 app/daemon 按预期保持运行，但 packaged worker 退出，立即和 8 秒后均无 packaged Python/GPU compute 进程回弹。
- 翻译模型失败降级已补充：新增 `npm run smoke:translation-model-failure`，以 packaged daemon + 隔离空 `FAST_SUB_MODEL_STORE_DIR` 创建 `local-nllb-ct2` `translate_srt` job，确认缺默认 NLLB 翻译模型时翻译路径以 `missing_model` 失败；原字幕生成由默认 ASR packaged smoke 覆盖且不依赖翻译模型。

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

Secret storage smoke 已补齐：Provider 页支持保存、替换、删除 API key；Electron main 删除 safeStorage secret record 后将对应 Provider key 状态恢复为 `missing`。Renderer 测试覆盖保存/替换后输入框清空，页面文本不保留 raw `sk-*` secret。

### 13.5 Implementation Result - 2026-05-19

已完成第一轮诊断隐私 polish：

- 设置 -> 诊断页不再显示静态 sample log，不再出现 `credential=` / `api_key=` 示例文本。
- 诊断页改为展示当前 `EnvironmentStatus` 摘要：health、platform/arch、daemon、FFmpeg、model store、本地转写、本地翻译、warnings 和 error diagnostic。
- warnings、error diagnostic 和 FFmpeg log tail 在 renderer 侧再次经过 `redactSecretText()`；页面固定展示“敏感信息：已脱敏”。
- 验证：`cd desktop && npm run typecheck`；`cd desktop && npm test -- App.test.tsx -t "shows task queue and settings entrances"`；`cd desktop && npm run build`。Vitest/build 在默认 Windows sandbox 中仍会因 esbuild 读 config 权限失败，按当前权限机制提升后通过。

仍待 13.5/13.6 补充：

- 失败详情页的 redacted diagnostic 行为需要在真实失败样本或 targeted test 中复查。
- 主流程、Provider 页、完成页和失败页仍需 13.6 screenshot/E2E baseline，确认不显示 daemon token、SSE、job id、JSON envelope 或 raw command。

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

### 13.6 Implementation Result - 2026-05-19

已新增 `desktop-tests/pics/round13/README.md` 作为 Round 13 screenshot baseline manifest，覆盖：

- 首次启动环境检查。
- 主界面空状态。
- 添加真实媒体后的主界面。
- 真实 job 生成中。
- 完成页。
- 失败任务详情。
- 模型管理。
- Provider 设置。
- 诊断页。
- English UI smoke。

每张截图都写明不得包含 API key、Authorization、daemon token、secret_ref、signed URL、proxy credential、完整私有路径、真实客户媒体名或真实任务产物。2026-05-19 已捕获 10 张 GUI screenshot baseline：`01-setup-check.png` 到 `10-english-ui.png`；`desktop-tests/pics/round13/README.md` 和 `desktop-tests/round13-release-smoke.md` 已同步为 PASS。

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

### 13.7 Implementation Result - 2026-05-19

已新增 `desktop-tests/round13-release-checklist.md`，覆盖：

- release scope、版本、分支、artifact 名称和平台范围。
- 自动化验证命令与当前结果。
- Windows installer/portable、packaged daemon、真实本地 provider/file smoke 汇总。
- 隐私和 secret 策略。
- runtime distribution 和 cleanup 说明。
- 发布前 blockers：macOS arm64 dmg smoke。Windows x64 当前按 unsigned artifact 发行，签名不是本轮 blocker，但会产生 SmartScreen/安全软件声誉风险。

### Windows Icon And Signing Decision - 2026-05-19

Windows artifacts are accepted as unsigned builds for Round 13 by user decision. Public distribution signing is deferred until a real code-signing certificate and publisher identity are available; the release checklist records SmartScreen and antivirus reputation risk instead of treating signing as a current blocker.

- App icon source: `desktop/build/icon.png`.
- Windows icon: `desktop/build/icon.ico`.
- Electron builder config: `win.icon=build/icon.ico`.
- `win.signAndEditExecutable=true` so electron-builder can write icon and version resources even though no certificate is configured.
- `Get-AuthenticodeSignature desktop/dist-release/win-unpacked/Fast Sub.exe` reports `NotSigned`.
- Version resource check reports ProductName/FileDescription/CompanyName `Fast Sub`, FileVersion `0.13.0`, ProductVersion `0.13.0.0`.
- Verification: `cd desktop && npm run package:dir`.

### License Inventory Finalization - 2026-05-19

已新增 `desktop/scripts/generate-license-inventory.mjs` 并生成 `desktop-tests/licenses/` 下的 release license reports：

- `npm-licenses.json`：来自 `desktop/package-lock.json`，571 packages，0 `needs-review`，0 `blocked`。
- `python-licenses.json`：来自 packaged app private Python `*.dist-info/METADATA`，47 packages，0 `needs-review`，0 `blocked`。`sentencepiece` 使用 upstream Apache-2.0 evidence override；`typing_extensions` 使用 PSF-2.0。
- `go-licenses.md`：`go.mod` 当前无外部 Go modules，Go standard library only。
- `license-summary.json`：汇总 618 records，51 `bundle-ok`，567 `manual-user-install`，0 `needs-review`，0 `blocked`。

`THIRD_PARTY_NOTICES.md` 已同步 generated report 路径、Python runtime 版本和 package content scan。`desktop/dist-release/win-unpacked/resources` 顶层只包含 `bin`、`python`、`app.asar`、`elevate.exe` 和 notice 文件；未发现 model store、userData、`local_tests`、`test-results`、`.env` 或 daemon ready token 入包。NLLB 模型仍是 runtime `download-only / needs-review`，因为它不随包分发且带 CC-BY-NC-4.0 使用限制。

该 checklist 是当前 release candidate 审核入口；它明确区分 Windows x64 已通过路径、非默认阻塞 external records，以及仍需手动或跨平台补齐的 blocker。

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
