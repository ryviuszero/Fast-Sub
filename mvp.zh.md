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

## JSON 和错误

支持 `--json` 的命令会保持 stdout 可被 `json.loads(stdout)` 解析。进度、warning 和人类诊断输出到 stderr。

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
- `fast-sub models list/install/verify`
- `fast-sub providers list/test`
- `fast-sub bench input.mp4`

占位命令：

- `fast-sub translate input.srt` 会非零退出，并说明 v0 尚未实现翻译。

## 隐私边界

v0 默认 provider 是 `local-faster-whisper`，音频留在本机。

API provider 仍可作为后续 provider 工作的一部分被枚举，但不属于默认 v0 字幕链路。任何未来 API 上传行为都必须显式 opt-in。

## Benchmark

`fast-sub bench` 测量 `transcribe_media_v1`：

```text
input media -> probe -> prepare_audio -> local-faster-whisper worker -> source SRT
```

benchmark 媒体和报告放在已忽略的 `local_tests/` 下。`scripts/bench_assets.py` 是开发/手动素材准备工具，不是正式产品 CLI。

## 已知限制

- v0 只生成原文字幕。
- 翻译 provider 放到 v0 后。
- provider 统一和旧 API/WhisperX 清理放到 v0 后。
- Electron UI 和 Web UI 放到 v0 后。
- whisper.cpp、SenseVoice、Paraformer、Parakeet、ONNX、TensorRT 等新 STT 后端放到 v0 后。
- v0 不随仓库提交真实模型或 benchmark 媒体。
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
