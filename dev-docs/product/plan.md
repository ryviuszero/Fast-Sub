# Fast Sub 分阶段验证方案（含多 Provider）

## Summary

`Fast Sub` 先做 CLI，再做桌面 UI。目标是一个开源免费的本地视频字幕工具：默认使用本地高性能 STT/翻译方案，但从架构第一天就支持多 provider，允许用户在本机性能不足、模型下载困难、或需要更高质量时切换到 API provider。

第一阶段不做 Electron UI，只做可组合、可测试、可 benchmark 的 CLI 小项目。核心链路先跑通：

```text
ffmpeg/ffprobe
-> probe
-> extract
-> analyze
-> model manager
-> local-faster-whisper
-> srt
```

后续再接翻译、多 ASR 后端、API provider、自动调度和桌面 UI。

## Architecture

- CLI/调度层：Go。
- Python：只作为模型 worker / AI 生态适配层，不承载主业务流程。
- ASR worker：v0 先调用 Python `faster-whisper` worker，后续可替换为独立二进制。
- C++/native binaries：`ffmpeg`、`ffprobe`、`whisper.cpp`、CTranslate2/ONNX/TensorRT 后端可作为独立 worker 接入。
- UI：后续 Electron + TypeScript，直接调用 CLI 或本地服务。
- Web 版：最后阶段再做，复用同一套 provider/worker contract，避免早期为 Web 改变本地优先架构。
- Go 迁移路线：详见 `dev-docs/product/go-migration-plan.md`。Go 迁移应从并行 CLI 开始，目标是提升分发、进程控制、下载、路径处理、UI/daemon 接入和长期稳定性，而不是承诺大幅提升模型推理速度。
- 主包策略：
  - `ffmpeg/ffprobe` 最终内置。
  - 模型不随主包打包，首次使用时下载。
  - `aria2c` 是否内置延后，取决于项目许可证策略。
- Provider 策略：
  - 默认本地 provider。
  - API provider 默认关闭。
  - 不静默上传音频/文本；任何 API 使用都必须由用户明确选择或配置。

## Worker Boundary

长期边界：

```text
Go = 产品主体 / CLI / 调度器 / 下载器 / 配置 / 日志 / provider 编排
Python = 模型 worker / AI 生态适配层
C++ binaries = ffmpeg / whisper.cpp / CTranslate2 / ONNX / TensorRT 高性能路径
Electron = 后续 UI 壳
Web = 最后阶段的浏览器入口 / 远程任务界面
```

设计原则：

- Go 主程序负责准备音频、写入 request JSON、启动 worker、读取 response JSON、渲染字幕、处理错误。
- Python worker 只负责加载模型、执行推理、返回标准 segments JSON。
- Python worker 不读取主配置文件。
- Python worker 不决定输出路径。
- Python worker 不下载模型。
- Python worker 不直接写 SRT/ASS/MP4。
- Python worker 不处理 API provider，除非它是一个明确命名的 API worker。
- worker 日志只能写 stderr，结构化结果只写 response JSON。
- API key 只传给需要的 API provider，不能传给本地模型 worker。
- 将来如果某个后端有 C++/ONNX/CT2 二进制版本，直接替换对应 worker，不影响 Go 主流程。

推荐 worker 调用形式：

```bash
fast-sub-worker-faster-whisper --request request.json --response result.json
```

v0 也可以先用 Python module 形式：

```bash
python -m fast_sub_workers.faster_whisper --request request.json --response result.json
```

STT worker request 示例：

```json
{
  "job_id": "20260501-001",
  "audio_path": "C:/path/audio.16k.mono.wav",
  "language": "auto",
  "model_path": "C:/FastSub/models/whisper-small",
  "device": "auto",
  "compute_type": "auto",
  "batch_size": 8,
  "vad": "normal",
  "mode": "balanced"
}
```

STT worker response 示例：

```json
{
  "provider": "local-faster-whisper",
  "language": "zh",
  "elapsed_sec": 12.4,
  "segments": [
    {
      "start_sec": 0.0,
      "end_sec": 2.8,
      "text": "你好，欢迎使用 Fast Sub。",
      "confidence": null,
      "words": []
    }
  ],
  "warnings": []
}
```

worker 失败约定：

- 进程 exit code 非 0 表示 worker 失败。
- stderr 输出人类可读错误。
- 如果能生成结构化错误，写入 response JSON：

```json
{
  "error": {
    "code": "MODEL_NOT_FOUND",
    "message": "Model path does not exist.",
    "retryable": false
  }
}
```

## Global CLI Conventions

全局参数：

```bash
fast-sub <command> [args]

--json
--verbose
--workdir <dir>
--output <path>
--overwrite
```

默认目录：

```text
models: 用户数据目录/FastSub/models
jobs:   用户缓存目录/FastSub/jobs
logs:   用户数据目录/FastSub/logs
```

Exit codes：

```text
0 成功
1 通用失败
2 输入文件无效
3 缺少依赖
4 模型未安装
5 下载/校验失败
6 GPU/OOM 失败
7 ffmpeg/ffprobe 失败
8 provider 配置无效
9 API provider 失败
```

## Provider Interfaces

### STT Provider

统一输入：

```text
16kHz mono wav
language: auto|zh|en|ja|ko|...
segments/vad config
mode: fast|balanced|quality
```

统一输出：

```json
{
  "language": "zh",
  "segments": [
    {
      "start_sec": 0.0,
      "end_sec": 3.2,
      "text": "你好，欢迎使用 Fast Sub。",
      "confidence": 0.91,
      "words": []
    }
  ],
  "warnings": []
}
```

Provider 需声明：

```text
id
local/api
supported_languages
supports_word_timestamps
supports_batch
requires_gpu
offline
license
privacy_note
```

v0 实现：

```text
local-faster-whisper
```

后续实现：

```text
local-whisper-cpp
local-sensevoice
local-paraformer
local-parakeet
api-openai-transcription
api-custom-http-stt
```

### Translation Provider

统一输入：

```text
subtitle text array
source language
target language
mode: replace|bilingual
```

统一输出：

```json
{
  "translations": ["Hello, welcome to Fast Sub."],
  "warnings": []
}
```

v0 先定义接口，翻译不阻塞主链路。

v0/Round 7 实现：

```text
local-nllb-ct2
api-openai-chat
web-bing
web-google
```

后续实现：

```text
api-deepl
api-custom-http-translate
```

安全要求：

- API key 不打印到日志。
- API provider 默认关闭。
- API 模式只上传必要音频或文本，不上传原视频。
- `auto --yes` 可以自动下载本地模型，但不能自动启用 API 上传。

## Milestones

## Implementation Checklist

状态说明：

- `[x]` 已在 `master` 合并并通过基础测试。
- `[~]` 已有骨架或部分实现，但还不能视为完整里程碑。
- `[ ]` 尚未开始或应在后续独立分支完成。

当前主线状态：

- [x] 项目重命名为 `fast-sub`，包目录改为 `src/fast_sub`。
- [x] CLI 支持裸命令兼容：`fast-sub input.mp4` 仍进入默认 run 流程。
- [x] `doctor`、`probe`、`extract` 媒体基础能力。
- [x] provider contract 和 `providers list/test` 骨架。
- [x] `refine` 字幕整理能力。
- [x] `models list/install/verify` 模型管理基础能力。
- [x] 模型 manifest 支持目录/多文件语义，适配 faster-whisper/CTranslate2 模型目录。
- [x] 模型下载 hash mismatch 后清理 `.part`，避免污染后续镜像重试。
- [x] 默认模型缓存目录统一为 `用户数据目录/FastSub/models`。
- [x] 测试素材与 benchmark 样本规划，含 `dev-docs/benchmark/test-assets.md` 和 manifest 示例。
- [x] Worker request/response/error schema 和通用 worker runner 骨架。
- [x] `analyze` 音频预分析命令，支持 JSON 输出、稳定 warning 枚举和 VAD/mode 推荐。
- [x] `burn` 字幕烧录命令，支持 ffmpeg 参数构造、preset、字体和 Windows 路径规避策略。
- [x] STT provider/model resolution，支持本地模型状态、依赖状态和 API provider 状态表达。
- [x] `local-faster-whisper` worker，可通过 worker request/response JSON 执行真实 faster-whisper 转写。
- [x] `transcribe` CLI 已接通本地 faster-whisper worker，支持 JSON metadata、`--keep-temp` 和 `--gpu-load`。
- [x] 本地 ASR 依赖提供 `local-asr` optional extra，并在缺依赖时给出安装提示。
- [x] 模型缓存权限异常、坏目录、不可访问文件会返回结构化状态，避免 CLI traceback。
- [x] v0 命令入口已收敛：`auto`、裸命令和 `run` 都走本地 `auto` 链路，旧 OpenAI-compatible / WhisperX 行为不再从默认 CLI 路径静默触发。
- [x] `transcribe` 已为 `auto` 收敛结构化错误、metadata 和用户提示。
- [x] `translate` 命令已实现 Round 7 provider loop：`web-bing`、`web-google`、`api-openai-chat`、`local-nllb-ct2`，支持 replace/bilingual、partial failure、`.errors.json`、checkpoint/resume 和本地 NLLB 模型安装入口。
- [x] `bench` benchmark 报告，含当前本机 CPU/auto baseline 流程、硬件信息、JSON/Markdown 输出。
- [x] `scripts/bench_assets.py` 真实 benchmark 数据准备与受控下载器，详见 `dev-docs/archive/python-rounds/round5-5.md`。
- [x] `auto` 最小自动调度，支持 dry-run、缺模型提示、`--yes` 本地模型安装、transcribe/refine 串联。
- [x] 翻译 provider loop 和默认 NLLB/CTranslate2 翻译模型 manifest。
- [x] 翻译 benchmark，详见 `dev-docs/archive/python-rounds/round7-5.md`：新增独立 `fast-sub bench-translate`，不塞进现有 `fast-sub bench`；复用 `translate_srt_v1`，使用 reference SRT/TXT 计算 BLEU、chrF、exact match、耗时和失败率；默认无 sacreBLEU 时记录 `fast_sub_lightweight_v1` 口径。
- [x] Python maintainability cleanup，详见 `dev-docs/archive/python-rounds/round7-75.md` 和 `dev-docs/archive/python-rounds/round7-75-implementation.md`：已完成 `cli.py` 命令 handler 拆分、轻量分包和 `mypy src` baseline。
- [x] Go migration foundation，新增并行 `fast-sub-go` CLI，详见 `dev-docs/go-docs/specs/round8-go-foundation.md`。
- [x] Go transcribe/auto main path，Go 已能调度本地 faster-whisper worker 生成字幕，详见 `dev-docs/go-docs/specs/round9-go-transcribe-auto.md`。
- [x] Go product core before UI，Go 已实现模型下载、provider runtime、OpenAI STT 和 whisper.cpp native backend，详见 `dev-docs/go-docs/specs/round10-go-product-core.md`。
- [x] Go daemon/job API gate，新增 `fast-sub-go serve/daemon`、REST job API、SSE events、job store 和 cancel/restart 语义，详见 `dev-docs/go-docs/specs/round10-5-go-daemon-job-api.md` 和 `dev-docs/go-docs/specs/daemon-api.md`。
- [ ] 更完整 provider 统一、Electron UI 和 Web 版均放到后续轮次。

第二轮并行组合已完成：

- [x] `codex/fast-sub-test-assets`：整理 benchmark/test-assets 文档、样本元数据和 fixture 策略。
- [x] `codex/fast-sub-worker-contract`：实现 worker request/response schema 和 runner 骨架，不接真实模型。
- [x] `codex/fast-sub-analyze`：实现音频预分析，不依赖 Whisper 模型。
- [x] `codex/fast-sub-burn`：实现 ffmpeg 字幕烧录模块和 CLI。

第三轮和 round3 hardening 已完成：

- [x] `codex/fast-sub-stt-provider-resolution`：实现 STT provider/model resolution。
- [x] `codex/fast-sub-faster-whisper-worker`：实现真实 faster-whisper worker。
- [x] `codex/fast-sub-transcribe-cli`：实现 `fast-sub transcribe` 主流程。
- [x] `codex/fast-sub-transcribe-integration`：接通真实本地转写链路并记录验证。
- [x] `codex/fast-sub-round3-hardening`：修复模型缓存异常处理和本地 ASR 安装提示。

第四轮并行计划见 `dev-docs/archive/python-rounds/round4.md`：

- [x] `codex/fast-sub-transcribe-hardening`：为自动链路收敛转写错误、metadata 和 keep-temp 行为。
- [x] `codex/fast-sub-auto-core`：实现 `auto` dry-run、缺模型提示、`--yes` 本地模型安装、调用 transcribe/refine 的真实最小链路。
- [x] `codex/fast-sub-translate-cli`：第 7 轮实现 `fast-sub translate`、web/API/local translation providers，并支持 `models install nllb-200-distilled-600m-ct2-int8`。

第 7.5 轮计划：

- [x] `codex/fast-sub-translate-bench`：新增独立 `fast-sub bench-translate` 翻译 benchmark，复用 `translate_srt_v1`，通过 reference SRT/TXT 输出 BLEU、chrF、exact match、吞吐、失败率和 JSON/Markdown report；不做 LLM judge，不提交真实媒体、真实 reference 或本地报告。

第 7.75 轮计划：

- [x] `codex/fast-sub-python-cleanup`：Python Maintainability Cleanup Before Go。已完成安全网、`cli.py` 命令 handler 拆分和轻量边界整理；未改变用户命令、参数、JSON schema、退出码、模型安装、转写、翻译或 benchmark 行为。详见 `dev-docs/archive/python-rounds/round7-75.md` 和 `dev-docs/archive/python-rounds/round7-75-implementation.md`。

第五轮和 5.5 轮已完成：

- [x] `codex/fast-sub-bench`：实现 `fast-sub bench`，支持 `transcribe_media_v1` scope、CPU/auto profiles、repeat 聚合、硬件信息、JSON/Markdown report。
- [x] `codex/fast-sub-bench-assets`：实现 `scripts/bench_assets.py` benchmark asset workflow，支持 sources/init/download/prepare/verify、asset/sample 分离、allowed host 校验、安全 archive member 提取和 offline tests。
- [ ] 当前本机真实 baseline 报告：等真实测试样本准备后补跑，输出到 `local_tests/reports/`，不提交个人路径或大媒体。
- [ ] 3060 和更多机器 baseline：上线前补测。

v0 剩余迭代预估：

- 第三轮：`local-faster-whisper` worker 原型 + `transcribe` CLI。已完成。
- 第四轮：`auto` 最小链路。已完成代码与默认测试，真实模型手动验证记录待补。
- 第五轮：benchmark/report 与固定样本回归。已实现 `transcribe_media_v1` scope、CPU/auto profiles、repeat 聚合、JSON/Markdown report 和硬件探测；当前本机真实 baseline 可按 `dev-docs/benchmark/test-assets.md` 的本地流程补跑，3060 和更多机器上线前补测。
- 第 5.5 轮：真实 benchmark 数据准备与受控下载器。已实现开发脚本 `uv run python scripts/bench_assets.py sources/init/download/prepare/verify`，用 manifest 记录官方来源、许可证、download policy、allowed hosts 和 checksum，让 `bench` 有稳定、合法、可复现的本地输入数据；该下载器不作为正式用户 CLI 功能暴露。
- 第六轮：v0 hardening/release，详见 `dev-docs/archive/python-rounds/round6.md`。已收敛 v0 CLI 入口、补充结构化错误/JSON 纯净性 smoke tests、更新 v0 文档和本地优先包装描述；真实模型 smoke 和更多机器 benchmark 仍按手动 release checklist 执行。

因此，当前 v0 的发布边界是“本地原文字幕 CLI”：默认 `auto` 链路、可脚本化 JSON 输出、离线 smoke tests、清晰错误码和手动真实模型 release checklist。翻译、provider 统一、Electron UI 和 Web 版继续作为 v0 后功能，不混入本轮。

后续建议路线：

- 第 7 轮：Translation Provider Loop + 翻译模型安装。已完成。
- 第 7.5 轮：Translation Benchmark。已完成。
- 第 7.75 轮：Python Maintainability Cleanup Before Go。已完成。
- 第 8 轮：Go migration foundation。已完成。
- 第 9 轮：Go 接管 `transcribe/auto` 主链路，继续调用 Python faster-whisper worker。已完成。
- 第 10 轮：Go provider runtime 与 native backend 准备，含 Go 模型下载、OpenAI STT 和 whisper.cpp native backend。已完成。
- 第 10.5 轮：Go daemon/job API gate，提供 UI 可接入的 HTTP REST + SSE job API。已完成。
- 第 11 轮：桌面 UI bridge/shell，启动 Go daemon、读取 ready JSON、保存 token、调用 REST、订阅 SSE、退出时关闭 daemon。
- 第 12 轮：Web 版，复用 job/provider/model contract。

### Milestone 0: CLI 骨架

命令：

```bash
fast-sub --version
fast-sub config get
fast-sub config set <key> <value>
```

验收：

- 能读取/写入本地配置。
- 支持 `--json`。
- 日志目录、模型目录、任务目录可初始化。

### Milestone 1: 环境检查

命令：

```bash
fast-sub doctor
```

检查：

- `ffmpeg` 是否可用。
- `ffprobe` 是否可用。
- Python worker 是否可用。
- GPU/CUDA 粗略状态。
- 模型目录是否可写。
- 已配置 provider 状态。

输出字段：

```text
ffmpeg_found
ffprobe_found
gpu_available
cuda_available
models_dir
providers
warnings
```

验收：

- 没有模型也能运行。
- 缺少 ffmpeg 时给出明确提示。
- 无 API key 时 API provider 显示为未配置，而不是失败崩溃。

### Milestone 2: 媒体探测

命令：

```bash
fast-sub probe input.mp4
```

实现：

- 调用 `ffprobe -print_format json`。
- 解析容器、时长、音频流、视频流。
- 多音轨默认选择第一个有效音频流。

输出字段：

```text
path
duration_sec
container
audio_streams[]
video_streams[]
selected_audio_stream
```

验收：

- 支持 `.mp4/.mov/.mkv/.webm/.mp3/.wav/.m4a`。
- 无音频时 exit code `2`。
- 路径包含空格和中文时可用。

### Milestone 3: 音频抽取

命令：

```bash
fast-sub extract input.mp4
```

默认输出：

```text
<job>/audio.16k.mono.wav
```

ffmpeg 输出规格：

```text
16000 Hz
mono
pcm_s16le
```

参数：

```bash
--audio-stream <index>
--keep-temp
--output audio.wav
```

验收：

- 输出 wav 时长与原音频差异小于 1 秒。
- 视频和纯音频输入都可处理。
- ffmpeg 失败时保留可读错误信息。

### Milestone 4: 音频预分析

命令：

```bash
fast-sub analyze input.mp4
```

分析项：

- 总时长。
- 平均音量。
- 峰值音量。
- 静音比例。
- 简单 VAD 语音段数量。
- 语音占比。
- 平均语音段长度。
- 推荐 VAD 策略。
- 推荐模式。

输出字段：

```text
duration_sec
speech_ratio
silence_ratio
mean_volume_db
peak_volume_db
estimated_segments
avg_segment_sec
recommended_vad: off|normal|aggressive
recommended_mode: fast|balanced|quality
```

初始规则：

- 静音比例 > 15%：`vad=normal`。
- 静音比例 > 35%：`vad=aggressive`。
- 音频低于 2 分钟：可关闭 VAD。
- 语音段非常碎：输出噪声/音乐/多人打断 warning。

验收：

- 不依赖 Whisper 模型。
- 10 分钟视频分析耗时明显低于完整转写。
- JSON 可被 `auto` 复用。

### Milestone 5: 模型管理

命令：

```bash
fast-sub models list
fast-sub models install <id>
fast-sub models verify <id>
```

Manifest 字段：

```text
id
name
type: asr|translate
backend
size_bytes
license
url
mirrors[]
sha256
recommended_for
```

初始模型：

```text
whisper-base
whisper-small
whisper-large-v3-turbo
nllb-200-distilled-600m-ct2-int8
```

下载要求：

- 断点续传。
- 下载前检查磁盘空间。
- 下载后 sha256 校验。
- 已存在且校验通过时不重复下载。

验收：

- 中断后可恢复。
- 校验失败 exit code `5`。
- 能发现缺文件和 hash 不匹配。

### Milestone 6: Provider 管理

命令：

```bash
fast-sub providers list
fast-sub providers test <id>
```

显示字段：

```text
id
type: stt|translate
local/api
status: available|missing_dependency|missing_model|missing_api_key|disabled
privacy_note
```

验收：

- 本地 provider 能说明缺模型还是缺依赖。
- API provider 无 key 时提示配置方法。
- `providers test` 不泄露 API key。

### Milestone 7: Whisper 转写

命令：

```bash
fast-sub transcribe input.mp4
fast-sub transcribe input.mp4 --provider local-faster-whisper
```

参数：

```bash
--provider local-faster-whisper
--model whisper-small
--language auto|zh|en|ja|ko
--device auto|cuda|cpu
--compute auto|float16|int8_float16|int8
--beam-size 1|3|5
--vad off|normal|aggressive
--mode fast|balanced|quality
--output video.srt
```

默认策略：

- provider：`local-faster-whisper`。
- model：`whisper-small`。
- device：`auto`。
- compute：`auto`。
- mode：`balanced`。
- VAD：使用 `analyze` 推荐。

输出字段：

```text
srt_path
provider
model
backend
language_detected
duration_sec
elapsed_sec
rtfx
segments_count
warnings
```

OOM 降级：

```text
降低 batch
-> 切 int8_float16
-> 切 CPU 并提示速度变慢
```

验收：

- 生成有效 SRT。
- 时间轴递增。
- 无负时间、空字幕、明显重叠。

### Milestone 8: 字幕整理

命令：

```bash
fast-sub refine input.srt
```

规则：

- 删除空白字幕。
- 修复重叠时间。
- 合并过短片段。
- 拆分过长文本。
- 限制单条字幕最大字符数。

默认限制：

```text
中文/日文/韩文：单行 18-24 字
英文：单行 42 字左右
单条字幕建议 1-6 秒
```

参数：

```bash
--lang zh|en|ja|ko|auto
--max-chars
--max-duration
--bilingual
```

验收：

- 输出仍是合法 SRT。
- 不改变整体顺序。
- 常见播放器可加载。

### Milestone 9: 翻译

命令：

```bash
fast-sub translate input.srt --provider web-bing --to zh
fast-sub translate input.srt --provider web-google --to zh
fast-sub translate input.srt --provider local-nllb-ct2 --from en --to zh
fast-sub translate input.srt --provider api-openai-chat --model <model> --to zh
```

参数：

```bash
--provider web-bing|web-google|api-openai-chat|local-nllb-ct2
--from auto|en|zh|ja|ko
--to zh|en|ja|ko
--mode replace|bilingual
--bilingual-order original-first|translated-first
--model nllb-200-distilled-600m-ct2-int8
--model-path <path>
--batch-size
--timeout
--sleep-seconds
--resume/--no-resume
```

行为：

- 保留原时间轴。
- web provider 默认逐 cue 翻译，避免不可靠 batch 破坏 cue 对齐。
- 输出行数与输入字幕条数一致。
- 翻译失败的行保留原文并记录 warning。
- partial failure 写最终 SRT 和 `.errors.json`；all failure 非零退出且不写误导性的最终 SRT。
- checkpoint 文件为 `<output>.translate-progress.json`，参数和 input hash 不匹配时不复用。
- `local-nllb-ct2 --from auto` 会先做轻量字幕语言检测；无法可靠判断 `en|zh|ja|ko` 时要求显式 `--from`。NLLB 内部使用 FLORES-200 code：`eng_Latn`、`zho_Hans`、`jpn_Jpan`、`kor_Hang`。
- `translators` 作为 `web-translate` optional extra 处理，以隔离 GPL-3.0 分发风险。

验收：

- 输入 100 条字幕，输出仍为 100 条时间轴。
- API provider 未显式配置时不可用。
- 本地翻译可在 ASR 后释放 ASR 模型再加载 NLLB。
- 远程 provider 必须显式 opt-in；`auto --yes` 不会静默安装翻译模型或启用上传。

### Milestone 10: 字幕烧录

命令：

```bash
fast-sub burn input.mp4 input.srt
```

输出：

```text
<input>.subtitled.mp4
```

参数：

```bash
--font
--font-size
--preset fast|balanced|quality
--output
```

规则：

- 优先保留原音频。
- 视频重新编码。
- 处理 Windows 路径和 CJK 字体。
- 后续支持 ASS 样式。

验收：

- 中文、日文、韩文不乱码。
- 文件可播放。
- 字幕位置正常。

### Milestone 11: Benchmark

命令：

```bash
fast-sub bench input.mp4
fast-sub bench-translate input.srt --reference ref.zh.srt --from en --to zh --provider local-nllb-ct2
fast-sub bench-translate-manifest --json
```

参数：

```bash
--provider
--model
--language
--mode fast|balanced|quality
--repeat 3
```

输出：

- JSON 报告。
- Markdown 报告。
- 翻译 benchmark 报告使用 reference SRT/TXT，输出 BLEU、chrF、exact match、耗时和失败率；这是独立的 `bench-translate` 命令，不复用媒体转写 `bench` 入口。若环境安装 sacreBLEU，报告记录 sacreBLEU signature、raw 0-100 score 和 canonical 0-1 score；否则记录 `metric_implementation=fast_sub_lightweight_v1`，该 lightweight 分数不等价于 sacreBLEU。

指标：

```text
elapsed_sec
rtfx
peak_memory
peak_vram
provider
model
device
compute_type
segments_count
invalid_segments_count
warnings
```

验收：

- 同一输入、同一配置可重复比较。
- 报告可直接附到 issue/PR。
- 本地 provider 和 API provider 的耗时分开记录。
- `bench-translate` 是可复现的粗略质量参考，不是人工质量保证；真实模型、真实媒体、真实 reference 和本地报告不提交仓库。

### Milestone 12: 自动调度

命令：

```bash
fast-sub auto input.mp4
fast-sub auto input.mp4 --yes
fast-sub auto input.mp4 --translate zh
fast-sub auto input.mp4 --burn
```

流程：

```text
doctor
-> probe
-> analyze
-> provider resolution
-> model resolution
-> transcribe
-> refine
-> optional translate
-> optional burn
```

参数：

```bash
--stt-provider auto|local-faster-whisper|api-openai-transcription|...
--translate-provider auto|local-nllb-ct2|api-openai-chat|...
--mode fast|balanced|quality
--translate zh
--burn
--yes
```

默认行为：

- 没模型时提示安装。
- `--yes` 允许自动下载本地模型。
- `--yes` 不允许自动启用 API 上传。
- 本地失败时给出建议：换小模型、CPU、下载模型、或手动选择 API provider。

验收：

- `fast-sub auto input.mp4 --yes` 能从零开始生成字幕。
- 失败时说明卡在哪一步。
- 保留 job 日志。

### Milestone 13: 桌面 UI

后续 Electron UI 只包装 CLI：

```text
拖入视频
-> 选择字幕/翻译/烧录
-> 显示模型下载进度
-> 显示转写进度
-> 打开输出目录
```

验收：

- 两次点击内生成字幕。
- UI 不重复实现核心逻辑。
- 所有任务都能映射到 CLI 命令。

### Milestone 14: Web 版

Web 版放到最后做，目标是复用 CLI/worker/provider contract，而不是重写字幕核心逻辑。

可能形态：

```text
本地 Web UI：浏览器连接本机 Fast Sub daemon，仍然本地处理视频和模型。
托管 Web 版：用户上传音频/视频到服务端，由服务端 provider 执行 STT/翻译。
混合 Web 版：浏览器 UI + 用户自建/私有部署后端。
```

设计要求：

- 不影响本地 CLI、桌面版和 worker contract 的优先级。
- Web API 只封装已有 job/provider/model/task 概念。
- 托管 Web 版必须明确提示上传行为、文件保留策略、隐私边界和费用。
- 本地 Web UI 优先复用本机模型缓存和任务日志。

验收：

- 能通过浏览器提交视频任务、查看进度、下载字幕。
- 和 CLI 生成的 SRT/ASS 行为一致。
- Web 版 provider 选择和本地版保持同一套语义。

## Test Plan

固定测试集：

```text
中文访谈 10 分钟
英文访谈 10 分钟
中英混杂 10 分钟
噪声/背景 5 分钟
韩语 10 分钟
日语 10 分钟
```

基础测试：

```text
正常输入
文件不存在
无音轨视频
输出文件已存在
路径包含空格
路径包含中文
```

Provider contract tests：

```text
每个 STT provider 用同一段 30 秒音频，必须返回合法 segments
每个 Translation provider 输入 10 条字幕文本，必须返回等长数组
API provider 无 key 时必须给出明确错误
日志不得包含 API key
```

SRT 检查：

```text
编号递增
时间轴递增
无负时间
无明显重叠
无空字幕
播放器可加载
```

性能检查：

```text
elapsed_sec
RTFx
peak_memory
peak_vram
model
provider
device
compute_type
```

回归策略：

- 每次改动至少跑 `doctor/probe/extract/analyze/refine`。
- ASR 和翻译作为慢测试单独跑。
- 3060 机器建立一份基准结果。

## Suggested Build Order

1. CLI 骨架与配置。
2. `doctor`。
3. `probe`。
4. `extract`。
5. `analyze`。
6. `models list/install/verify`。
7. `providers list/test`。
8. `transcribe` with `local-faster-whisper`。
9. `refine`。
10. `bench`。
11. benchmark asset helper script。
12. `auto`。
13. `burn`。
14. `translate`。
15. Go migration foundation。
16. Go transcribe/auto main path。
17. Go provider runtime + API/native provider。
18. Go daemon/job API gate。
19. Electron UI bridge/shell。
20. Web 版。

## Assumptions

- v0 只做 CLI。
- v0 优先 Windows，但 Go CLI 尽量保持跨平台。
- v0 只实现一个 STT provider：`local-faster-whisper`。
- v0 翻译接口先设计好，具体实现可晚于字幕主链路。
- v0 后先做翻译闭环，再启动 Go 主体迁移。
- Go 迁移从并行 CLI 开始，不直接替换 Python v0 CLI。
- Python 长期保留为模型 worker / AI 生态适配层。
- 默认不上传任何文件或文本。
- `ffmpeg/ffprobe` v0 可先作为外部依赖，打包阶段再内置。
- 模型下载先用普通 HTTP 断点续传，是否内置 aria2 延后决定。
- Web 版是最后阶段，不参与 v0/v1 的核心实现取舍。
