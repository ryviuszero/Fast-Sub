# Fast Sub 第四轮并行分支计划

第四轮目标是把第三轮已经跑通的手动转写链路，推进成最小自动链路：

```bash
fast-sub auto input.mp4 --yes
```

本轮不追求完整产品化，不做翻译、不做 benchmark 正式报告、不做 UI。重点是让 CLI 能清楚地规划、提示、安装本地模型，并调用已有 `transcribe`/`refine` 能力产出 SRT。

## 当前基线

已合并到 `master` 的能力：

- `doctor`、`probe`、`extract`
- `analyze`
- `refine`
- `burn`
- `models list/install/verify`
- 模型 manifest 目录/多文件支持
- 模型缓存目录统一为 `用户数据目录/FastSub/models`
- 模型下载 hash mismatch 后清理 `.part`
- 模型缓存权限异常返回结构化状态，不让 CLI traceback
- `providers list/test`
- provider/model resolution
- worker request/response/error schema
- `local-faster-whisper` worker
- `fast-sub transcribe` 本地转写链路
- `local-asr` optional extra 和本地 ASR 安装提示

当前仍未实现或未收敛：

- `auto` 仍未实现。
- 缺模型时还没有 `--yes` 自动安装并继续执行的主流程。
- `transcribe` 的错误码和用户提示还需要为 `auto` 收敛。
- 真实本地端到端 smoke 还没有固定成一套可重复验证记录。
- `translate` 仍是占位。
- `bench` 仍未实现。
- 旧 `run` 流程仍保留 OpenAI compatible / WhisperX 路径，后续再清理。

## 第四轮交付目标

第四轮结束时，主分支应至少支持：

```bash
fast-sub auto input.mp4 --dry-run --json
fast-sub auto input.mp4
fast-sub auto input.mp4 --yes
```

期望行为：

- `--dry-run --json` 输出完整执行计划，不下载模型、不调用 worker。
- 缺模型且没有 `--yes` 时，清楚提示需要运行的安装命令。
- 缺模型且有 `--yes` 时，允许自动安装本地模型，然后继续转写。
- 本地转写成功后产出 `.srt`。
- 默认不启用 API provider，不上传音频或文本。
- 失败时能说明卡在哪一步：doctor/probe/analyze/model/provider/transcribe/refine。

最小自动流程：

```text
validate input
-> doctor/readiness check
-> probe
-> analyze
-> provider/model resolution
-> optional local model install when --yes
-> transcribe
-> refine
-> final result
```

JSON 结果建议：

```json
{
  "ok": true,
  "input": "input.mp4",
  "output": "input.srt",
  "provider": "local-faster-whisper",
  "model": "whisper-small",
  "steps": [
    {"name": "probe", "status": "ok"},
    {"name": "analyze", "status": "ok"},
    {"name": "model", "status": "installed"},
    {"name": "transcribe", "status": "ok"},
    {"name": "refine", "status": "ok"}
  ],
  "warnings": []
}
```

## 并行原则

- 两个分支都从最新 `master` 切出。
- 两个分支可以并行。
- `auto-core` 是主功能分支，包含原来的 auto plan、model install flow 和 integration。
- `transcribe-hardening` 是支撑分支，专注让 `transcribe` 更适合被 `auto` 调用。
- 每个分支只做自己章节内的任务。
- 每个分支完成后运行相关测试和 `uv run pytest`。
- 每个分支完成后不要自行合并回 `master`，先回到项目经理对话做 review 和合并判断。
- 不要在第四轮实现翻译、API STT、benchmark 正式报告、Electron UI 或 Web 版。
- 不要让默认测试下载真实模型。
- 不要静默启用 API provider。
- 不要提交大型媒体文件或真实 benchmark 数据文件。
- 推荐先合并 `transcribe-hardening`，再合并 `auto-core`。如果 `auto-core` 先完成，也可以先 review，但合并前应 rebase/merge 最新 `master`。

## 分支总览

| 分支 | 目标 | 主要写入范围 | 是否并行 |
| --- | --- | --- | --- |
| `codex/fast-sub-auto-core` | `auto` dry-run、`--yes` 本地模型安装、真实最小链路 | `auto.py`、CLI、model flow、auto tests、docs | 是 |
| `codex/fast-sub-transcribe-hardening` | 为自动链路收敛转写错误和 metadata | `transcribe.py`、CLI、worker/provider 错误映射、tests | 是 |

## 分支 A：`codex/fast-sub-auto-core`

### 目标

实现第四轮的主功能：`fast-sub auto` 的 dry-run 计划、缺模型提示、`--yes` 本地模型安装，以及真实最小自动链路。

这个分支合并原计划中的：

- `codex/fast-sub-auto-plan`
- `codex/fast-sub-model-install-flow`
- `codex/fast-sub-auto-integration`

原因：这三块都围绕同一套 auto step schema、action hint、CLI 参数和模型状态流转，拆太细会让最后 integration 分支承担大量粘合和冲突。

### 命令

```bash
fast-sub auto input.mp4
fast-sub auto input.mp4 --dry-run
fast-sub auto input.mp4 --dry-run --json
fast-sub auto input.mp4 --yes
fast-sub auto input.mp4 --yes --json
```

### 功能范围

- 新增 `src/fast_sub/auto.py`。
- 在 CLI 中挂接 `auto` 命令。
- 校验输入路径和媒体类型。
- 调用或复用 `probe_media`。
- 调用或复用 `analyze_media`。
- 调用 `resolve_stt_provider`。
- 生成 `AutoPlan` / `AutoStep` 结构。
- `--dry-run` 只输出计划，不下载、不转写、不写 SRT。
- 非 dry-run 时，如果模型缺失且没有 `--yes`，返回清晰错误和 action hint。
- 非 dry-run 时，如果模型缺失且有 `--yes`，调用现有 `install_model` 下载并校验本地模型。
- 模型已安装时直接继续，不重复下载。
- 把下载失败、hash mismatch、权限异常、磁盘不足转换成稳定错误文案。
- 调用 `transcribe_media` 生成原文 SRT。
- 调用 `refine` 或等价内部函数整理最终 SRT。
- 支持 `--provider`、`--model`、`--language`、`--mode`、`--gpu-load`、`--device`、`--compute` 的最小参数透传。
- 支持 `--output`。
- 支持 `--keep-temp`。
- 支持 `--json`，JSON 只写 stdout。
- 保证 `--yes` 只允许自动下载本地模型，不会自动启用 API provider 或授权上传。
- 写入一次手动验证记录到本文档。

### 建议类型

```python
class AutoStep:
    name: str
    status: str
    message: str
    action_hint: str | None

class AutoResult:
    ok: bool
    input: Path
    output: Path
    provider: str
    model: str
    language: str
    mode: str
    dry_run: bool
    steps: list[AutoStep]
    warnings: list[str]
```

非 dry-run 流程：

```text
probe
-> analyze
-> resolve provider/model
-> maybe install model when --yes
-> transcribe_media
-> refine_subtitle_file 或等价内部 refine
-> write final result
```

推荐验证命令：

```bash
$env:UV_CACHE_DIR='.uv-cache'; $env:TMP='.test-work\tmp'; $env:TEMP='.test-work\tmp'; uv run pytest
```

本地真实验证：

```bash
$env:UV_CACHE_DIR='.uv-cache'; $env:TMP='.test-work\tmp'; $env:TEMP='.test-work\tmp'; uv run fast-sub auto local_tests\happy.wav --provider local-faster-whisper --model whisper-base --device cpu --compute int8 --gpu-load low --yes --output .test-work\manual\auto-happy.srt --json --keep-temp
```

如果本地没有 `faster-whisper`：

```bash
$env:UV_CACHE_DIR='.uv-cache'; uv sync --extra local-asr
```

### 不做

- 不实现翻译。
- 不实现 `--burn`。
- 不实现 API fallback。
- 不做 benchmark report。
- 不清理旧 `run` 流程。
- 不实现翻译、烧录、benchmark。
- 不做 UI。
- 不做 aria2。
- 不做并发下载。

### 验收

- `fast-sub auto input.mp4 --dry-run --json` 输出稳定 JSON。
- 缺模型时 plan 中出现 `missing_model` 和安装提示。
- 缺依赖时 plan 中出现 `missing_dependency` 和 `local-asr` 安装提示。
- 缺模型且无 `--yes` 时不下载，错误清楚。
- 缺模型且有 `--yes` 时能调用本地模型安装流程。
- 模型安装失败时错误包含模型 id、失败阶段和可读原因。
- `--yes` 不会对 API provider 做上传授权。
- 本地真实小样本能生成可加载 SRT。
- `--json` 成功和失败输出都可解析。
- `--json` 不混入人类可读日志。
- 相关单测覆盖成功计划、缺模型计划、缺依赖计划、无效输入。
- 默认测试不依赖真实模型或网络。
- 手动验证命令、环境、结果、剩余风险写入文档。
- `uv run pytest` 通过。

### 启动提示

```text
请从最新 master 创建/切换到 codex/fast-sub-auto-core。阅读 FAST_SUB_PLAN.md 和 FAST_SUB_PARALLEL_ROUND4.md，只实现“分支 A：codex/fast-sub-auto-core”的任务。实现 fast-sub auto 的 dry-run 计划、缺模型提示、--yes 本地模型安装、调用 transcribe/refine 的真实最小链路。不要实现翻译、burn、API fallback、benchmark report、UI、旧 run 清理、aria2 或并发下载。完成后运行相关测试和 uv run pytest，并尽可能用本地模型做一次真实 auto 验证，记录命令、结果和剩余风险。
```

## 分支 B：`codex/fast-sub-transcribe-hardening`

### 目标

让 `transcribe` 更适合作为 `auto` 的内部步骤：错误更稳定，metadata 更完整，用户提示更友好。

### 功能范围

- 梳理 `transcribe_media` 的错误输出，减少 traceback 和底层 worker 噪声。
- 对常见失败给出明确阶段：
  - `missing_model`
  - `missing_dependency`
  - `EMPTY_SEGMENTS`
  - `MODEL_NOT_FOUND`
  - `TRANSCRIBE_FAILED`
  - ffmpeg/ffprobe 失败
- JSON 错误输出保持机器可读。
- metadata 中保留 provider/model/device/compute/gpu_load/batch_size/duration/elapsed/rtfx。
- `--gpu-load` 和 `--batch-size` 的优先级补测试。
- 保证 `--keep-temp` 下 request/response/metadata 可用于排查。
- 可以增加内部结果类型，方便 `auto` 读取成功/失败阶段。

### 建议文件

- `src/fast_sub/transcribe.py`
- `src/fast_sub/cli.py`
- `tests/test_transcribe.py`
- `tests/test_cli_transcribe.py`

### 不做

- 不实现 `auto`。
- 不自动安装模型。
- 不实现 OOM 多级降级。
- 不实现 API STT。
- 不实现翻译。

### 验收

- fake worker 成功路径保持通过。
- 缺依赖提示包含 `local-asr` 或明确安装命令。
- 缺模型提示包含 `fast-sub models install <id>`。
- 空语音/空 segments 错误清楚。
- `--json` 错误输出可解析。
- `--keep-temp` 行为有测试覆盖。
- `uv run pytest` 通过。

### 启动提示

```text
请从最新 master 创建/切换到 codex/fast-sub-transcribe-hardening。阅读 FAST_SUB_PLAN.md 和 FAST_SUB_PARALLEL_ROUND4.md，只实现“分支 B：codex/fast-sub-transcribe-hardening”的任务。重点是为 auto 收敛 transcribe 错误、metadata 和 keep-temp 行为，不实现 auto，不自动安装模型，不接 API STT 或翻译。完成后运行相关测试和 uv run pytest，并总结改动、验证结果、剩余风险。
```

## 推荐合并顺序

```text
1. codex/fast-sub-transcribe-hardening
2. codex/fast-sub-auto-core
```

原因：

- `transcribe-hardening` 先收敛底层错误、metadata 和 keep-temp 行为，能降低 `auto-core` 的适配风险。
- `auto-core` 集中处理 auto schema、模型安装、真实串联和文档验证，避免多个 auto 分支重复设计 step/action hint。
- 如果 `auto-core` 先完成，也可以先 review；合并前需要同步 `transcribe-hardening` 后的主分支并修正少量接口差异。

## 第四轮不做

- 翻译 provider 和 `fast-sub translate`
- API STT provider
- API translation provider
- `bench` 正式报告
- 完整 GPU/OOM 自动降级
- Electron UI
- Web 版
- 旧 `run` 流程清理
- aria2 下载器
- 打包/安装器

## 第四轮后续

第五轮建议做：

- `bench` 正式报告。
- 固定样本回归。
- 3060 性能基线。
- 真实样本 manifest 与手动 slow tests。

第六轮建议做：

- v0 hardening/release。
- 统一 exit code。
- 清理旧 `run` 流程。
- 完善 README/安装文档。
- 打包前检查和端到端 smoke tests。

## 第四轮完成记录

合并到 `master` 的提交：

```text
0b9ae32 fix: harden transcribe errors
372612f feat: add auto subtitle pipeline
```

已完成：

- `fast-sub auto` 命令已挂接到 CLI。
- `auto` 支持 `--dry-run` 和 `--json`。
- 缺模型且无 `--yes` 时给出安装提示，不自动下载。
- 缺模型且有 `--yes` 时调用本地模型安装流程。
- `auto` 默认只使用本地 STT provider，不用 `--yes` 授权 API 上传。
- `auto` 成功路径会调用 `transcribe`，再调用 `refine` 写出最终 SRT。
- `transcribe` 已提供结构化错误：`stage`、`code`、`message`、`action_hint`。
- `transcribe` metadata 已包含 provider/model/device/compute/gpu_load/batch_size/duration/elapsed/rtfx。
- `--keep-temp` 成功和失败路径都有 metadata 测试覆盖。

默认测试：

```bash
$env:UV_CACHE_DIR='.uv-cache'; $env:TMP='.test-work\tmp'; $env:TEMP='.test-work\tmp'; uv run pytest
```

结果：

```text
146 passed
```

剩余风险：

- 尚未补充真实本地模型的 `fast-sub auto ... --yes` 手动验证记录。
- 默认测试不下载真实模型，也不依赖 `faster-whisper` 真实推理。
- `auto` 仍只覆盖原文字幕最小链路，不包含翻译、烧录、benchmark、API fallback 或完整 OOM 降级。
- 旧 `run` 流程仍存在 OpenAI compatible / WhisperX 路径，后续 v0 hardening 再收敛。
