# Fast Sub 第 7.5 轮：Translation Benchmark

## Summary

第 7.5 轮在第 7 轮翻译 provider loop 之上，补齐“翻译质量大致可比较”的 benchmark 设计。核心交付是新增 `fast-sub bench-translate` 计划，让用户用源语言 SRT 和目标语言 reference SRT/TXT，对不同翻译 provider 的质量、速度和失败情况形成可复现的粗略判断。

本轮只规划和实现 Python CLI 内的翻译 benchmark。不启动 Go migration，不做 Electron UI/Web UI，不提交真实模型、真实媒体或本地 benchmark 报告。

与现有 `fast-sub bench` 的边界：

- `fast-sub bench` 继续用于媒体输入的转写 benchmark：`media -> STT -> SRT`，指标以 RTFx、WER/CER 和字幕结构健康度为主。
- `fast-sub bench-translate` 用于字幕输入的翻译 benchmark：`source SRT -> translate -> target SRT`，指标以 BLEU、chrF、exact match、失败 cue、耗时和 provider 隐私边界为主。
- 两者不塞进同一个命令，避免媒体参数、STT worker、翻译 provider 和 reference 对齐规则互相污染。
- `FAST_SUB_BENCH_QUALITY_PLAN.md` 只描述现有 `fast-sub bench` 的 ASR/transcribe 质量增强；本文档描述独立的 translation benchmark。

## Current State

第 7.5 轮开始前已经完成：

- `fast-sub translate` 已可真实翻译 SRT，并支持 replace/bilingual。
- provider registry 已包含 `web-bing`、`web-google`、`api-openai-chat`、`local-nllb-ct2`。
- `local-nllb-ct2` 已接入模型管理器和默认 NLLB/CTranslate2 模型 manifest。
- 翻译命令已有 partial failure、all failure、`.errors.json`、checkpoint/resume 和 JSON purity 测试。
- `fast-sub bench` 已实现 `transcribe_media_v1`，可输出 JSON/Markdown benchmark 报告。
- `scripts/bench_assets.py` 已提供真实 benchmark 数据准备与受控下载器，但不作为正式用户 CLI。
- sacreBLEU 是 MT benchmark 的事实标准之一，支持 BLEU、chrF、TER、JSON 输出和 metric signature。
- SubER/subtitle-edit-rate 已有直接针对 SRT 的字幕质量指标，可作为后续 segmentation-aware 指标参考。

第 7.5 轮需要补上的能力：

- 翻译 provider 之间缺少同一批字幕上的粗略质量比较。
- 用户不知道当前本地 NLLB、网页翻译和 API chat 翻译在某个样本上的大致差异。
- 现有 `bench` 只测转写，不测 `translate_srt_v1`。
- 还没有翻译 reference manifest 和翻译 benchmark report schema。

## Implementation Scope

第 7.5 轮建议使用一个分支：

```text
codex/fast-sub-translate-bench
```

建议单分支的原因：

- `bench-translate` CLI、translation runner、quality metrics、report schema 和 docs 强相关。
- 第一版不引入真实样本下载，不需要拆出 assets 分支。
- 本轮与 Go migration、UI/Web、provider 新增都隔离。

建议分两阶段验收，但仍保留一个实现分支：

### Phase A: 最小闭环

- `bench-translate` CLI。
- 调用 `translate_srt()`，默认 `--no-resume`。
- 支持 SRT/TXT reference。
- 输出 JSON report。
- 优先使用 sacreBLEU 计算 BLEU/chrF，并记录 metric signature；保留 lightweight 指标作为 fallback 或测试实现。
- 实现 exact match。
- 覆盖 mock provider 的成功、partial failure、all failure。

### Phase B: 报告完善

- Markdown report。
- `--output-dir`。
- `--repeat` 聚合，包含 avg/min/max/stddev。
- manifest schema/example，支持 samples + provider matrix。
- path redaction、secret redaction、privacy warning 覆盖。

## Goals

- 新增 `fast-sub bench-translate input.srt --reference ref.zh.srt --from en --to zh --provider local-nllb-ct2`。
- 使用 reference-based 指标粗略评估翻译质量。
- 输出 JSON 和 Markdown benchmark report。
- 记录 provider/model/source/target、cue 成功失败数、耗时、吞吐和质量指标。
- 支持 reference SRT 和 reference TXT。
- 支持 repeat 聚合，让用户观察 provider 稳定性。
- 记录 metric implementation、metric signature、score scale 和 dependency versions，让报告可复现。
- 规划公开数据集采样方案，覆盖 `en/ja/ko -> zh` 和 `zh/ja/ko -> en`。
- 支持 light/standard 两档采样规模，用于快速 smoke benchmark 和相对稳定的质量比较。
- 保持远程 provider 必须显式 opt-in，不静默上传字幕文本。
- 不把 benchmark 分数描述为权威人工质量结论，只作为可复现的粗略参考。

## Non-Goals

- 不在第 7.5 轮启动 Go migration。
- 不做 Electron UI 或 Web UI。
- 不新增翻译 provider。
- 不实现 LLM judge。
- 不实现人工评审工作流。
- 不在第 7.5 轮实现 SubER、TER、CER、time alignment 或 automatic segmentation 指标；只把它们列为后续方向。
- 不提交真实模型文件、真实媒体文件、真实 reference corpus 或本地 benchmark 报告。
- 不把 `bench` 改成多任务入口；第一版使用独立 `bench-translate`。
- 不默认联网下载 benchmark 数据。
- 不让采样脚本下载公开数据集；数据集必须由用户手动下载到本地。
- 不把手动下载的数据集原始文件、采样结果或生成的 report 提交仓库。
- 不静默启用任何远程 provider。

## Workstream 1: Translate Benchmark CLI

目标命令：

```bash
fast-sub bench-translate input.srt --reference ref.zh.srt --from en --to zh --provider local-nllb-ct2
fast-sub bench-translate input.srt --reference ref.zh.txt --from en --to zh --provider web-bing
fast-sub bench-translate input.srt --reference ref.zh.srt --from en --to zh --provider api-openai-chat --model <model>
```

必需参数：

```text
--provider web-bing|web-google|api-openai-chat|local-nllb-ct2
--to zh|en|ja|ko
--reference <path>
```

支持参数：

```text
--from auto|en|zh|ja|ko
--json
--markdown
--markdown-path <path>
--output-dir <path>
--repeat
--sample-manifest <path>
--model <id-or-provider-model>
--model-path <path>
--batch-size
--timeout
--sleep-seconds
--keep-outputs / --no-keep-outputs
```

行为要求：

- `bench-translate` 调用现有 `translate_srt()`，不绕过第 7 轮 provider 安全边界。
- benchmark 翻译输出默认写到 `.fast-sub/bench-translate/<input-stem>-<timestamp>/`，不写在输入 SRT 旁边。
- 支持 `--output-dir` 覆盖默认输出目录。
- 默认保留 translated SRT、`.errors.json` 和 report，便于用户复查；如实现 `--no-keep-outputs`，只能清理中间文件，不能清理用户显式指定的 Markdown/JSON report。
- benchmark 默认传 `--no-resume` 给 `translate_srt()`，避免 checkpoint 污染耗时指标；如果后续允许 `--resume`，report 必须记录 `resume_used=true|false`。
- 默认使用 `replace` 模式计分；不使用 bilingual 输出计分。
- `--repeat` 必须大于 0。
- 缺 provider、未知 provider、缺 `--to`、缺 reference、非法 batch size 或非法 repeat 都返回结构化错误。
- `--json` 模式下 stdout 必须只输出可解析 JSON；进度、warning、隐私提示进入 stderr。
- 非 JSON 模式可以打印简短进度和 privacy warning。
- repeat report 必须记录每次 run 的独立结果，summary 不只记录 average，也记录 min/max/stddev。
- 如果 provider 有 batch retry 或 single cue fallback，report 必须记录 retry/fallback 计数，避免速度和失败率不可解释。

Exit code 约定：

- 输入、参数或 reference 无效：`2`。
- provider 缺依赖：沿用 `translate` 的 `3`。
- 本地模型缺失或不可访问：沿用 `translate` 的模型相关错误码。
- provider 全部失败：非零退出，优先沿用 `translate` 的 provider failure 语义。
- partial failure：退出 `0`，但 report 中 `failed_count > 0`，并记录 warning 和 `errors_path`。
- Markdown/JSON report 写入失败：非零退出，并返回结构化 `report_write_failed` 或等价错误码。
- 参数或 reference 无效时，不生成 run report，只输出结构化错误。
- provider all failure 时，生成 failed JSON report，`status="failed"`，quality metric 为 null，reference 状态仍可记录。

## Workstream 2: Reference-Based Quality Metrics

第一版质量指标：

```text
bleu
chrf
exact_match_rate
reference_available
reference_alignment_status
reference_type
metric_implementation
metric_signature
score_scale
tokenizer
```

Metric implementation 要求：

- 默认优先使用 sacreBLEU 计算 BLEU 和 chrF。
- report 需要记录 sacreBLEU 的 signature、version、tokenizer、case、smooth 等可复现信息。
- 如果 sacreBLEU 不可用或第一版选择不引入依赖，必须明确记录 `metric_implementation=fast_sub_lightweight_v1`，且文档说明该分数不等价于 sacreBLEU。
- JSON report 的 canonical score 使用 0-1；如果底层库返回 0-100，同时记录 `raw_score` 和 `raw_scale`。

BLEU 要求：

- 默认使用 sacreBLEU corpus-level BLEU；fallback 才使用 Fast Sub lightweight corpus-level BLEU。
- 使用 1-4 gram clipped precision。
- 使用 brevity penalty。
- JSON canonical score 输出 0-1 浮点，不输出百分号。
- 如果使用 sacreBLEU，记录原始 0-100 raw score 和 signature。
- 对 CJK 文本按 Unicode 字符或轻量 tokenizer 处理，口径必须记录在 report 中。

chrF 要求：

- 默认使用 sacreBLEU chrF；fallback 使用 character n-gram F-score。
- 默认 n=6。
- beta=2。
- JSON canonical score 输出 0-1 浮点。
- 如果使用 sacreBLEU，记录原始 0-100 raw score 和 signature。
- 对中日韩文本优先参考 chrF，因为 BLEU 对短字幕更不稳定。

exact match 要求：

- 按 cue 顺序比较 normalized prediction/reference。
- 只在 reference SRT cue 可对齐时计算 cue-level exact match。
- reference 是 TXT 或 cue 数不一致时，`exact_match_rate=null`，并记录 alignment status。

Reference 读取规则：

- `.srt` reference 使用 `pysubs2` 按 cue 顺序抽取文本。
- `.txt` reference 默认按全文语料读取。
- TXT 第一版不强行和 SRT cue 对齐；未来可扩展 `--reference-txt-mode lines|corpus`。
- source SRT cue 数和 reference SRT cue 数不一致时，不让 benchmark 崩溃。
- cue 数不一致时设置：

```text
reference_alignment_status = "count_mismatch"
```

- reference 缺失、不可读或格式错误时返回结构化错误；如果 manifest 中没有 reference，则 report 可以成功但 `reference_available=false`。

Normalization 要求：

- report 必须记录 normalization profile，例如 `translate_quality_basic_v1`。
- report 必须记录 `metric_implementation=fast_sub_lightweight_v1`。
- report 必须记录 tokenizer，例如 `char_cjk_or_whitespace_v1`。
- 去除 SRT 样式标签、`\N`、多余空白。
- 英文 casefold。
- CJK 不做破坏字符的信息丢失式归一化。

Reference 对齐状态：

```text
aligned
count_mismatch
corpus_only
missing
invalid
```

- `reference_type=srt` 且 cue 数一致时，`reference_alignment_status=aligned`，可计算 cue-level `exact_match_rate`。
- `reference_type=srt` 但 cue 数不一致时，`reference_alignment_status=count_mismatch`，`exact_match_rate=null`，仍可计算 corpus-level BLEU/chrF。
- `reference_type=txt` 时，`reference_alignment_status=corpus_only`，`exact_match_rate=null`。
- reference 缺失或不可读时，CLI 参数模式返回结构化错误；manifest 模式可记录 `missing|invalid` 并跳过该 sample。

字幕结构指标：

- report 需要记录基础字幕结构差异，但不把它们直接解释为翻译质量：
  - `cue_count_delta`
  - `duration_total_delta_sec`
  - `avg_chars_per_cue`
  - `avg_cps`
- segmentation-aware 指标作为后续方向记录：
  - `SubER`
  - `AS-BLEU`
  - `t-BLEU`
  - `TER`
  - `CER`

## Workstream 3: Report And Manifest

Report scope：

```text
measurement_scope = "translate_srt_v1"
```

JSON report 必须包含：

```text
schema_version
generated_at
measurement_scope
input_basename
input_path_redacted
command
sample
provider
model
source_language
target_language
fast_sub_version
dependency_versions
input_sha256
reference_sha256
config_hash
profiles/runs 或 runs
summary
```

每次 run 至少包含：

```text
index
status
provider
model
source_language
target_language
srt_path
cues_count
translated_count
failed_count
elapsed_sec
chars_per_sec
cues_per_sec
quality
batch_size_requested
batch_size_effective
retry_count
single_cue_fallback_count
rate_limit_sleep_sec_total
warnings
errors_path
output_dir
resume_used
```

summary 至少包含：

```text
runs
ok_runs
failed_runs
elapsed_sec_avg
chars_per_sec_avg
cues_per_sec_avg
elapsed_sec_min
elapsed_sec_max
elapsed_sec_stddev
chars_per_sec_min
chars_per_sec_max
chars_per_sec_stddev
cues_per_sec_min
cues_per_sec_max
cues_per_sec_stddev
bleu_avg
bleu_min
bleu_max
bleu_stddev
chrf_avg
chrf_min
chrf_max
chrf_stddev
exact_match_rate_avg
exact_match_rate_min
exact_match_rate_max
exact_match_rate_stddev
failed_count_avg
failed_count_min
failed_count_max
reference_type
reference_alignment_status
metric_implementation
metric_signature
score_scale
normalization_profile
tokenizer
```

Markdown report 要求：

- 标题为 `Fast Sub Translation Benchmark Report`。
- 包含 Summary、Provider、Quality、Performance、Run Details、Warnings And Errors。
- 不输出绝对 input/reference 路径。
- command 中的路径只保留 basename。
- 不输出 prediction/reference 全文。
- secret、API key、Authorization header 和敏感请求内容不得出现在 Markdown。
- 明确说明 higher/lower is better。
- 明确说明不同 reference、不同领域、不同长度样本之间的分数不能直接横向比较。

Manifest 计划：

新增翻译 benchmark manifest schema，建议命令：

```bash
fast-sub bench-translate-manifest
fast-sub bench-translate-manifest --json
```

Manifest 示例字段：

```json
{
  "schema_version": 1,
  "providers": [
    {
      "id": "web-bing"
    },
    {
      "id": "local-nllb-ct2",
      "model": "nllb-200-distilled-600m-ct2-int8"
    }
  ],
  "samples": [
    {
      "id": "en-podcast-1m-to-zh",
      "source_subtitle_path": "local_tests/subtitles/en-podcast-1m.srt",
      "reference_translation_path": "local_tests/references/en-podcast-1m.zh.srt",
      "source_language": "en",
      "target_language": "zh",
      "domain": "podcast",
      "source_dataset": "authorized local sample",
      "license": "local-only",
      "redistributable": false,
      "target_metrics": ["bleu", "chrf", "exact_match_rate", "elapsed_sec"]
    }
  ]
}
```

真实 reference、真实字幕和本地 report 必须放在 ignored `local_tests/` 路径，不提交仓库。

Manifest 行为：

- manifest 支持 samples + provider matrix，同一 sample 可以跑多个 provider。
- CLI 参数可以覆盖 manifest 中的 provider matrix，但覆盖行为必须记录在 report。
- manifest sample 级别必须记录 source/reference license 和 redistributable 状态。
- 不同 sample/reference 的分数不能聚合为单一质量结论；只允许在 report 中分 sample 展示或显式标注不可直接比较。

输出目录建议：

```text
.fast-sub/bench-translate/<input-stem>-<target>-<provider>-<timestamp>-<short-hash>/
```

其中 short hash 来自 input/reference/config，report 中记录完整 `input_sha256`、`reference_sha256` 和 `config_hash`。

## Workstream 3.5: Public Dataset Sampling

目标：

- 用公开平行语料构造可复现的小型翻译 benchmark 样本。
- 覆盖用户最关心的两个方向组：
  - 英日韩转中：`en -> zh`、`ja -> zh`、`ko -> zh`
  - 中日韩转英：`zh -> en`、`ja -> en`、`ko -> en`
- 数据集本体由用户手动下载；Fast Sub 只提供本地提取、过滤、采样和伪 SRT 生成脚本。

采样规模：

| Profile | 每方向条数 | 目的 |
| --- | ---: | --- |
| `light` | 20-50 | 快速验证 provider 可用性、JSON/report、隐私提示和失败路径。 |
| `standard` | 200-500 | 更稳定地比较 BLEU/chrF、耗时、失败率和 provider 差异。 |

推荐数据源：

| 数据源 | 用途 | 方向 |
| --- | --- | --- |
| IWSLT/TED Talks | 主数据源；更接近字幕/口语翻译场景。 | `en -> zh`、`ja -> zh`、`ko -> zh`、`zh -> en`、`ja -> en`、`ko -> en`，以实际可获得语言对为准。 |
| Tatoeba Challenge | light profile 和 sanity set；小、易抽样、易复现。 | 六个核心方向的 fallback。 |
| JParaCrawl | 日中专项补充。 | `ja -> zh`，必要时也可反向构造 `zh -> ja`，但不属于本轮核心方向。 |
| WMT / UM-Corpus | 英中专项补充。 | `en -> zh`、`zh -> en`。 |

第一版优先级：

1. `light` profile 优先从 Tatoeba Challenge 抽样，保证每个核心方向都有小样本。
2. `standard` profile 优先从 IWSLT/TED Talks 抽样，尽量贴近字幕场景。
3. 如果 IWSLT/TED 某个方向不可用或质量不稳定，使用 Tatoeba fallback。
4. `ja -> zh` 可以额外使用 JParaCrawl 补充 standard profile。
5. `en -> zh` / `zh -> en` 可以额外使用 WMT 或 UM-Corpus 补充 standard profile。
6. `ko -> zh` 第一版不绑定大型商业或受限数据集，优先 IWSLT/TED + Tatoeba。

本地目录：

```text
local_tests/
  bench_translate/
    raw/
      iwslt_ted/
      tatoeba/
      jparacrawl/
      wmt_or_um/
    datasets/
      light/
      standard/
    manifests/
      light.json
      standard.json
    reports/
      light/
      standard/
```

目录规则：

- `local_tests/bench_translate/` 必须在 git ignore 范围内。
- 不复用 ASR/transcribe benchmark 的 `local_tests/bench/`，避免报告、assets 和 manifest 混用。
- `raw/` 放用户手动下载并解压后的原始公开数据。
- `datasets/light` 和 `datasets/standard` 放采样后生成的 source/reference SRT/TXT。
- `manifests/` 放本地生成的 benchmark manifest。
- `reports/` 放本地 benchmark 输出。

采样脚本职责：

- 只读取本地 `raw/` 数据，不访问网络。
- 只做提取、过滤、去重、固定 seed 采样、语言方向转换和伪 SRT/TXT 生成。
- 生成每个方向的：
  - `source.srt`
  - `reference.srt`
  - `reference.txt`
  - sample metadata JSON
- 生成 light/standard manifest。
- 记录 source dataset、license、manual download URL、download date、raw file hash、sample seed、sample ids、sample hash。
- 不把采样结果写入仓库路径以外的随机位置。

采样规则：

- 固定 random seed，保证同一 raw 数据和同一脚本版本可复现。
- 过滤空行、明显错位行、过短行、超长行、重复 source/reference。
- 保留句子顺序为采样后稳定顺序，不依赖原始文件遍历顺序。
- 伪 SRT 时间轴用合成时间，例如每 cue 3 秒；report 必须标记 `synthetic_timing=true`。
- SRT cue 数必须和 reference cue 数一致。
- TXT reference 默认写全文 corpus，不做 cue 对齐承诺。
- 对 CJK 方向保留原始字符，不做破坏性 normalization。

示例输出命名：

```text
local_tests/bench_translate/datasets/light/en-zh.sample-50.source.srt
local_tests/bench_translate/datasets/light/en-zh.sample-50.reference.srt
local_tests/bench_translate/datasets/light/en-zh.sample-50.reference.txt
local_tests/bench_translate/datasets/standard/ko-en.sample-300.source.srt
local_tests/bench_translate/datasets/standard/ko-en.sample-300.reference.srt
local_tests/bench_translate/datasets/standard/ko-en.sample-300.reference.txt
```

脚本文档必须说明：

- 用户需要手动下载哪些数据集。
- 原始数据应放到哪个 `raw/` 子目录。
- 每个数据源的 license 和 redistributable 状态。
- 生成的样本只用于本地 benchmark，不提交仓库。

## Workstream 4: Provider Safety And Privacy

安全边界：

- 不静默启用远程 provider。
- web/API provider 必须由 CLI 参数或显式配置选择。
- 非 JSON 输出中，远程 provider 需要提示字幕文本会发送到第三方服务。
- JSON 输出不能被 privacy warning 污染。
- `api-openai-chat` 仍要求显式 API key 和显式 model。
- `OPENAI_API_KEY`、Authorization header、raw request、raw response 中的敏感内容不得写入 stdout、stderr、JSON、Markdown 或 `.errors.json`。
- web provider 仍受第三方网页翻译稳定性、限流、地区可用性和条款影响；report 不能把 web provider 结果描述为稳定 SLA。
- `local-nllb-ct2` 的缺依赖、缺模型、hash mismatch 和不可访问模型路径必须保留结构化错误。
- report 默认不得包含 prediction/reference 全文，只记录计数、分数、状态、warning 和 redacted path。
- report 必须结构化记录：
  - `provider_privacy_class=local|remote-web|remote-api`
  - `uploads_text=true|false`
  - `provider_terms_url` 可选
  - `redaction_applied=true|false`

质量解释边界：

- BLEU/chrF 只能表示相对粗略信号。
- 短字幕、意译、口语化翻译和多参考缺失会导致分数波动。
- Markdown 必须说明“lower/higher is better”和“not a human-quality guarantee”。
- 对 CJK 翻译优先看 chrF；BLEU 可作为辅助。
- Markdown 必须说明不同 reference、领域、长度的分数不可直接比较。

## Workstream 5: Tests And Docs

CLI 测试：

- 缺 provider。
- 未知 provider。
- 缺 `--to`。
- 缺 `--reference`。
- 非法 repeat。
- 非法 batch size。
- JSON stdout purity。
- Markdown path redaction。
- remote provider privacy warning 不污染 JSON。
- secret redaction 覆盖 stdout、stderr、JSON、Markdown 和 error payload。

Runner 测试：

- 完全一致译文得到高 BLEU/chrF 和 exact match。
- 部分错误译文得到较低 BLEU/chrF。
- SRT reference 可用。
- TXT reference 可用。
- cue count mismatch 被记录为 `count_mismatch`。
- partial failure 仍输出 report，并记录 failed_count/errors_path。
- all failure 非零退出，并尽量保留结构化 report。
- 默认 `--no-resume`，report 中 `resume_used=false`。
- 输出目录默认落在 `.fast-sub/bench-translate/<input-stem>-<timestamp>/`。
- 输出目录包含 target/provider/timestamp/short-hash。
- repeat 聚合 elapsed、throughput 和 quality 的 avg/min/max/stddev。
- provider all failure 生成 failed JSON report，metric 为 null。
- 参数/reference 无效不生成 run report，只输出结构化错误。
- batch retry、single cue fallback 和 rate limit sleep 计数进入 report。
- manifest 支持 samples + provider matrix。

Metrics 测试：

- 空预测。
- 短预测。
- CJK 字符。
- 英文大小写和空白归一化。
- BLEU brevity penalty。
- chrF beta=2 行为。
- sacreBLEU signature 被记录。
- canonical score scale 为 0-1，raw score/scale 保留底层库口径。

Regression 测试：

- 现有 `fast-sub bench` 转写 benchmark 不受影响。
- 默认测试不访问真实网络。
- 默认测试不下载真实模型。
- 不提交真实 benchmark report。

需要同步的文档：

```text
FAST_SUB_PLAN.md
FAST_SUB_GO_MIGRATION_PLAN.md
mvp.md
mvp.zh.md
```

文档必须说明：

- `bench-translate` 是计划中的独立命令。
- 第一版使用 reference-based BLEU/chrF，不使用 LLM judge。
- BLEU/chrF 默认对齐 sacreBLEU；若使用 lightweight fallback，必须说明不等价。
- JSON report 中 canonical score 为 0-1，同时记录 raw score/scale。
- repeat report 包含 min/max/stddev。
- SubER/TER/CER/time-alignment 是后续方向，不属于第 7.5 轮默认实现。
- 数据采样覆盖 `en/ja/ko -> zh` 和 `zh/ja/ko -> en` 六个核心方向。
- 提供 light/standard 两档采样说明。
- 数据集本体手动下载到 `local_tests/bench_translate/raw/`，脚本只做本地提取和采样。
- `local_tests/bench_translate/` 与 ASR benchmark 目录隔离，并保持 ignored。
- report schema 需要后续 Go migration 兼容。
- 不提交真实模型、真实媒体、真实 reference 或本地 report。

## Checklist

- [x] 新增 `bench-translate` CLI 计划和实现。
- [x] 新增 translation benchmark runner。
- [x] 复用 `translate_srt()`，不绕过 provider 安全边界。
- [x] 新增 BLEU/chrF/exact_match 轻量指标。
- [x] 优先接入或对齐 sacreBLEU，并记录 metric signature。
- [x] 统一 canonical score scale，并保留 raw score/scale。
- [x] 支持 reference SRT。
- [x] 支持 reference TXT。
- [x] 支持 JSON report。
- [x] 支持 Markdown report。
- [x] 支持 repeat 聚合 avg/min/max/stddev。
- [x] 支持 manifest schema/example 和 provider matrix。
- [ ] 增加 public dataset sampling 规划和本地采样脚本说明。
- [ ] 支持 light/standard 两档采样 profile。
- [ ] 覆盖 `en/ja/ko -> zh` 和 `zh/ja/ko -> en` 六个核心方向。
- [x] 记录 input/reference/config hash 和 dependency versions。
- [x] 记录 provider privacy class 和 upload boundary。
- [x] 覆盖 CLI 错误路径。
- [x] 覆盖 metric edge cases。
- [x] 覆盖 partial/all failure。
- [x] 覆盖 JSON purity 和 secret redaction。
- [x] 同步文档。

## Merge Criteria

- 工作在 `codex/fast-sub-translate-bench`。
- 不修改 Go migration 代码。
- 不新增 Electron UI/Web UI。
- 默认测试不访问真实网络。
- 默认测试不下载真实模型。
- 不提交真实模型、真实媒体、真实 reference 或真实本地 report。
- `bench-translate` 能对 SRT input + SRT/TXT reference 输出 JSON report。
- Markdown report 不包含绝对路径和 secret。
- JSON/Markdown report 不包含 prediction/reference 全文。
- partial failure 和 all failure 都有结构化 report 行为。
- 远程 provider 只能显式 opt-in。
- BLEU/chrF 口径、normalization profile 和 reference alignment status 在 report 中可追踪。
- report 记录 `metric_implementation`、`metric_signature`、`score_scale`、`tokenizer` 和 `resume_used`。
- report 记录 avg/min/max/stddev repeat 聚合。
- manifest 能表达同一批 samples 对多个 providers 的 matrix benchmark。
- report 记录 input/reference/config hash，避免 timestamp-only 输出不可复现。
- 文档说明 SubER/segmentation-aware 指标是后续方向。
- 数据采样脚本不访问网络，只处理用户手动下载到 `local_tests/bench_translate/raw/` 的数据。
- light/standard manifest 能表达六个核心方向。
- 采样输出和报告位于 ignored `local_tests/bench_translate/`，不与 ASR benchmark 目录冲突。
- 现有 `fast-sub bench` 转写 benchmark 行为保持兼容。
