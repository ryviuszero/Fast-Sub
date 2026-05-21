# Fast Sub Round 8: Go Migration Foundation

## Summary

第 8 轮目标是建立并行 Go CLI foundation，而不是替换现有 Python CLI。

本轮应新增一个可独立运行的 `fast-sub-go`，先实现低风险命令和基础设施：

```text
version
doctor
probe
extract
```

Python v0 CLI `fast-sub` 仍然是稳定用户入口。Go 本轮只建立骨架、错误/JSON contract、ffmpeg/ffprobe 调用、路径处理和兼容测试，为后续 Round 9 接管 `transcribe/auto` 做准备。

推荐分支：

```text
codex/fast-sub-go-foundation
```

## Context

Round 7.75 已经完成 Python 分层重构：

- CLI command shell 已拆分。
- `clients/`、`providers/`、`model_store/`、`benchmark/`、`media/`、`stt/`、`translation/`、`pipeline/` 等包边界已收敛。
- Python `mypy src` baseline 已经 clean。

因此 Round 8 不应该继续吸收 Python 重构工作。Python 改动只允许用于：

- golden compatibility fixtures。
- contract documentation。
- 为 Go 测试准备的稳定 JSON fixture。
- 极小的测试辅助调整。

## Goals

- 新增 Go module 和并行 Go CLI entrypoint。
- 建立小而明确的 Go project layout。
- 实现 `fast-sub-go --version`。
- 实现 `fast-sub-go doctor`，检查本地运行环境。
- 实现 `fast-sub-go probe`，调用 `ffprobe` 输出媒体 metadata。
- 实现 `fast-sub-go extract`，调用 `ffmpeg` 输出 16kHz mono wav。
- 对齐 Python v0 的 stdout/stderr/JSON/exit-code 基本语义。
- 增加 compatibility tests，覆盖 JSON shape、exit code、Windows paths、missing dependency。

## Non-Goals

- 不替换 `fast-sub`。
- 不实现 Go `transcribe`。
- 不实现 Go `auto`。
- 不运行模型推理。
- 不接入 faster-whisper worker。
- 不实现模型下载器。
- 不实现 provider runtime。
- 不做 Electron UI。
- 不做 Web。
- 不继续大规模 Python 重构。
- 不使用 CGo ffmpeg bindings。
- 不实现正式 job folder。
- 不实现 daemon、HTTP/WebSocket、job lifecycle、progress API 或 background scheduler。
- 不检查 Python worker、模型、GPU/CUDA、网络或远程 provider key。
- 不实现 adaptive warm worker、worker pool、资源锁调度或外部消息队列；这些只在文档中作为后续设计约束保留。

## CLI Framework Decision

Round 8 默认使用标准库 `flag` + 小型 command dispatcher，暂不引入 Cobra。

原因：

- Round 8 只有 `version/doctor/probe/extract` 四类命令。
- 标准库依赖最少，最容易控制 stdout/stderr 和 JSON purity。
- Cobra 可在 Round 9/10 命令树明显复杂后重新评估。

可选方案说明：

- 标准库 `flag` + 小型 command dispatcher：依赖最少，适合 Round 8 的 `version/doctor/probe/extract` 小范围。
- Cobra：更适合后续 `models/providers/bench/job/daemon` 等复杂命令树。

无论选择哪种方案，都必须满足：

- stdout/stderr writer 可注入，方便测试 JSON purity。
- JSON mode 下 stdout 只能输出 JSON。
- 人类提示、warning、progress、debug diagnostics 进入 stderr。
- command 不能各自随意 `fmt.Println`。
- 错误输出统一走 structured error writer。
- help/version 行为必须可测试。
- 不引入其他 CLI framework。
- 不实现复杂 logger；Round 8 默认只输出必要 warning/error，后续再加 `--verbose` / `--debug`。

## Target Layout

新增 Go 代码建议结构：

```text
go.mod
cmd/fast-sub-go/main.go
internal/cli
internal/errors
internal/media
internal/ffmpeg
internal/paths
internal/worker
internal/subtitle
internal/bench
internal/testutil
```

Round 8 最低需要：

```text
cmd/fast-sub-go/main.go
internal/cli
internal/errors
internal/media
internal/ffmpeg
internal/paths
internal/testutil
```

不要创建未使用的空 package。Round 8 只落地实际用到的 package；future package 只保留在文档里。

职责：

- `cmd/fast-sub-go`: 只启动 CLI。
- `internal/cli`: command registration、参数解析、stdout/stderr、JSON mode。
- `internal/errors`: exit code、structured error、redaction-safe error output。
- `internal/media`: media metadata model、probe result normalization。
- `internal/ffmpeg`: `ffmpeg` / `ffprobe` 命令构造与执行。
- `internal/paths`: Windows-friendly path handling、output path resolution。
- `internal/testutil`: fake binaries、fixture helpers、JSON comparison helpers。

建议额外拆分：

- `internal/cli/output`: JSON/human output writer、stderr diagnostics。
- `internal/cli/command`: command dispatcher 或 Cobra command construction。
- `internal/ffmpeg/probe_raw.go`: ffprobe raw JSON model 和 invocation。
- `internal/media/metadata.go`: Fast Sub normalized media metadata。

## CLI Contract

本轮 Go CLI 命令：

```bash
fast-sub-go --version
fast-sub-go doctor [--json]
fast-sub-go probe <input> [--json]
fast-sub-go extract <input> --output <wav> [--json]
```

输出规则：

- human mode：stdout 可以输出人类可读结果。
- JSON mode：stdout 必须是纯 JSON。
- progress、warning、人类错误信息输出到 stderr。
- API key、Authorization、token、用户敏感路径不得进入 JSON、stderr 或 report。
- Round 8 不实现多级日志；debug/verbose 作为后续扩展。
- 如果后续实现 debug，absolute path 和完整 command args 只能在用户显式开启 debug 时输出，并且仍需 redaction。

Exit code 建议：

```text
0 success
1 general failure
2 invalid input / usage
3 missing local dependency
7 ffmpeg / ffprobe failure
```

具体原因放入 structured error：

```json
{
  "schema_version": "fast_sub_cli_result_v1",
  "ok": false,
  "command": "doctor",
  "exit_code": 3,
  "error": {
    "code": "missing_dependency",
    "stage": "doctor",
    "message": "ffprobe was not found on PATH.",
    "action_hint": "Install ffmpeg and make sure ffprobe is available on PATH.",
    "details": {}
  }
}
```

JSON success 顶层结构：

Round 8 所有 `--json` 成功输出优先使用统一顶层结构：

```json
{
  "schema_version": "fast_sub_cli_result_v1",
  "ok": true,
  "command": "probe",
  "result": {}
}
```

如果某个命令为了兼容 Python v0 需要不同 shape，必须有 compatibility fixture 锁住字段语义，并在实现记录中说明。

Structured error 要求：

- `schema_version` 用于 Go/Python 兼容测试。
- `ok=false`。
- `command` 记录当前命令。
- `exit_code` 记录 shell exit code。
- `error.code` 用于脚本判断。
- `error.stage` 用于定位失败阶段。
- `error.message` 面向人类，可 redacted。
- `error.action_hint` 给出下一步。
- `error.details` 只能包含 redaction-safe 信息。

Path / redaction 规则：

- Round 8 JSON 输出默认尽量对齐 Python v0 的字段语义。
- 如需输出用户路径，优先输出用户传入的 clean path 或 redacted path，不新增绝对路径泄露。
- benchmark/report 类输出默认不包含绝对路径；Round 8 `probe/extract` 如果为了兼容需要路径字段，必须有测试锁住字段语义。
- API key、Authorization、token 和远程 provider secret 即使未来出现在 env/config，也不得进入 JSON/stderr。
- human stderr 可以显示用户输入路径。
- JSON mode 不主动把相对路径扩展为绝对路径。
- error details 中的路径优先使用 basename、用户输入原值或 redacted path。

## Command Behavior

### `--version`

- 输出 Go CLI version。
- version 可以先读取 hardcoded dev version，例如 `0.1.0-dev`，后续再接构建注入。
- 后续可以通过 Go build flags 注入，例如 `-ldflags "-X main.version=..."`。
- 不读取 Python package metadata。
- `--version` 不访问文件系统、不检查 ffmpeg、不读取配置。

### `doctor`

检查：

- `ffmpeg` 是否可执行。
- `ffprobe` 是否可执行。
- 当前 OS / arch。
- 基础路径能力，例如当前工作目录可读。
- doctor binary check timeout 默认为 5s。

不检查：

- 模型是否安装。
- Python worker 是否安装。
- GPU/CUDA。
- 网络下载。
- remote provider API key。
- model cache/hash。
- ffmpeg/ffprobe version 第一版只记录可执行 path 和 raw first line，不解析复杂版本语义。

JSON success 示例：

```json
{
  "ok": true,
  "command": "doctor",
  "ffmpeg": {"available": true, "path": "...", "version": "..."},
  "ffprobe": {"available": true, "path": "...", "version": "..."},
  "platform": {"os": "windows", "arch": "amd64"}
}
```

### `probe`

行为：

- 输入必须存在。
- 调用 `ffprobe` 获取媒体 metadata。
- 推荐参数：

```text
ffprobe -v error -print_format json -show_format -show_streams <input>
```

- `internal/ffmpeg` 负责运行 ffprobe、捕获 stdout/stderr、解析 raw JSON。
- `internal/media` 负责将 raw ffprobe JSON 转换为 Fast Sub normalized metadata。
- JSON 输出应尽量对齐 Python `fast-sub probe --json` 的字段语义。
- 不要求字节级 JSON 完全一致，但字段含义、错误码、路径处理要兼容。
- ffprobe timeout 默认为 30s。
- stderr tail 默认最多保留 8192 bytes。

必须处理：

- 文件不存在。
- path 包含空格。
- path 包含中文字符。
- ffprobe 不存在。
- ffprobe 返回非零。
- ffprobe 输出不是合法 JSON。
- raw JSON 缺少 `format` 或 `streams`。
- duration 为空、非法或不可解析。
- 无 audio stream。
- 无 video stream。

### `extract`

行为：

- 输入必须存在。
- 输出路径必须显式传入。
- 调用 `ffmpeg` 生成 16kHz mono wav。
- 推荐参数至少包含：

```text
-vn
-ac 1
-ar 16000
-c:a pcm_s16le
```

- 默认不覆盖已存在输出，除非实现并显式支持 `--overwrite`。
- JSON 输出包含输入、输出、sample rate、channels、elapsed 或 status。
- 输出必须先写同目录临时文件，例如 `<output>.fast-sub-tmp-<pid-or-random>`。
- ffmpeg 成功后 rename 到最终路径。
- cancel、timeout 或 ffmpeg failure 时清理 tmp。
- Windows rename / output-exists 行为需要测试。
- extract timeout 默认 30min；后续可根据 media duration 计算更精确 timeout。
- stderr tail 默认最多保留 8192 bytes。

必须处理：

- 文件不存在。
- 输出目录不存在。
- 输出已存在。
- ffmpeg 不存在。
- ffmpeg 返回非零。
- Windows path 空格和中文字符。

取消/timeout 最小语义：

- Go 使用 `exec.CommandContext` 启动 ffmpeg/ffprobe。
- context cancel 或 timeout 时终止 child process。
- JSON mode 下 cancel/timeout 输出 structured error。
- extract cancel/timeout 必须清理临时输出。

## Compatibility Tests

需要新增 Go tests：

- `--version` 输出非空。
- `doctor --json` success / missing ffmpeg。
- `probe --json` success with fake ffprobe JSON。
- `probe --json` missing input。
- `probe --json` invalid ffprobe JSON。
- `extract --json` success with fake ffmpeg。
- `extract --json` missing input。
- `extract --json` output exists without overwrite。
- Windows path with spaces。
- Windows path with Chinese characters。
- JSON mode stdout can be unmarshaled on success and failure.
- stderr may contain diagnostics but must not pollute JSON stdout.

建议使用 fake binary：

- fake 必须跨平台。
- 优先使用 Go test helper process，或临时构建小型 Go fake binary。
- 不依赖 `.sh` / `.bat` 脚本。
- 在测试临时目录创建 fake `ffmpeg` / `ffprobe` 或 PATH shim。
- 将临时目录 prepend 到 `PATH`。
- fake `ffprobe` 场景：
  - valid JSON
  - invalid JSON
  - empty stdout
  - non-zero exit with stderr
  - slow response for timeout/cancel
- fake `ffmpeg` 场景：
  - 创建目标临时 wav 文件
  - 返回非零
  - 写 stderr
  - 模拟长时间运行

Python compatibility fixtures：

- 如果需要对齐 Python JSON shape，可新增 fixture 文件，不修改 Python runtime。
- 允许 normalize JSON formatting。
- 不允许改变字段语义。

## Future Worker And Job Contracts

本节仅是后续设计指导。Round 8 implementation must not create worker manager、job queue、resource lock、adaptive warm worker、daemon 或 progress API 代码。

Round 8 不实现这些能力，但 Go foundation 的包边界和错误模型要给后续能力留出位置。

Worker discovery：

```text
1. explicit --worker-command
2. config worker_command
3. FAST_SUB_WORKER_COMMAND / FAST_SUB_STT_WORKER_COMMAND
4. PATH 中 fast-sub-worker-* 可执行文件
5. bundled worker
6. missing_worker structured error
```

Worker capability handshake：

- 后续 Go `transcribe/auto` 在长任务前应检查 worker capability。
- capability 至少包含：
  - `schema_version`
  - `worker_type`
  - `protocol_versions`
  - `features`
  - `backends`
- 不兼容时返回 `worker_protocol_error` 或 `missing_worker`，不要等模型加载后才失败。

Progress / cancel：

- 预留 `progress.json` 或 progress event schema。
- 阶段名称建议：

```text
probing_media
extracting_audio
loading_model
transcribing
aligning
translating
rendering
done
```

- cancel 不等于普通 failure。
- worker 正常取消可以写 canceled response；worker 被 kill 时 Go 生成 structured canceled/timeout error。

Resource locks：

```text
ffmpeg_concurrency
gpu_asr_lock
cpu_heavy_lock
model_install_lock
provider_rate_limit_lock
warm_worker_memory_budget
warm_worker_vram_budget
```

- 后续批量任务优先使用本地资源锁和持久化 job folder。
- 不在桌面默认路径中依赖 Redis/RabbitMQ/Celery。
- 外部消息队列只作为 server/multi-user future adapter。

Adaptive warm worker：

- 后续重模型 worker 使用 `worker_mode=auto|one-shot|warm`。
- `auto` 根据任务类型、队列长度、本地资源和后续阶段决定是否保温 worker。
- 单任务可在完成后短暂 idle，超过 idle timeout 自动退出。
- 批量任务复用同 key worker，避免重复加载模型。
- worker key 包含 worker type、backend/provider、model、device、compute type。
- ASR 和本地 NLLB worker 默认不同时保温，除非本地资源检查确认充足。
- ASR 阶段完成且后续需要本地翻译时，可以释放 ASR idle worker，为 translation worker 腾出内存/显存。
- 资源紧张时 auto 模式应缩短 idle timeout 或退回 one-shot。

Local resource check：

- 后续 worker manager 启动 warm worker 前应检查：
  - 可用内存。
  - 可用磁盘空间。
  - GPU 可用性和显存，若可检测。
  - 当前 warm heavy worker 数量。
- 资源不足时返回 structured warning/error，或降级为 one-shot。
- 低配机器默认优先稳定完成任务，而不是保温多个模型。

Job folder lifecycle：

- 成功任务可清理中间音频和 tmp。
- 失败任务保留 request/response/error/stderr tail。
- `--keep-temp` 或等价配置用于调试。
- 需要覆盖 disk full、permission denied、output unwritable。

Performance metrics：

- 后续 report/job metadata 应记录：

```text
ffprobe_elapsed_sec
ffmpeg_elapsed_sec
worker_start_elapsed_sec
model_load_elapsed_sec
worker_idle_elapsed_sec
inference_elapsed_sec
translation_elapsed_sec
render_elapsed_sec
total_elapsed_sec
```

- 指标缺失用 null，不伪造。

## Acceptance Criteria

- `go test ./...` 通过。
- Go files 已 `gofmt`。
- `fast-sub-go --version` 可运行。
- `fast-sub-go doctor --json` 输出可解析 JSON。
- `fast-sub-go probe <fixture> --json` 输出可解析 JSON。
- `fast-sub-go extract <fixture> --output <out.wav> --json` 可通过 fake 或真实 ffmpeg smoke。
- 默认测试不下载模型、不访问真实网络、不需要 GPU。
- Python v0 CLI 不被替换。
- Python 实现代码没有无关重构。
- 文档记录 Round 8 的 Go CLI 仍是并行 preview。

## Implementation Prompt

给新 Codex 对话使用：

```markdown
PLEASE IMPLEMENT THIS PLAN:

You are on the Fast Sub repository. Implement Round 8: Go Migration Foundation.

Read first:
- `AGENTS.md`
- `dev-docs/go-docs/project-standards.md`
- `dev-docs/go-docs/specs/round8-go-foundation.md`
- `dev-docs/product/go-migration-plan.md`

Hard constraints:
- Add a parallel Go CLI, do not replace Python `fast-sub`.
- Do not implement transcribe/auto/model inference.
- Do not continue Python refactoring.
- Python edits are allowed only for fixtures/golden contract docs if absolutely needed.
- Use `exec.CommandContext` for ffmpeg/ffprobe.
- Do not use CGo ffmpeg bindings.
- Default tests must not require real models, GPU, network, or real ffmpeg.
- Preserve JSON purity: `--json` stdout must be parseable JSON on success and failure.

Implement:
- `go.mod`
- `cmd/fast-sub-go/main.go`
- Go internal packages for CLI, errors, media, ffmpeg, paths, testutil.
- `fast-sub-go --version`
- `fast-sub-go doctor [--json]`
- `fast-sub-go probe <input> [--json]`
- `fast-sub-go extract <input> --output <wav> [--json]`

Tests:
- Use fake ffmpeg/ffprobe binaries where practical.
- Cover success and common failure JSON.
- Cover Windows paths with spaces and Chinese characters.
- Run `gofmt` and `go test ./...`.
- Do not create unused empty packages.
- Do not add worker manager, job queue, daemon, resource lock, or warm worker implementation in Round 8.
- Python runtime files must remain unchanged except approved fixtures/contract docs.

Final answer must include:
- Files changed.
- Commands implemented.
- Verification results.
- Any compatibility gaps left for Round 9.
```
