# Fast Sub 第二轮并行分支计划

本文档用于从最新 `master` 同时启动四个更稳妥的 Codex 实现对话。第一轮基础分支已经合并，第二轮目标是在不抢同一批核心文件的前提下推进 `analyze`、worker 协议、字幕烧录和测试素材体系。

## 当前基线

已合并到 `master` 的能力：

- `doctor`、`probe`、`extract`
- `providers list/test` 和 provider contract 骨架
- `refine`
- `models list/install/verify`
- 模型 manifest 目录/多文件支持
- 模型缓存目录修复
- 下载 hash mismatch 后清理 `.part`

当前仍是占位或未实现的能力：

- `analyze`
- `transcribe`
- `translate`
- `burn`
- `bench`
- `auto`
- Electron UI
- Web 版

## 并行原则

- 四个分支都从最新 `master` 切出。
- 每个分支只做自己章节内的任务。
- 每个分支可以为了挂接命令少量修改 `src/fast_sub/cli.py`，但不要改其它分支的命令参数、输出 schema 或行为。
- 每个分支完成后运行本分支相关测试和 `uv run pytest`。
- 每个分支完成后不要自行合并回 `master`，先回到项目经理对话做 review 和合并判断。
- 不要在第二轮提前实现 `auto`、完整 `transcribe`、完整 `translate`。
- 不要静默引入真实网络 API 调用。
- 不要提交大型媒体文件。

## 分支总览

| 分支 | 目标 | 主要写入范围 | 冲突风险 |
| --- | --- | --- | --- |
| `codex/fast-sub-analyze` | 音频预分析 | `analyze.py`、CLI、analyze tests | 中 |
| `codex/fast-sub-worker-contract` | Worker 协议和 runner 骨架 | `worker_models.py`、`worker_runner.py`、worker tests | 低 |
| `codex/fast-sub-burn` | ffmpeg 字幕烧录 | `burn.py`、CLI、burn tests | 中 |
| `codex/fast-sub-test-assets` | 测试素材与 benchmark 样本规划 | docs、fixture manifest | 低 |

## 分支 A：`codex/fast-sub-analyze`

### 目标

实现无模型依赖的音频预分析：

```bash
fast-sub analyze input.mp4
fast-sub analyze input.mp4 --json
```

这个分支的产物后续会被 `auto` 用来选择 VAD、转写模式和用户提示。

### 功能范围

- 复用现有 `probe` / `extract` / ffmpeg 能力。
- 支持视频和纯音频输入。
- 输出人类可读结果和 JSON 结果。
- 不依赖 Whisper、faster-whisper、WhisperX、NLLB 或任何模型。
- 可使用 `ffmpeg` 的 `silencedetect` / `volumedetect`。
- 如果选择 wav 扫描，必须保持实现轻量，不引入重型音频依赖。

### JSON 输出字段

```json
{
  "duration_sec": 600.0,
  "speech_ratio": 0.82,
  "silence_ratio": 0.18,
  "mean_volume_db": -22.5,
  "peak_volume_db": -2.1,
  "estimated_segments": 86,
  "avg_segment_sec": 5.7,
  "recommended_vad": "normal",
  "recommended_mode": "balanced",
  "warnings": []
}
```

字段约束：

- `speech_ratio + silence_ratio` 应接近 `1.0`。
- `recommended_vad` 只能是 `off`、`normal`、`aggressive`。
- `recommended_mode` 只能是 `fast`、`balanced`、`quality`。
- `warnings` 必须是字符串数组。
- `warnings` 字符串必须来自稳定枚举，便于后续 `auto` 和 `bench` 解析：
  - `LOW_VOLUME`
  - `CLIPPING_RISK`
  - `FRAGMENTED_SPEECH`
  - `HIGH_SILENCE_RATIO`
  - `UNKNOWN_DURATION`
- 实现内部应保留 silence/speech intervals 计算结果，即使 v0 不在 JSON 中输出，避免后续 `auto` 需要重算。
- 如果实现选择输出 intervals，应使用稳定字段名：

```json
{
  "silence_segments": [
    {"start_sec": 12.3, "end_sec": 15.8, "duration_sec": 3.5}
  ]
}
```

### 初始规则

- 推荐规则优先级从高到低：
  1. 静音比例大于 35%：`recommended_vad=aggressive`。
  2. 静音比例大于 15%：`recommended_vad=normal`。
  3. 音频低于 2 分钟且静音比例不大于 15%：`recommended_vad=off`。
  4. 其它情况：`recommended_vad=normal`。
- 语音段非常碎：加入噪声、背景音乐或多人打断 warning。
- 平均音量过低：加入低音量 warning。
- 峰值接近 0 dB：加入削波或爆音风险 warning。
- `recommended_mode` v0 可先按简单规则实现：
  - 时长很短且音量正常：`fast`。
  - 默认：`balanced`。
  - 有碎片化语音、低音量或高静音比例 warning：`quality`。

### 建议文件

- `src/fast_sub/analyze.py`
- `src/fast_sub/cli.py`
- `tests/test_analyze.py`
- `tests/test_cli_analyze.py`

### 不做

- 不实现 `auto`。
- 不实现 `transcribe`。
- 不下载模型。
- 不修改 worker contract。
- 不修改模型 manifest。
- 不引入真实 ASR。

### 验收

- `fast-sub analyze tests/fixtures/sample.wav --json` 输出稳定 JSON。
- 缺少文件、无音轨、ffmpeg 失败时错误清晰。
- 规则函数可单元测试，不需要真实长视频。
- warning 枚举和推荐规则必须有单元测试。
- `uv run pytest` 通过。

### 启动提示

```text
请从最新 master 创建/切换到 codex/fast-sub-analyze。阅读 FAST_SUB_PLAN.md 和 FAST_SUB_PARALLEL_ROUND2.md，只实现“分支 A：codex/fast-sub-analyze”的任务。重点是 fast-sub analyze input.mp4 和 --json，不依赖任何 ASR 模型，不实现 auto/transcribe/translate。完成后运行相关测试和 uv run pytest，并总结改动、验证结果、剩余风险。
```

## 分支 B：`codex/fast-sub-worker-contract`

### 目标

建立本地 worker 调用协议和 runner 骨架，后续用于：

- `local-faster-whisper`
- `local-whisper-cpp`
- `local-nllb-ct2`
- 将来的 ONNX / TensorRT / 独立二进制 worker

### 功能范围

- 优先复用或扩展现有 `src/fast_sub/provider_models.py` 中的 provider request/response/segment schema。
- 只有当现有 schema 无法表达 worker 错误或 runner 状态时，才新增 `worker_models.py`。
- 定义 worker request schema。
- 定义 worker response schema。
- 定义 worker error schema。
- 实现通用 worker runner：
  - 写 request JSON。
  - 启动子进程。
  - 等待 exit code。
  - 读取 response JSON。
  - 捕获 stderr。
  - 校验 response shape。
  - 将错误映射为项目内可读异常。
- 用 fake worker 覆盖成功和失败路径。

### 建议 schema

STT worker request：

```json
{
  "schema_version": 1,
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

STT worker response：

```json
{
  "schema_version": 1,
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

Worker error：

```json
{
  "schema_version": 1,
  "error": {
    "code": "MODEL_NOT_FOUND",
    "message": "Model path does not exist.",
    "retryable": false,
    "details": {},
    "stderr_tail": ""
  }
}
```

Runner 约束：

- 子进程命令必须使用 argv list，不使用 shell。
- request JSON 写入文件，response JSON 从文件读取。
- stdout/stderr 只作为日志或错误上下文，不作为结构化数据通道。
- stderr 捕获时需要按 bytes 接收并容错解码，避免 Windows GBK/UTF-8 混合输出导致崩溃。
- 必须支持 timeout；超时错误要清晰，至少终止 worker 主进程。
- response 缺失、JSON 无效、schema 无效、exit code 非 0 都应映射成项目内可读异常。
- `job_id` 可由调用方传入；未传时 runner 应生成稳定可读的默认值。

### 建议文件

- `src/fast_sub/provider_models.py`（优先扩展）
- `src/fast_sub/worker_models.py`（仅在错误/runner schema 需要时新增）
- `src/fast_sub/worker_runner.py`
- `tests/test_worker_models.py`
- `tests/test_worker_runner.py`
- `tests/fixtures/workers/`

### 不做

- 不接真实 faster-whisper。
- 不安装或声明重型模型依赖。
- 不实现 `transcribe` CLI。
- 不下载模型。
- 不调用 API provider。
- 不修改 `analyze` 输出。

### 验收

- request、response、error 都可 JSON 序列化和反序列化。
- 成功 fake worker 返回合法 segments。
- runner 不通过 stdout 读取结构化结果。
- runner 不使用 shell 拼接命令。
- timeout 路径错误清晰。
- worker exit code 非 0 时错误清晰。
- response 文件不存在时错误清晰。
- response JSON 无效时错误清晰。
- schema 无效时错误清晰。
- stderr 只作为日志/错误上下文，不污染结构化结果。
- `uv run pytest` 通过。

### 启动提示

```text
请从最新 master 创建/切换到 codex/fast-sub-worker-contract。阅读 FAST_SUB_PLAN.md 和 FAST_SUB_PARALLEL_ROUND2.md，只实现“分支 B：codex/fast-sub-worker-contract”的任务。只做 worker 协议和 runner 骨架，用 fake worker 测试，不接真实 faster-whisper，不实现 transcribe CLI。完成后运行相关测试和 uv run pytest，并总结改动、验证结果、剩余风险。
```

## 分支 C：`codex/fast-sub-burn`

### 目标

实现 ffmpeg 字幕烧录能力：

```bash
fast-sub burn input.mp4 input.srt
fast-sub burn input.mp4 input.srt --output output.mp4
```

### 功能范围

- 检查输入视频存在。
- 检查输入字幕存在。
- 检查 ffmpeg 可用。
- 生成默认输出：`<input>.subtitled.mp4`。
- 支持 `--output`。
- 支持 `--font`。
- 支持 `--font-size`。
- 支持 `--preset fast|balanced|quality`。
- 优先保留原音频。
- 视频重新编码。
- 处理 Windows 路径、空格路径和中文路径。
- 对字体或字幕滤镜失败给出清晰错误。

### 建议实现

- 单独封装 ffmpeg 参数构造，方便测试。
- CLI 层只负责参数解析和错误展示。
- Windows 字幕路径优先采用“复制到 job 临时目录 + 简单相对文件名”的策略，避免 `subtitles=` filter 直接解析 `C:\...`、UNC、空格或中文路径。
- 如果实现仍需要 filter 路径转义，路径转义逻辑必须有单元测试。
- ffmpeg 执行时可以设置 cwd 为 job 临时目录，并将字幕文件命名为简单 ASCII 文件名，例如 `subtitle.srt`。
- `--preset` 映射必须固定，建议：
  - `fast`: `-preset veryfast -crf 26`
  - `balanced`: `-preset medium -crf 23`
  - `quality`: `-preset slow -crf 20`
- `--font` 和 `--font-size` 通过 `force_style` 传给 subtitles filter；不要在本分支实现完整 ASS 样式系统。
- 如果 ffmpeg 缺少 `subtitles` filter 或 libass 支持，错误信息应明确指出当前 ffmpeg 不支持字幕烧录。
- 不要把复杂 ASS 样式系统放进本分支。

### 建议文件

- `src/fast_sub/burn.py`
- `src/fast_sub/cli.py`
- `tests/test_burn.py`
- `tests/test_cli_burn.py`

### 不做

- 不做 ASS 样式编辑器。
- 不实现翻译。
- 不实现自动调度。
- 不修改 `analyze`。
- 不修改 worker contract。
- 不修改模型管理。

### 验收

- 缺少输入视频时 exit code 和错误清晰。
- 缺少字幕时 exit code 和错误清晰。
- 缺少 ffmpeg 时 exit code 和错误清晰。
- ffmpeg 参数构造可测试。
- 字幕路径包含空格或中文时不会被错误拼接。
- Windows 绝对路径、UNC 路径、空格路径、中文路径至少覆盖参数构造单元测试。
- 字幕 filter 失败时错误信息包含 stderr 摘要。
- 有 ffmpeg 的环境下可生成可播放 MP4。
- `uv run pytest` 通过。

### 启动提示

```text
请从最新 master 创建/切换到 codex/fast-sub-burn。阅读 FAST_SUB_PLAN.md 和 FAST_SUB_PARALLEL_ROUND2.md，只实现“分支 C：codex/fast-sub-burn”的任务。只做 ffmpeg 字幕烧录，不做 auto、不做翻译、不改 worker contract。完成后运行相关测试和 uv run pytest，并总结改动、验证结果、剩余风险。
```

## 分支 D：`codex/fast-sub-test-assets`

### 目标

建立 benchmark 和回归测试素材规划，让后续性能验证有稳定样本体系。

### 功能范围

- 新增测试素材文档。
- 定义样本元数据 manifest 示例。
- 明确哪些素材可以随仓库分发，哪些只能本地准备。
- 明确下载来源、许可证、语言、时长、噪声特征。
- 给后续 `bench` 命令预留字段。

### 固定测试集

- 中文访谈 10 分钟
- 英文播客/访谈 10 分钟
- 中英混杂视频 10 分钟
- 背景音乐/噪声视频 5 分钟
- 韩语视频 10 分钟
- 日语视频 10 分钟

### Manifest 建议字段

```json
{
  "id": "zh-interview-10m",
  "language": "zh",
  "duration_sec": 600,
  "media_type": "video",
  "noise_profile": "clean_speech",
  "source_url": "https://example.com/video",
  "license": "CC-BY-4.0",
  "redistributable": false,
  "local_path": "local_tests/media/zh-interview-10m.mp4",
  "checksum_sha256": null,
  "reference_transcript_path": "local_tests/references/zh-interview-10m.txt",
  "reference_subtitle_path": "local_tests/references/zh-interview-10m.srt",
  "expected_language": "zh",
  "domain": "interview",
  "speaker_count": 2,
  "has_music": false,
  "has_overlap_speech": false,
  "target_metrics": ["rtfx", "wer", "segments_count"],
  "prepared_audio_path": "local_tests/audio/zh-interview-10m.16k.mono.wav",
  "expected_use": ["probe", "extract", "analyze", "transcribe", "bench"],
  "notes": ""
}
```

素材分层：

- 仓库内小 fixture：5-15 秒、体积极小、可重新生成或许可证清晰，用于 CI smoke tests。
- 本地 benchmark 大样本：不提交仓库，只提交 manifest 示例和人工准备说明。
- reference transcript/subtitle：如果版权允许可以提交；否则只记录本地路径和准备方法。
- 每个大样本应尽量记录 checksum，保证不同机器 benchmark 可比较。

### 建议文件

- `FAST_SUB_TEST_ASSETS.md`
- `tests/fixtures/README.md`
- `tests/fixtures/manifest.example.json`

### 不做

- 不提交大型视频或音频文件。
- 不做下载器。
- 不做 benchmark runner。
- 不改 CLI。
- 不改模型下载。
- 不接网络下载逻辑。

### 验收

- 文档足够指导人工准备测试集。
- manifest 示例字段能支持后续 `bench`。
- 清楚区分仓库内小 fixture 和本地大样本。
- manifest 能同时支持性能指标和质量指标，例如 RTFx、WER、segments_count。
- 明确 reference transcript/subtitle 的许可证和是否可分发。
- 如果只改文档，可以不跑完整测试；若改测试文件，运行 `uv run pytest`。

### 启动提示

```text
请从最新 master 创建/切换到 codex/fast-sub-test-assets。阅读 FAST_SUB_PLAN.md 和 FAST_SUB_PARALLEL_ROUND2.md，只实现“分支 D：codex/fast-sub-test-assets”的任务。只整理测试素材文档、manifest 示例和小 fixture 策略，不提交大型媒体文件，不改 CLI。完成后总结改动、验证结果、剩余风险。
```

## 推荐合并顺序

```text
1. codex/fast-sub-test-assets
2. codex/fast-sub-worker-contract
3. codex/fast-sub-analyze
4. codex/fast-sub-burn
```

原因：

- `test-assets` 基本只改文档和 fixture manifest，最容易先合。
- `worker-contract` 是后续 `transcribe` 的基础，应尽早稳定。
- `analyze` 是 `auto` 的前置条件，但不依赖 worker。
- `burn` 相对独立，和 `analyze` 只有 CLI 文件可能轻微冲突。

## 第二轮后续分支

第二轮合并后，再启动这些分支会更稳：

- `codex/fast-sub-local-faster-whisper-worker`
- `codex/fast-sub-transcribe-cli`
- `codex/fast-sub-bench-skeleton`
- `codex/fast-sub-auto`
- `codex/fast-sub-translate-cli`

其中：

- `transcribe-cli` 应等待 `worker-contract` 合并。
- `auto` 应等待 `analyze`、`worker-contract`、`transcribe-cli` 合并。
- `bench-skeleton` 可以在 test-assets 合并后单独做。
- `translate-cli` 可以等主链路字幕生成稳定后再接。
