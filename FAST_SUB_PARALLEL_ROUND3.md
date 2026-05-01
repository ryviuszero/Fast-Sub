# Fast Sub 第三轮并行分支计划

第三轮目标是进入核心转写闭环：让本地 `local-faster-whisper` 能通过 Fast Sub 的 provider/model/worker 架构被正式调起，并产出合法 SRT。

第三轮不追求极致性能和完整自动化，优先把最小本地字幕链路跑通：

```bash
fast-sub transcribe input.mp4 --provider local-faster-whisper --model whisper-small --output input.srt
```

## 当前基线

已合并到 `master` 的相关能力：

- `doctor`、`probe`、`extract`
- `analyze`
- `refine`
- `burn`
- `models list/install/verify`
- `providers list/test`
- provider contract 骨架
- worker request/response/error schema
- worker runner 骨架
- test assets / benchmark manifest 规划

当前仍未实现或未接通：

- `transcribe` 仍是占位命令。
- `local-faster-whisper` 还没有真实 worker。
- provider/model resolution 还没有独立收敛。
- `auto` 还不能做最小链路调度。
- 翻译仍未 provider 化。

## 第三轮交付目标

第三轮结束时，主分支应至少支持：

```bash
fast-sub transcribe input.mp4 --provider local-faster-whisper --model whisper-small --output input.srt
```

并输出：

- 合法 SRT。
- 基础 JSON metadata。
- 清晰错误：
  - 输入不存在。
  - 无音轨。
  - `ffmpeg` / `ffprobe` 失败。
  - 模型未安装。
  - worker 依赖缺失。
  - worker 返回空 segments 或非法 segments。
- 可被后续 `auto` 复用的 transcribe API。

JSON metadata 建议字段：

```json
{
  "srt_path": "input.srt",
  "provider": "local-faster-whisper",
  "model": "whisper-small",
  "language_detected": "zh",
  "duration_sec": 600.0,
  "elapsed_sec": 58.2,
  "rtfx": 10.31,
  "segments_count": 120,
  "warnings": []
}
```

## 并行原则

- 第三轮前三个分支可以并行。
- 第四个 integration 分支必须等前三个分支合并后再开。
- 每个分支只做自己章节内的任务。
- 不要在第三轮实现 `auto`、翻译、API STT、benchmark 正式报告、Electron UI 或 Web 版。
- 不要让 CI 下载真实模型。
- 真实模型测试用本地手动验证或 slow test 说明，不作为默认测试前置条件。
- worker 日志只写 stderr，结构化结果只写 response JSON。
- API provider 默认不启用，不静默上传任何音频或文本。

## 分支总览

| 分支 | 目标 | 主要写入范围 | 是否并行 |
| --- | --- | --- | --- |
| `codex/fast-sub-stt-provider-resolution` | 收敛 provider/model 解析 | `provider_resolution.py`、tests | 是 |
| `codex/fast-sub-faster-whisper-worker` | 真实 faster-whisper worker | `fast_sub_workers/`、worker tests | 是 |
| `codex/fast-sub-transcribe-cli` | `fast-sub transcribe` 主流程 | `transcribe.py`、CLI、tests | 是 |
| `codex/fast-sub-transcribe-integration` | 端到端接线与真实运行修正 | integration glue/docs/tests | 否，等前三个合并 |

## 分支 A：`codex/fast-sub-stt-provider-resolution`

### 目标

把“选哪个 provider、哪个模型、模型在哪里、为什么不可用”独立成可测试模块，避免 `transcribe` 命令堆积决策逻辑。

### 功能范围

- 新增 STT provider/model resolution 层。
- 输入：
  - `provider_id`
  - `model_id`
  - `language`
  - `device`
  - `compute_type`
- 输出：
  - provider id
  - model id
  - model path
  - provider type
  - provider location
  - model backend
  - model installed
  - provider status
  - missing reason
  - privacy note
  - action hint
  - local/api 标记
- 检查 `local-faster-whisper` 是否是已知 provider。
- 检查 provider 是否是 STT provider。
- 检查模型 id 是否存在于 manifest。
- 检查模型 `type` 是否是 `asr`。
- 检查模型 `backend` 是否与 provider 兼容，例如 `local-faster-whisper` 只能使用 `backend=faster-whisper` 的模型。
- 检查模型是否安装。
- 模型未安装时返回结构化错误或 unavailable result，不自动下载。
- API provider 只保留状态表达，不实际调用。

### 建议文件

- `src/fast_sub/provider_resolution.py`
- `tests/test_provider_resolution.py`

### 建议类型

```python
class ProviderResolution:
    provider_id: str
    model_id: str
    model_path: Path | None
    provider_type: str
    provider_location: str
    model_backend: str | None
    model_installed: bool
    status: str
    message: str
    local: bool
    privacy_note: str
    action_hint: str | None
```

状态建议：

```text
available
missing_model
missing_dependency
missing_api_key
unknown_provider
unknown_model
incompatible_model
disabled
```

### 不做

- 不调用 worker。
- 不下载模型。
- 不实现 `transcribe` CLI。
- 不实现 `auto`。
- 不接 API STT。

### 验收

- `local-faster-whisper + whisper-small` 能解析到模型路径。
- 模型缺失时返回 `missing_model`。
- 模型 backend 与 provider 不匹配时返回 `incompatible_model`。
- provider 不是 STT 类型时错误清晰。
- 未知 provider 错误清晰。
- 未知 model 错误清晰。
- API provider 无 key 时表达为不可用，不崩溃。
- 模型缺失时给出可执行提示，例如 `fast-sub models install whisper-small`。
- 不泄露 API key。
- `uv run pytest` 通过。

### 启动提示

```text
请从最新 master 创建/切换到 codex/fast-sub-stt-provider-resolution。阅读 FAST_SUB_PLAN.md 和 FAST_SUB_PARALLEL_ROUND3.md，只实现“分支 A：codex/fast-sub-stt-provider-resolution”的任务。不要调用 worker，不下载模型，不实现 transcribe CLI，不做 auto。完成后运行相关测试和 uv run pytest，并总结改动、验证结果、剩余风险。
```

## 分支 B：`codex/fast-sub-faster-whisper-worker`

### 目标

实现真实 `local-faster-whisper` worker，但先不接主 CLI。这个分支只负责“给定 request JSON，返回标准 worker response JSON”。

### 功能范围

- 新增 Python worker 入口。
- 读取 `--request request.json`。
- 写入 `--response response.json`。
- 校验 request schema。
- 校验模型目录存在。
- 导入并调用 `faster_whisper`。
- 输出标准 `SttWorkerResponse`。
- stderr 只写日志。
- worker 失败时尽量输出结构化 `WorkerErrorResponse`。
- faster-whisper 的 `segments` 是 generator；worker 必须在 try/计时范围内完成 `segments = list(segments)`，确保真实推理、错误捕获和 elapsed 统计都发生在 worker 内。
- `batch_size > 1` 时应使用 `faster_whisper.BatchedInferencePipeline`；如果暂不支持 batched pipeline，必须忽略 batch 并返回 warning，不能让参数静默失效。

支持参数：

- `language`: `auto|zh|en|ja|ko|...`
- `device`: `auto|cuda|cpu`
- `compute_type`: `auto|float16|int8_float16|int8`
- `batch_size`
- `vad`: `off|normal|aggressive`
- `mode`: `fast|balanced|quality`

v0 可以保守处理：

- `device=auto`：优先用 CTranslate2/faster-whisper 能识别的 CUDA 可用性判断；无法确认时用 cpu。
- `compute_type=auto`：cuda 默认 `float16`，cpu 默认 `int8`。
- `vad` 映射：
  - `off`: `vad_filter=False`
  - `normal`: `vad_filter=True`
  - `aggressive`: `vad_filter=True`，并使用更短 `min_silence_duration_ms`
- `mode` 映射：
  - `fast`: `beam_size=1`
  - `balanced`: `beam_size=5`
  - `quality`: `beam_size=5`，v0 可先与 balanced 相同并返回 warning
- 成功 response 的 `elapsed_sec` 应只统计 worker 内模型加载、转写和结果转换耗时。

### 建议文件

- `src/fast_sub_workers/__init__.py`
- `src/fast_sub_workers/faster_whisper.py`
- `tests/test_faster_whisper_worker.py`

### Worker error code 建议

```text
MODEL_NOT_FOUND
MISSING_DEPENDENCY
INVALID_REQUEST
TRANSCRIBE_FAILED
EMPTY_SEGMENTS
UNSUPPORTED_DEVICE
```

### 不做

- 不实现 `transcribe` CLI。
- 不下载模型。
- 不改模型 manifest，除非发现 manifest 与真实加载完全不兼容。
- 不接 API provider。
- 不做 OOM 多级降级。
- 不要求 CI 下载真实模型。

### 验收

- 模型不存在返回 `MODEL_NOT_FOUND`。
- `faster-whisper` 未安装返回 `MISSING_DEPENDENCY`。
- invalid request 返回 `INVALID_REQUEST`。
- mock faster-whisper 可单测成功路径。
- mock 覆盖 generator segments，确认 worker 会消费 generator。
- batch_size > 1 时覆盖 `BatchedInferencePipeline` 调用，或覆盖 warning。
- vad/mode 到 faster-whisper 参数的映射有单元测试。
- 成功路径输出合法 worker response。
- stderr 不污染 response JSON。
- `uv run pytest` 通过。

### 启动提示

```text
请从最新 master 创建/切换到 codex/fast-sub-faster-whisper-worker。阅读 FAST_SUB_PLAN.md 和 FAST_SUB_PARALLEL_ROUND3.md，只实现“分支 B：codex/fast-sub-faster-whisper-worker”的任务。实现真实 faster-whisper worker 入口，但不要接 transcribe CLI，不下载模型，不实现 auto。默认测试必须通过 mock/fake，不要求 CI 下载真实模型。完成后运行相关测试和 uv run pytest，并总结改动、验证结果、剩余风险。
```

## 分支 C：`codex/fast-sub-transcribe-cli`

### 目标

实现 `fast-sub transcribe` CLI 主流程。这个分支可以先用 fake/mock worker 测试主流程，不强依赖真实 faster-whisper worker 合并。

### 命令

```bash
fast-sub transcribe input.mp4
fast-sub transcribe input.mp4 --provider local-faster-whisper --model whisper-small
fast-sub transcribe input.mp4 --language auto --output out.srt
fast-sub transcribe input.mp4 --json
```

### 参数

```text
--provider local-faster-whisper
--model whisper-small
--language auto|zh|en|ja|ko
--device auto|cuda|cpu
--compute auto|float16|int8_float16|int8
--batch-size 8
--vad auto|off|normal|aggressive
--mode fast|balanced|quality
--output
--json
--keep-temp
```

默认值：

- `--provider`: `local-faster-whisper`
- `--model`: `whisper-small`
- `--language`: `auto`
- `--device`: `auto`
- `--compute`: `auto`
- `--batch-size`: `8`
- `--vad`: `auto`
- `--mode`: `balanced`

### 流程

```text
validate input
-> probe
-> extract 16k mono wav
-> optionally analyze for vad/mode when vad=auto
-> provider/model resolution
-> build worker request
-> run worker
-> validate segments
-> render SRT
-> write metadata / JSON output
```

### 建议文件

- `src/fast_sub/transcribe.py`
- `src/fast_sub/cli.py`
- `tests/test_transcribe.py`
- `tests/test_cli_transcribe.py`

### Segment 校验

- segments 不得为空。
- `start_sec`、`end_sec` 不得为负。
- `end_sec` 必须大于 `start_sec`。
- 文本为空的 segment 应被丢弃或触发 warning。
- 输出 SRT 时间轴必须递增。
- 明显重叠应修复或报错；v0 可以先轻度修复后 warning。

### JSON 输出字段

```json
{
  "srt_path": "out.srt",
  "provider": "local-faster-whisper",
  "model": "whisper-small",
  "language_detected": "zh",
  "duration_sec": 600.0,
  "elapsed_sec": 58.2,
  "worker_elapsed_sec": 55.7,
  "rtfx": 10.31,
  "segments_count": 120,
  "warnings": []
}
```

JSON / 日志约定：

- `--json` 时，结构化 JSON 只写 stdout。
- 进度、worker stderr 摘要和人类可读日志写 stderr。
- `elapsed_sec` 表示端到端 CLI 耗时。
- `worker_elapsed_sec` 来自 worker response。
- `rtfx = duration_sec / elapsed_sec`；如果 duration 缺失，则 `rtfx=null`。

`--keep-temp` 约定：

- 保留 prepared wav。
- 保留 worker request JSON。
- 保留 worker response JSON。
- 保留 metadata JSON。
- 当前 worker runner 使用临时目录时，transcribe 分支必须扩展 runner 支持 `keep_temp/output_dir`，或在 transcribe 层复制 request/response 到 job 目录。

### 不做

- 不接 API STT。
- 不实现 `auto`。
- 不实现翻译。
- 不做 OOM 多级降级。
- 不做 benchmark 正式报告。

### 验收

- fake worker 返回 segments 后能生成合法 SRT。
- segments 为空时报错。
- 非法时间轴被拒绝或修复并 warning。
- 空文本 segment 应丢弃并记录 warning。
- 轻微 overlap 可按稳定规则修复并 warning，例如 `start=max(start, previous_end)`；修复后 `end<=start` 的 segment 必须丢弃或报错。
- `--json` 输出稳定字段。
- `--json` 不混入人类可读日志。
- `--keep-temp` 能保留 job 音频和中间 request/response。
- 默认不上传任何文件。
- `uv run pytest` 通过。

### 启动提示

```text
请从最新 master 创建/切换到 codex/fast-sub-transcribe-cli。阅读 FAST_SUB_PLAN.md 和 FAST_SUB_PARALLEL_ROUND3.md，只实现“分支 C：codex/fast-sub-transcribe-cli”的任务。实现 fast-sub transcribe 主流程，可以用 fake/mock worker 测试；不要接 API STT，不实现 auto，不实现翻译，不做 benchmark。完成后运行相关测试和 uv run pytest，并总结改动、验证结果、剩余风险。
```

## 分支 D：`codex/fast-sub-transcribe-integration`

### 目标

前三个分支合并后，开 integration 分支，把真实 `local-faster-whisper` worker、provider/model resolution 和 `transcribe` CLI 接成端到端链路。

### 功能范围

- 连接 provider resolution、worker runner、faster-whisper worker。
- 用本地模型目录跑真实样本。
- 补 slow test 说明或手动验证文档。
- 记录 3060 推荐默认参数。
- 记录真实验证环境和性能数据。
- 修正真实运行暴露的问题。
- 更新 README 或计划文档中的实际使用命令。

真实验证记录模板：

```json
{
  "os": "Windows 11",
  "python_version": "3.13.x",
  "gpu": "RTX 3060",
  "cuda_available": true,
  "model": "whisper-small",
  "provider": "local-faster-whisper",
  "device": "cuda",
  "compute_type": "float16",
  "batch_size": 8,
  "input_duration_sec": 60.0,
  "elapsed_sec": 8.4,
  "rtfx": 7.14,
  "segments_count": 18,
  "warnings": []
}
```

### 推荐验证命令

```bash
fast-sub models verify whisper-small
fast-sub transcribe tests/fixtures/sample.wav --provider local-faster-whisper --model whisper-small --output local_tests/output/sample.srt --json
```

如果 `tests/fixtures/sample.wav` 太短或不适合作为真实 ASR 输入，可改用 `FAST_SUB_TEST_ASSETS.md` 中的本地小样本。

### 不做

- 不实现 `auto`。
- 不实现翻译。
- 不实现 API STT。
- 不做完整 benchmark report。
- 不做 Electron UI。

### 验收

- 真实本地模型能生成可加载 SRT。
- 模型未安装时错误明确，不自动下载。
- faster-whisper 依赖缺失时错误明确。
- 真实成功、模型缺失、依赖缺失三条路径都有验证记录。
- JSON metadata 字段稳定。
- 本地手动验证步骤写入文档。
- slow/integration test 不作为默认测试前置条件；如果加入测试，必须标记为 slow 或写入手动验证文档。
- `uv run pytest` 通过。

### 启动提示

```text
请从最新 master 创建/切换到 codex/fast-sub-transcribe-integration。阅读 FAST_SUB_PLAN.md 和 FAST_SUB_PARALLEL_ROUND3.md。前三个第三轮分支已合并后，接通真实 local-faster-whisper worker、provider/model resolution 和 fast-sub transcribe CLI。不要实现 auto、翻译、API STT 或 benchmark report。完成后运行 uv run pytest，并尽可能用本地模型做一次真实转写验证，记录命令、结果和剩余风险。
```

## 推荐合并顺序

前三个分支并行开发，合并顺序建议：

```text
1. codex/fast-sub-stt-provider-resolution
2. codex/fast-sub-faster-whisper-worker
3. codex/fast-sub-transcribe-cli
4. codex/fast-sub-transcribe-integration
```

原因：

- provider/model resolution 是 `transcribe` 的决策基础。
- faster-whisper worker 是真实本地转写能力。
- transcribe CLI 可以先用 fake worker 独立验证主流程。
- integration 分支负责最终接线和真实运行修正，必须等前三者合并。

## 第三轮不做

第三轮不要扩大到以下范围：

- `fast-sub auto`
- 翻译 provider 和 `fast-sub translate`
- API STT provider
- OOM 多级自动降级
- benchmark 正式报告
- Electron UI
- Web 版
- 模型自动下载交互
- 打包/安装器

## 第三轮后续

第三轮完成后，第四轮再做：

- `auto` 最小链路。
- 模型缺失时的交互提示和 `--yes` 自动安装本地模型。
- 更完整的 GPU/OOM 降级策略。
- 端到端 smoke tests。

第五轮再做：

- `bench` 正式报告。
- 固定样本回归。
- 3060 性能基线。

第六轮再做：

- v0 hardening/release。
- 统一错误码。
- 清理旧 `run` 流程。
- 完善文档和打包前检查。
