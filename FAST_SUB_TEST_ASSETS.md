# Fast Sub Test Assets

本文档定义 Fast Sub 的测试素材分层、固定 benchmark 样本、manifest 字段和人工准备流程。目标是让 `probe`、`extract`、`analyze`、`transcribe`、`bench` 后续都能使用同一套可追踪素材，而不把大型或授权不清的媒体文件提交到仓库。

## Asset Layers

### 仓库内小 fixture

- 用途：CI smoke tests、解析边界测试、极小输入验证。
- 时长：建议 5-15 秒。
- 体积：尽量小，适合随仓库分发。
- 来源：优先使用可重新生成的合成音频/字幕，或许可证明确允许再分发的素材。
- 存放：`tests/fixtures/`。
- 要求：每个媒体 fixture 都应在 `tests/fixtures/README.md` 记录来源、生成方式、许可证和预期用途。

当前仓库内 fixture：

| 文件 | 用途 | 说明 |
| --- | --- | --- |
| `tests/fixtures/sample.wav` | smoke tests | 极小 WAV 样本，用于媒体解析和基础流程测试；不代表真实 benchmark 难度。 |
| `tests/fixtures/config.toml` | config tests | 配置读取测试 fixture。 |

### 本地 benchmark 大样本

- 用途：性能对比、质量评估、回归观察。
- 时长：5-10 分钟为主。
- 体积：不提交仓库。
- 存放：默认使用 `.gitignore` 已忽略的 `local_tests/`。
- 要求：提交 manifest 示例和准备说明；真实媒体、参考转写、参考字幕只在本地准备。
- 校验：每个大样本应尽量记录 SHA-256，保证不同机器的 benchmark 可比较。

推荐目录：

```text
local_tests/
  media/
  audio/
  references/
  manifests/
  reports/
```

### Reference transcript/subtitle

- 如果许可证允许再分发，可以提交小型 reference 文本。
- 如果许可证不允许或来源不明确，只在 manifest 中记录本地路径和准备方法。
- reference transcript 用于 WER/CER 等质量指标。
- reference subtitle 用于时间轴、segments_count、字幕合法性和人工对比。

## Fixed Benchmark Set

| ID | 语言 | 时长 | 媒体类型 | 场景 | 噪声特征 | 推荐用途 |
| --- | --- | ---: | --- | --- | --- | --- |
| `zh-interview-10m` | zh | 600s | video | 中文访谈 | clean_speech | `probe`, `extract`, `analyze`, `transcribe`, `bench` |
| `en-podcast-10m` | en | 600s | audio/video | 英文播客或访谈 | clean_speech | `probe`, `extract`, `analyze`, `transcribe`, `bench` |
| `zh-en-mixed-10m` | zh,en | 600s | video | 中英混杂视频 | code_switching | `analyze`, `transcribe`, `bench` |
| `noisy-music-5m` | unknown | 300s | video | 背景音乐或噪声视频 | music_noise | `analyze`, `transcribe`, `bench` |
| `ko-talk-10m` | ko | 600s | video | 韩语讲话 | clean_speech | `transcribe`, `bench` |
| `ja-talk-10m` | ja | 600s | video | 日语讲话 | clean_speech | `transcribe`, `bench` |

## Common ASR Benchmark Sources

语音类 benchmark 通常覆盖不同 domain、语言、说话方式和噪声条件。Fast Sub 的固定样本应尽量参考通用 ASR benchmark，但不要求默认测试下载这些数据集。

常见公开 benchmark / 数据集参考：

| 数据集 | 语言 | 场景 | 适合用途 | 备注 |
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

Fast Sub 固定样本来源优先级：

| Fast Sub 样本 | 推荐来源优先级 | 说明 |
| --- | --- | --- |
| `zh-interview-10m` | AISHELL-1；授权清晰中文访谈/公开演讲；自录 | 中文 clean/spontaneous baseline |
| `en-podcast-10m` | GigaSpeech；TED-LIUM；Earnings-22；AMI；授权播客 | 英文长音频和播客场景 |
| `zh-en-mixed-10m` | ICoS；自录/授权中英混杂材料 | code-switching 场景，先作为候选 |
| `noisy-music-5m` | Common Voice noisy/other；授权背景音乐视频；自录 | 噪声和音乐干扰 |
| `ko-talk-10m` | KsponSpeech；授权韩语讲话/访谈 | 韩语自然对话或讲话 |
| `ja-talk-10m` | ReazonSpeech；Common Voice Japanese；授权日语讲话 | 日语讲话 baseline |

## Source And License Rules

- 优先选择 Creative Commons、公共领域、项目自录或明确授权素材。
- 记录原始 `source_url`、访问日期、许可证名称和是否可再分发。
- 如果素材来自 YouTube、播客平台或课程平台，默认视为不可再分发，除非页面明确授权。
- 不能确认授权时，不提交媒体和 reference 文本，只记录本地准备步骤。
- API provider 测试不得默认上传本地 benchmark 媒体；任何上传行为都必须由后续命令显式选择。

## Manifest Fields

`tests/fixtures/manifest.example.json` 展示了建议字段。字段设计同时服务于素材准备、性能 benchmark 和质量评估。

关键字段：

- `id`: 稳定样本 ID。
- `benchmark_family`: 例如 `esb`, `open_asr_leaderboard`, `fast_sub_local`。
- `source_dataset`: 原始数据集或素材集合名，例如 `AISHELL-1`, `GigaSpeech`, `ReazonSpeech`。
- `language`: 原始语言；混合语言可使用数组。
- `duration_sec`: 目标时长或实际时长。
- `media_type`: `audio` 或 `video`。
- `domain`: `audiobook`, `podcast`, `interview`, `meeting`, `lecture`, `conversation`, `video` 等。
- `speaking_style`: `read`, `narrated`, `oratory`, `spontaneous`, `conversation`, `code_switching` 等。
- `noise_profile`: `clean_speech`, `music_noise`, `background_noise`, `code_switching`, `overlap_speech` 等稳定枚举。
- `language_mix`: 单语可为 `null`，混合语言样本记录如 `["zh", "en"]`。
- `source_url`: 原始来源。
- `source_accessed_at`: 获取或记录来源的日期，使用 `YYYY-MM-DD`。
- `license`: 许可证名称。
- `redistributable`: 是否允许随仓库分发。
- `local_path`: 本地媒体路径，建议位于 `local_tests/media/`。
- `checksum_sha256`: 实际媒体文件 SHA-256；未知时为 `null`。
- `reference_transcript_path`: 参考文本路径。
- `reference_subtitle_path`: 参考字幕路径。
- `target_metrics`: 后续 `bench` 可计算或记录的指标，例如 `rtfx`, `wer`, `cer`, `segments_count`, `invalid_segments_count`。
- `expected_use`: 该样本适用的命令或测试场景。

## Manual Preparation Flow

1. 选择授权清晰的原始素材，记录来源和许可证。
2. 将原始媒体放入 `local_tests/media/`。
3. 如果需要统一输入，生成 16kHz mono WAV 到 `local_tests/audio/`。
4. 准备 reference transcript 或 subtitle 到 `local_tests/references/`。
5. 计算原始媒体和准备后音频的 SHA-256。
6. 复制 `tests/fixtures/manifest.example.json` 到 `local_tests/manifests/<sample-id>.json` 并填写真实字段。
7. 运行 `probe`、`extract`、`analyze` 或后续 `bench` 后，把报告输出到 `local_tests/reports/`。

PowerShell checksum 示例：

```powershell
Get-FileHash local_tests/media/zh-interview-10m.mp4 -Algorithm SHA256
```

## Bench Readiness

后续 `bench` 命令可以直接消费 manifest 中的这些信息：

- 输入路径：`local_path` 或 `prepared_audio_path`。
- 基准身份：`id`, `language`, `domain`, `noise_profile`。
- 可比性：`duration_sec`, `checksum_sha256`, `prepared_audio_checksum_sha256`。
- 质量指标：`reference_transcript_path`, `reference_subtitle_path`, `target_metrics`。
- 隐私与许可：`license`, `redistributable`, `source_url`, `notes`。

## Current Machine Baseline Flow

第五轮 `bench` 报告的默认 scope 固定为 `transcribe_media_v1`：

```text
input media -> probe -> prepare_audio -> local-faster-whisper worker -> source SRT
```

本轮报告不包含 `auto` 调度、`refine`、翻译或烧录耗时。CPU 和 auto profile 的手动 baseline 建议写到本地忽略目录：

```powershell
fast-sub bench local_tests/media/<sample>.mp4 `
  --provider local-faster-whisper `
  --model whisper-small `
  --repeat 3 `
  --sample-manifest local_tests/manifests/<sample>.json `
  --sample-id <sample-id> `
  --json `
  --markdown local_tests/reports/current-machine.md
```

可提交的 Markdown 报告应只保留文件名、sample id、checksum、样本来源和硬件概要，不应包含用户目录绝对路径、主机名、网络共享路径或大媒体文件。

## Do Not Commit

不要提交以下内容：

- 5-10 分钟 benchmark 视频或音频。
- 授权不清的 reference transcript/subtitle。
- 本地 benchmark 报告中的绝对个人路径或机器敏感信息。
- 任何为下载素材而新增的下载器、网络脚本或 CLI 行为。

