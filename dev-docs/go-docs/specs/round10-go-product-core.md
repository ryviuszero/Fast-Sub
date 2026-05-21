# Fast Sub Round 10: Go Product Core Before UI

## Summary

Round 10 是 UI 前的 Go 核心封口轮。目标是让下一轮桌面 UI 可以主要调用 `fast-sub-go`，不再绕回 Python CLI 做模型下载、provider 判断或主链路编排。

本轮必须完成：

- Go 侧统一模型下载、安装和校验。
- Go 侧 provider registry、provider 状态检查和隐私边界。
- Round 9 的 `transcribe` / `auto` 支持 `--model <id>`，并继续兼容 `--model-path <path>`。
- Go 侧真实 `api-openai-transcription` provider。
- Go 侧 `local-whisper-cpp` native backend。

Round 10 的最小 UI gate 是模型管理、provider 状态和 `--model <id>` 本地主链路。`api-openai-transcription` 与 `local-whisper-cpp` 仍属于本轮目标，但必须作为独立 provider gate 接入同一 registry，避免任一 backend 阻塞模型管理和本地 faster-whisper 主路径。

长期边界保持不变：

```text
Go = 产品主体 / CLI / 下载 / provider runtime / job orchestration / UI contract
Python = faster-whisper worker / NLLB worker / AI adapter
Native binaries = ffmpeg / ffprobe / whisper.cpp / future ONNX/TensorRT workers
UI = 调用 Go CLI 或 Go daemon，不重复实现字幕核心逻辑
```

## Current State

Round 8 已实现并行 Go CLI foundation：

- `fast-sub-go --version`
- `fast-sub-go doctor [--json]`
- `fast-sub-go probe <input> [--json]`
- `fast-sub-go extract <input> --output <wav> [--json]`

Round 9 已实现 Go 本地字幕主路径 preview：

- `fast-sub-go transcribe <input> --model-path <path> [--json]`
- `fast-sub-go auto <input> --model-path <path> [--yes] [--json]`
- Go 负责 probe、extract、worker request、worker process、worker response validation、SRT render 和 JSON 输出。
- Python 仍作为 `fast-sub-worker-faster-whisper` worker。

Round 9 仍有 UI 前缺口：

- Go 还不能通过模型 ID 安装和解析模型。
- Go 还没有 `models list/install/verify`。
- Go 还没有 `providers list/test`。
- Go 还没有真实 API STT provider。
- Go 还没有 whisper.cpp native backend。
- `auto --yes` 还不能从零下载本地模型并生成字幕。

## Branches And Worktrees

Round 10 可以开多个 worktree 并行，但必须按依赖顺序合并。推荐 4 个分支：

```text
codex/fast-sub-go-models-download
codex/fast-sub-go-provider-runtime
codex/fast-sub-go-openai-stt
codex/fast-sub-go-whisper-cpp
```

推荐合并顺序：

```text
1. codex/fast-sub-go-models-download
2. codex/fast-sub-go-provider-runtime
3. codex/fast-sub-go-openai-stt
4. codex/fast-sub-go-whisper-cpp
```

`openai-stt` 和 `whisper-cpp` 可以先并行实现，但合并时必须基于 provider runtime 的最终接口调和。

## Goals

- 所有下载能力归 Go 管理。
- Go 支持模型 manifest、模型安装、校验、锁和断点续传。
- Go 支持 `providers list/test`。
- Go 支持 `transcribe/auto --model <id>`。
- Go 支持 `api-openai-transcription` 真实调用。
- Go 支持 `local-whisper-cpp` native provider。
- `auto --yes` 只允许自动下载本地模型，不允许静默启用 API 上传。
- 下一轮 UI 可以依赖 Go 的 JSON 输出、错误码和 provider/model 状态。

## Non-Goals

- 不替换 Python `fast-sub` 稳定入口。
- 不在 Go 中运行 faster-whisper 推理。
- 不用 CGo 链接 whisper.cpp。
- 不实现 Electron UI。
- 不实现 Web。
- 不实现完整 daemon/job API；如果 UI 前仍需要 daemon，另开 Round 10.5。
- 不实现 Go 翻译 provider runtime。
- 不静默下载或启用 API provider。
- 不引入 aria2、外部消息队列、插件系统、复杂 worker pool 或 daemon/job API。
- 不实现 ASR/翻译并发流水线、chunk-level 并发 ASR、自动性能调度或模型预热。
- 不在默认测试中访问真实网络、真实 OpenAI、真实模型、GPU 或真实 ffmpeg。
- 不提交模型文件、下载产物、真实媒体、API key、本机路径或 benchmark 报告。

## Round 10 Simple Decisions

本轮采用简单、可替换、可测试的实现，不提前引入复杂系统：

- 下载器：使用 Go 内置 HTTP downloader，接口命名预留 `DownloadBackend`，默认实现为 `native-http`。
- provider registry：使用 Go 静态 registry，不实现动态插件、外部 manifest provider 加载或运行时 provider 安装。
- provider test：默认只做静态检查，不联网、不上传；live test 延后。
- 性能策略：只记录关键耗时指标，不实现自动调度、预热、chunk 并发或 ASR/翻译流水线。
- 日志：Round10 只做 stderr 普通日志和 JSON stdout 纯净性；JSONL progress events 留到 daemon/UI 轮次。
- 资源管理：只做基础磁盘空间检查和外部进程 timeout；RAM/VRAM 预算、worker idle timeout 和并发限制延后。
- 配置：优先 CLI flag + 环境变量；复杂 Go-side config schema 可先不做，除非实现 provider/model 必须。
- 项目结构：按稳定职责拆包，但不做抽象过度设计。

## Go Project Structure Constraints

Round10 新增 Go 代码必须遵守以下结构约束。包名可按实际已有 Round8/Round9 代码微调，但职责边界不能混用：

```text
cmd/fast-sub-go/
internal/cli/
internal/contracts/
internal/errors/
internal/logging/
internal/media/
internal/ffmpeg/
internal/models/
internal/downloads/
internal/providers/
internal/runtime/openai/
internal/runtime/whispercpp/
internal/runtime/fasterwhisper/
internal/paths/
internal/worker/
internal/subtitle/
internal/testutil/
```

职责：

- `cmd/fast-sub-go/`：只负责入口、版本注入和调用 CLI dispatcher。
- `internal/cli/`：命令解析、stdout/stderr 策略、exit code 映射；不直接实现下载、provider 或转写细节。
- `internal/contracts/`：UI-facing JSON schema、provider/model/worker contract、golden fixture helper；避免散落在各 runtime 包里。
- `internal/errors/`：稳定错误码、action hint、redaction 后的错误包装。
- `internal/logging/`：stderr 日志、redaction、第三方 stdout/stderr tail 处理；不得写 JSON stdout。
- `internal/models/`：manifest、model resolver、model store、verify/install orchestration。
- `internal/downloads/`：HTTP downloader、resume、lock、checksum、staging directory；不得知道 provider 业务。
- `internal/providers/`：静态 provider registry、metadata、availability check、provider resolution。
- `internal/runtime/openai/`：OpenAI-compatible transcription HTTP client，只处理 API provider runtime。
- `internal/runtime/whispercpp/`：whisper.cpp binary discovery、capability detection、execution、output parse。
- `internal/runtime/fasterwhisper/`：Round9 Python worker adapter 的 Go 侧封装。
- `internal/media/`、`internal/ffmpeg/`：probe/extract/normalize 规则和 ffmpeg/ffprobe subprocess。
- `internal/paths/`：model store、job temp、output path、Windows/UNC/path traversal 规则。
- `internal/worker/`：Python worker subprocess protocol，不承载 provider registry。
- `internal/subtitle/`：Segment、SRT render/parse、timestamp validation。
- `internal/testutil/`：fake HTTP server、fake ffmpeg、fake worker、fake whisper.cpp binary、JSON golden helpers。

依赖方向：

- `cli` 可以依赖 application/runtime-facing 包，但 runtime 包不能依赖 `cli`。
- `models` 可以依赖 `downloads`、`paths`、`contracts`、`errors`，不能依赖 provider runtime。
- `providers` 可以依赖 `models` 的只读 resolver interface，不能调用 downloader。
- `runtime/*` 可以依赖 `media`、`ffmpeg`、`subtitle`、`contracts`、`errors`，不能互相依赖。
- `contracts`、`errors`、`paths` 应保持底层稳定，不依赖高层业务包。

禁止：

- 禁止为了 Round10 引入 service locator、通用插件框架、全局 mutable registry 或反射式 provider 加载。
- 禁止 provider runtime 直接写 stdout。
- 禁止 model downloader 直接调用 provider test 或 transcribe。
- 禁止把 OpenAI、whisper.cpp、faster-whisper 的特殊字段塞进通用 `Segment`；特殊能力放在 provider capability 或 metadata。
- 禁止为了未来 UI 提前实现 daemon、queue、worker pool、progress websocket。

## Workstream 1: Go Models Download

分支：

```text
codex/fast-sub-go-models-download
```

目标：

- 新增 Go model store。
- 实现：

```bash
fast-sub-go models list [--json]
fast-sub-go models verify <id> [--json]
fast-sub-go models install <id> [--json]
```

模型 manifest 至少支持：

```text
id
name
type: asr|translate|binary
backend
artifact_kind: model|binary|manifest
compatible_providers[]
version/revision
size_bytes
license
license_url
urls[]
sha256
required_files[]
default_for
privacy_class
install_layout
source_type
etag
platforms[]
min_disk_free_bytes
estimated_ram_bytes
```

下载要求：

- HTTP 下载。
- `.part` 临时文件。
- resume。
- 如果服务端不支持 Range 或 ETag/Last-Modified 变化，必须从头重新下载。
- sha256 校验。
- per-model lock。
- staging directory 安装，成功后再 atomic rename 到最终目录。
- 检测 stale lock，并给出可执行 action hint。
- checksum mismatch 清理损坏 `.part`。
- 并发 install 同一 model id 时只有一个写入者。
- 安装成功后 verify directory/multi-file 完整性。
- 安装前检查磁盘空间，不足时返回 `disk_full`。
- 不依赖 symlink 作为 Windows 默认安装布局；Windows 默认使用真实文件或后续明确支持 hardlink fallback。
- manifest 中的相对路径必须防止 path traversal，不能写出 model store。
- JSON 模式 stdout 保持纯 JSON。

新增命令：

```bash
fast-sub-go models install <id> --dry-run [--json]
```

`--dry-run` 输出下载计划、目标目录、文件列表、总大小、校验策略、预计磁盘需求和隐私/license 提示，不写入模型目录。

本轮不要求：

- aria2。
- P2P。
- 复杂镜像测速。
- UI 进度条协议。
- 自动更新 manifest。

测试：

- fake HTTP server。
- 小 fixture 文件。
- resume。
- Range 不支持 / ETag 变化时重新下载。
- checksum mismatch。
- staging directory 成功 rename / 失败清理。
- lock contention。
- stale lock。
- missing required file。
- inaccessible path。
- disk full。
- path traversal 被拒绝。
- dry-run JSON。
- JSON success/failure 可 `json.Unmarshal`。

## Workstream 2: Go Provider Runtime

分支：

```text
codex/fast-sub-go-provider-runtime
```

目标：

- 新增 Go provider registry。
- 实现：

```bash
fast-sub-go providers list [--json]
fast-sub-go providers test <id> [--json]
```

Provider 至少包含：

```text
local-faster-whisper
local-whisper-cpp
api-openai-transcription
```

Provider 状态：

```text
available
missing_dependency
missing_model
missing_api_key
invalid_config
disabled
not_implemented
```

Provider metadata 至少包含：

```text
id
type: stt|translate
location: local|api|native
backend
offline
requires_api_key
requires_model
privacy_note
supported_languages
supports_word_timestamps
supports_batch
capabilities[]
compatible_model_types[]
```

隐私规则：

- local provider 标记为本地处理。
- API provider 明确提示会上传音频。
- `auto --yes` 不允许因为 provider resolution 自动选择 API provider。
- API key、Authorization、raw secret 不得出现在 stdout、stderr、JSON 或测试输出。
- provider list/test 默认不得触发真实音频上传。

`providers test` 语义：

- 默认执行静态检查，只验证依赖、binary、worker、模型、API key 是否配置，不调用真实网络 API。
- `api-openai-transcription` 的静态 API key 检查使用与 `transcribe` 相同的 Go 配置读取顺序：`FAST_SUB_OPENAI_API_KEY` / `OPENAI_API_KEY`，或配置文件中的 `api_key_env` 指向的环境变量。
- OpenAI-compatible provider 配置文件读取顺序统一为：`--config <path>`（transcribe 命令）、`FAST_SUB_GO_CONFIG`、当前工作目录 `fast-sub-go.toml`；`providers test` 没有命令级 `--config`，因此使用后两者。
- 如果请求的配置文件不存在或解析失败，`providers test api-openai-transcription` 必须返回 `invalid_config`，即使环境中同时存在 API key；这与 `transcribe` 的配置加载失败语义保持一致。
- 后续如需要真实连通性，另加 `--live`，并要求用户显式确认 API provider 可能联网或上传测试数据。
- 静态检查和 live 检查的 JSON 字段必须可区分，例如 `check_mode: static|live`。

测试：

- provider list JSON shape。
- local-faster-whisper 缺 worker / 缺模型 / available。
- local-whisper-cpp 缺 binary / 缺模型 / available。
- api-openai-transcription 缺 API key / env configured / config-file `api_key_env` configured / invalid config。
- secret redaction。

## Workstream 3: Go OpenAI STT Provider

分支：

```text
codex/fast-sub-go-openai-stt
```

目标：

- 实现真实 `api-openai-transcription`。
- 支持显式 provider：

```bash
fast-sub-go transcribe input.mp4 --provider api-openai-transcription --model <model> --json
```

配置来源：

- CLI 显式 model，或配置文件中的显式 `model`。
- API key 通过环境变量或显式配置 key name；配置文件只允许保存 `api_key_env`，不得保存 raw API key。`transcribe` 和 `providers test` 必须复用同一套配置解析。
- base URL 可通过 CLI 或配置文件配置，便于 OpenAI-compatible endpoint。
- `api_upload_format` 和 `words` 可通过 CLI 或配置文件配置。
- 配置文件读取顺序：`--config <path>`、`FAST_SUB_GO_CONFIG`、当前工作目录 `fast-sub-go.toml`。

配置文件示例：

```toml
[providers.api-openai-transcription]
model = "gpt-4o-transcribe"
api_key_env = "OPENAI_API_KEY"
base_url = "https://api.openai.com/v1"
api_upload_format = "auto"
words = false
```

项目根目录提供 `fast-sub-go.toml` / example 配置作为本地默认位置示例；真实 key 应只存在于环境变量中。

行为要求：

- 必须显式选择 API provider。
- 必须显式 model；不设隐藏默认模型。显式来源可以是 CLI `--model` 或配置文件 `model`。
- API provider 不强制使用 16k mono wav 上传；官方 OpenAI base URL 默认优先压缩上传格式，避免 wav 放大后误触 25MB 限制。
- 本轮至少预留 `api_upload_format` 配置，取值建议为 `auto|wav|m4a|mp3`；`auto` 默认选择压缩格式，除非兼容 endpoint 明确要求 wav。
- 官方 OpenAI base URL 才默认启用 25MB 上传检查；OpenAI-compatible endpoint 不硬套官方限制，除非用户显式配置。
- API response 转成统一 segments，再复用 Go SRT renderer。
- OpenAI 官方模型参数能力必须按模型区分：`whisper-1` 可优先 `verbose_json` + segment timestamps，并且仅当 `words=true` / `--word-timestamps on` 时请求 word timestamps；`gpt-4o-transcribe` / `gpt-4o-mini-transcribe` 不假设支持同样 timestamp 参数。
- 网络/API 错误返回结构化 `api_failed` 或现有兼容错误码。
- API key 和 Authorization 必须 redacted。

默认测试：

- mock HTTP server。
- 不访问真实 OpenAI。
- 覆盖成功、401、429、5xx、invalid JSON、timeout、secret redaction、配置文件读取、拒绝配置文件 raw API key。
- 验证 JSON stdout 纯净。

手动 smoke：

```bash
fast-sub-go transcribe sample.mp4 --provider api-openai-transcription --model <model> --json
```

手动 smoke 需要真实 API key，不纳入默认测试。

## Workstream 4: Go Whisper.cpp Native Backend

分支：

```text
codex/fast-sub-go-whisper-cpp
```

目标：

- 实现 `local-whisper-cpp` native provider。
- Go 调用外部 whisper.cpp binary，不使用 CGo。
- 支持：

```bash
fast-sub-go transcribe input.mp4 --provider local-whisper-cpp --model <id> --json
fast-sub-go transcribe input.mp4 --provider local-whisper-cpp --model-path <path> --json
```

Binary 发现顺序：

1. CLI option，如果本轮增加。
2. `FAST_SUB_WHISPER_CPP_COMMAND`。
3. PATH lookup。
4. Go-managed binary install path，如果 manifest 已支持 binary 类型。
5. `missing_dependency`。

输出解析策略：

- 启动前检测 binary capability，例如 `--version` / `--help` 是否支持 `--output-json`、`--output-json-full`、`--output-srt`、`--output-file`、`--no-prints` 和 `--language auto`。
- 优先让 whisper.cpp 输出 JSON；不支持 JSON 时才 fallback 到 SRT。
- 调用时强制使用 `--no-prints` 或等效静默参数，provider stdout/stderr 不得污染 `fast-sub-go --json`。
- 输出文件写入 job temp directory，解析后由 Go 统一渲染最终 SRT。
- Go 读取输出并转换成统一 `Segment`。
- 最终 SRT 仍由 Go 统一 renderer 生成，避免 provider 输出格式漂移。
- 解析必须覆盖 CJK 文本、空 segment、非法 timestamp 和不同 whisper.cpp 版本输出差异。

本轮要求：

- fake binary 测试。
- path with spaces / Chinese path。
- binary capability detection。
- missing binary。
- missing model。
- non-zero exit。
- invalid output。
- CJK JSON/SRT 输出。
- JSON stdout 纯净。

本轮不要求：

- whisper.cpp CMake 构建。
- GPU backend 自动选择。
- CUDA/Metal/Vulkan packaging。
- 性能调优。

## Workstream 5: Transcribe/Auto Integration

目标：

- `--model-path` 继续最高优先级。
- `--model <id>` 通过 Go model resolver 查找已安装模型。
- `auto --yes --model <id>` 可以自动安装本地模型。
- `auto --yes` 不会安装或启用 API provider。
- provider resolution 默认仍偏向本地 provider。

目标命令：

```bash
fast-sub-go transcribe input.mp4 --provider local-faster-whisper --model whisper-small --json
fast-sub-go transcribe input.mp4 --provider local-whisper-cpp --model whisper-small --json
fast-sub-go transcribe input.mp4 --provider api-openai-transcription --model <model> --json
fast-sub-go auto input.mp4 --model whisper-small --yes --json
```

缺模型时：

- 非 `--yes`：返回 `missing_model`，提示 install 命令。
- `--yes` + local provider：尝试 Go `models install`。
- API provider：不安装本地模型，不静默上传。

## UI Gate

Round 10 完成后才进入 Round 11 UI。UI 开始条件：

- Go 能下载、校验、解析模型。
- Go 能列出 provider 状态。
- Go 能测试 provider 可用性。
- Go 能跑 local-faster-whisper。
- Go 能跑 local-whisper-cpp。
- Go 能跑 api-openai-transcription。
- Go 的 `--json` 成功/失败输出稳定。
- Go 的错误码覆盖：

```text
invalid_input
missing_dependency
missing_worker
missing_model
missing_api_key
download_failed
hash_mismatch
api_failed
provider_unavailable
worker_failed
worker_protocol_error
ffmpeg_failed
ffprobe_failed
output_exists
permission_denied
disk_full
```

如果 UI 需要进度、取消和后台任务，而 CLI one-shot 不够稳定，则先做 Round 10.5 Go daemon/job API gate。

## JSON Contract

Round 10 的 UI-facing JSON 必须稳定，所有新命令的成功/失败输出都包含：

```text
schema_version
ok
command
result
warnings[]
error
action_hint
```

要求：

- `models list/install/verify`、`providers list/test`、`transcribe`、`auto` 都要有 contract golden fixture。
- JSON stdout 不能混入日志、进度、第三方 binary 输出或 worker stdout。
- secret、Authorization、API key、签名 URL、proxy credential、本机绝对路径在错误和日志中必须 redacted。
- 成功 JSON 和失败 JSON 都必须可由 UI 直接 `json.Unmarshal`。

## Final Acceptance Commands

Round 10 最终至少支持：

```bash
fast-sub-go models list --json
fast-sub-go models install whisper-small --json
fast-sub-go models verify whisper-small --json

fast-sub-go providers list --json
fast-sub-go providers test local-faster-whisper --json
fast-sub-go providers test local-whisper-cpp --json
fast-sub-go providers test api-openai-transcription --json

fast-sub-go transcribe input.mp4 --provider local-faster-whisper --model whisper-small --json
fast-sub-go transcribe input.mp4 --provider local-whisper-cpp --model whisper-small --json
fast-sub-go transcribe input.mp4 --provider api-openai-transcription --model <model> --json

fast-sub-go auto input.mp4 --model whisper-small --yes --json
```

## Test Plan

默认自动化测试：

```bash
go test ./...
```

默认测试必须满足：

- 不访问真实网络。
- 不下载真实模型。
- 不需要 GPU。
- 不需要真实 ffmpeg。
- 不需要真实 whisper.cpp。
- 不需要真实 OpenAI API key。

测试重点：

- fake HTTP downloader。
- fake ffmpeg / ffprobe。
- fake faster-whisper worker。
- fake whisper.cpp binary。
- mock OpenAI-compatible HTTP server。
- Windows paths with spaces and Chinese characters。
- JSON stdout purity。
- JSON golden contract。
- secret redaction。
- concurrent install lock。
- hash mismatch / `.part` cleanup。
- dry-run install。
- disk full / permission denied。
- provider static test 不联网。
- OpenAI official 25MB policy 与 compatible endpoint 行为分离。

手动 release smoke：

- 真实 ffmpeg。
- 真实 faster-whisper worker。
- 真实 whisper 模型下载。
- 真实 whisper.cpp binary。
- 可选真实 OpenAI-compatible STT。

手动 smoke 输出只记录在本地报告中，不提交仓库。

## Merge Criteria

每个 workstream 合并前必须：

- `gofmt` applied。
- `go test ./...` pass。
- 不破坏已合并 Go CLI 命令。
- 不破坏 Python `fast-sub`。
- 不提交大文件、模型、真实媒体、API key、本地路径或下载产物。
- JSON success/failure 可解析。
- 错误码和隐私边界写入测试。

最终 Round 10 合并后：

- `master` 上 Round 10 acceptance commands 的 fake/default 测试通过。
- `dev-docs/product/go-migration-plan.md` 和本文件状态一致。
- Round 11 UI 可以基于 Go core 继续规划。

## Deferred

- Electron UI。
- Web。
- Go translation provider runtime。
- Go daemon/job API，除非 UI 前必须补。
- whisper.cpp GPU packaging。
- aria2 或高级下载加速。
- 多机器真实 benchmark 矩阵。

## Open Questions For Further Research

这些点暂不在 Round 10 内拍死，后续需要继续调查和设计：

| Topic | Round10 action | Future research |
| --- | --- | --- |
| aria2 / 高级下载器 | 不实现；只保留 `DownloadBackend` 接口和 `native-http` 默认实现 | 是否支持 aria2c、multipart range、镜像测速、代理、限速、断点元数据；外部 aria2 和 Go 内置下载器如何共享 JSON/progress/error contract |
| 更多 provider | 静态 registry；只实现 `local-faster-whisper`、`local-whisper-cpp`、`api-openai-transcription` | 后续 `local-whisperx`、`local-parakeet`、`api-elevenlabs`、`api-deepgram`、`api-example-ai`、Go translation providers 是否需要 manifest-driven registry 或插件机制 |
| 快速字幕生成策略 | 只记录耗时指标；不做自动调度 | 自动选择最快 backend、模型推荐、音频预切片、VAD、chunk 并发 ASR、GPU/CPU 估计、模型预热、质量回退 |
| ASR/翻译并发 | 不实现；Round10 只做 source subtitle generation provider core | 长视频是否边 ASR 边翻译；chunk-level pipeline 如何保证时间轴、顺序、失败重试、断点恢复和隐私边界 |
| 日志与进度 | stderr 普通日志 + JSON stdout 纯净；第三方输出只作为 redacted tail | daemon/UI 是否采用 JSONL progress events；日志级别、结构化字段、job id、progress stage、取消事件如何统一 |
| 项目结构 | 按 `Go Project Structure Constraints` 拆包；不做插件框架 | 如果 provider 数量增长，是否需要更强的 application/service 层或 package boundary lint |
| 资源管理 | 只做磁盘空间检查、外部进程 timeout、基础 cleanup | RAM/VRAM 预算、worker 并发限制、idle timeout、低资源自动降级、ASR 与翻译 worker 互斥策略 |
| 配置系统 | CLI flag + 环境变量优先；只补必要最小配置 | Go 是否读取 Python v0 config；Go-side config schema、secret storage、配置迁移和 UI 设置同步 |
| 模型来源与许可 | manifest 支持 URL、sha256、license/privacy；不做自动 manifest 更新 | Hugging Face、GitHub Release、自建镜像、手动导入、license acceptance、镜像信任和离线包 |
| 跨平台二进制 | binary discovery + capability detection；不构建/打包 whisper.cpp | ffmpeg/whisper.cpp/native workers 的安装、签名、版本检测、升级、GPU variant 选择 |
| benchmark 闭环 | provider/model metadata 字段尽量复用 bench 需求 | 是否让 bench 直接消费 provider registry，避免 UI、CLI、bench 三套 provider 描述漂移 |
