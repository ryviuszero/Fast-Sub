# Fast Sub 翻译 Benchmark 手动验证

以下命令都在仓库根目录执行。

## 1. 验证本地 benchmark 数据

```powershell
python scripts\bench_translate_assets.py inspect --json
python scripts\bench_translate_assets.py verify --profile all --json
```

预期结果：

- `ok=true`
- `light` 有 6 个样本，每个方向 source/reference 都是 50 条 cue
- `standard` 有 6 个样本，每个方向 source/reference 都是 300 条 cue

## 2. 本地快速冒烟测试

需要本地翻译依赖和 NLLB 模型：

```powershell
uv sync --extra local-translate
uv run --extra local-translate fast-sub models verify nllb-200-distilled-600m-ct2-int8
```

如果模型不存在，先安装：

```powershell
uv run --extra local-translate fast-sub models install nllb-200-distilled-600m-ct2-int8
```

跑一个 light 样本：


```powershell
uv run fast-sub bench-translate `
  local_tests\bench_translate\datasets\light\en-zh.sample-50.source.srt `
  --reference local_tests\bench_translate\datasets\light\en-zh.sample-50.reference.srt `
  --from en `
  --to zh `
  --provider local-nllb-ct2 `
  --output-dir local_tests\bench_translate\reports\light\en-zh-local-nllb `
  --markdown `
  --json
```

```powershell
uv run fast-sub bench-translate `
  local_tests\bench_translate\datasets\light\en-zh.sample-50.source.srt `
  --reference local_tests\bench_translate\datasets\light\en-zh.sample-50.reference.srt `
  --from en `
  --to zh `
  --provider web-bing `
  --output-dir local_tests\bench_translate\reports\light\en-zh-web-bing `
  --markdown `
  --json
```

```powershell
uv run --extra local-translate fast-sub bench-translate `
  local_tests\bench_translate\datasets\light\en-zh.sample-50.source.srt `
  --reference local_tests\bench_translate\datasets\light\en-zh.sample-50.reference.srt `
  --from en `
  --to zh `
  --provider web-google `
  --output-dir local_tests\bench_translate\reports\light\en-zh-web-google `
  --markdown `
  --json
```

```powershell
uv run --extra local-translate fast-sub bench-translate `
  local_tests\bench_translate\datasets\light\en-zh.sample-50.source.srt `
  --reference local_tests\bench_translate\datasets\light\en-zh.sample-50.reference.srt `
  --from en `
  --to zh `
  --provider api-openai-chat `
  --output-dir local_tests\bench_translate\reports\light\en-zh-api-openai-chat `
  --markdown `
  --json
```



检查 JSON report：

```powershell
Get-Content local_tests\bench_translate\reports\light\en-zh-local-nllb\report.json |
  ConvertFrom-Json |
  Select-Object measurement_scope, provider, source_language, target_language
```

预期重点：

- `measurement_scope=translate_srt_v1`
- `provider=local-nllb-ct2`
- 每次 run 里 `resume_used=false`
- `reference_alignment_status=aligned`
- 默认安装依赖后 `metric_implementation=sacrebleu`；如果当前环境无法 import sacreBLEU，则回退为 `fast_sub_lightweight_v1`
- `provider_privacy_class=local`
- `uploads_text=false`

## 3. TXT reference 冒烟测试

```powershell
uv run --extra local-translate fast-sub bench-translate `
  local_tests\bench_translate\datasets\light\en-zh.sample-50.source.srt `
  --reference local_tests\bench_translate\datasets\light\en-zh.sample-50.reference.txt `
  --from en `
  --to zh `
  --provider local-nllb-ct2 `
  --output-dir local_tests\bench_translate\reports\light\en-zh-local-nllb-txt `
  --json
```

预期重点：

- `reference_type=txt`
- 当前采样脚本生成的 TXT 是一行对应一条 cue，所以 `reference_alignment_status=aligned`
- 会按行计算 `exact_match_rate`
- 翻译成功时会用这些行作为 corpus-level BLEU/chrF 输入
- 如果 TXT 行数和预测 cue 数不一致，则退回 `reference_alignment_status=corpus_only`，`exact_match_rate=null`

## 4. repeat 聚合冒烟测试

```powershell
uv run --extra local-translate fast-sub bench-translate `
  local_tests\bench_translate\datasets\light\ja-en.sample-50.source.srt `
  --reference local_tests\bench_translate\datasets\light\ja-en.sample-50.reference.srt `
  --from ja `
  --to en `
  --provider local-nllb-ct2 `
  --repeat 2 `
  --output-dir local_tests\bench_translate\reports\light\ja-en-local-nllb-repeat2 `
  --json
```

检查 summary 聚合字段：

```powershell
(Get-Content local_tests\bench_translate\reports\light\ja-en-local-nllb-repeat2\report.json |
  ConvertFrom-Json).summary |
  Select-Object runs, ok_runs, elapsed_sec_avg, elapsed_sec_min, elapsed_sec_max, elapsed_sec_stddev, bleu_avg, chrf_avg
```

预期重点：

- `runs=2`
- `elapsed_sec_avg/min/max/stddev` 都存在
- `bleu_avg`、`chrf_avg` 存在，具体数值取决于 provider 输出

## 5. standard 样本示例

light 冒烟通过后再跑 standard，耗时会更长：

```powershell
uv run --extra local-translate fast-sub bench-translate `
  local_tests\bench_translate\datasets\standard\ko-en.sample-300.source.srt `
  --reference local_tests\bench_translate\datasets\standard\ko-en.sample-300.reference.srt `
  --from ko `
  --to en `
  --provider local-nllb-ct2 `
  --output-dir local_tests\bench_translate\reports\standard\ko-en-local-nllb `
  --markdown `
  --json
```


```powershell
uv run --extra local-translate fast-sub bench-translate `
  local_tests\bench_translate\datasets\standard\ko-en.sample-300.source.srt `
  --reference local_tests\bench_translate\datasets\standard\ko-en.sample-300.reference.srt `
  --from ko `
  --to en `
  --provider api-openai-chat `
  --output-dir local_tests\bench_translate\reports\standard\ko-en-api-openai-chat `
  --markdown `
  --json
```

## 6. 显式远程 provider 冒烟测试

只有在你明确接受字幕文本发送到第三方网页翻译服务时才运行：

```powershell
uv run fast-sub bench-translate `
  local_tests\bench_translate\datasets\light\en-zh.sample-50.source.srt `
  --reference local_tests\bench_translate\datasets\light\en-zh.sample-50.reference.srt `
  --from en `
  --to zh `
  --provider web-bing `
  --sleep-seconds 0.5 `
  --output-dir local_tests\bench_translate\reports\light\en-zh-web-bing `
  --markdown
```

预期重点：

- 文本模式会出现 privacy warning
- 如果额外加 `--json`，stdout 仍然应该是可解析 JSON，不被 warning 污染
- report 记录 `provider_privacy_class=remote-web`
- report 记录 `uploads_text=true`

OpenAI-compatible API provider 需要显式模型。可以传 `--model`，也可以在 `.env`
或当前 shell 中设置 `OPENAI_MODEL`：

```powershell
uv run fast-sub bench-translate `
  local_tests\bench_translate\datasets\light\en-zh.sample-50.source.srt `
  --reference local_tests\bench_translate\datasets\light\en-zh.sample-50.reference.srt `
  --from en `
  --to zh `
  --provider api-openai-chat `
  --model qwen3-4b-2507 `
  --output-dir local_tests\bench_translate\reports\light\en-zh-api-openai-chat `
  --markdown `
  --json
```

预期重点：

- 如果没有 `--model` 且没有 `OPENAI_MODEL`，命令会以 exit 2 返回结构化参数错误，不生成 run report
- report 记录 `provider_privacy_class=remote-api`
- report 记录 `uploads_text=true`

也可以用 `--config` 读取 `[translator]` 配置：

```toml
[translator]
provider = "api-openai-chat"
model = "qwen3-4b-2507"
base_url = "http://localhost:1234/v1"
batch_size = 4
timeout = 60
sleep_seconds = 0
```

```powershell
uv run fast-sub bench-translate `
  local_tests\bench_translate\datasets\light\en-zh.sample-50.source.srt `
  --reference local_tests\bench_translate\datasets\light\en-zh.sample-50.reference.srt `
  --from en `
  --to zh `
  --config fast-sub.toml `
  --output-dir local_tests\bench_translate\reports\light\en-zh-api-openai-chat-config `
  --markdown `
  --json
```

## 7. 手动跑全部 light 六方向

```powershell
$samples = @(
  @("en","zh"),
  @("ja","zh"),
  @("ko","zh"),
  @("zh","en"),
  @("ja","en"),
  @("ko","en")
)

foreach ($pair in $samples) {
  $from = $pair[0]
  $to = $pair[1]
  $id = "$from-$to"
  uv run --extra local-translate fast-sub bench-translate `
    "local_tests\bench_translate\datasets\light\$id.sample-50.source.srt" `
    --reference "local_tests\bench_translate\datasets\light\$id.sample-50.reference.srt" `
    --from $from `
    --to $to `
    --provider local-nllb-ct2 `
    --output-dir "local_tests\bench_translate\reports\light\$id-local-nllb" `
    --json
}
```

生成的 report 都在 `local_tests/bench_translate/reports/` 下，只用于本地验证，不要提交。
