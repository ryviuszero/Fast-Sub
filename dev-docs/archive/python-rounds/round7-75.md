# Fast Sub 第 7.75 轮：Go 迁移前的 Python 分层重构

## Summary

第 7.75 轮是在第 8 轮 Go migration foundation 之前插入的一轮 Python 分层重构。

这一轮不是要把 Python 重构成长期产品主体。长期方向仍然是：

```text
Go 产品主体 + Python 模型 worker + native binaries
```

本轮目标是在 golden/characterization tests 保护下，把当前已经跑通的 Python CLI 整理成更清晰的层次：

```text
CLI shell + application use cases + pure domain + infrastructure adapters + stable contracts
```

现在真正的风险不是“文件数量多”，而是部分文件已经变成过大的编排中心，尤其是 `src/fast_sub/cli.py`、`src/fast_sub/bench.py`、`src/fast_sub/bench_translate.py` 和 `src/fast_sub/translate.py`。第 7.75 轮允许做较大规模整理，但必须保持公开行为、JSON schema、退出码和报告格式兼容。

推荐实现分支：

```text
codex/fast-sub-python-cleanup
```

## Current State

第 7.75 轮开始前已经完成：

- `fast-sub auto`、裸命令和 `run` 已经统一走本地字幕链路。
- `fast-sub transcribe` 已经接入本地 faster-whisper worker。
- `fast-sub translate` 已经支持 web、API、本地 NLLB/CTranslate2 provider。
- `fast-sub models install/verify/list` 已经支持 ASR 和翻译模型。
- `fast-sub bench` 已经覆盖媒体转写 benchmark。
- `fast-sub bench-translate` 已经覆盖翻译质量和运行时间 benchmark。
- 测试已经覆盖 CLI、provider、model、worker、benchmark、translation 和 release smoke 的主要路径。

当前可维护性风险：

- `cli.py` 同时承担命令注册、参数处理、业务编排和 JSON 输出，文件过大。
- benchmark 和 translation 模块里同时混有命令侧编排与领域逻辑。
- 当前 flat package layout 不利于快速识别哪些模块是未来 Go CLI 必须保持兼容的契约。
- 如果现在做大规模 Python 架构重构，会和后续 Go 接管编排的工作重复。

## Implementation Scope

本轮建议保持一个分支：

```text
codex/fast-sub-python-cleanup
```

原因：

- 主要工作是补行为锁定测试、抽出 CLI shared contract、拆 command shell、沉淀 application use cases、隔离 infrastructure adapters。
- 拆成多个分支会在 `cli.py` 和测试上产生不必要冲突。
- review 时应该把它作为一次“无行为变化的分层重构”整体判断。

允许做：

- 将 `cli.py` 中的 CLI command shell 移到轻量的 `fast_sub.cli.commands` package。
- 抽出 CLI shared contract，例如 JSON 输出、structured errors、redaction、exit code、CLI context。
- 从大 command handler 中抽出 application use cases，例如 translate、bench-translate、models。
- 从业务编排中隔离 infrastructure adapters，例如 ffmpeg、workers、OpenAI-compatible API、web translators、NLLB/CTranslate2、model store。
- 将未来 Go 必须兼容的 schema/report/error/checkpoint 模型收敛到 contracts 边界。
- 在已有测试覆盖或新增 characterization/golden test 的前提下，从大文件中抽出纯 helper。
- 为必须保持不变的命令行为补 characterization tests。
- 更新文档，说明 Go 迁移前 Python 层次如何收敛。

本轮不做：

- 不改变公开命令名、参数、默认值、JSON schema 或退出码。
- 不改变模型安装行为。
- 不改变转写、翻译、benchmark、burn 或 auto 的输出语义。
- 不引入新框架。
- 不开始写 Go 代码。
- 不追求全项目 mypy clean，也不追求完美的最终 Python 架构。

## Goals

- 降低 `cli.py` 的体积和职责。
- 形成清晰的 `cli / application / domain / infrastructure / contracts` 分层。
- 让 command shell 和 application use case 更容易 review，也更容易被后续 Go compatibility tests 对齐。
- 在有行为锁定测试的前提下移动代码。
- 保持 Python 长期定位为 worker / adapter，而不是产品主编排层。
- 将副作用集中到 infrastructure adapters，避免 domain/application 层直接依赖 Typer、Rich、网络、ffmpeg 或模型 runtime。
- 将 provider request/response、worker request/response、structured errors、benchmark report 和 checkpoint schema 收敛为 Go migration 资产。
- 让第 8 轮可以专注 Go foundation，而不是被 Python 可读性问题拖住。

## Non-Goals

- 不把 Python 设计成最终产品编排架构。
- 不重写 benchmark、translation 或 provider 系统。
- 不新增 STT 或 translation provider。
- 不新增 CLI 功能。
- 不删除 Python CLI。
- 不在本轮用 Go 替换 Python。
- 不追求一次性完成所有 provider/worker 深拆。
- 不引入重量级依赖注入框架。
- 不把 clean architecture 模板机械套进项目。

## Workstream 1: 理解现状与 Golden Safety Net

参考大型 Python CLI 的分层重构流程，但只使用收窄版：

```text
0. Understand
1. Golden safety net
2. Extract CLI shared contract
3. Decompose command shell
4. Extract application use cases
5. Isolate infrastructure adapters
5. Verify
```

任务：

- 开始前记录 `git status --short`。
- 不强制整个 workspace 绝对干净；但必须隔离已有文档或用户改动，不回滚用户已有改动。
- 在实现记录里写清楚当前 Python 项目形态。
- 梳理 CLI 入口和现有 `--json` 输出契约。
- 梳理副作用：文件写入、模型下载、worker 进程、ffmpeg/ffprobe 调用、远程 provider 上传、API key。
- 确认现有测试是否已经覆盖高风险 CLI 行为。
- 只在行为没有被锁定时补 characterization tests。

安全网优先级：

- `fast-sub --help`
- `fast-sub models list --json`
- `fast-sub transcribe --help`
- `fast-sub translate --help`
- `fast-sub bench --help`
- `fast-sub bench-translate --help`
- missing model / missing dependency / invalid provider JSON errors。
- translation partial failure 和 all failure 行为。
- translation/API 路径中的 secret redaction。

Golden/characterization tests 需要覆盖：

- `--help` normalized snapshot，去 ANSI、宽度差异和绝对路径。
- `--json` 成功/失败 payload schema 或 golden fixture。
- exit code matrix。
- command order、option names、默认值和 help 文案中的关键片段。
- provider list/test JSON。
- model missing、hash mismatch、inaccessible model cache。
- translate partial/all failure。
- bench 和 bench-translate report schema。
- Windows 路径、中文路径、UNC-like path。

## Workstream 2: Target Layered Architecture

目标结构：

```text
src/fast_sub/
  cli/
    app.py
    commands/
      __init__.py
      auto_cmd.py
      bench_cmd.py
      bench_translate_cmd.py
      burn_cmd.py
      media_cmd.py
      models_cmd.py
      providers_cmd.py
      transcribe_cmd.py
      translate_cmd.py
    context.py
    errors.py
    io.py
    redaction.py

  application/
    transcribe_service.py
    translate_service.py
    bench_service.py
    bench_translate_service.py
    model_service.py
    provider_service.py

  domain/
    subtitles.py
    translation.py
    benchmark.py
    media.py
    model_manifest.py

  infrastructure/
    ffmpeg.py
    openai_stt.py
    openai_chat.py
    translators_web.py
    nllb_ct2.py
    model_store.py
    workers.py

  contracts/
    errors.py
    provider_models.py
    worker_models.py
    report_models.py
    checkpoint_models.py
```

分层职责：

- `cli`: Typer app、命令注册、参数解析、stdout/stderr、JSON purity、exit code、human output、redaction。
- `application`: 用例编排，例如 transcribe、translate、bench、models；输入输出是 typed request/result，不依赖 Typer。
- `domain`: 纯业务规则，例如 SRT parse/render、bilingual/replace、metric normalization、provider failure 判定、manifest validation。
- `infrastructure`: 所有副作用，例如 ffmpeg/ffprobe、HTTP API、web translators、NLLB/CTranslate2、worker process、model cache/download。
- `contracts`: Go migration 和 Python worker 必须保持兼容的 schema、report、error、checkpoint 模型。

Dependency direction rule：

```text
cli -> application -> domain
application -> infrastructure through explicit adapters/protocols
cli/application/infrastructure -> contracts
domain must not import cli or infrastructure
infrastructure must not own CLI output policy
```

迁移规则：

- 不要求一次性创建所有目标文件；按风险逐步落地。
- 第一批必须落地 `cli/io.py`、`cli/errors.py`、`cli/redaction.py`、`cli/context.py` 或等价 shared contract。
- command 文件使用 `*_cmd.py`，避免和 domain modules 同名。
- 如果现有 `cli.py` 仍作为 entrypoint，需要保留 thin compatibility wrapper，导入新的 `cli.app`。
- 旧私有 helper 被移动时，必要时在旧位置保留 thin wrapper 或 re-export，作为 migration shim，不视为新 public API。

## Workstream 3: CLI Command Shell 拆分

`cli` 层保留：

- Typer app 创建和命令注册。
- 共享 stdout/stderr/JSON 策略。
- structured error -> exit code 映射。
- 少量共享格式化 wrapper，如果移动它们会造成过大 churn，可以暂时保留。

command modules 负责：

- 具体 command shell 函数。
- command-specific option handling。
- 将 CLI 参数转换为 application request。
- 调用 application use case。
- 已存在的 command-specific JSON payload assembly。

执行规则：

- 一次只移动一个 command family。
- 公开命令行为必须保持一致。
- 顶层 leaf command 必须保持原命令层级，例如 `fast-sub translate` 不能变成 `fast-sub translate run`。
- 只有 `models`、`providers` 这类已有子命令结构适合使用 sub-Typer。
- `cli.app` 控制注册顺序，避免 help 输出顺序漂移。
- 每移动一个 command family 后运行对应 focused CLI tests。
- 如果某个 command body 耦合太强，先保留在 `cli.py`，并在实现记录里说明原因。
- 如果现有测试或外部 import 依赖函数位置，可以先保留 re-export 或 thin wrapper。

建议移动顺序：

1. 低风险信息类命令：`models`、`providers`、`doctor` 如果存在。
2. 媒体工具命令：`probe`、`extract`、`analyze`、`burn`。
3. benchmark 命令：`bench`、`bench-translate`。
4. 主链路命令：`transcribe`、`translate`、`auto`、裸命令和 `run` 路由。

停止条件：

- 如果移动主链路命令造成大范围 churn 或行为不清晰，就停在低风险命令拆分完成的位置，把剩余部分留给后续整理。

## Workstream 4: Application / Domain / Infrastructure 拆分

目标是将大 command handler 和大领域模块中的编排逻辑逐步收敛到 application use cases。

优先 use cases：

```text
TranslateSrtUseCase.run(request) -> TranslateSrtResult
BenchTranslateUseCase.run(request) -> BenchTranslateReport
InstallModelUseCase.run(request) -> ModelInstallResult
VerifyModelUseCase.run(request) -> ModelVerifyResult
TranscribeMediaUseCase.run(request) -> TranscribeResult
```

拆分规则：

- application use case 不直接 print、不调用 `typer.Exit`、不依赖 Rich console。
- domain module 不访问网络、文件系统、环境变量、ffmpeg、Typer 或 Rich。
- infrastructure adapter 可以访问网络、文件系统、进程、模型 runtime，但不能决定 CLI JSON/human output。
- provider、worker、report、checkpoint schema 放入 contracts 或等价稳定模块。
- 不为未来 Go/native provider 创建复杂抽象基类；只抽当前真实需要的协议/adapter。
- benchmark 内部只有在 report schema 已被测试锁住后再拆。

优先级：

1. translate 和 bench-translate，因为它们刚完成 provider/report/checkpoint 设计，最需要清晰边界。
2. models，因为 install/verify/list 是 Go migration 需要复用的模型资产边界。
3. transcribe/auto 主链路，只有在 golden tests 足够稳定时再拆。
4. provider/worker 深拆作为 stretch goal。

## Workstream 5: Import-Time Side Effects

规则：

- `fast-sub --help` 不应加载模型、不探测 GPU、不访问网络、不初始化 provider runtime。
- `fast-sub providers list --json` 不应加载真实模型或访问远程服务。
- command module import 不应读取 config、创建 job dir、初始化 worker、探测 CUDA、下载模型或发起 HTTP 请求。
- 重依赖延迟到 handler、use case 或 infrastructure adapter 内部加载。
- 如果拆分导致 import cycle，先抽 shared contract，不用业务逻辑绕路解决。

## Workstream 6: 验证

合并前必须运行：

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

必须做的 CLI smoke：

```bash
uv run fast-sub --help
uv run fast-sub models list --json
uv run fast-sub transcribe --help
uv run fast-sub translate --help
uv run fast-sub bench --help
uv run fast-sub bench-translate --help
```

回归规则：

- `--json` stdout 在成功和失败时都必须是可解析 JSON。
- JSON mode 下，人类诊断信息留在 stderr。
- API keys、Authorization headers、raw secrets 不得出现在 stdout、stderr、JSON 或 errors report。
- missing model、missing dependency、inaccessible model cache、invalid provider 不得 traceback。
- benchmark report schema 保持兼容。
- translation 输出保持 cue 顺序、时间轴和 cue 数量行为。

停止条件：

- 移动某 command family 需要修改大量无关测试或改变公开行为时停止。
- 出现循环 import 时停止当前搬迁，先抽 shared contract。
- golden/help/json snapshot 出现非预期 diff 时停止。
- 需要改业务逻辑才能完成文件移动时停止。
- provider/worker 深拆影响模型安装、远程上传、secret redaction 或 JSON purity 时停止。
- 本轮必须优先完成 CLI shared contract 和至少一批 command shell/use case 拆分；provider/worker 深拆可以延后。

## Checklist

- [ ] 实现前记录 `git status --short`，隔离已有用户/文档改动。
- [ ] 记录当前 Python 项目形态。
- [ ] 梳理 CLI command families 和副作用。
- [ ] 确认或补充高风险行为 characterization/golden tests。
- [ ] 抽出 CLI shared contract：IO、errors、redaction、context。
- [ ] 建立目标分层边界：cli、application、domain、infrastructure、contracts。
- [ ] 至少拆出低风险 command shell。
- [ ] 至少为 translate、bench-translate 或 models 中的一类建立 application use case。
- [ ] command 文件避免和 domain module 同名，优先使用 `*_cmd.py`。
- [ ] 只有在 golden tests 足够稳定时才拆主链路 command shell。
- [ ] 控制 import-time side effects。
- [ ] 对移动过的旧 helper 保留必要 compatibility shim。
- [ ] 不触碰 Go migration 实现。
- [ ] 每移动一个 command family 后运行 focused tests。
- [ ] 合并前运行完整验证。
- [ ] 如果没有移动所有 command family 或 provider/worker 深拆，在文档或实现记录里说明停止点。

## Merge Criteria

- 分支没有有意行为变化。
- 公开命令、参数、JSON payload 和退出码保持兼容。
- `cli.py` 或新的 `cli/app.py` 主要负责命令 wiring 和共享 CLI 策略。
- command shell、application use case、domain rule、infrastructure adapter 和 contracts 归属更清晰。
- domain 层没有新增对 Typer/Rich/HTTP/ffmpeg/model runtime 的依赖。
- infrastructure 副作用边界更集中。
- Go migration 需要兼容的 schema/report/error/checkpoint 更容易定位。
- `fast-sub --help` 和 provider list 这类轻量命令没有新增重依赖 import 或副作用。
- golden/characterization tests 锁住关键 CLI、JSON、exit code 和 report 行为。
- 完整测试和 smoke checks 通过，或者明确记录跳过原因。
- 实现记录说明哪些部分在 Go 迁移前不适合继续重构。
