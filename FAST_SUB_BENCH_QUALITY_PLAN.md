# Fast Sub Bench Quality Plan

本文档记录 `fast-sub bench` 的最小可用增强方案。它只描述计划，不执行实现；范围限定在“当前已生成的本地音频 + reference transcript 可以直接验证”的指标。

与第 7.5 轮翻译 benchmark 的关系：

- 本文档只覆盖 ASR/transcribe benchmark，也就是 `media -> STT -> SRT`。
- 第 7.5 轮的 `FAST_SUB_PARALLEL_ROUND7_5.md` 覆盖独立的 `fast-sub bench-translate`，也就是 `source SRT -> translate -> target SRT`。
- 两者不共用同一个 CLI 命令；现有 `fast-sub bench` 不新增翻译模式，避免媒体 benchmark 参数和翻译 provider/reference 对齐规则混在一起。

## 目标

本轮增强现有 `fast-sub bench`，不新增 ASR benchmark 命令。目标是让本地 benchmark 样本可以回答这些问题：

- 当前机器跑某个模型是否足够快。
- 某个模型在当前固定样本上的转写是否足够准。
- 输出字幕是否存在明显结构问题，例如空输出、无效时间轴或异常段数。
- 跑完测试后能得到默认简报摘要，并可生成 Markdown/JSON 详细报告。

## 明确不做

- 不做模型矩阵命令。
- 不做自动模型推荐。
- 不做复杂 CPU/GPU 峰值内存采样。
- 不引入重型评测依赖。
- 不把真实 benchmark 媒体、reference 或本地报告提交到仓库。

## 可验证指标

### 速度

继续保留当前 `bench` 已有指标：

- `elapsed_sec`
- `worker_elapsed_sec`
- `rtfx_e2e`
- `worker_rtfx`
- repeat 后的 summary

`rtfx_e2e >= 1.0` 可作为“至少不慢于实时”的基础判断；`rtfx_e2e >= 2.0` 更适合批量字幕处理。

### 质量

当 manifest 中存在 `reference_transcript_path` 时，从本次生成的 SRT 提取纯文本，并与 reference transcript 对比：

- 中文、日文、韩文和 noisy/other 样本优先计算 `cer`。
- 英文样本计算 `wer`，同时可保留 `cer` 作为辅助。
- 没有 reference 时，`reference_available=false`，质量指标为 `null`，不让 benchmark 失败。

质量计算不应依赖重型评测库。第一版优先实现一个小型 Levenshtein edit distance；后续如果需要更完整的 ASR 指标，再考虑接入 `jiwer`。所有质量指标都必须记录使用的 normalization profile，否则不同样本或后续版本之间不可比较。

建议 `quality` 字段：

```json
{
  "reference_available": true,
  "reference_mode": "strict",
  "quality_status": "ok",
  "metric_primary": "cer",
  "normalizer": "basic_cjk_v1",
  "wer": null,
  "cer": 0.084,
  "wer_edits": null,
  "wer_ref_units": null,
  "cer_edits": 42,
  "cer_ref_units": 500,
  "prediction_chars": 482,
  "reference_chars": 500
}
```

`quality_status` 枚举：

```text
ok
no_reference
partial_reference
empty_prediction
empty_reference
invalid_reference
not_computed
```

质量指标不直接决定 `bench` 命令成败。只要转写 run 成功，`bench` 就可以成功；质量问题通过 `quality_status`、warnings 和 summary 表达。

### Text Normalization

本轮需要固定最小 normalization 口径：

英文 WER/CER 使用 `basic_en_v1`：

- Unicode NFKC。
- lowercase。
- 移除标点和符号。
- 将连续空白压缩为一个空格。
- WER 按空格分词。
- CER 按归一化后的字符计算，去除空格。

中文、日文、韩文和 noisy/other CER 使用 `basic_cjk_v1`：

- Unicode NFKC。
- lowercase。
- 移除标点和符号。
- 移除全部空白。
- CER 按 Unicode 字符计算。
- 韩文第一版按 Hangul syllable 字符计算，不拆 jamo。

如果 manifest 明确 `language=en`，主指标为 WER；如果 `language` 为 `zh`、`ja`、`ko` 或 `unknown/noisy`，主指标为 CER。混合语言后续可同时计算 WER/CER，但本轮不把 `zh-en-mixed-10m` 自动纳入质量评估。

### Metric Semantics

WER/CER 的计算定义：

```text
wer = edit_distance(reference_words, prediction_words) / max(1, len(reference_words))
cer = edit_distance(reference_chars, prediction_chars) / max(1, len(reference_chars))
```

JSON 主字段 `wer` / `cer` 使用 0-1 浮点，不输出百分号。Markdown 可以同时显示百分比。

空文本规则：

- reference 和 prediction 都为空：错误率为 `0.0`，`quality_status=ok`。
- reference 为空但 prediction 非空：错误率按 insertion 计算，`quality_status=empty_reference`。
- reference 非空但 prediction 为空：错误率为 `1.0`，`quality_status=empty_prediction`。

Reference mode：

- `strict`：reference 覆盖完整音频，可以计算 WER/CER。
- `partial`：reference 只覆盖部分音频，不计算 WER/CER，`quality_status=partial_reference`。
- `none`：没有 reference，不计算 WER/CER，`quality_status=no_reference`。

manifest 未声明时，存在 `reference_transcript_path` 默认视为 `strict`，但建议 Round5_5 后续生成的 sample entry 显式写入 `reference_mode`。

### 字幕健康度

增加轻量结构指标：

- `segments_count`
- `invalid_segments_count`
- `empty_output`
- `parse_error`
- `overlap_count`
- `non_positive_duration_count`
- `empty_text_count`
- `prediction_chars`
- `reference_chars`
- `duration_sec`

`invalid_segments_count` 用于记录负时长、倒序、明显非法时间轴或缺少文本的字幕段。`empty_output` 用于快速发现模型或参数导致的空字幕。

SRT 解析应复用项目已依赖的 `pysubs2`，不要用正则手写解析。建议健康度定义：

- `parse_error=true`：SRT 无法解析。
- `empty_output=true`：没有任何有效文本；不只是文件为空。
- `empty_text_count`：文本为空或只含空白的 cue 数量。
- `non_positive_duration_count`：结束时间小于等于开始时间的 cue 数量。
- `overlap_count`：当前 cue 开始时间早于上一 cue 结束时间。
- `invalid_segments_count = empty_text_count + non_positive_duration_count + overlap_count`，如果 parse failed，可设为 `null` 并记录 `parse_error=true`。

质量计算使用从 SRT 提取并合并后的纯文本；字幕健康度使用 cue 级结构。

## Manifest Compatibility

当前实现以 sample-only manifest 为准：

```json
{
  "schema_version": 1,
  "samples": [
    {
      "id": "en-podcast-1m",
      "kind": "sample",
      "prepared_media_path": "local_tests/media/light/en-podcast-1m.wav",
      "prepared_media_checksum_sha256": "...",
      "reference_transcript_path": "local_tests/references/light/en-podcast-1m.txt",
      "reference_transcript_checksum_sha256": "...",
      "language": "en"
    }
  ]
}
```

`bench` 不再依赖 `assets[]`，也不暴露 `--sample-id`。CLI 输入媒体路径后，读取逻辑按
`samples[].prepared_media_path` 的文件名匹配 sample entry。

必需字段：

- `samples`: sample 数组。
- `samples[].id`: 报告中的稳定样本 ID。
- `samples[].prepared_media_path`: 已生成媒体路径，也是 CLI 输入和 manifest sample 的匹配依据。

建议字段：

- `samples[].prepared_media_checksum_sha256`: 已生成媒体 SHA-256。
- `samples[].reference_transcript_path`: reference 文本路径；存在时计算 WER/CER。
- `samples[].reference_transcript_checksum_sha256`: reference SHA-256。
- `samples[].language`: `auto`, `zh`, `en`, `ja`, `ko`；其他值仅保留为元数据，执行时回落到 `auto`。
- `samples[].source_dataset`, `source_url`, `license`, `redistributable`: 报告中的来源说明。
- `samples[].target_metrics`: 当前样本关注的指标集合。

如果找不到 manifest entry，`bench` 仍可运行，但 `reference_available=false`，且语言保持 CLI 参数或默认 `auto`。

不应把 prediction/reference 全文默认写入 JSON 或 Markdown。报告只写计数、错误率、状态和 warnings。后续如果需要诊断文本差异，可另加显式参数；本轮不做。

## 当前样本覆盖范围

本轮只使用已经可以通过脚本准备并带有 reference 的样本：

| 样本 | 来源 | 主要验证点 |
| --- | --- | --- |
| `zh-interview-10m` | AISHELL-1 | 中文 CER、速度、字幕结构 |
| `ja-talk-10m` | Common Voice Japanese | 日文 CER、速度、字幕结构 |
| `ko-talk-10m` | Common Voice Korean | 韩文 CER、速度、字幕结构 |
| `noisy-music-5m` | Common Voice `other.tsv` | noisy/other 场景 CER、空输出、段数异常 |
| `mini-librispeech-dev-clean-sample-001` | Mini LibriSpeech | 英文 WER/CER、速度 |

`en-podcast-10m` 和 `zh-en-mixed-10m` 当前仍保持 `manual_required`，本轮不自动纳入质量评估。待原始音频和 reference 准备好后，再通过同一套指标纳入。

## 报告要求

### 默认简报摘要

默认控制台输出应保持短而可读，重点展示：

- profile
- actual device / compute type
- avg RTFx
- CER / WER
- invalid segments
- empty output
- status

默认摘要不应泄露用户目录绝对路径。

### Markdown 详细报告

`--markdown` 输出详细报告，包含：

- 硬件概要。
- 样本元数据。
- 每个 profile 的 summary。
- 每次 run 的速度、质量和字幕健康度。
- warnings/errors。
- 指标解释。

详细报告仍应避免写入用户目录绝对路径、主机名、网络共享路径或其他机器敏感信息。

### JSON 完整结构

`--json` 输出完整机器可读报告：

- 每个 run 保留现有速度字段。
- `quality` 从占位字段变成真实指标。
- 增加字幕健康度字段。
- summary 聚合 `cer_avg`, `wer_avg`, `invalid_segments_count_avg`。
- summary 增加 `quality_summary_method`，本轮固定为 `repeat_macro_avg`。

JSON 模式下 stdout 只输出 JSON；warning 或降级说明应进入 report 字段，不污染 stdout。

summary 聚合规则：

- `cer_avg`、`wer_avg` 只统计 `quality_status=ok` 且对应指标非 `null` 的成功 run。
- `invalid_segments_count_avg` 只统计成功 run。
- 本轮 repeat 维度使用算术平均，也就是 `quality_summary_method=repeat_macro_avg`。
- 后续跨多个样本时再考虑 micro average，即总 edit distance / 总 reference units。

## 测试计划

新增或更新单测覆盖：

- 有 reference transcript 时，`bench` 输出真实 CER。
- 英文 reference 时，`bench` 输出 WER 和 CER。
- 无 reference 时，不计算质量但 `bench` 成功。
- `reference_mode=partial` 时，不计算 WER/CER，并输出 `quality_status=partial_reference`。
- 空 reference / 空 prediction 行为符合 Metric Semantics。
- 英文 normalization 去大小写和标点后再算 WER。
- CJK normalization 去空白和标点后再算 CER。
- SRT 空输出时 `empty_output=true`。
- SRT parse error 时记录 `parse_error=true`。
- overlapping cue、non-positive duration、empty text 分别计数。
- 无效 SRT 时间轴计入 `invalid_segments_count`。
- summary 聚合 `cer_avg`, `wer_avg`, `invalid_segments_count_avg`。
- summary 输出 `quality_summary_method=repeat_macro_avg`。
- 新版 `samples[]` manifest 能读取 `reference_transcript_path`。
- 报告默认不包含 prediction/reference 全文。
- 默认简报摘要不泄露绝对路径。
- Markdown 详细报告包含质量、字幕健康度和 run 明细。

建议验收命令：

```powershell
uv run pytest tests/test_bench.py
uv run pytest tests/test_bench_assets.py
uv run ruff check src/fast_sub/bench.py tests/test_bench.py
uv run pytest
```

如果本机 `uv` 默认 cache 目录不可写，可改用项目内 cache：

```powershell
$env:UV_CACHE_DIR='.uv-cache'
uv run pytest tests/test_bench.py
```

## 验收标准

- 不新增 CLI 命令。
- 不新增复杂资源采样。
- 不新增真实媒体或本地报告到仓库。
- 现有 `bench` JSON/Markdown 输出保持向后兼容，新增字段只补充信息。
- 当前已生成的样本和 references 能用于速度、质量和字幕健康度验证。
- WER/CER 口径、normalizer 和 reference_mode 在 JSON/Markdown 中可追踪。
- 支持 Round5_5 的 `samples[]` manifest。
- 默认报告不泄露 prediction/reference 全文。
