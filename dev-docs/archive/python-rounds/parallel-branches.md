# Fast Sub 并行开发分支说明

本文档用于同时启动多个 Codex 对话时分配任务。四个分支都从当前基础状态切出，目标是并行推进互相依赖较少的模块。

## 总原则

- 每个分支只做自己负责的范围，避免跨分支大改。
- 优先补测试，再实现命令。
- 所有命令最终都要能被后续 `auto`、Electron UI、Web UI 复用。
- API 上传、本地模型下载、真实 ASR 推理不要在这些分支里提前耦合。
- 如需修改 `src/fast_sub/cli.py`，只挂接本分支命令，避免改动其它命令的参数和行为。

## 分支 1：`codex/fast-sub-media`

### 目标

实现媒体基础能力：

- `fast-sub doctor`
- `fast-sub probe`
- `fast-sub extract`

### 范围

- `doctor` 检查：
  - `ffmpeg` 是否可用
  - `ffprobe` 是否可用
  - Python 版本
  - 基础缓存/任务目录是否可写
- `probe` 基于 `ffprobe -print_format json` 输出媒体信息：
  - path
  - duration_sec
  - container
  - audio_streams
  - video_streams
  - selected_audio_stream
- `extract` 基于 `ffmpeg` 输出统一 ASR 输入：
  - 16000 Hz
  - mono
  - wav / pcm_s16le

### 建议文件

- `src/fast_sub/media.py`
- `src/fast_sub/cli.py`
- `tests/test_media.py`
- 新增 `tests/test_cli_media.py`

### 不做

- 不做 VAD/静音分析。
- 不做模型下载。
- 不做 STT provider。
- 不做字幕生成。

### 验收

- `fast-sub doctor` 在缺少工具时不崩溃，能给出清晰状态。
- `fast-sub probe tests/fixtures/sample.wav --json` 输出机器可读 JSON。
- `fast-sub extract input --output audio.wav` 能生成 16k mono wav。
- 路径包含空格和中文时可用。
- `uv run pytest` 通过。

## 分支 2：`codex/fast-sub-provider-contract`

### 目标

建立 provider 抽象，为本地 STT、API STT、本地翻译、API 翻译统一接口。

### 范围

- 定义 STT provider request/response schema。
- 定义 Translation provider request/response schema。
- 定义 provider metadata：
  - id
  - type: `stt | translate`
  - local/api
  - supported_languages
  - supports_word_timestamps
  - supports_batch
  - requires_gpu
  - offline
  - license
  - privacy_note
- 增加 provider registry 骨架。
- 增加 `fast-sub providers list` 和 `fast-sub providers test <id>` 骨架。

### 建议文件

- 新增 `src/fast_sub/provider_models.py`
- 新增 `src/fast_sub/providers.py`
- `src/fast_sub/models.py`
- `src/fast_sub/cli.py`
- 新增 `tests/test_providers.py`

### 不做

- 不接真实 faster-whisper。
- 不接真实 OpenAI API。
- 不下载模型。
- 不处理 ffmpeg。

### 验收

- provider request/response 可 JSON 序列化。
- `providers list` 能列出至少：
  - `local-faster-whisper`
  - `api-openai-transcription`
  - `local-nllb-ct2`
  - `api-openai-chat`
- API provider 缺 key 时状态为 `missing_api_key`，不崩溃。
- 本地 provider 缺模型/依赖时状态可表达。
- 日志和 JSON 输出不得包含 API key。
- `uv run pytest` 通过。

## 分支 3：`codex/fast-sub-refine`

### 目标

实现字幕整理能力，让转写后的 SRT 更适合观看。

### 范围

- `fast-sub refine input.srt`
- SRT 读取和写回。
- 删除空白字幕。
- 修复重叠时间。
- 合并过短片段。
- 拆分过长文本。
- CJK 和英文使用不同默认行长。

### 建议文件

- `src/fast_sub/subtitle.py`
- `src/fast_sub/cli.py`
- 新增 `tests/test_refine.py`

### 默认规则

- 中文/日文/韩文：单行 18-24 字。
- 英文：单行约 42 字。
- 单条字幕建议 1-6 秒。
- 输出时间轴必须递增。

### 不做

- 不做 ASR。
- 不做翻译。
- 不做 ASS 样式。
- 不做视频烧录。

### 验收

- 输入合法 SRT，输出仍是合法 SRT。
- 空字幕被删除。
- 明显重叠时间被修复。
- 过长文本会被软拆行或拆段。
- 常见播放器可加载输出。
- `uv run pytest` 通过。

## 分支 4：`codex/fast-sub-models`

### 目标

实现模型管理基础能力：

- `fast-sub models list`
- `fast-sub models install <id>`
- `fast-sub models verify <id>`

### 范围

- 模型 manifest。
- 模型缓存目录。
- 下载前检查磁盘空间。
- 普通 HTTP 下载。
- 断点续传可先做简化版；如果复杂，至少不要破坏已有文件。
- sha256 校验。
- 已安装模型状态检测。

### 初始模型

- `whisper-base`
- `whisper-small`
- `whisper-large-v3-turbo`

### 建议文件

- 新增 `src/fast_sub/model_manager.py`
- 新增 `src/fast_sub/model_manifest.py` 或 `src/fast_sub/data/models.json`
- `src/fast_sub/cli.py`
- 新增 `tests/test_model_manager.py`

### 不做

- 不内置 aria2。
- 不接真实 ASR 推理。
- 不自动下载模型，除非用户显式运行 install。
- 不把模型打进主包。

### 验收

- `models list` 能显示模型 ID、大小、license、安装状态。
- `models verify <id>` 能检测存在/缺失/hash 不匹配。
- 下载失败有清晰错误。
- hash 不匹配不能标记为安装成功。
- `uv run pytest` 通过。

## 合并建议

推荐合并顺序：

```text
1. codex/fast-sub-provider-contract
2. codex/fast-sub-media
3. codex/fast-sub-refine
4. codex/fast-sub-models
```

之后再开后续分支：

```text
codex/fast-sub-analyze
codex/fast-sub-worker
codex/fast-sub-transcribe
codex/fast-sub-auto
codex/fast-sub-translate
codex/fast-sub-burn
```

## 给每个 Codex 对话的启动提示

建议在对应分支启动后这样说：

```text
请阅读 FAST_SUB_PLAN.md 和 FAST_SUB_PARALLEL_BRANCHES.md，只实现当前分支对应章节的任务。不要实现其它分支范围。完成后运行相关测试和 uv run pytest，并总结改动、验证结果、剩余风险。
```
