# Fast Sub 第 7 轮：Translation Provider Loop

## Summary

第 7 轮把 Fast Sub 从“本地原文字幕 CLI”推进到“可用的字幕翻译工具”。核心交付是实现真实的 `fast-sub translate input.srt --to <lang>` 命令，并让本地翻译模型可以通过现有模型管理器安装。

本轮仍在 Python CLI 内完成。不启动 Go 迁移，不做 UI/Web，也不静默启用任何远程上传。

## Current State

第 7 轮开始前已经完成：

- v0 本地原文字幕 CLI 已完成 hardening 和文档同步。
- `fast-sub translate` 仍是占位命令。
- provider contract 已经包含 `ProviderType.TRANSLATE`、`TranslationProviderRequest` 和 `TranslationProviderResponse`。
- 模型管理器已经支持 CTranslate2 风格的目录/多文件 manifest。
- 项目已有 `translators` 依赖，但当前翻译逻辑还没有接入真实 provider 化 CLI 流程。

第 7 轮开始时的缺口：

- 没有真实 translated/bilingual SRT 输出链路。
- provider registry 里还没有 web translation provider。
- `api-openai-chat` 已有定义，但还不是可用翻译 provider。
- `local-nllb-ct2` 已有定义，但不能从 `models install` 解析模型。
- model manifest 里还没有 NLLB 翻译模型。
- `translators` 是 GPL-3.0 许可证依赖，发布打包策略需要在本轮明确。
- NLLB 使用 FLORES-200 语言码，不能只依赖 `zh` / `en` / `ja` / `ko` 这种 CLI 简码。

## Implementation Scope

第 7 轮实现建议使用一个分支：

```text
codex/fast-sub-translate-cli
```

建议单分支的原因：

- `translate` CLI、provider resolution、model manifest 和 SRT 行为必须一起落地才完整可 review。
- 如果把模型安装和翻译 provider 拆开，`local-nllb-ct2` 会长期处在半可用状态。
- 本轮范围和 Go migration、UI/Web 都隔离，单分支足够清晰。

只有在用户文档变得很大时，才考虑后续拆一个 docs-only 分支：

```text
codex/fast-sub-translate-docs
```

## Goals

- 实现 `fast-sub translate input.srt --to zh` 真实翻译命令。
- 支持 provider id：`web-bing`、`web-google`、`api-openai-chat`、`local-nllb-ct2`。
- 新增默认本地翻译模型 ID：`nllb-200-distilled-600m-ct2-int8`。
- 支持通过 `fast-sub models install/verify` 安装和校验本地 NLLB/CTranslate2 翻译模型。
- 保持字幕时间轴、cue 顺序和 cue 数量稳定。
- 远程翻译必须显式 opt-in，并在文档和提示中说明隐私边界。
- 已支持 `--json` 的路径中，stdout 在成功和覆盖到的失败场景下都必须可解析。

## Non-Goals

- 不在第 7 轮启动 Go migration。
- 不做 Electron UI 或 Web UI。
- 不让 `auto --yes` 自动安装翻译模型。
- 不静默选择任何远程 provider。
- 不在核心范围外扩展 `api-deepl` 或 `api-custom-http-translate`，除非第 7 轮核心目标已经稳定完成。
- 不提交真实 NLLB 模型文件。
- 不把免费网页翻译描述为高可靠 provider；它是便利 MVP 能力，不是稳定商业 API。
- 不在第 7 轮实现完整 project file 系统；只做轻量 checkpoint/resume。

## Workstream 1: Translate CLI

目标命令：

```bash
fast-sub translate input.srt --to zh --provider web-bing
fast-sub translate input.srt --to zh --provider web-google
fast-sub translate input.srt --to zh --provider api-openai-chat --model <model>
fast-sub translate input.srt --to zh --provider local-nllb-ct2
```

必需参数：

```text
--to zh|en|ja|ko
--provider web-bing|web-google|api-openai-chat|local-nllb-ct2
```

支持参数：

```text
--from auto|en|zh|ja|ko
--mode replace|bilingual
--bilingual-order original-first|translated-first
--output / -o
--model <id-or-provider-model>
--model-path <path>
--batch-size
--timeout
--sleep-seconds
--json
```

行为要求：

- 除非 `[translator].provider` 已配置，否则 provider 必须显式指定。
- 缺 provider、未知 provider、缺目标语言、非法 batch size 都要返回结构化错误。
- `--json` 模式下，成功和覆盖到的失败场景 stdout 都必须是可解析 JSON。
- 人类可读进度、warning 和隐私提示进入 stderr 或普通 human output，不污染 JSON stdout。
- 增加 `--resume/--no-resume`，默认允许从同参数、同输入 hash 的 checkpoint 继续。

## Workstream 2: Translation Providers

Provider 要求：

| Provider | 类型 | 需要网络 | Key/model 要求 | 说明 |
| --- | --- | --- | --- | --- |
| `web-bing` | remote web | yes | 不需要 API key | 调用 `translators.translate_text(..., translator="bing")`。 |
| `web-google` | remote web | yes | 不需要 API key | 调用 `translators.translate_text(..., translator="google")`；失败提示可建议改用 `web-bing`。 |
| `api-openai-chat` | API | yes | 显式 API key + 显式 model | 不允许硬编码默认模型。 |
| `local-nllb-ct2` | local | no | 已安装模型或显式 model path | 通过模型管理器解析。 |

规则：

- 远程 provider 必须明确说明字幕文本会发送到第三方服务。
- provider privacy class 必须区分：
  - `local`: 不上传字幕文本。
  - `remote-web`: 上传字幕文本到第三方网页翻译服务，无 API key，但稳定性、限流和服务条款不可控。
  - `remote-api`: 上传字幕文本到配置的 API provider，需要 key，费用和隐私遵循 provider 条款。
- API key、Authorization header、原始 secret、敏感请求内容不能出现在 stdout、stderr、JSON 或 `.errors.json`。
- `api-openai-chat` 解析响应时要容忍 fenced JSON、`<think>` blocks、前缀文本、malformed JSON、id/count mismatch。
- `api-openai-chat` 遇到 JSON 解析失败或 id/count mismatch 时，先缩小 batch 重试，再降级到单 cue；单 cue 仍失败才记录该 cue error。
- `local-nllb-ct2` 遇到缺运行时依赖要返回 `missing_dependency`，缺模型目录要返回 `missing_model`。
- `web-bing` / `web-google` 默认逐 cue 翻译，避免网页翻译服务破坏分隔符导致 cue 数错位。
- `web-bing` / `web-google` 第一版不承诺真正 batch；`--batch-size` 对 web provider 可以忽略、限制为 1，或只用于节流/进度分组。
- Google 在中国大陆网络环境可能不可用，失败提示应建议切换 `web-bing`。
- `translators` 许可证策略必须在本轮 merge 前明确：
  - 如果项目接受 GPL-3.0 影响，可以继续作为默认依赖分发。
  - 如果不接受，应改为 optional extra，例如 `uv sync --extra web-translate`，provider 缺依赖时返回 `missing_dependency`。

## Workstream 3: Translation Model Install

默认本地翻译模型 ID：

```text
nllb-200-distilled-600m-ct2-int8
```

必须支持的模型命令：

```bash
fast-sub models list
fast-sub models install nllb-200-distilled-600m-ct2-int8
fast-sub models verify nllb-200-distilled-600m-ct2-int8
```

Manifest 要求：

- 模型类型为 `translate`。
- backend 为 `nllb-ct2` 或 `ctranslate2`。
- manifest 类型为 directory/multi-file。
- URL 必须 pin 到明确仓库 revision。
- 每个必需文件都有 size 和 sha256。
- 不使用浮动 `latest` revision。
- 不提交真实模型文件。
- 必需文件类别至少包括：
  - CTranslate2 model files。
  - tokenizer / sentencepiece model。
  - vocabulary / config files。
  - model license 或 license reference。
  - pinned source revision。

NLLB 语言码要求：

- CLI 继续接收用户友好的短码，例如 `en`、`zh`、`ja`、`ko`。
- `local-nllb-ct2` 内部必须映射到 FLORES-200 language codes：
  - `en -> eng_Latn`
  - `zh -> zho_Hans`
  - `zh-Hant -> zho_Hant`，可作为后续扩展，第一版至少不要误映射繁体。
  - `ja -> jpn_Jpan`
  - `ko -> kor_Hang`
- `--from auto` 对 `local-nllb-ct2` 默认不成立；除非上游已有可靠语言检测结果，否则要求用户显式传 `--from en|zh|ja|ko`。
- 单条字幕超过 NLLB 推荐长度时，需要切分或返回 warning；不能把超长文本直接静默送入模型。

本地 provider 解析顺序：

1. `--model-path` 优先，且路径必须可读。
2. `--model <id>` 通过 model manifest 解析。
3. 未传模型参数时默认使用 `nllb-200-distilled-600m-ct2-int8`。
4. 缺模型时返回结构化 `missing_model`，并提示：

```bash
fast-sub models install nllb-200-distilled-600m-ct2-int8
```

5. 模型目录不完整、hash mismatch、不可访问时，都返回结构化错误，不能 traceback。

第 7 轮支持用户显式 `models install`；不让 `auto --yes` 默认安装翻译模型。

## Workstream 4: SRT Behavior

输入输出规则：

- 使用 `pysubs2` 解析 SRT。
- 保持 cue 顺序。
- 保持 cue 时间轴。
- 成功和 partial failure 场景下保持 cue 数量。
- `replace` 模式写译文。
- `bilingual` 模式按配置顺序写原文 + 译文。
- 单条失败时保留原文，并记录 warning。
- 如果每一行或每个 batch 都失败，命令非零退出，不写误导性的最终 translated subtitle。
- 可行时写 `.errors.json`，记录失败行、provider、错误摘要，但不能包含敏感请求内容。
- partial failure 时写最终 SRT 和 `.errors.json`。
- all failure 时不写最终 SRT，但必须写 `.errors.json`，除非输出目录本身不可写。
- JSON failure payload 中包含 `errors_path`，方便脚本定位失败明细。

## Workstream 4.5: Checkpoint And Resume

目标：

- 大字幕文件、网络 provider 和本地模型 provider 都可能中断；第 7 轮需要轻量恢复能力。
- 不实现完整 project file；只实现 translate 命令专用 checkpoint。

Checkpoint 文件：

```text
<output>.translate-progress.json
```

记录内容：

- input file path。
- input file hash。
- provider。
- source language。
- target language。
- mode。
- bilingual order。
- model / model path 摘要。
- 已成功 cue id 和译文。
- 已失败 cue id 和错误摘要。

恢复规则：

- 默认 `--resume`。
- 输入 hash、provider、target language、mode 或模型配置不匹配时，不复用旧 checkpoint。
- `--no-resume` 忽略 checkpoint 并重新翻译。
- 成功完成后可以保留 checkpoint 作为调试资料，或在文档中明确会清理；二者需要固定一种行为。

## Workstream 5: Tests And Docs

模型管理测试：

- `models list` 包含 translate 模型。
- `models verify nllb-200-distilled-600m-ct2-int8` 在目录缺失时返回 `missing`。
- 缺必需文件返回 `missing`。
- hash mismatch 返回 `hash_mismatch`。
- 不可访问路径不能 traceback。
- install 使用 fake HTTP，默认测试不访问真实网络。

Provider 测试：

- mock `translators.translate_text`，覆盖 `web-bing` 和 `web-google`。
- 验证 web provider 默认逐 cue 调用，不把多条字幕拼成一个不可靠 batch。
- 验证 `translators` 缺依赖时的 optional-extra 提示，前提是本轮决定采用 optional extra。
- mock local NLLB provider，确认已安装模型路径会传入 provider。
- 覆盖缺依赖、缺模型、非法 `--model-path`、未知模型 ID。
- 覆盖 NLLB ISO/FLORES 语言码映射，以及 `local-nllb-ct2 --from auto` 的拒绝/提示。
- 覆盖 chat parser：plain JSON、fenced JSON、`<think>`、前缀文本、malformed JSON、id/count mismatch。
- 覆盖 chat provider 在 parser/count mismatch 时缩小 batch 并降级到单 cue。

CLI 测试：

- 缺 provider。
- 未知 provider。
- 缺 `--to`。
- 非法 batch size。
- `replace` 成功写出合法 SRT。
- `bilingual` 成功写出合法 SRT。
- partial failure 成功退出，保留原文并记录 warning。
- all failure 非零退出，不写误导性输出。
- `--json` 成功/失败 stdout 都能被 `json.loads` 解析。
- secret 会从 stdout、stderr、JSON 和 `.errors.json` 中脱敏。
- checkpoint 存在且参数/input hash 匹配时，会跳过已成功 cue。
- checkpoint 参数/input hash 不匹配时，不复用旧翻译。
- `--no-resume` 会忽略 checkpoint。

需要同步的文档：

```text
FAST_SUB_PLAN.md
FAST_SUB_GO_MIGRATION_PLAN.md
mvp.md
mvp.zh.md
```

文档必须说明：

- provider 差异。
- 本地和远程 provider 的隐私边界。
- `translators` GPL-3.0 打包风险。
- 如果采用 optional extra，说明 `uv sync --extra web-translate`。
- NLLB 模型安装命令。
- NLLB FLORES-200 语言码限制和 `--from auto` 限制。
- 免费网页翻译稳定性、限流、地区访问风险。
- 第 7 轮中 `auto --yes` 不会静默安装翻译模型。

## Checklist

- [ ] 实现真实 `fast-sub translate` CLI 行为。
- [ ] 增加 `web-bing` 和 `web-google` providers。
- [ ] 明确 `translators` GPL-3.0 处理策略，必要时改为 optional extra。
- [ ] 增加 `api-openai-chat` translation provider 行为。
- [ ] 增加 chat provider batch 缩小重试和单 cue fallback。
- [ ] 增加 `local-nllb-ct2` 通过模型管理器解析模型。
- [ ] 增加 NLLB ISO/FLORES 语言码映射。
- [ ] 增加 `nllb-200-distilled-600m-ct2-int8` model manifest 条目。
- [ ] 增加翻译模型 install/verify fake download 测试。
- [ ] 增加 SRT replace/bilingual 行为测试。
- [ ] 增加 partial/all failure 测试。
- [ ] 增加 checkpoint/resume 测试。
- [ ] 增加 JSON purity 测试。
- [ ] 增加 secret redaction 测试。
- [ ] 更新文档。

## Merge Criteria

- 工作在 `codex/fast-sub-translate-cli`。
- 默认测试不下载真实模型或真实媒体。
- `translate` 能生成合法 replace 和 bilingual SRT。
- 本地 NLLB 模型缺失时，提示 `fast-sub models install nllb-200-distilled-600m-ct2-int8`。
- 远程 provider 只能显式 opt-in。
- remote provider 隐私 class 在 provider list/test 和文档中可见。
- 覆盖到的成功和失败路径中，`--json` 输出可解析。
- API key 和敏感请求内容不泄露。
- `translators` GPL-3.0 分发策略已经明确。
- NLLB 语言码映射和 `--from auto` 限制已经测试覆盖。
- checkpoint/resume 行为有测试覆盖。
- 文档清楚区分第 7 轮翻译和第 8 轮 Go migration。
