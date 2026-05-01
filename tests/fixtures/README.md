# Test Fixtures

`tests/fixtures/` 只放可以随仓库分发的小型测试素材和示例 manifest。大型 benchmark 媒体应放在 `.gitignore` 已忽略的 `local_tests/` 下。

## Current Fixtures

| 文件 | 类型 | 用途 | 分发策略 |
| --- | --- | --- | --- |
| `config.toml` | config | 配置读取测试 | 随仓库分发 |
| `sample.wav` | audio | 极小 WAV smoke test | 随仓库分发 |
| `manifest.example.json` | manifest | benchmark/test-assets 字段示例 | 随仓库分发 |

## Small Fixture Strategy

- 优先使用合成素材，避免版权不清。
- 单个媒体 fixture 建议控制在 5-15 秒和很小体积内。
- 每个新增媒体 fixture 必须记录来源、生成方法、许可证和预期用途。
- 小 fixture 只验证流程是否可运行，不用于性能结论。
- 真实语言质量和性能对比使用 `local_tests/` 中的本地大样本。

## Local Benchmark Layout

推荐本地目录：

```text
local_tests/
  media/
  audio/
  references/
  manifests/
  reports/
```

这些文件不应提交仓库。准备大样本时，从 `manifest.example.json` 复制一份到 `local_tests/manifests/`，填写真实来源、许可证、checksum 和 reference 路径。

## Adding A New Redistributable Fixture

1. 确认素材可再分发，或使用脚本/命令重新生成。
2. 控制体积和时长，避免把 benchmark 样本放入仓库。
3. 在本 README 的表格中登记文件。
4. 如果素材用于后续 `bench`，同步在 manifest 示例或测试专用 manifest 中登记字段。

