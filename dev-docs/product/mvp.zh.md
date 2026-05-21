# Fast Sub v0 MVP

## 目标

Fast Sub v0 是一个本地优先的 CLI，用本地视频或音频生成原文 `.srt` 字幕。

推荐命令：

```bash
fast-sub auto input.mp4
```

兼容入口：

```bash
fast-sub input.mp4
fast-sub run input.mp4
```

这三个入口都走同一条 v0 本地链路，不会静默上传音频，不会静默调用 OpenAI-compatible API，也不会静默进入 WhisperX 旧流程。

## v0 链路

```text
ffmpeg/ffprobe
-> probe
-> extract/analyze
-> provider/model resolution
-> local-faster-whisper worker
-> transcribe
-> refine
-> final .srt
```

底层命令 `fast-sub transcribe input.mp4` 只做原文转写，也供 `bench` 使用。

## 安装

基础 CLI：

```bash
pip install fast-sub
```

本地 ASR 依赖：

```bash
pip install "fast-sub[local-asr]"
```

源码开发：

```bash
uv sync --extra local-asr
```

网页翻译依赖 GPL-3.0 的 `translators` 包，因此作为 optional extra 处理，方便发布打包前审查：

```bash
uv sync --extra web-translate
```

本地 NLLB 翻译依赖：

```bash
uv sync --extra local-translate
fast-sub models install nllb-200-distilled-600m-ct2-int8
```

v0 打包阶段仍要求 `ffmpeg` 和 `ffprobe` 可在 PATH 中找到。

## 首次运行

检查本机状态：

```bash
fast-sub doctor
fast-sub models list
fast-sub providers list
```

显式安装模型：

```bash
fast-sub models install whisper-small
```

或允许 `auto` 自动安装本地模型：

```bash
fast-sub auto input.mp4 --yes
```

`--yes` 只授权本地模型下载/安装，不会授权 API 上传。
它也不会静默安装翻译模型。

## 翻译

第 7 轮新增真实 SRT 翻译：

```bash
fast-sub translate input.srt --provider web-bing --from en --to zh
fast-sub translate input.srt --provider web-google --from en --to zh
fast-sub translate input.srt --provider api-openai-chat --api-key $OPENAI_API_KEY --model <model> --to zh
fast-sub translate input.srt --provider local-nllb-ct2 --from en --to zh
```

除非显式配置 provider，否则必须传 `--provider`；必须传 `--to`。远程 provider 不会被静默选择。
`replace` 输出译文；`bilingual` 输出原文和译文，并保持 cue 顺序、时间轴和数量稳定。
partial failure 会保留失败 cue 原文并写 `.errors.json`；all failure 非零退出，不写误导性的最终 SRT。

默认启用轻量 checkpoint/resume：

```text
<output>.translate-progress.json
```

传 `--no-resume` 可强制重新翻译。

## JSON 和错误

支持 `--json` 的命令会保持 stdout 可被 `json.loads(stdout)` 解析。进度、warning 和人类诊断输出到 stderr。

Fast Sub 启动 CLI 时也会读取当前工作目录的 `.env` 文件。真实 shell 环境变量优先；
`.env` 只填充尚未设置的变量，不覆盖已有环境变量。API 翻译配置可以这样写：

```env
OPENAI_API_KEY=replace-with-your-api-key
OPENAI_MODEL=gpt-4.1-mini
OPENAI_BASE_URL=https://api.openai.com/v1
```

`.env` 加载是静默的，不会打印 secret。

v0 常用 exit code：

```text
0 成功
1 命令失败
2 输入或 CLI 用法无效
3 缺本地依赖
4 缺模型
5 下载、校验或缓存失败
```

缺本地 ASR 依赖时提示：

```text
uv sync --extra local-asr
pip install fast-sub[local-asr]
```

缺模型时提示：

```text
fast-sub models install <id>
fast-sub auto --yes
```

API key 和 token 不得出现在 stdout、stderr、JSON payload 或报告中。

## v0 命令

v0 稳定命令：

- `fast-sub auto input.mp4`
- `fast-sub input.mp4`
- `fast-sub run input.mp4`
- `fast-sub transcribe input.mp4`
- `fast-sub probe input.mp4`
- `fast-sub extract input.mp4`
- `fast-sub analyze input.mp4`
- `fast-sub refine input.srt`
- `fast-sub burn input.mp4 input.srt`
- `fast-sub translate input.srt --provider <id> --to <lang>`
- `fast-sub models list/install/verify`
- `fast-sub providers list/test`
- `fast-sub bench input.mp4`
- `fast-sub bench-translate input.srt --reference ref.zh.srt --from en --to zh --provider <id>`
- `fast-sub bench-translate-manifest`

## 隐私边界

v0 默认 provider 是 `local-faster-whisper`，音频留在本机。

翻译 provider 有明确隐私分类：

- `local-nllb-ct2`：本地运行，不上传字幕文本。
- `web-bing` / `web-google`：远程网页翻译，会把字幕文本发送到第三方网页翻译服务；稳定性、限流、条款和地区可用性由第三方决定。Google 在中国大陆网络环境可能失败，可尝试 `web-bing`。
- `api-openai-chat`：远程 API，会把字幕文本发送到配置的 OpenAI-compatible API；必须显式 API key 和显式 model。

任何 API 上传行为都必须显式 opt-in。

## Benchmark

`fast-sub bench` 测量 `transcribe_media_v1`：

```text
input media -> probe -> prepare_audio -> local-faster-whisper worker -> source SRT
```

第 7.5 轮新增独立的 `fast-sub bench-translate` 命令，用于粗略评估翻译质量：

```bash
fast-sub bench-translate input.srt --reference ref.zh.srt --from en --to zh --provider local-nllb-ct2
```

翻译 benchmark 使用目标语言 reference SRT/TXT，报告 BLEU、chrF、exact match、耗时、吞吐和失败 cue 数。它是可复现的粗略质量信号，不是人工质量保证。JSON canonical score 使用 0-1；如果环境安装了 sacreBLEU，报告会记录 sacreBLEU signature 和 raw 0-100 分；否则记录 `metric_implementation=fast_sub_lightweight_v1`，该 lightweight 分数不等价于 sacreBLEU。repeat summary 包含 avg/min/max/stddev。现有 `fast-sub bench` 继续专注媒体转写 benchmark。

`fast-sub bench-translate-manifest` 会输出本地 manifest schema/example，用 samples + provider matrix 表达 light/standard 翻译样本。真实数据集由用户手动下载到 `local_tests/bench_translate/raw/`；生成样本按可用数据覆盖 `en/ja/ko -> zh` 和 `zh/ja/ko -> en`，并保持 ignored。

benchmark 媒体、reference、生成的模型缓存和报告都放在已忽略的 `local_tests/` 下。`scripts/bench_assets.py` 是开发/手动素材准备工具，不是正式产品 CLI。不要提交真实模型、真实媒体、真实 reference corpus 或本地 benchmark 报告。

## 已知限制

- `auto` 默认仍只生成原文字幕；翻译是独立显式命令。
- `local-nllb-ct2 --from auto` 会先做轻量字幕语言检测；如果无法可靠判断 `en|zh|ja|ko`，请使用 `--from en|zh|ja|ko`。NLLB 内部使用 FLORES-200 code：`eng_Latn`、`zho_Hans`、`jpn_Jpan`、`kor_Hang`。
- provider 统一和旧 API/WhisperX 清理放到 v0 后。
- Electron UI 和 Web UI 放到 v0 后。
- whisper.cpp、SenseVoice、Paraformer、Parakeet、ONNX、TensorRT 等新 STT 后端放到 v0 后。
- v0 不随仓库提交真实模型、benchmark 媒体、benchmark reference corpus 或本地报告。
- 真实模型 smoke test 需要手动跑，因为它可能涉及网络、大模型下载和本机硬件差异。

## Release Smoke

默认自动化测试保持离线，不下载真实模型或真实媒体。

手动真实模型 smoke：

```bash
uv run fast-sub --version
uv run fast-sub doctor
uv run fast-sub models list
uv run fast-sub providers list
uv run fast-sub auto tests/fixtures/sample.wav --dry-run --json
uv run fast-sub transcribe <real-local-sample> --model whisper-small --device auto
uv run fast-sub auto <real-local-sample> --yes
uv run fast-sub <real-local-sample> --yes
uv run fast-sub run <real-local-sample> --yes
uv run fast-sub bench <real-local-sample> --repeat 1 --profile auto --json
```

生成的模型缓存、媒体、benchmark 输出和本地报告都不应提交。
