# Fast Sub 第五轮计划：Benchmark 与本机基线

第五轮目标是建立可重复的 benchmark/report 能力，并用当前本机形成第一份性能 baseline。当前阶段不强制依赖 RTX 3060，也不要求默认测试下载真实模型；上线前再补更多机器和更完整样本。

本轮只切一个分支：

```text
codex/fast-sub-bench
```

原因：

- `bench` 命令、JSON schema、Markdown report、样本 manifest 和本机 baseline 模板强相关。
- 拆成多个分支会反复对齐字段名、报告结构和样本元数据。
- 本轮主要新增 `bench` 能力和文档，不会大面积改 `transcribe/auto`，冲突风险可控。

## 当前基线

已合并到 `master` 的相关能力：

- `probe`、`extract`、`analyze`
- 模型管理和 provider resolution
- `local-faster-whisper` worker
- `transcribe` CLI
- `auto` 最小链路
- `FAST_SUB_TEST_ASSETS.md` 中已有固定样本分类和 manifest 初版

仍缺少：

- `fast-sub bench` 命令。
- 本机硬件信息采集。
- CPU / auto profile 对比。
- repeat 聚合。
- JSON / Markdown benchmark report。
- 当前本机 baseline 记录流程。
- 样本来源与行业常见 ASR benchmark 的映射。

## 第五轮交付目标

第五轮结束时，主分支应至少支持：

```bash
fast-sub bench input.mp4
fast-sub bench input.mp4 --json
fast-sub bench input.mp4 --markdown local_tests/reports/report.md
fast-sub bench input.mp4 --repeat 3
```

推荐真实本机运行：

```bash
fast-sub bench local_tests/media/sample.mp4 \
  --provider local-faster-whisper \
  --model whisper-small \
  --repeat 3 \
  --json \
  --markdown local_tests/reports/current-machine.md
```

本轮的真实 baseline 优先使用当前本机：

- CPU profile 必跑。
- GPU/auto profile 如果本机可用则跑。
- 如果没有 GPU，GPU/auto profile 应清楚标记为 skipped 或 unavailable。

## Measurement Scope

第五轮 benchmark 只测 `transcribe_media` 端到端路径：

```text
input media
-> probe
-> prepare_audio
-> local-faster-whisper worker
-> render source-language SRT
```

本轮不把 `auto` 的调度、模型自动安装、raw/refine 串联、翻译或烧录计入 benchmark。原因：

- `auto` 会额外执行 refine 和调度逻辑，不适合作为 ASR 性能基线。
- `bench` 的第一版目标是比较 STT provider/profile 的速度，而不是完整产品流程耗时。
- 后续可以新增 `bench auto` 或 `--scope auto`，但本轮不做。

报告中应明确记录：

- `measurement_scope`: 固定为 `transcribe_media_v1`。
- `includes_audio_prepare`: `true`，表示 `elapsed_sec` 包含音频准备。
- `includes_worker_only_metric`: `true`，表示同时记录 worker 自身耗时。
- `excludes_refine`: `true`。

RTFx 口径：

- `rtfx_e2e = duration_sec / elapsed_sec`，代表 Fast Sub 转写端到端速度。
- `worker_rtfx = duration_sec / worker_elapsed_sec`，代表 worker 推理速度；如果 worker 未返回耗时则为 `null`。

## Bench Profiles

默认 profiles：

```text
cpu-int8:
  device=cpu
  compute_type=int8

auto:
  device=auto
  compute_type=auto
```

行为：

- `cpu-int8` 用于稳定 CPU baseline。
- `auto` 用于本机默认高性能路径；如果检测不到可用 GPU，也可以走 CPU，但报告中必须记录 requested device/compute、actual device/compute 和硬件状态。
- 后续可扩展 `cuda-float16`、`cuda-int8_float16`、`gpu-low`、`gpu-max`，本轮不强求。

字段约定：

- `requested_device` / `requested_compute_type`：CLI/profile 传入 `transcribe_media` 的值。
- `actual_device` / `actual_compute_type`：worker 实际使用的值；如果当前 worker response 还不能返回，则先记录为 `unknown`，不要用 requested 值冒充 actual 值。
- `batch_size_source`：`explicit` 或 `gpu_load`，用于说明 batch size 来自 `--batch-size` 还是 `--gpu-load` profile。

如果实现 actual device/compute 需要扩展 worker response metadata，可以在本分支内做最小兼容扩展；旧 response 没有这些字段时保持 `unknown`。

## Hardware Detection

bench report 应记录本机硬件信息。默认测试不依赖真实硬件，使用 mock detector。

建议字段：

```json
{
  "hardware": {
    "os": "Windows",
    "platform": "Windows-...",
    "python": "3.13.5",
    "cpu": "...",
    "gpu": "NVIDIA GeForce RTX 3060",
    "cuda_available": true,
    "cuda_device_count": 1,
    "driver_version": "xxx",
    "vram_total_mb": 12288
  }
}
```

读取策略：

- 标准库：
  - `platform.platform()`
  - `platform.processor()`
  - `sys.version`
- NVIDIA GPU：
  - 优先尝试 `nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits`
  - 没有 `nvidia-smi` 不报错，返回 unavailable。
- CUDA：
  - 如果 `ctranslate2` 可导入，可尝试 `ctranslate2.get_cuda_device_count()`。
  - 未安装或调用失败时记录 unknown/false，不影响 CPU benchmark。

不要写死 3060。3060 只是后续推荐补充的参考机器，不是默认测试依赖。

## Bench Result Schema

JSON report 建议结构：

```json
{
  "schema_version": 1,
  "generated_at": "2026-05-02T12:00:00Z",
  "measurement_scope": "transcribe_media_v1",
  "includes_audio_prepare": true,
  "includes_worker_only_metric": true,
  "excludes_refine": true,
  "input": "local_tests/media/zh-interview-10m.mp4",
  "input_basename": "zh-interview-10m.mp4",
  "input_path_redacted": true,
  "input_sha256": "optional-sha256-if-known",
  "command": "fast-sub bench local_tests/media/zh-interview-10m.mp4 --repeat 3",
  "sample": {
    "id": "zh-interview-10m",
    "source_dataset": "AISHELL-1",
    "source_url": "https://huggingface.co/datasets/AISHELL/AISHELL-1",
    "license": "apache-2.0",
    "domain": "interview",
    "speaking_style": "spontaneous",
    "noise_profile": "clean_speech"
  },
  "hardware": {
    "os": "Windows",
    "python": "3.13.5",
    "cpu": "...",
    "gpu": "...",
    "cuda_available": true
  },
  "profiles": [
    {
      "name": "cpu-int8",
      "requested_device": "cpu",
      "requested_compute_type": "int8",
      "runs": [],
      "summary": {}
    },
    {
      "name": "auto",
      "requested_device": "auto",
      "requested_compute_type": "auto",
      "runs": [],
      "summary": {}
    }
  ]
}
```

单次 run 字段：

```json
{
  "index": 1,
  "status": "ok",
  "provider": "local-faster-whisper",
  "model": "whisper-small",
  "requested_device": "cpu",
  "requested_compute_type": "int8",
  "actual_device": "cpu",
  "actual_compute_type": "int8",
  "gpu_load": "balanced",
  "batch_size": 4,
  "batch_size_source": "gpu_load",
  "duration_sec": 600.0,
  "elapsed_sec": 75.2,
  "worker_elapsed_sec": 70.1,
  "rtfx_e2e": 7.98,
  "worker_rtfx": 8.56,
  "segments_count": 128,
  "quality": {
    "reference_available": false,
    "wer": null,
    "cer": null
  },
  "warnings": []
}
```

失败或跳过 run 字段：

```json
{
  "index": 1,
  "status": "skipped",
  "reason": "cuda unavailable"
}
```

summary 字段：

```json
{
  "runs": 3,
  "ok_runs": 3,
  "failed_runs": 0,
  "skipped_runs": 0,
  "first_run_elapsed_sec": 75.2,
  "elapsed_sec_min": 70.1,
  "elapsed_sec_max": 75.2,
  "elapsed_sec_avg": 72.6,
  "steady_state_elapsed_sec_avg": 71.3,
  "rtfx_e2e_best": 8.4,
  "rtfx_e2e_worst": 7.8,
  "rtfx_e2e_avg": 8.1,
  "worker_rtfx_best": 9.0,
  "worker_rtfx_worst": 8.2,
  "worker_rtfx_avg": 8.6
}
```

Repeat / warmup 规则：

- 本轮默认不单独实现 `--warmup`，但 summary 必须单独记录 `first_run_elapsed_sec`。
- 当 `repeat > 1` 时，`steady_state_elapsed_sec_avg` 使用第 2 次到最后一次成功 run 的平均值；如果只有 1 次成功 run，则为 `null`。
- 所有 summary 只统计 `status=ok` 的 run；failed/skipped 不参与耗时和 RTFx 聚合。
- 如果未来增加 `--warmup`，warmup run 不写入默认 summary，可以单独放入 `warmup_runs`。

命令退出约定：

- 至少一个 profile 有成功 run：exit code `0`。
- 所有 profile 都 failed 或 skipped：exit code `1`。
- 输入无效、依赖缺失、模型缺失等命令级错误按现有 Fast Sub exit code 约定处理。
- 后续可加 `--strict`，让任一 profile failed 都返回非 0；本轮不强求。

## Markdown Report

Markdown report 至少包含：

- 标题和生成时间。
- 输入文件和 sample id。
- 样本来源、许可证、是否可再分发。
- measurement scope 和 RTFx 口径说明。
- 硬件信息。
- bench 命令和可复现参数。
- profile 对比表：
  - profile
  - requested device
  - requested compute
  - actual device
  - actual compute
  - repeat
  - avg elapsed
  - avg RTFx e2e
  - avg worker RTFx
  - segments_count
  - status
- warnings / errors。
- 后续补测机器的 TODO。

报告示例路径：

```text
local_tests/reports/current-machine.md
```

不要提交真实大样本报告中的个人绝对路径或敏感机器信息。

隐私/脱敏要求：

- Markdown 默认只展示输入文件名、sample id、checksum 和相对路径；不要展示用户目录绝对路径。
- JSON 可以保留原始 `input` 字段用于本地复现，但应同时提供 `input_basename` 和 `input_path_redacted`，方便生成可提交的 Markdown。
- 硬件信息可以记录 CPU/GPU 型号，但不要记录用户名、主机名、完整用户目录或网络共享凭据。

## Benchmark 样本来源策略

语音类 benchmark 通常覆盖不同 domain、语言、说话方式和噪声条件。第 5 轮不要求下载所有数据集，但文档和 manifest 应对齐通用 ASR benchmark 的样本来源。

常见公开 benchmark / 数据集参考：

| 数据集 | 语言 | 场景 | 用途 | 备注 |
| --- | --- | --- | --- | --- |
| LibriSpeech | en | audiobook | clean narrated speech | ASR 标准英文基线，CC-BY-4.0 |
| Common Voice | 多语 | crowd-sourced reading | 多口音、多语种 | CC0，适合语言覆盖 |
| VoxPopuli | 多语/欧洲语言 | parliament speech | oratory / 非母语口音 | CC0 |
| TED-LIUM | en | TED talks | long-form oratory | 常见演讲类 benchmark |
| GigaSpeech | en | audiobook/podcast/YouTube | 多 domain | 适合播客/公开视频语音 |
| Earnings-22 | en | earnings calls | meeting/spontaneous | 财报会议长音频 |
| AMI | en | meetings | 多人会议 | 适合会议和重叠说话 |
| AISHELL-1 | zh | Mandarin speech | 中文普通话 clean baseline | Apache-2.0，安静室内 |
| KsponSpeech | ko | spontaneous dialog | 韩语自然对话 | AIHub，需要注意获取条件 |
| ReazonSpeech | ja | Japanese corpus | 日语 ASR | 许可和用途需按官方说明 |
| ICoS / HiKE | 多语 / 韩英 | code-switching | 中英/多语混杂参考 | 可作为后续候选 |

Fast Sub 固定样本建议：

| Fast Sub 样本 | 推荐来源优先级 | 说明 |
| --- | --- | --- |
| `zh-interview-10m` | AISHELL-1；授权清晰中文访谈/公开演讲；自录 | 中文 clean/spontaneous baseline |
| `en-podcast-10m` | GigaSpeech；TED-LIUM；Earnings-22；AMI；授权播客 | 英文长音频和播客场景 |
| `zh-en-mixed-10m` | ICoS；自录/授权中英混杂材料 | code-switching 场景，先作为候选 |
| `noisy-music-5m` | Common Voice noisy/other；授权背景音乐视频；自录 | 噪声和音乐干扰 |
| `ko-talk-10m` | KsponSpeech；授权韩语讲话/访谈 | 韩语自然对话或讲话 |
| `ja-talk-10m` | ReazonSpeech；Common Voice Japanese；授权日语讲话 | 日语讲话 baseline |

样本原则：

- 优先选择许可证清晰、可追溯、可复现的来源。
- 不确认可再分发时，不提交媒体和 reference 文本。
- 所有本地样本都记录 `source_url`、`license`、`source_accessed_at`、`checksum_sha256`。
- manifest 字段统一使用 `source_accessed_at`，与 `tests/fixtures/manifest.example.json` 保持一致；不要再新增平行的 `access_date`。
- 当前本机 baseline 可以先用已有本地样本，不必等六类样本全部齐全。

## 默认测试策略

默认测试：

```bash
uv run pytest
```

不做：

- 不下载真实模型。
- 不跑 5-10 分钟真实媒体。
- 不要求 GPU。
- 不要求 `nvidia-smi` 存在。
- 不上传 API。

默认测试应 mock：

- hardware detector
- auto/transcribe result
- failed/skipped profile
- repeat 聚合
- first-run / steady-state summary
- requested vs actual device/compute
- JSON report
- Markdown report

可选 slow/manual benchmark：

```bash
FAST_SUB_RUN_REAL_BENCH=1 uv run pytest tests/test_bench_real.py
```

或者直接手动运行 CLI：

```bash
fast-sub bench local_tests/media/sample.mp4 --repeat 3 --markdown local_tests/reports/current-machine.md
```

## 分支范围

分支：`codex/fast-sub-bench`

建议写入范围：

- `src/fast_sub/bench.py`
- `src/fast_sub/cli.py`
- `tests/test_bench.py`
- `tests/test_cli_bench.py`
- `FAST_SUB_TEST_ASSETS.md`
- `FAST_SUB_PLAN.md`
- `FAST_SUB_PARALLEL_ROUND5.md`
- 必要时更新 `tests/fixtures/manifest.example.json`

不做：

- 不实现翻译。
- 不做 API provider benchmark。
- 不下载真实模型作为默认测试。
- 不提交真实大媒体。
- 不做 UI。
- 不清理旧 `run`。
- 不强制要求 3060。
- 不实现 WER/CER 计算；可以在 schema 中预留字段。
- 不把 `auto` / `refine` / `burn` 耗时混入第五轮 benchmark。

## 验收标准

- `fast-sub bench input.mp4 --json` 可输出结构化报告。
- `fast-sub bench input.mp4 --markdown report.md` 可生成 Markdown。
- CPU profile 可跑。
- auto/GPU profile 可跑或清楚标记 skipped。
- 硬件信息被记录。
- repeat 聚合正确。
- summary 单独记录 first run，并在 repeat > 1 时计算 steady-state 平均值。
- JSON 区分 requested device/compute 和 actual device/compute；无法得知 actual 时明确为 `unknown`。
- 报告同时包含 `rtfx_e2e` 和 `worker_rtfx`，并说明口径。
- 失败 run 有结构化错误或 skipped reason。
- Markdown 报告不包含个人绝对路径或敏感机器信息。
- 默认测试不依赖真实模型/GPU/网络。
- `uv run pytest` 通过。
- 文档记录当前本机 baseline 的手动运行方式和后续补机器计划。

## 启动提示

```text
请从最新 master 创建/切换到 codex/fast-sub-bench。阅读 FAST_SUB_PLAN.md、FAST_SUB_TEST_ASSETS.md 和 FAST_SUB_PARALLEL_ROUND5.md，只实现第五轮 benchmark 任务。实现 fast-sub bench、硬件探测、CPU/auto profile、repeat 聚合、JSON/Markdown report，并更新样本来源和本机 baseline 文档。benchmark 范围固定为 transcribe_media_v1，不把 auto/refine/burn 耗时计入本轮报告；JSON 需要区分 requested/actual device/compute，记录 rtfx_e2e、worker_rtfx、first run 和 steady-state summary。默认测试必须 mock 硬件和转写结果，不下载真实模型、不依赖 GPU、不提交大媒体。不实现翻译、API provider benchmark、UI、旧 run 清理或 WER/CER 计算。完成后运行相关测试和 uv run pytest，并总结改动、验证结果、剩余风险。
```
