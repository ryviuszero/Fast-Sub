# MVP：OpenAI 兼容视频字幕 CLI

## 目标

构建第一版 CLI 原型：输入一个本地视频或音频文件，通过 OpenAI 兼容的语音 API 和 `translators` 包生成字幕文件。

第一版聚焦一个可靠的命令行流程：

```text
video.mp4/audio.wav -> 准备音频 -> 语音转写 -> 可选翻译 -> 字幕文件
```

工具命令名为 `sub-gen`。

工具需要支持 Speaches 这类 OpenAI 兼容的 STT 服务，并使用 `translators` 包生成译文和双语字幕。

## 不做的内容

第一版不包含：

- GUI 或 Web UI
- 视频字幕烧录
- 批量目录处理
- 说话人分离
- 手动字幕编辑
- 实时转写
- 队列管理
- 媒体服务器集成
- 基于 VAD 的高级音频分段

## 核心模式

### 原文字幕

生成源语言字幕。

预期流程：

```text
视频 -> 音频 -> /audio/transcriptions -> original.srt
```

当服务提供方支持时，该模式默认使用 `response_format=srt`。

### 译文字幕

只生成目标语言字幕。

预期流程：

```text
视频 -> 音频 -> verbose transcription segments -> translators 包 -> translated.srt
```

该模式要求 STT 服务返回带时间戳的 segments。

如果省略 `--target-lang`，默认目标语言为英文。

### 双语字幕

生成同时包含原文和译文的字幕。

预期流程：

```text
视频 -> 音频 -> verbose transcription segments -> translators 包 -> bilingual.srt
```

示例输出：

```srt
1
00:00:01,200 --> 00:00:04,500
Hello everyone.
大家好。
```

## CLI 设计

```bash
sub-gen video.mp4 \
  --mode bilingual \
  --source-lang en \
  --target-lang zh \
  --stt-base-url http://localhost:8000/v1 \
  --stt-api-key dummy \
  --stt-model Systran/faster-whisper-small \
  --translator bing \
  --output video.en-zh.bilingual.srt
```

## 必填参数

- `video`：输入视频或音频路径
- `--mode`：`original`、`translated` 或 `bilingual`
- `--stt-base-url`：OpenAI 兼容的 STT API base URL
- `--stt-api-key`：STT API key；本地服务可使用 `dummy`
- `--stt-model`：STT 模型名称
- `--source-lang`：可选源语言提示，用于语音转写；默认值为 `auto`

默认值：

- `--mode`：`original`
- `--source-lang`：`auto`
- `--stt-base-url`：`OPENAI_BASE_URL`，否则为 `https://api.openai.com/v1`
- `--stt-api-key`：`OPENAI_API_KEY`
- `--stt-model`：仅官方 OpenAI 默认 `whisper-1`；其他服务需要显式提供
- `--stt-temperature`：`0`
- `--max-audio-mb`：仅官方 OpenAI 默认 `25`；其他服务默认不做客户端大小限制，除非显式设置

如果省略 `--output`，CLI 会自动生成输出路径。

## 翻译参数

`translated` 和 `bilingual` 模式使用：

- `--translator`：`translators` 服务名称；默认值为 `bing`
- `--target-lang`：目标字幕语言；默认值为 `en`

## 可选参数

- `--format`：字幕格式，第一版为 `srt`，后续支持 `ass`
- `--stt-temperature`：STT 采样温度，OpenAI 范围为 `0` 到 `1`
- `--max-audio-mb`：准备后音频的上传大小限制；官方 OpenAI 默认 `25`
- `--max-line-chars`：单行字幕的软性字符限制
- `--bilingual-order`：`original-first` 或 `translated-first`
- `--keep-temp`：保留临时音频和中间 JSON 文件
- `--config`：从 TOML 配置文件加载选项

## 配置文件

v0.1 支持 TOML 配置文件。命令行参数会覆盖配置文件中的值。

```toml
[stt]
base_url = "http://localhost:8000/v1"
api_key = "dummy"
model = "Systran/faster-whisper-small"

[translator]
service = "bing"

[subtitle]
mode = "bilingual"
source_lang = "auto"
target_lang = "zh"
format = "srt"
bilingual_order = "original-first"
```

## 内部流程

1. 校验输入路径和输出路径。
2. 检查 `ffmpeg` 和 `ffprobe` 是否可用。
3. 从输入视频或音频文件中准备音频。
4. 使用 STT endpoint 转写音频。
5. 如果音频超过服务上传限制，停止执行并给出清晰的 provider limit 错误信息。
6. 在需要时规范化带时间戳的 segments。
7. 在需要时翻译 segments。
8. 校验翻译输出。
9. 生成字幕文件。
10. 当翻译部分失败时，写入部分输出和错误报告。
11. 除非设置了 `--keep-temp`，否则清理临时文件。

v0.1 不要求支持长媒体切片。第一版假设准备后的音频可以放入服务提供方的上传限制内。

## 推荐项目结构

使用 Python 和 `uv`。

```text
pyproject.toml
uv.lock
src/sub_gen/
  cli.py
  config.py
  media.py
  stt.py
  translate.py
  subtitle.py
  models.py
```

建议运行时依赖：

- `typer` 或 `click`
- `httpx`
- `pydantic`
- `pysubs2`
- `rich`
- `platformdirs`

建议开发依赖：

- `pytest`
- `ruff`
- `pyright`

## Provider 兼容规则

`original` 模式：

- 当服务支持时，优先使用 `response_format=srt`。
- 如果不可用，则降级为 `verbose_json` 并在本地生成 SRT。

`translated` 和 `bilingual` 模式：

- 要求返回带时间戳的 `segments`。
- 优先使用 `response_format=verbose_json`。
- 如果服务只返回不带时间戳的纯文本，需要给出清晰错误信息并失败退出。

OpenAI 兼容性检查：

- 仅使用官方 OpenAI 时，准备后的音频会按 `25 MB` 检查；如果显式传入 `--max-audio-mb`，则按该值检查。
- 语言提示需要看起来像 ISO 语言代码，例如 `en` 或 `zh`；`auto` 会省略 OpenAI 可选的 `language` 参数，让 STT 服务自行检测语言。
- v0.1 会拒绝 `gpt-4o-transcribe`、`gpt-4o-mini-transcribe` 和 `gpt-4o-transcribe-diarize`，因为 OpenAI 当前文档说明它们只支持 `response_format=json`，而本工具需要 `srt` 或带时间戳的 `verbose_json`。

## 翻译规则

翻译应通过 `translators` 包按 segment 逐条进行，以保持 STT 时间轴对齐。

以下情况 CLI 应重试：

- 任意翻译结果为空。

如果某个翻译批次重试后仍然失败，CLI 应写入部分输出和机器可读的错误报告，而不是丢弃整个运行结果。

## 临时文件

使用可预测的任务目录：

```text
.sub-gen/jobs/<video-hash>/
  audio.wav
  transcript.json
  translation.zh.json
  output.srt
  errors.json
```

第一版可以实现 `--keep-temp`，并为未来的 `--resume` 预留目录结构。

## 输出命名

推荐默认命名：

```text
video.en.srt
video.zh.srt
video.en-zh.bilingual.srt
```

v0.1 只要求输出 `.srt`。`.ass` 延后到 v0.2。

双语 SRT 默认先显示原文，再显示译文。

## MVP 验收标准

第一版在以下命令可用时视为成功：

```bash
sub-gen video.mp4 \
  --mode original \
  --source-lang en \
  --stt-base-url http://localhost:8000/v1 \
  --stt-api-key dummy \
  --stt-model Systran/faster-whisper-small
```

也支持直接输入音频文件：

```bash
sub-gen audio.wav \
  --mode original \
  --source-lang en \
  --stt-base-url http://localhost:8000/v1 \
  --stt-api-key dummy \
  --stt-model Systran/faster-whisper-small
```

```bash
sub-gen video.mp4 \
  --mode bilingual \
  --source-lang en \
  --target-lang zh \
  --stt-base-url http://localhost:8000/v1 \
  --stt-api-key dummy \
  --stt-model Systran/faster-whisper-small \
  --translator bing \
  --output video.en-zh.bilingual.srt
```

## v0.1 决策

1. 命令名：`sub-gen`。
2. `original` 模式默认使用 `response_format=srt`。
3. `translated` 模式在省略 `--target-lang` 时默认翻译为英文。
4. 翻译使用 `translators` 包，不再使用 OpenAI 兼容的 Chat endpoint。
5. v0.1 中 `--source-lang` 可选，默认自动检测。
6. v0.1 只需要 `.srt`；`.ass` 延后到 v0.2。
7. v0.1 假设音频满足 provider 上传限制；不满足时给出清晰的限制错误。
8. 默认提取音频格式为 `wav`。
9. 临时任务文件存放在 `.sub-gen/`。
10. v0.1 包含 `--config config.toml`。
11. 翻译按带时间戳的 segment 逐条执行。
12. 翻译批次失败时写入部分输出和错误报告。
13. 双语 SRT 默认原文在前。
14. 省略 `--output` 时自动生成输出文件名。
15. v0.1 不计划支持已有 `.srt` 输入翻译。

## 待确认问题

v0.1 暂无未确认问题。
