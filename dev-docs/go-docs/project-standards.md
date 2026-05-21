# Fast Sub 项目规范与代码风格

本文档定义 Fast Sub 进入 Go migration 阶段后的项目规范和 code style。它不替代已有 Python/v0 规划文档，而是作为后续 Go foundation、Python worker 边界、跨语言 contract 和代码 review 的统一标准。

长期方向：

```text
Go 产品主体 + Python 模型 worker / AI adapter + native binaries
```

## 全局原则

- 行为优先于结构：重构不能改变公开 CLI、JSON schema、退出码、报告格式或 provider/worker contract，除非有独立迁移计划。
- 本地优先：默认不上传音频、字幕文本、API key 或本地路径；远程 provider 必须显式选择或配置。
- 契约稳定：CLI JSON、worker request/response、provider metadata、benchmark report、checkpoint/error 文件属于跨语言契约。
- 边界清楚：CLI 负责用户输入输出，service 负责业务流程，client/infrastructure 负责副作用，model/constants/errors 负责稳定数据边界。
- 小步提交：功能、重构、格式化、依赖更新尽量分开；大型重构必须有 characterization/golden tests。
- 不做“看起来高级”的抽象：没有至少两个具体使用场景时，不新增 base class、framework、generic manager 或 dependency injection 容器。
- Windows 是优先平台：路径、编码、换行、权限、ffmpeg/worker 子进程行为都要考虑 Windows。

## Python 代码规范

Python 当前定位：

```text
Python = v0 CLI compatibility + model worker / AI adapter
```

Python package owner：

- `fast_sub/cli/`：Typer 命令、JSON/stdout/stderr 策略、结构化错误、redaction、exit code。
- `fast_sub/clients/`：网络请求和第三方服务 client。
- `fast_sub/infrastructure/`：ffmpeg、ffprobe、worker 子进程、本地 runtime adapter。
- `fast_sub/providers/`：provider registry、metadata、availability、resolution。
- `fast_sub/stt/`：转写 options/results、worker orchestration、STT errors/constants。
- `fast_sub/translation/`：翻译 options/results、language mapping、parsing、translation service。
- `fast_sub/subtitles/`：字幕模型、SRT parse/render、refine。
- `fast_sub/media/`：probe/extract/analyze 和媒体规则。
- `fast_sub/model_store/`：模型 manifest、install、verify、download、status。
- `fast_sub/output/`：输出路径和 burn-in 行为。
- `fast_sub/pipeline/`：跨模块 auto/run orchestration。
- `fast_sub/benchmark/`：benchmark options、metrics、reports、execution。
- `fast_sub/contracts/`：跨语言或跨进程稳定契约。

Python 文件组织：

- `models.py`：dataclass、pydantic model、enum、result/status/options。
- `constants.py`：默认值、固定选项、阈值、regex、不可变配置。
- `errors.py`：该 package 拥有的异常类型。
- `service.py`：该 package 的主要 use-case / business flow。
- `registry.py`：注册表构建和默认 registry。
- `resolution.py`：解析用户选择、配置和运行时状态的 resolver。
- `helpers.py`：小型辅助函数，只在职责很清楚时使用。

避免新增宽泛的 `utils.py`、`common.py`、`manager.py`、`domain.py`。如果文件名无法表达职责，通常说明边界还没想清楚。

Python style：

- package、module、function、variable 使用 `snake_case`。
- class、dataclass、pydantic model 使用 `PascalCase`。
- 常量使用 `UPPER_SNAKE_CASE`。
- 私有 helper 使用 `_leading_underscore`。
- 布尔变量用 `is_`、`has_`、`should_` 这类判断式命名。
- 新代码优先从具体 owner package 导入，不依赖根级 re-export。
- 纯计算和无状态转换优先用函数。
- 输入/输出数据优先用 dataclass 或 pydantic model。
- 外部服务 client 可以用 class，尤其当它需要保存 base URL、token、timeout 或默认 headers。
- 不在 `__init__` 中执行网络请求、文件写入、subprocess 或模型加载。
- 不通过继承复用业务逻辑，优先组合和小函数。

Python error / I/O：

- CLI 捕获业务错误后转换成用户输出和退出码。
- 底层函数不直接 `typer.Exit`，不直接打印 CLI 文本。
- HTTP 请求放 `clients/`。
- ffmpeg、ffprobe、worker 进程放 `infrastructure/`。
- 文件读写放在拥有该文件语义的 package 中。
- API key、Authorization、token 不得进入 stdout、stderr、JSON 或 report。

Python checks：

```bash
uv run ruff format --check src\fast_sub tests
uv run ruff check src\fast_sub tests
uv run mypy src
uv run pytest
```

## Go 代码规范

Go 从第 8 轮开始作为并行 CLI foundation 引入。Go 代码规范以标准库风格为主，不引入重量级框架。

当前目录：

```text
cmd/fast-sub-go/
internal/cli/
internal/config/
internal/contracts/
internal/daemon/
internal/downloads/
internal/errors/
internal/events/
internal/jobs/
internal/media/
internal/models/
internal/providers/
internal/runtime/
internal/ffmpeg/
internal/paths/
internal/procutil/
internal/worker/
internal/subtitle/
```

该结构是合法的标准 Go layout。当前不应在 release 或文档整理分支中重排 Go 包。后续如果要降低 `internal/` 平铺带来的导航成本，应单独开重构分支。

后续可选目标结构：

```text
cmd/fast-sub-go/

internal/app/
  cli/
  daemon/

internal/core/
  config/
  contracts/
  errors/
  events/
  jobs/
  media/
  models/
  providers/
  subtitle/

internal/runtime/
  ffmpeg/
  openai/
  whispercpp/
  worker/
  procutil/

internal/platform/
  downloads/
  paths/
```

Go 目录整理规则：

- 单独分支处理，不和功能、发布、文档归档混在一起。
- 先移动低耦合包，再移动 `jobs` / `providers` / `models` 等核心包。
- 只做包路径和 import 迁移，不改公开行为。
- 每个迁移切片后运行 `go test ./...`。
- 同步更新 `dev-docs/go-docs/README.md`、`dev-docs/go-docs/specs/daemon-api.md` 和受影响的 Electron spec 引用。

Go 分层规则：

- `cmd/fast-sub-go` 保持很薄，只负责启动 CLI。
- `internal/cli` 负责命令注册、参数解析、stdout/stderr、JSON mode。
- `internal/errors` 负责 exit code 和结构化错误。
- `internal/ffmpeg` 只负责构造和执行 `ffmpeg` / `ffprobe` 命令，不做业务决策。
- `internal/worker` 负责 worker request/response、进程启动、timeout、stderr tail、schema validation。
- `internal/media`、`internal/subtitle`、`internal/bench` 放对应业务逻辑。
- `internal/testutil` 只给测试使用，生产代码不依赖它。

Go style：

- 使用 `gofmt` / `go test ./...` 作为最低 gate。
- `go vet ./...` 作为建议 gate；Round 8 可先不作为 mandatory gate。
- package 名小写、短、表达职责，不使用 `common`、`utils`、`manager`。
- error 必须带上下文，优先 `fmt.Errorf("probe media: %w", err)`。
- public type / function 必须有 doc comment。
- 不在 `init()` 里做配置读取、文件 I/O、网络请求或进程探测。
- 不使用全局 mutable state 存储运行时配置。
- 命令输出必须遵守 stdout/stderr 策略：JSON mode 下 stdout 只能是 JSON。
- Go CLI command 必须支持 stdout/stderr writer 注入，测试不得依赖真实 `os.Stdout` / `os.Stderr`。
- 每个 command 不应直接随意 `fmt.Println`；统一通过 CLI output/error writer 输出。
- Round 8 不实现复杂 logger；默认只输出必要 warning/error，后续再加 `--verbose` / `--debug`。
- 日志级别扩展时必须遵守：stdout JSON purity、stderr human diagnostics、secret/path redaction。
- Go 不直接运行模型推理；模型推理仍通过 Python/native worker 边界。
- Go 不用 CGo 绑定 ffmpeg；Round 8 使用 `exec.CommandContext` 调外部二进制。
- 涉及 Windows 路径时使用 `filepath`，不要手写路径分隔符。
- 重模型 worker 默认采用 adaptive warm worker 策略，而不是永久常驻。
- warm worker 必须有 idle timeout、health check、shutdown、dirty-state handling 和资源释放策略。
- 本地资源不足时，调度器应优先释放 idle heavy worker，而不是继续保温占用内存/显存。

Go error / JSON contract：

- shell exit code 保持简单，具体原因放 `error.code`。
- 结构化错误字段和 Python v0 保持兼容，或显式版本化。
- 结构化错误至少记录 `ok=false`、`command`、`exit_code`、`error.code`、`error.stage`、`error.message`、`error.action_hint` 和 redaction-safe `details`。
- 如果字段语义可能被 Go/Python 同时消费，必须有 fixture 或 schema 记录。
- stderr 可以有人类可读诊断，stdout 在 `--json` 下必须可被 `json.Unmarshal`。
- API key、Authorization、token、用户本地敏感路径不得进入 JSON、stderr 或 report。

Go tests：

- 不依赖真实 ffmpeg、真实模型、真实网络作为默认测试。
- 用 fake binary / fake worker / golden JSON 做兼容测试。
- fake ffmpeg/ffprobe 必须跨平台；优先使用 Go test helper process 或临时 Go fake binary，不依赖 `.sh` / `.bat` 脚本。
- 必须覆盖 Windows path、JSON purity、exit code、timeout、missing dependency。
- Go 与 Python 的兼容测试可以 normalize JSON formatting，但不能改变字段语义。

Go checks：

```bash
gofmt -w <changed-go-files>
go test ./...
```

建议：

```bash
go vet ./...
```

## 跨语言 Contract 规范

这些内容被视为稳定契约：

- CLI command name、option name、默认值、exit code。
- `--json` 成功和失败输出。
- worker request/response/error JSON。
- worker capabilities / protocol version handshake。
- provider registry/status/privacy metadata。
- model manifest/status/install/verify 语义。
- benchmark report schema。
- translate checkpoint 和 `.errors.json`。
- job status、progress schema 和 resource lock 语义。

修改稳定契约前必须：

1. 在计划文档中说明原因。
2. 标明是否需要版本化。
3. 更新 Python tests。
4. 如果 Go 已经存在，更新 Go compatibility tests。
5. 在 release notes 或迁移文档中说明兼容影响。

## 错误分类

稳定 error code 应优先复用，不要每个模块临时发明新 code：

```text
invalid_input
missing_dependency
missing_worker
missing_model
model_hash_mismatch
ffmpeg_failed
ffprobe_failed
worker_failed
worker_timeout
worker_canceled
worker_protocol_error
provider_failed
rate_limited
canceled
disk_full
permission_denied
report_write_failed
```

错误输出规则：

- 用户取消使用 `canceled` 或 `worker_canceled`，不要混成普通 failure。
- protocol/schema mismatch 使用 `worker_protocol_error`。
- 子进程非零退出需要保留 redacted stderr tail。
- 磁盘和权限错误必须有明确 action hint。
- secret、Authorization、API key、raw subtitle text 和敏感路径不得进入 error details。

## 性能指标

任务 report 或 job metadata 应逐步记录阶段耗时，便于判断 Go 迁移是否真正改善体验：

```text
ffprobe_elapsed_sec
ffmpeg_elapsed_sec
worker_start_elapsed_sec
model_load_elapsed_sec
worker_idle_elapsed_sec
inference_elapsed_sec
translation_elapsed_sec
render_elapsed_sec
total_elapsed_sec
```

可选指标：

```text
peak_memory_mb
peak_vram_mb
rtfx
cues_per_sec
chars_per_sec
```

记录原则：

- 指标缺失时使用 null，不伪造。
- report schema 需要包含 `schema_version`、`producer_version`、`created_at`。
- 旧 report schema 变更时需要保留兼容说明。

## Review Gate

合并判断优先级：

1. 公开行为是否保持兼容。
2. JSON/exit-code/stdout-stderr 是否稳定。
3. 是否引入新的上传、网络、子进程或模型下载副作用。
4. 是否有足够测试锁住高风险行为。
5. 代码是否放在正确 owner package。
6. 命名、类型、错误、docstring/comment 是否符合本规范。
