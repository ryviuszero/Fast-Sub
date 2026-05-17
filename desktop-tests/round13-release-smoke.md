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
| R13-AUTO-001 | `TODO` | `go test ./...` | 未运行 |  |
| R13-AUTO-002 | `TODO` | `cd desktop && npm run typecheck` | 未运行 |  |
| R13-AUTO-003 | `TODO` | `cd desktop && npm test` | 未运行 |  |
| R13-AUTO-004 | `TODO` | `cd desktop && npm run build` | 未运行 |  |
| R13-AUTO-005 | `TODO` | `cd desktop && npm run smoke` | 未运行 |  |
| R13-AUTO-006 | `TODO` | `cd desktop && npm run package:dir` | 未建立 |  |
| R13-AUTO-007 | `TODO` | `cd desktop && npm run package` | 未建立 |  |

## 打包形态 Smoke

| ID | 状态 | 场景 | 步骤 | 期望 | 当前结果 | 证据/下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| R13-PKG-001 | `TODO` | 打包产物启动 | 从 release artifact 启动应用 | 不依赖 dev server，进入主界面或首次环境检查 | 未验证 |  |
| R13-PKG-002 | `TODO` | 自管 daemon ready | 打包 app 启动 daemon | ready JSON 解析成功，renderer 不接触 token | 未验证 |  |
| R13-PKG-003 | `TODO` | daemon repair | 手动触发或模拟 daemon 中断后 repair | 重新启动 daemon 并同步状态 | 未验证 |  |
| R13-PKG-004 | `TODO` | 401 恢复 | 模拟 token 失效或 fake 401 | 显示本地服务认证失效和修复动作 | 未验证 |  |
| R13-PKG-005 | `TODO` | SSE disconnect/events_lost | 模拟断线或事件丢失 | REST 重新同步 job 状态 | 未验证 |  |
| R13-PKG-006 | `TODO` | app 退出清理 | 运行中退出 app | 不遗留 daemon/worker/ffmpeg/whisper.cpp 子进程 | 未验证 |  |
| R13-PKG-007 | `TODO` | FFmpeg/FFprobe 首装 | 清空 app 私有 FFmpeg 后启动检查 | 可安装或给出明确修复动作 | 未验证 |  |
| R13-PKG-008 | `TODO` | aria2 fallback | 模拟 aria2 bootstrap 失败 | 回退普通 HTTPS 下载或给出明确错误 | 未验证 |  |
| R13-PKG-009 | `TODO` | whisper.cpp binary | 缺少 native binary 时点安装依赖 | 可安装或显示明确阻塞 | 未验证 |  |
| R13-PKG-010 | `TODO` | app 私有 Python runtime | 在无系统 Python/uv 假设下启动本地 worker/translation bridge | daemon 能定位 app 私有 Python runtime，不要求用户安装 Python | 未验证 |  |
| R13-PKG-011 | `TODO` | macOS arm64 dmg artifact | 在 macOS arm64 启动 dmg 产物 | app 启动、daemon ready、签名/公证状态有记录 | 未验证 |  |
| R13-PKG-012 | `TODO` | macOS executable permissions | 在 macOS arm64 app bundle 内检查 daemon/Python/native binaries | 可执行权限正确，未被 quarantine 阻断，resources 定位正确 | 未验证 |  |
| R13-PKG-013 | `TODO` | macOS process cleanup | macOS arm64 上运行任务后取消/退出/repair | 不遗留 daemon/Python/ffmpeg/whisper.cpp 子进程 | 未验证 |  |
| R13-PKG-014 | `TODO` | Windows installer artifact | 安装 Windows x64 installer 后启动应用 | 安装、启动、daemon ready、卸载/清理说明可用 | 未验证 |  |
| R13-PKG-015 | `TODO` | Windows portable artifact | 解压 Windows x64 portable zip 后启动应用 | 不需安装即可启动，daemon ready，userData 不写入包目录敏感文件 | 未验证 |  |

## 真实 Provider 和文件 Smoke

| ID | 状态 | 场景 | 输入 | Provider | 期望 | 当前结果 | 证据/下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R13-REAL-001 | `TODO` | 原字幕生成 | 小音频/视频 | `local-faster-whisper` | 生成 SRT，完成页可打开字幕和目录 | 未验证 |  |
| R13-REAL-002 | `TODO` | Native ASR | 小音频/视频 | `local-whisper-cpp` | 成功输出或明确依赖/模型提示 | 未验证 |  |
| R13-REAL-003 | `TODO` | API STT blocker | 小音频 | 本地兼容 OpenAI API | Base URL/model/key alias 隔离，无 key/有 key路径和 401/403 可理解 | 未验证 |  |
| R13-REAL-004 | `TODO` | 本地字幕翻译 | 小 SRT/TXT | `local-nllb-ct2` | 输出翻译字幕或逐行 TXT | 未验证 |  |
| R13-REAL-005 | `TODO` | Web 翻译小文件 external record | 小 SRT/TXT | `web-bing` / `web-google` | 成功或 provider_failed；不无限卡住；失败不默认阻塞 | 未验证 |  |
| R13-REAL-006 | `TODO` | Web 翻译大文件超时 | 大 TXT | `web-bing` / `web-google` | 3 分钟硬超时和用户提示 | 未验证 |  |
| R13-REAL-007 | `TODO` | API 翻译 blocker | 小 SRT/TXT | 本地兼容 OpenAI API | 支持无 key 本地端点，401/403 可理解 | 未验证 |  |
| R13-REAL-008 | `TODO` | 双语字幕 | 小媒体 | local/API translation | 单个 `transcribe` job 完成转写加翻译 | 未验证 |  |
| R13-REAL-009 | `TODO` | 烧录字幕 | 小视频 + SRT | `burn_in` | 输出硬字幕视频，日志 redacted | 未验证 |  |
| R13-REAL-010 | `TODO` | 路径兼容 | 中文/日文/韩文/空格路径 | 任意本地流程 | 文件名、输出名和错误页不乱码 | 未验证 |  |
| R13-REAL-011 | `TODO` | GPU 长任务取消 | 长音频/视频 | local ASR GPU | 取消后子进程和显存释放 | 未验证 |  |
| R13-REAL-012 | `TODO` | 真实 OpenAI-compatible external record | 小音频或小 SRT/TXT | 真实 OpenAI-compatible 服务 | 记录账号、网络、费用和服务可用性；失败不默认阻塞 | 未验证 |  |
| R13-REAL-013 | `TODO` | 首次启动默认模型安装 | 无本地默认模型环境 | 小型默认 ASR + 当前默认 NLLB | 引导安装，完成后显示本地转写/翻译就绪 | 未验证 |  |
| R13-REAL-014 | `TODO` | 默认 ASR blocker | 小音频/视频 | 小型默认 ASR 模型 + 最终选定默认 ASR Provider | packaged app 能完成默认本地转写，不依赖 API/mock | 未验证 |  |
| R13-REAL-015 | `TODO` | 翻译模型失败降级 | 模拟默认翻译模型安装失败 | 默认本地翻译 | 原字幕生成不被阻断，翻译/双语路径被阻断并可恢复 | 未验证 |  |
| R13-REAL-016 | `TODO` | Python CLI packaged check | 隔离系统 Python/uv 后运行 | app 私有 Python + `fast-sub --help` | CLI 可运行，不使用系统 Python/uv | 未验证 |  |
| R13-REAL-017 | `TODO` | Python ASR dependency check | 隔离系统 Python/uv 后运行 | app 私有 faster-whisper worker | worker import/check 可运行 | 未验证 |  |
| R13-REAL-018 | `TODO` | Python translation dependency check | 隔离系统 Python/uv 后运行 | app 私有 translation bridge | `ctranslate2`/`sentencepiece` import 或等效 check 可运行 | 未验证 |  |

## 诊断和隐私 Smoke

| ID | 状态 | 场景 | 步骤 | 期望 | 当前结果 | 证据/下一步 |
| --- | --- | --- | --- | --- | --- | --- |
| R13-PRIV-001 | `TODO` | 诊断摘要 | 复制/导出诊断信息 | 不包含 API key、Authorization、daemon token、secret_ref、signed URL、proxy credential | 未验证 |  |
| R13-PRIV-002 | `TODO` | 失败详情 | 触发 provider/job 失败 | 显示用户可执行动作和 redacted detail | 未验证 |  |
| R13-PRIV-003 | `TODO` | 普通主界面 | 主流程各状态巡检 | 不显示 daemon、SSE、job id、JSON envelope、raw command | 未验证 |  |
| R13-PRIV-004 | `TODO` | Secret storage | 保存、替换、删除 API key | renderer、配置文件、日志不出现 raw secret | 未验证 |  |
| R13-PRIV-005 | `TODO` | License policy | 检查第三方 license inventory | 所有组件有 bundle/download/manual/blocked/needs-review 结论，无 blocked 组件入包 | 未验证 |  |

## 新记录模板

```markdown
| R13-XXX-000 | `TODO` | 场景 | 步骤/输入 | 期望 | 当前结果 | 证据/下一步 |
```
