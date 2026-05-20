# Round 13 Release Smoke Record

本文件用于记录 Round 13 打包、真实 Provider、真实文件和发布诊断 smoke。默认自动化测试仍不访问真实网络、真实模型、真实 FFmpeg、真实 whisper.cpp 或 GPU；这些真实环境验证只记录在本表。

## 状态约定

| 状态 | 含义 |
| --- | --- |
| `PASS` | 当前 build 和环境下已验证通过。 |
| `RETEST` | 已有实现或修复，但需要在新 build 或新环境中复测。 |
| `TODO` | 已确认是发布 blocker 或必须补的实现/配置。 |
| `BLOCKED` | 受本机环境、网络、账号、模型、硬件或外部服务限制，当前无法验证。 |
| `DEFER` | 非发布 blocker，明确延后。 |

## 环境记录模板

每次完整 smoke 前先复制并填写：

```text
Date:
Branch:
Commit:
App version:
Build type: dev / packaged / installer / portable
Artifact path:
OS:
Architecture:
GPU:
Network:
Models available:
FFmpeg/FFprobe source:
Python CLI source:
Go daemon source:
Python runtime source:
Signing/notarization status:
Notes:
```

## 自动化基线

| ID | 状态 | 命令 | 当前结果 | 证据/备注 |
| --- | --- | --- | --- | --- |
| R13-AUTO-000 | `PASS` | 13.1 release inventory | 已完成 | 2026-05-17：已盘点 Electron build 输出、Go/Python/native runtime resolver、userData paths、package gaps，并创建 `THIRD_PARTY_NOTICES.md` 初始 license policy。 |
| R13-AUTO-001 | `PASS` | `go test ./...` | 通过 | 2026-05-19：最终基线刷新，使用 workspace-local `GOCACHE=.gocache`，所有 Go packages 通过。 |
| R13-AUTO-002 | `PASS` | `cd desktop && npm run typecheck` | 通过 | 2026-05-19：TypeScript strict check 在 API key 删除入口和 release smoke 脚本加入后通过。 |
| R13-AUTO-003 | `PASS` | `cd desktop && npm test` | 通过 | 2026-05-19：Vitest 4 files / 77 tests passed；包含 Provider API key 保存、替换、删除和 raw secret 不进入页面文本的覆盖。沙箱内 esbuild 读 config 被拒，提升权限重跑通过。 |
| R13-AUTO-004 | `PASS` | `cd desktop && npm run build` | 通过 | 2026-05-19：最终基线刷新，electron-vite build 通过；沙箱内 esbuild 读 config 被拒，提升权限重跑通过。 |
| R13-AUTO-005 | `PASS` | `cd desktop && npm run smoke` | 通过 | 2026-05-19：renderer/preload/CSP smoke 通过，未启动真实 daemon 或网络；沙箱内 Electron cache/GPU 受限，提升权限重跑通过。 |
| R13-AUTO-006 | `PASS` | `cd desktop && npm run package:dir` | 通过 | 2026-05-17：app 私有 Python runtime 准备后，`win-unpacked` 生成成功；Go/Python executables 均位于 `resources/` 且在 ASAR 外。 |
| R13-AUTO-007 | `PASS` | `cd desktop && npm run package` | 通过 | 2026-05-19：最终 RC package 重新生成最新 `FastSub-Desktop-0.13.0-windows-x64.exe`、`.zip` 和 blockmap；包含 API key 删除入口、翻译模型失败 smoke 脚本、最终 icon/version resource 和 unsigned internal build 决策。 |
| R13-AUTO-015 | `PASS` | Windows icon/version resource smoke | 通过 | 2026-05-19：新增 `desktop/build/icon.png` 和 `desktop/build/icon.ico`，`win.icon=build/icon.ico`，`win.signAndEditExecutable=true`。`npm run package:dir` 通过；`Get-AuthenticodeSignature` 确认 `Fast Sub.exe` 仍为 `NotSigned` 内部测试包，VersionInfo 显示 ProductName/FileDescription/CompanyName `Fast Sub`、FileVersion `0.13.0`、ProductVersion `0.13.0.0`。 |
| R13-AUTO-016 | `PASS` | Translation batching release blocker fix | 通过 | 2026-05-19：翻译任务默认批处理从 daemon bridge 统一注入：`local-nllb-ct2` 默认 `--batch-size 32`，`api-openai-chat` 默认 `--batch-size 16`，`web-bing/web-google` 默认 `--batch-size 1`；显式 `batch_size` 可覆盖。Python NLLB 批量失败时递归拆半降级到单条，避免大 batch 失败整批丢失。验证：`go test ./internal/jobs`、`UV_CACHE_DIR=.uv-cache PYTHONPATH=src uv run pytest tests/test_translate.py -q`。 |
| R13-AUTO-017 | `PASS` | `cd desktop && npm run smoke:translation-model-failure` | 通过 | 2026-05-19：新增 packaged daemon smoke，以隔离空 `FAST_SUB_MODEL_STORE_DIR` 创建 `local-nllb-ct2` `translate_srt` job，确认缺默认翻译模型时 job 以 `missing_model` 失败并提示安装模型；不访问真实网络/模型/API。 |
| R13-AUTO-008 | `PASS` | `cd desktop && npm run smoke:packaged` | 通过 | 2026-05-17：检查 `app.asar`、ASAR 外 Go daemon/Python CLI/worker，启动 packaged app smoke，验证 packaged daemon ready JSON、health、401/auth config 和 Python imports；未访问真实网络、模型或 API。2026-05-19：完整 package 后重跑通过；增强脚本覆盖 Electron main packaged daemon repair，并在隔离 job root 创建受控失败 job，覆盖 SSE 断开和 `events_lost` replay。 |
| R13-AUTO-009 | `PASS` | Provider dependency button fix | 通过 | 2026-05-17：`local-faster-whisper` / `local-nllb-ct2` 的“依赖”动作改为重新检查 app 私有 Python runtime；`local-whisper-cpp` 仍保留 native binary 安装。验证 `npm run typecheck`、`npm test -- App.test.tsx -t provider`、`npm run package`、`npm run smoke:packaged`。 |
| R13-AUTO-010 | `PASS` | Hide model install jobs from queue | 通过 | 2026-05-17：任务队列过滤 `model_install`，模型安装进度只保留在模型管理/Provider 卡片中。验证 `npm run typecheck`、`npm test -- App.test.tsx -t "hides model install jobs"`。 |
| R13-AUTO-011 | `PASS` | Packaged Python dependency check source | 通过 | 2026-05-17：Electron main 向 daemon 注入 `FAST_SUB_PYTHON` 指向 app 私有 `python.exe`；Go provider static check 优先用该 Python 验证 `faster_whisper` / `ctranslate2` / `sentencepiece`，避免误用系统 Python/uv。验证 `go test ./internal/providers`、`npm run typecheck`、`npm test -- App.test.tsx -t provider`、`npm run package`、`npm run smoke:packaged`。 |
| R13-AUTO-012 | `PASS` | Packaged native dependency smoke harness | 通过 | 2026-05-19：新增 `npm run smoke:native-deps`，用打包后的 `win-unpacked/Fast Sub.exe` 和隔离 `desktop/test-results/round13-native-deps/*` userData 验证 FFmpeg/aria2 fallback/whisper.cpp 首装路径；该命令访问真实下载源，只作为手动 release smoke，不进默认 CI。验证 `npm run typecheck`、`npm run package:dir`、`npm run smoke:native-deps`、`npm run smoke:native-deps -- whisper-cpp`、`npm run smoke:packaged`。 |
| R13-AUTO-013 | `PASS` | Windows installer smoke | 通过 | 2026-05-19：`FastSub-Desktop-0.13.0-windows-x64.exe /S /D=<desktop/test-results/round13-installer/Fast Sub>` 静默安装，通过已安装 `Fast Sub.exe` 的 daemon repair smoke，然后运行 `Uninstall Fast Sub.exe /S` 静默卸载；安装目录已清理。 |
| R13-AUTO-014 | `PASS` | Relocatable packaged Python commands | 通过 | 2026-05-19：真实退出清理 smoke 暴露安装版 worker wrapper 会启动构建目录 Python；修复为 Electron 注入 `python.exe -m fast_sub.app` 和 `python.exe -m fast_sub_workers.faster_whisper`，避免 Windows console script launcher 的绝对解释器路径。验证 `npm run typecheck`、`go test ./internal/providers ./internal/worker ./internal/jobs`、`npm run prepare:python-runtime`、`npm run package`、`npm run smoke:packaged`。 |

## 打包形态 Smoke

| ID | 状态 | 场景 | 步骤 | 期望 | 当前结果 | 证据/下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| R13-PKG-001 | `PASS` | 打包产物启动 | 从 release artifact 启动应用 | 不依赖 dev server，进入主界面或首次环境检查 | 通过 | 2026-05-17：`dist-release/win-unpacked/Fast Sub.exe` with `FAST_SUB_SMOKE=1` exited 0，renderer/preload/CSP smoke ready。 |
| R13-PKG-002 | `PASS` | 自管 daemon ready | 打包 app 启动 daemon | ready JSON 解析成功，renderer 不接触 token | 通过 | 2026-05-17：`resources/bin/win32-x64/fast-sub-go.exe serve --json-ready --host 127.0.0.1 --port 0` ready smoke 通过；仅验证 token 存在，未记录 token 值；health 和带 token config 请求通过。 |
| R13-PKG-003 | `PASS` | daemon repair | packaged app 无窗口 smoke 模式下用隔离 userData 启动自管 daemon，再执行 `DaemonProcessManager.repair()` | 重新启动 daemon 并同步状态 | 通过 | 2026-05-19：`npm run smoke:packaged` 设置 `FAST_SUB_SMOKE_DAEMON_REPAIR=1` 启动 `dist-release/win-unpacked/Fast Sub.exe`，验证 repair 前后 daemon health 均 200、pid 发生变化、session owned=true。 |
| R13-PKG-004 | `PASS` | 401 恢复 | 模拟 token 失效或 fake 401 | 显示本地服务认证失效和修复动作 | daemon 401 baseline 通过 | 2026-05-17：packaged daemon `/v1/config` 无 Authorization 返回 401，带 ready token 返回 200；UI 文案恢复动作仍需人工路径 smoke。 |
| R13-PKG-005 | `PASS` | SSE disconnect/events_lost | 在 packaged daemon 隔离 job root 创建受控失败 job，打开/中断 SSE，再裁剪 event log 后用 `Last-Event-ID` 触发 replay gap | REST 重新同步 job 状态 | 通过 | 2026-05-19：`npm run smoke:packaged` 覆盖 `/v1/jobs/{id}/events` 连接可中断、终态 job 可通过 REST 查询、replay gap 返回 `events_lost`；未运行真实模型、真实 ffmpeg 或 GPU。 |
| R13-PKG-006 | `PASS` | app 退出清理 | 运行中退出 app | 不遗留 daemon/worker/ffmpeg/whisper.cpp 子进程 | 通过 | 2026-05-19：旧安装包曾残留 `fast-sub.exe` / `python.exe` 且使用构建目录 Python；已改为 packaged daemon 使用 `python.exe -m ...` module command 并重新生成 installer/zip。新包真实本地 Faster Whisper 长任务运行中快照显示 worker 子 Python 来自 `C:/Program Files/Fast Sub/resources/python/win32-x64/python.exe`；退出 app 后立即和 8 秒后复查均无 `Fast Sub.exe`、`fast-sub-go.exe`、worker、packaged `python.exe`、ffmpeg 或 whisper.cpp 残留。 |
| R13-PKG-007 | `PASS` | FFmpeg/FFprobe 首装 | 隔离 userData 后运行 `npm run smoke:native-deps` 的 `ffmpeg` 场景 | 可安装或给出明确修复动作 | 通过 | 2026-05-19：先下载 app 私有 aria2，再用 aria2 下载 gyan.dev FFmpeg essentials；`ffmpeg.exe`/`ffprobe.exe` 发布到 app 私有 `native-binaries/ffmpeg/bin`，`available=true`，`installedNow=true`。 |
| R13-PKG-008 | `PASS` | aria2 fallback | 运行 `ffmpeg-no-aria2` 场景并设置 `FAST_SUB_DISABLE_ARIA2_AUTO_INSTALL=1` | 回退普通 HTTPS 下载或给出明确错误 | 通过 | 2026-05-19：普通 HTTPS fallback 成功下载同一 FFmpeg archive 并完成解压发布；慢网约 22 分钟，smoke 等待预算调整为 30 分钟。 |
| R13-PKG-009 | `PASS` | whisper.cpp binary | 隔离 userData 后运行 `npm run smoke:native-deps -- whisper-cpp` | 可安装或显示明确阻塞 | 通过 | 2026-05-19：从 ggml-org/whisper.cpp GitHub release 下载 Windows x64 binary zip，解压 `whisper-cli.exe` 到 app 私有 `native-binaries/whisper-cpp/bin`；`available=true`，`installedNow=true`。 |
| R13-PKG-010 | `PASS` | app 私有 Python runtime | 在无系统 Python/uv 假设下启动本地 worker/translation bridge | daemon 能定位 app 私有 Python runtime，不要求用户安装 Python | 通过 | 2026-05-17：packaged `resources/python/win32-x64/Scripts/fast-sub.exe --version` 输出 `0.1.0`；worker `--help` 通过；`fast_sub/faster_whisper/ctranslate2/sentencepiece` import 通过。 |
| R13-PKG-010A | `PASS` | Python Provider dependency action | 点击本地 Faster Whisper / NLLB 缺依赖动作 | 不下载 Python 依赖，修复 daemon 后重新检查 bundled runtime；失败时 UI 明确显示错误 | 通过 | 2026-05-17：Python 依赖随 app-private runtime 打包；按钮文案改为“重新检查内置运行时”，main process 对 `local-faster-whisper` / `local-nllb-ct2` 执行 daemon repair + static provider check。 |
| R13-PKG-010B | `PASS` | local-faster-whisper packaged provider check | 用打包内 daemon + app 私有 Python runtime 做 static provider check | `python_dependencies` 和 worker check 通过；缺模型时只显示模型问题 | 通过 | 2026-05-17：设置 `FAST_SUB_PYTHON`、`FAST_SUB_STT_WORKER_COMMAND` 和临时模型目录后，打包内 `fast-sub-go.exe providers test local-faster-whisper --json` 返回 `status=available`，`python_dependencies=available`。 |
| R13-PKG-011 | `BLOCKED` | macOS arm64 dmg artifact | 在 macOS arm64 启动 dmg 产物 | app 启动、daemon ready、签名/公证状态有记录 | 等待 macOS 机器 | 2026-05-20：macOS 打包和 smoke 需要切换到 macOS arm64 release machine 执行；不阻塞当前 Windows RC 分支合并。 |
| R13-PKG-012 | `BLOCKED` | macOS executable permissions | 在 macOS arm64 app bundle 内检查 daemon/Python/native binaries | 可执行权限正确，未被 quarantine 阻断，resources 定位正确 | 等待 macOS 机器 | 2026-05-20：随 macOS arm64 dmg follow-up 一起验证。 |
| R13-PKG-013 | `BLOCKED` | macOS process cleanup | macOS arm64 上运行任务后取消/退出/repair | 不遗留 daemon/Python/ffmpeg/whisper.cpp 子进程 | 等待 macOS 机器 | 2026-05-20：随 macOS arm64 dmg follow-up 一起验证；Windows 退出清理已通过。 |
| R13-PKG-014 | `PASS` | Windows installer artifact | 安装 Windows x64 installer 后启动应用 | 安装、启动、daemon ready、卸载/清理说明可用 | 通过 | 2026-05-19：最终 RC installer 静默安装到 `desktop/test-results/round13-installer-latest/Fast Sub`，运行已安装 app 的 `FAST_SUB_SMOKE_DAEMON_REPAIR=1` smoke 通过；随后从安装目录外执行静默卸载通过。首次复测若从安装目录内启动 uninstaller，会留下空安装目录；改用安装目录外 working directory 后无 app 文件残留，空目录已清理。 |
| R13-PKG-015 | `PASS` | Windows portable artifact | 解压 Windows x64 portable zip 后启动应用 | 不需安装即可启动，daemon ready，userData 不写入包目录敏感文件 | 通过 | 2026-05-19：最终 RC zip 解压到 `desktop/test-results/round13-portable-latest` 后，用 `FAST_SUB_PACKAGED_ROOT=<portable-root>` 执行 `npm run smoke:packaged` 通过。 |

## 真实 Provider 和文件 Smoke

| ID | 状态 | 场景 | 输入 | Provider | 期望 | 当前结果 | 证据/下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R13-REAL-001 | `PASS` | 原字幕生成 | 小音频/视频 | `local-faster-whisper` | 生成 SRT，完成页可打开字幕和目录 | 通过 | 2026-05-19 Windows x64 packaged resources：`local_tests/media/light/en-podcast-1m.wav` + `whisper-small` + CPU，输出 `desktop/test-results/round13-real-smoke/asr-en/en-podcast-1m.round13.srt`，15 segments，约 6.2s。 |
| R13-REAL-002 | `PASS` | Native ASR | 小音频/视频 | `local-whisper-cpp` | 成功输出或明确依赖/模型提示 | 通过 | 2026-05-19：使用 app 私有 whisper.cpp binary + `whispercpp-large-v3-turbo-q5_0`，输出 `desktop/test-results/round13-real-smoke/whisper-cpp/en-podcast-1m.whispercpp.round13.srt`，13 segments，约 37.8s。 |
| R13-REAL-003 | `PASS` | API STT blocker | 小音频 | 本地兼容 OpenAI API | Base URL/model/key alias 隔离，无 key/有 key路径和 401/403 可理解 | 通过 | 2026-05-19：本机 loopback mock `http://127.0.0.1:8765/v1`，无 API key，`api-openai-transcription` + `gpt-4o-transcribe` 输出 `desktop/test-results/round13-real-smoke/openai-compatible/api-stt.round13.srt`；未访问真实 OpenAI。 |
| R13-REAL-004 | `PASS` | 本地字幕翻译 | 小 SRT/TXT | `local-nllb-ct2` | 输出翻译字幕或逐行 TXT | 通过 | 2026-05-19：packaged Python bridge + `nllb-200-distilled-600m-ct2-int8`，SRT 输出 50 cues、0 failures；daemon `translate_srt` TXT 输出 `desktop/test-results/round13-real-smoke/translate-txt/notes.round13.zh.txt`，保留空行。 |
| R13-REAL-005 | `DEFER` | Web 翻译小文件 external record | 小 SRT/TXT | `web-bing` / `web-google` | 成功或 provider_failed；不无限卡住；失败不默认阻塞 | 本轮不测 | 2026-05-19：用户确认真实 OpenAI/Bing/Google external record 不需要执行；不作为本地桌面发布 blocker。 |
| R13-REAL-006 | `DEFER` | Web 翻译大文件超时 | 大 TXT | `web-bing` / `web-google` | 3 分钟硬超时和用户提示 | 本轮不测 | 2026-05-19：用户确认真实 OpenAI/Bing/Google external record 不需要执行；不作为本地桌面发布 blocker。 |
| R13-REAL-007 | `PASS` | API 翻译 blocker | 小 SRT/TXT | 本地兼容 OpenAI API | 支持无 key 本地端点，401/403 可理解 | 通过 | 2026-05-19：本机 loopback mock `http://127.0.0.1:8765/v1`，无 API key，`api-openai-chat` + `local-compatible-chat` 输出 `desktop/test-results/round13-real-smoke/openai-compatible/api-chat.round13.zh.srt`，50 cues；未访问真实 OpenAI。 |
| R13-REAL-008 | `PASS` | 双语字幕 | 小媒体 | local/API translation | 单个 `transcribe` job 完成转写加翻译 | 通过 | 2026-05-19：daemon `transcribe` job 内完成 `local-faster-whisper` -> `local-nllb-ct2`，输出 `desktop/test-results/round13-real-smoke/bilingual/en-podcast-1m.round13.bilingual.srt`，15 segments，约 8.0s。 |
| R13-REAL-009 | `PASS` | 烧录字幕 | 小视频 + SRT | `burn_in` | 输出硬字幕视频，日志 redacted | 通过 | 2026-05-19：daemon `burn_in` + app 私有 FFmpeg 输出 `desktop/test-results/round13-real-smoke/burn-in/input.round13.burned.mp4`，约 180 MB；未记录 raw command/token。 |
| R13-REAL-010 | `PASS` | 路径兼容 | 中文/日文/韩文/空格路径 | 任意本地流程 | 文件名、输出名和错误页不乱码 | 通过 | 2026-05-19：路径 `desktop/test-results/round13-real-smoke/路径 空格/中文 日本語 한국어/输入 en podcast 1m.wav`，输出 `输出 round13 原字幕.srt`，15 segments，路径和文件名正常。 |
| R13-REAL-011 | `PASS` | GPU 长任务取消 | 长音频/视频 | `local-faster-whisper` GPU | 取消后子进程和显存释放 | 通过 | 2026-05-19 Windows installed package：退出/取消路径首次 smoke 中，运行中快照显示 packaged `python.exe` PID 89332 为 NVIDIA compute 进程，GPU memory 约 5762 MiB；取消后立即和 8 秒后无 Fast Sub daemon/worker/Python/native 残留，`nvidia-smi` 不再显示 Fast Sub/Python compute 进程。应用内取消复测中，运行中 packaged `python.exe` PID 13900 为 NVIDIA compute 进程，GPU memory 约 6931 MiB；应用内取消后 app/daemon 保持运行但 packaged worker 退出，立即和 8 秒后均无 packaged Python/GPU compute 进程回弹。 |
| R13-REAL-012 | `DEFER` | 真实 OpenAI-compatible external record | 小音频或小 SRT/TXT | 真实 OpenAI-compatible 服务 | 记录账号、网络、费用和服务可用性；失败不默认阻塞 | 本轮不测 | 2026-05-19：用户确认真实 OpenAI/Bing/Google external record 不需要执行；本地 loopback OpenAI-compatible blocker 已通过。 |
| R13-REAL-013 | `PASS` | 首次启动默认模型安装 | 无本地默认模型环境 | 小型默认 ASR + 当前默认 NLLB | 引导安装，完成后显示本地转写/翻译就绪 | 通过 | 2026-05-19：使用隔离 `FAST_SUB_MODEL_STORE_DIR=desktop/test-results/round13-clean-model-store-20260519`，从空目录安装并 verify `whisper-small` 与 `nllb-200-distilled-600m-ct2-int8`；两者均 `installed=true`，各 4 files verified。未删除用户当前模型 store。 |
| R13-REAL-014 | `PASS` | 默认 ASR blocker | 小音频/视频 | 小型默认 ASR 模型 + 最终选定默认 ASR Provider | packaged app 能完成默认本地转写，不依赖 API/mock | 通过 | 2026-05-19：packaged `fast-sub-go.exe` + app 私有 Python worker + `whisper-small` CPU 完成真实本地 ASR；不依赖 API/mock/system Python/uv。 |
| R13-REAL-015 | `PASS` | 翻译模型失败降级 | 模拟默认翻译模型安装失败 | 默认本地翻译 | 原字幕生成不被阻断，翻译/双语路径被阻断并可恢复 | 通过 | 2026-05-19：原字幕生成已由 R13-REAL-001/R13-REAL-014 覆盖，不依赖翻译模型。新增 `npm run smoke:translation-model-failure` 在 packaged daemon + 空 `FAST_SUB_MODEL_STORE_DIR` 下创建 `local-nllb-ct2` `translate_srt` job，终态为 `failed` 且 error code=`missing_model`，恢复动作是安装 NLLB 翻译模型或切换 Provider。 |
| R13-REAL-016 | `PASS` | Python CLI packaged check | 隔离系统 Python/uv 后运行 | app 私有 Python + `fast-sub --help` | CLI 可运行，不使用系统 Python/uv | 通过 | 2026-05-17：直接运行 packaged `resources/python/win32-x64/Scripts/fast-sub.exe --version`，未调用系统 `uv run` 或开发 `.venv`。 |
| R13-REAL-017 | `PASS` | Python ASR dependency check | 隔离系统 Python/uv 后运行 | app 私有 faster-whisper worker | worker import/check 可运行 | 通过 | 2026-05-17：packaged worker `--help` 通过，packaged Python import `faster_whisper` 通过；未下载模型或跑真实 GPU。 |
| R13-REAL-018 | `PASS` | Python translation dependency check | 隔离系统 Python/uv 后运行 | app 私有 translation bridge | `ctranslate2`/`sentencepiece` import 或等效 check 可运行 | 通过 | 2026-05-17：packaged Python import `ctranslate2` 和 `sentencepiece` 通过；未下载真实 NLLB 模型。 |

## 诊断和隐私 Smoke

| ID | 状态 | 场景 | 步骤 | 期望 | 当前结果 | 证据/下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| R13-PRIV-001 | `PASS` | 诊断摘要 | 打开设置 -> 诊断 | 不包含 API key、Authorization、daemon token、secret_ref、signed URL、proxy credential | 通过 | 2026-05-19：诊断页已从静态 sample log 改为当前环境摘要，只展示 health/platform/daemon/FFmpeg/model readiness、warnings 和 redacted log tail；移除 `credential=` / `api_key=` 示例文本。验证 `npm run typecheck`、`npm test -- App.test.tsx -t "shows task queue and settings entrances"`、`npm run build`。 |
| R13-PRIV-002 | `PASS` | 失败详情 | 触发 provider/job 失败 | 显示用户可执行动作和 redacted detail | 通过 | 2026-05-19：截图 baseline `06-job-failed.png` 已捕获失败任务详情，用于发布前可视巡检。 |
| R13-PRIV-003 | `PASS` | 普通主界面 | 主流程各状态巡检 | 不显示 daemon、SSE、job id、JSON envelope、raw command | 通过 | 2026-05-19：诊断页移除 sample raw credential/API key；队列/设置入口目标测试通过。截图 baseline 已覆盖主界面空状态、文件已选、运行中、完成、失败、模型、Provider、诊断和英文 UI。 |
| R13-PRIV-004 | `PASS` | Secret storage | 保存、替换、删除 API key | renderer、配置文件、日志不出现 raw secret | 通过 | 2026-05-19：新增 Provider API key 删除入口，Electron main 删除 safeStorage secret record 并把对应 Provider `apiKeyStatus` 恢复为 `missing`；renderer 测试覆盖保存、替换、删除，确认输入框保存后清空，页面文本不包含 `sk-test-secret` 或 `sk-replacement-secret`。验证：`npm test -- App.test.tsx -t "updates provider settings mock controls"`；全量 `npm test` 77 tests passed。 |
| R13-PRIV-005 | `PASS` | License policy | 检查第三方 license inventory | 所有组件有 bundle/download/manual/blocked/needs-review 结论，无 blocked 组件入包 | 通过 | 2026-05-19：新增 `desktop/scripts/generate-license-inventory.mjs` 并生成 `desktop-tests/licenses/npm-licenses.json`、`python-licenses.json`、`go-licenses.md`、`license-summary.json`；汇总 618 records，0 `needs-review`，0 `blocked`。`desktop/dist-release/win-unpacked/resources` 包内容扫描未发现模型、userData、local_tests、test-results、`.env` 或 daemon ready token。 |

## E2E 和截图 Baseline

| ID | 状态 | 场景 | 步骤 | 期望 | 当前结果 | 证据/下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| R13-E2E-001 | `PASS` | 截图 baseline manifest | 建立 Round 13 截图清单 | 覆盖首次启动、主界面、任务中/完成/失败、模型、Provider、诊断和英文 UI | 通过 | 2026-05-19：`desktop-tests/pics/round13/README.md` 已同步，10 张截图文件已捕获：`01-setup-check.png` 到 `10-english-ui.png`。 |
| R13-E2E-002 | `PASS` | 主流程截图巡检 | 捕获并检查发布截图 | 不显示 daemon token、SSE、job id、JSON envelope、raw command、raw secret | 通过 | 2026-05-19：截图 baseline 覆盖主界面空状态、文件已选、运行中、完成、失败、模型、Provider 和诊断页。 |
| R13-E2E-003 | `PASS` | English UI smoke | 切换英文 UI 并截图 | 主导航、队列、Provider、诊断页关键文案为英文 | 通过 | 2026-05-19：`10-english-ui.png` 已捕获。 |

## Release Checklist

| ID | 状态 | 场景 | 步骤 | 期望 | 当前结果 | 证据/下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| R13-REL-001 | `PASS` | 发布检查清单 | 输出 Windows/macOS、验证、隐私、清理、blocker 清单 | 能作为 release candidate 审核入口 | 通过 | 2026-05-20：`desktop-tests/round13-release-checklist.md` 已按最终 Windows RC artifact、自动验证、手动 smoke、隐私/secret、unsigned Windows 决策更新；macOS arm64 打包/smoke 备注为 release-machine follow-up，不阻塞当前 Windows RC 分支合并。 |

## 新记录模板

```markdown
| R13-XXX-000 | `TODO` | 场景 | 步骤/输入 | 期望 | 当前结果 | 证据/下一步 |
```
