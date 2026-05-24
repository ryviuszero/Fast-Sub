# Round 14：无 API Key 网页翻译恢复

## 概要

Round 14 是 Fast Sub 公开发布后的网页翻译修复轮。Round 13 发布前为了关闭 GitHub Dependabot high alert，已移除 `web-translate` optional extra，避免 `translators -> ai-cloudscraper -> js2py` 进入默认锁文件和打包依赖。该安全修复保留了 `web-bing` / `web-google` provider id，但 packaged desktop 暂时不能继续提供无 API key 网页翻译。

本轮目标是在不恢复 `translators`、不重新引入 `js2py`、不要求用户申请 API key 的前提下，让 Windows/macOS packaged desktop 重新提供下载即用的 `web-bing` 和 `web-google` 翻译能力。

## 目标

- 恢复 packaged desktop 中 `web-bing` 和 `web-google` 的无 API key 免费网页翻译能力。
- 使用 JS helper 承载网页翻译实现，第一版同时支持 Bing 和 Google。
- 保持 Go daemon 是任务编排边界；renderer 不直接调用 Node package、网页接口、helper command 或 raw response。
- 保持现有远程上传确认：缺少显式确认时，`web-bing` / `web-google` job 必须继续拒绝执行。
- 保持 `web-bing` / `web-google` 默认 `batch-size=1` 和整任务超时策略，避免网页 provider 卡住长任务。
- 保持 `uv.lock` 不含 `js2py`、`translators`、`ai-cloudscraper`。
- 在 UI、诊断、help/release docs 中明确网页翻译是 best-effort experimental provider，可能因限流、地区或上游页面变化失败。

## 非目标

- 不恢复 Python `translators` 或 `web-translate` optional extra。
- 不把 `js2py`、`ai-cloudscraper` 或等价高危依赖重新加入 Python 锁文件。
- 不新增 Azure Translator 或 Google Cloud Translation 官方 API provider；官方 API provider 后续另开轮次。
- 不承诺 Python CLI 独立可用；Round 14 第一版只保证 packaged desktop。
- 不让 renderer 直接执行 shell、Node helper、HTTP 请求或第三方翻译 package。
- 不把网页翻译作为本地字幕生成主路径 blocker；本地 ASR、本地 NLLB 和 API provider 继续保持独立可用。
- 不实现 proxy pool、captcha 绕过、自动换 IP 或自动重试规避限流。
- 不保证 `web-bing` / `web-google` 长期稳定可用；它们是便利型第三方网页 provider，不是可靠批处理 provider。

## 分支计划

推荐分支：

```text
codex/web-translation-dependency-risk
```

本轮建议仍使用一个主分支推进，避免 Electron main、Go daemon、helper contract、packaged resource 和文档说明漂移。实现时按 14.1 -> 14.8 顺序提交；每个主要单元完成后同步更新 `dev-docs/ui-docs/project-tracker.md`，记录完成内容、验证命令、剩余问题和下一步。

合并到 `master` 前必须满足：

- `uv.lock` 不含 `js2py`、`translators`、`ai-cloudscraper`。
- 新增 npm runtime dependencies 后无 high/critical audit。
- Windows packaged smoke 通过。
- macOS packaged smoke 在 macOS arm64 release machine 上通过，或者明确标记为未合并 blocker；本轮默认将 macOS smoke 作为合并 blocker。

## 当前状态

- 当前分支：`codex/web-translation-dependency-risk`。
- `web-translate` optional extra 已从 `pyproject.toml` 移除，`uv.lock` 已重算并移除 `translators`、`ai-cloudscraper` 和 `js2py`。
- GitHub Dependabot `js2py allows remote code execution` high alert 已变为 fixed。
- Python `src/fast_sub/clients/web_translation.py` 仍保留原 `translators` adapter，但缺依赖时返回 `missing_dependency`。
- Go daemon `translate_srt` 仍识别 `web-bing` / `web-google`，并保留上传确认、默认 batch size 和 3 分钟 web translation timeout。
- Electron UI 仍展示 `web-bing` / `web-google` provider。
- 旧 packaged runtime / dist-release 可能仍包含移除前的 Python metadata；Round 14 实现后必须重新打包并验证包内不含旧 `web-translate` metadata。

## 已确认决策

- 必须无 API key。
- 必须下载即用。
- 第一版同时支持 `web-bing` 和 `web-google`。
- 第一版使用 JS helper，而不是 Python 包或 Go unofficial 包。
- 第一版范围是 packaged desktop；Python CLI 不作为验收 blocker。
- JS helper 只由 Electron main / Go daemon 控制路径间接调用，不暴露给 renderer。
- Windows 和 macOS 都进入第一版验收范围；macOS arm64 smoke 必须在 macOS release machine 上完成。

## 架构

Round 14 使用“Electron packaged resource + Go runner bridge + JS helper”架构。

```text
renderer
-> preload typed API
-> Electron main DaemonFastSubClient
-> self-managed Go daemon
-> translate_srt runner
-> JS web translation helper
-> unofficial Bing / Google web translation package
```

关键边界：

- Renderer 只提交 provider id、输入文件、语言、输出路径和上传确认，不接触 helper path、helper args、raw HTTP 或 package response。
- Electron main 在启动自管 daemon 时注入 helper command/env。开发态可以指向 Node helper，打包态必须指向 app resources 内的 helper。
- Go daemon 对 `web-bing` / `web-google` 优先走 JS helper；helper 不存在时返回结构化 `missing_dependency`。
- SRT/TXT 解析、replace/bilingual 输出、cue count 保持、`.errors.json` 写入和最终文件写入继续由现有 Python `fast-sub translate` pipeline 负责；Round 14 不在 Go 中重写字幕翻译业务语义。
- Python `fast-sub translate` 的 web provider 执行路径必须改为调用 Go 注入的 JS helper command，而不是导入 `translators`。本地 NLLB 和 API OpenAI chat 继续保留现有 Python CLI bridge。
- JS helper 属于 packaged desktop resource，不属于 renderer bundle。生产 helper 和其 runtime dependencies 必须放在 ASAR 外，例如 `process.resourcesPath/web-translate-helper/`。
- 打包态 helper 不依赖用户系统 Node。优先使用 packaged Electron binary 配合 `ELECTRON_RUN_AS_NODE=1` 运行 helper；如果该路径不可行，必须显式 bundle 独立 Node runtime，并在 14.1 记录体积和 license 影响。
- Go CLI 独立运行时没有 helper path/env 时，`web-bing` / `web-google` 必须返回 `missing_dependency`；不能回退到 Python `translators`，也不能要求用户手动安装全局 Node 作为桌面验收条件。

## Helper 契约

JS helper 必须是单次请求、单次响应的 subprocess。

调用形式：

```text
<helper-command> <helper-args...>
```

stdin JSON：

```json
{
  "schema_version": 1,
  "provider": "web-bing",
  "text": "hello",
  "from_language": "en",
  "to_language": "zh",
  "timeout_seconds": 60
}
```

允许的 provider：

```text
web-bing
web-google
```

成功 stdout JSON：

```json
{
  "schema_version": 1,
  "ok": true,
  "text": "你好"
}
```

失败 stdout JSON：

```json
{
  "schema_version": 1,
  "ok": false,
  "error": {
    "code": "provider_failed",
    "message": "translation failed",
    "action_hint": "Try again later or choose local/API translation."
  }
}
```

规则：

- stdout 必须只包含一个 JSON object，不允许输出日志。
- stderr 可以包含诊断日志，但 Go/Python 在展示或写入日志前必须 redacted 并截断。
- exit code `0` 且 `ok=false` 表示可处理的 provider failure。
- 非 0 exit code 默认映射为 `provider_failed`，除非上层能更明确地映射为 timeout/cancel。
- helper 必须用结构化 JSON 拒绝 unknown provider、empty text、invalid language、invalid JSON 和 oversized payload。
- helper 调用 provider package 前必须做语言别名归一化。最小必需别名：`zh` -> provider-specific Simplified Chinese code、`ja`、`ko`、`en` 和 `auto`。
- helper 调用 provider package 前必须执行保守 payload 限制。初始限制：`web-bing` 单次最多 1000 characters；`web-google` 单次最多 4000 characters。超限返回 `invalid_input`，action hint 提示拆分字幕或改用本地/API 翻译。
- Round 14 helper 不暴露 proxy 配置。后续如需 proxy，必须另做隐私和 credential 设计。
- helper 不得读取 API key、daemon token、secret store、config file、media file 或 userData path。
- helper 不得写输出文件；最终 SRT/TXT 输出仍由现有翻译 pipeline 负责。

错误映射：

| Helper code | Go/Python app error | 用户含义 |
| --- | --- | --- |
| `invalid_input` | `invalid_input` | Provider、语言或文本 payload 不合法。 |
| `missing_dependency` | `missing_dependency` | Packaged helper 或 package dependency 不可用。 |
| `missing_helper` | `missing_dependency` | Helper 文件没有被打包或无法定位。 |
| `missing_node_runtime` | `missing_dependency` | Packaged Node / Electron-as-Node runtime 不可用。 |
| `helper_start_failed` | `missing_dependency` | Helper 进程无法启动。 |
| `provider_timeout` | `provider_unavailable` | 网页翻译超时。 |
| `rate_limited` | `provider_unavailable` | 第三方网页服务限流。 |
| `region_blocked` | `provider_unavailable` | 当前网络区域不可访问第三方网页服务。 |
| `provider_response_changed` | `provider_unavailable` | 上游响应结构变化，package 无法解析。 |
| `provider_failed` | `provider_unavailable` | 第三方网页翻译失败。 |

部分失败策略：

- 保持现有 SRT 翻译语义。部分 cue 失败时可以写输出文件，但必须保持 cue count，并写 `.errors.json`。
- 如果全部 cue 失败，job 必须失败，不得写出误导性的成功字幕文件，并且必须写结构化错误详情。
- `replace` mode 下，只有至少一个 cue 成功时，失败 cue 才允许回退为原文；`bilingual` mode 下，失败 cue 保留原 cue 并省略翻译行。

## 实现单元

| 单元 | 名称 | 范围 | 验收 |
| --- | --- | --- | --- |
| 14.1 | 依赖和 helper 盘点 | 为 Bing/Google 选择精确 npm package 和版本；比较候选包，记录 license、dependency count、维护状态、audit 状态、体积影响和 runtime 选择 | `npm audit --omit=dev` 无 high/critical；runtime dependencies 仅允许宽松 license；最终决策写入本 spec 或 tracker |
| 14.2 | JS helper contract | 增加 helper source、schema validation、provider routing、timeout handling、stdout JSON discipline 和 mocked package tests | helper tests 覆盖两个 provider 的 success/failure/invalid input |
| 14.3 | Python web adapter 改造 | 将 Python `web_translation.py` 从导入 `translators` 改为调用 JS helper；保持现有 SRT/TXT、replace/bilingual、partial failure 和 `.errors.json` 语义 | Python tests 覆盖 fake helper 成功、失败、超时、缺 helper、全部失败和部分失败 |
| 14.4 | Go runner bridge | Go `translate_srt` 继续调用 Python CLI，但向 Python 注入 helper command/env；保留上传确认、batch size 和 job timeout | Go tests 覆盖 helper env 注入、缺 helper 映射、upload confirmation 和 web timeout |
| 14.5 | Electron packaged wiring | 将 helper 和生产依赖打包到 ASAR 外 desktop resources，并在 dev/package 模式启动自管 daemon 时注入 helper command/args | packaged daemon 能定位 helper，不依赖系统 Node 或 Python `translators`；helper path 位于 `process.resourcesPath` |
| 14.6 | Provider 状态和 UI 文案 | 更新 provider availability、action hints 和 UI copy，说明无 key 网页翻译是 experimental/best-effort | renderer tests 覆盖可用/缺 helper 状态，且不暴露 command/path |
| 14.7 | Packaged smoke 和安全验证 | Windows 和 macOS packaged smoke 覆盖短 SRT 的 Bing/Google 翻译；验证 lockfiles 和 packaged Python metadata 不含 `js2py/translators/ai-cloudscraper` | smoke logs 记录 provider、语言对、结果状态、redaction 和 dependency scan |
| 14.8 | 文档和 tracker 同步 | 更新 tracker、help docs、API docs 和 release notes，说明无 key 网页翻译行为和限制 | 文档不再把 `web-translate` install path 作为当前支持路径 |

实现顺序固定为 14.1 -> 14.8。14.1 未完成前，不得把候选 npm 包视为已批准依赖；14.2 未完成前，不得接 Go/Python 运行路径；14.7 未完成前，不得声称 packaged desktop 已恢复 web translation。

## 依赖决策门

Round 14 不能把 first-pass package candidates 直接当成已批准依赖。14.1 必须比较候选包，并在进入实现前记录最终决策。

任意 runtime package 的最低准入条件：

- License 是 MIT、Apache-2.0、BSD 或类似宽松许可证。
- 新增 package 后 `npm audit --omit=dev` 无 high/critical。
- Runtime dependency tree 足够小，能解释 packaged size impact。
- Package 兼容 Windows 和 macOS 上选定的 helper runtime。
- Package 可以在单元测试中 mock，不需要真实网络。
- 已知不稳定性、请求限制和 unofficial-provider disclaimer 必须同步到 docs/help wording。

第一批候选：

| Provider | Package | 说明 |
| --- | --- | --- |
| `web-bing` | `bing-translate-api` | NPM Bing web translation package；看起来比 Python 替代方案更适合无 key Bing。必须先验证 license、dependency tree、audit 和 packaged behavior。 |
| `web-google` | `@vitalets/google-translate-api` | Unofficial Google Translate package；package 自身提示 100% legal/stable 路径是官方 API。必须标记为 best-effort。 |

14.1 需要比较的 Google 替代：

- `@iamtraction/google-translate`：实现更简单、MIT license，但采用前必须检查维护新鲜度。
- `google-translate-api-x`：相关 unofficial Google package；只有 audit、维护状态和打包 profile 明显更好时才考虑。

Round 14 默认路径拒绝：

- Python `translators`：会拉入 `js2py` 依赖链。
- Python `googletrans`：只覆盖 Google，且仍是 unofficial。
- Python `deep-translator`：对无 key packaged desktop 不明显优于 JS helper，且仍可能依赖 unofficial web behavior。
- 官方 Azure/Google SDK：需要 API key，不符合 Round 14 无 key 要求。

## 安全和隐私要求

- `uv.lock` 不得包含 `js2py`、`translators` 或 `ai-cloudscraper`。
- 新增 JS package 后必须审计 `package-lock.json`；helper path 不能引入 high/critical vulnerability。
- Helper source 和 production dependencies 必须打包到 ASAR 外，不依赖从 `app.asar` 内执行文件。
- Helper stdout/stderr 进入 daemon logs、UI diagnostics 或 test snapshots 前必须经过 redaction。
- Helper 不得接收 audio/media paths、API keys、Authorization headers、daemon ready token、`secret_ref`、signed URL、proxy credential 或 raw config。
- Web provider 执行仍必须要求显式上传确认，因为字幕文本会发送到第三方服务。
- Packaged smoke 必须只使用公开安全的 sample text/media name。

## 测试计划

本地自动检查：

```powershell
go test ./internal/jobs ./internal/providers
cd desktop && npm run typecheck
cd desktop && npm test
cd desktop && npm run build
uv lock --locked
```

针对性测试：

- JS helper unit tests：
  - mocked package 下 `web-bing` success。
  - mocked package 下 `web-google` success。
  - provider package 抛出 rate limit / network error。
  - provider package 抛出 response-shape / parser error。
  - invalid provider、empty text、invalid language、oversized text 和 invalid JSON。
  - stdout 始终保持 JSON-only。
  - stderr diagnostic text 允许存在，但 success parsing 不依赖 stderr。
- Python adapter tests：
  - fake helper 返回 `web-bing` 翻译结果。
  - fake helper 返回 `web-google` 翻译结果。
  - fake helper 返回 `provider_failed`。
  - helper command 缺失返回 `missing_dependency`。
  - helper file 缺失返回 `missing_dependency`。
  - packaged Node / Electron-as-Node runtime 缺失返回 `missing_dependency`。
  - timeout 映射为 `provider_unavailable`。
  - 部分失败保持 cue count 并写 `.errors.json`。
  - 全部 cue 失败时 job 失败且不写最终成功字幕。
- Go runner tests：
  - self-managed daemon env 包含 helper command/args。
  - 缺 helper env 映射为 `missing_dependency`。
  - missing upload confirmation 仍返回 `invalid_input`。
  - web provider 整任务超时仍映射为 `provider_unavailable`。
- Desktop tests：
  - packaged mode 下自管 daemon 收到 helper env。
  - packaged helper 从 `process.resourcesPath` 定位，不从 renderer bundle path 定位。
  - renderer 不暴露 helper command、args、raw response 或 raw stderr。
  - Provider 页标记 web translation 为 no-key 但 best-effort。
  - provider unavailable states 映射为可执行 UI hint，且不显示 helper path。

Packaged smoke：

- 重建 Windows packaged app。
- 在 macOS arm64 release machine 重建 macOS packaged app。
- 使用隔离 userData 和 clean Python runtime。
- 确认 package 不包含 Python `translators` metadata。
- 用 `web-bing` 翻译一份公开安全的短 SRT。
- 用 `web-google` 翻译一份公开安全的短 SRT。
- 验证没有配置或要求 API key。
- 验证失败文案建议 retry/local/API provider，而不是提示安装 `web-translate`。
- 验证 helper 和 dependencies 位于 ASAR 外，且不依赖系统 Node。
- 验证 `uv.lock`、packaged Python metadata 和 packaged runtime 不含 `js2py`、`translators` 或 `ai-cloudscraper`。

## 验收标准

- `web-bing` 和 `web-google` 可以在 Windows packaged desktop 中无 API key 翻译短 SRT。
- `web-bing` 和 `web-google` 可以在 macOS arm64 packaged desktop 中无 API key 翻译短 SRT。
- `web-bing` 和 `web-google` 不依赖系统 Node、系统 Python `translators`、全局 npm package 或用户手动安装 helper dependency。
- 断网或 provider package 失败时，产生结构化、redacted provider error。
- Dependabot 不出现由 Round 14 dependency 引入的 open high/critical alert。
- `uv.lock` 保持不含 `js2py`、`translators` 和 `ai-cloudscraper`。
- Helper files 和 production dependencies 打包在 ASAR 外，并通过 packaged resource path 定位。
- 部分 cue 失败保持 cue count 并写错误详情；全部 cue 失败不得写出误导性的成功字幕。
- CI 通过。
- `dev-docs/ui-docs/project-tracker.md` 记录实现结果、验证命令和剩余限制。

## 风险

- 两个候选 JS package 都依赖 unofficial web behavior，可能在无预告情况下失效。
- Google web translation 通常比 Bing 更不稳定，可能因地区、请求模式或上游响应变化失败。
- Packaged Electron 配合 `ELECTRON_RUN_AS_NODE=1` 运行 helper 必须在 Windows 和 macOS 都验证通过。
- 新 JS dependencies 可能增加包体积或触发新的 npm advisory。
- 上游条款可能不允许自动化访问；UI/help docs 必须把它描述为 third-party web provider 的 best-effort 行为，而不是 guaranteed local/offline feature。
