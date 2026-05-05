# Fast Sub 框架与代码风格规范

本文档定义 Fast Sub 后续开发的框架约定和代码风格。它面向日常功能开发、维护和代码审查，是新增、修改、删除代码时默认遵守的项目规范。

## 项目分层

Fast Sub 按“入口层 -> 业务层 -> 适配层 -> 数据结构”的思路组织代码。

- CLI 层：负责命令参数、配置解析、输出格式、退出码。
- Service 层：负责业务流程和 use-case 编排。
- Client/Infrastructure 层：负责外部系统、网络请求、ffmpeg、worker 进程等 I/O。
- Model/Constants/Errors：负责稳定的数据结构、常量和错误边界。

CLI 不直接写核心业务逻辑。业务 service 不直接隐藏网络请求。底层 client/infrastructure 不决定用户输出格式。

## 包职责

`fast_sub/cli/` 是命令行入口。这里可以解析 Typer 参数、读取配置、处理 env/CLI 优先级、调用 service、打印 JSON 或文本输出。

`fast_sub/clients/` 是网络和第三方服务边界。HTTP 请求、下载、Web 翻译、OpenAI-compatible API 调用都放这里。

`fast_sub/infrastructure/` 是本地运行时边界。ffmpeg、ffprobe、worker 子进程等本机工具适配放这里。

`fast_sub/providers/` 是 provider 注册和解析边界。provider 定义、registry、provider resolution 放这里。

`fast_sub/stt/` 是语音转字幕业务。转写 options、results、service、errors、constants 放这里。

`fast_sub/translation/` 是字幕翻译业务。翻译 options、results、language、parsing、service、errors、constants 放这里。

`fast_sub/subtitles/` 是字幕模型和 SRT 处理。字幕段、cue、render、refine 放这里。

`fast_sub/media/` 是媒体分析业务。媒体类型判断、分析结果、分析阈值、分析 service 放这里。

`fast_sub/model_store/` 是模型管理业务。模型 manifest、安装、校验、下载策略、状态模型放这里。

`fast_sub/output/` 是输出文件相关逻辑。默认输出路径、burn subtitles 等放这里。

`fast_sub/pipeline/` 是跨模块流程编排。它可以串联 media、model_store、stt、subtitles、output，但不应该实现这些模块内部细节。

`fast_sub/benchmark/` 是基准测试业务。benchmark options、metrics、reports、execution 放这里。

## 文件组织

每个业务 package 优先使用稳定的文件命名：

- `models.py`：数据结构、dataclass、pydantic model、enum、结果对象。
- `constants.py`：默认值、固定选项、阈值、regex pattern、不可变配置。
- `errors.py`：该 package 拥有的异常类型。
- `service.py`：该 package 的主要业务函数和 use-case。
- `registry.py`：注册表构建和默认 registry。
- `resolution.py`：解析用户选择、配置和运行时状态的 resolver。
- `helpers.py`：小型辅助函数，只在职责很清楚时使用。

避免新增宽泛的 `utils.py`、`common.py`、`manager.py`、`domain.py`。如果文件名无法表达职责，通常说明代码边界还没想清楚。

## 导入风格

导入应体现代码 owner。

推荐：

```python
from fast_sub.translation.models import TranslateOptions
from fast_sub.translation.service import translate_srt
from fast_sub.providers.constants import DEFAULT_STT_PROVIDER
```

避免：

```python
from fast_sub.models import TranslateOptions
from fast_sub.common import DEFAULT_STT_PROVIDER
from fast_sub.utils import translate_srt
```

新代码优先从具体 package 导入，不依赖根级 re-export。只有当前公共 API 明确需要时，才在 `__init__.py` 导出。

## 命名风格

遵守 Python 常规命名：

- package、module、function、variable 使用 `snake_case`。
- class、dataclass、pydantic model 使用 `PascalCase`。
- 常量使用 `UPPER_SNAKE_CASE`。
- 私有 helper 使用 `_leading_underscore`。
- 布尔变量使用能表达判断的名字，例如 `is_available`、`has_errors`、`should_resume`。

命名应表达业务含义，不用泛化词掩盖责任。优先使用 `resolve_stt_provider`、`write_translation_errors`、`build_analysis_result` 这类明确动作名。

## 函数风格

函数应该小而明确。

- 一个函数只负责一个层级的事情。
- Public 函数做流程表达，private helper 做细节。
- 参数过多时优先引入 options/result model。
- 返回值优先使用明确的 dataclass、pydantic model 或 TypedDict。
- 不用裸 `tuple` 表达复杂结果，除非含义非常局部且清晰。

Public service 不应返回结构隐式的复杂 `dict`。只有在局部 JSON payload、CLI 输出边界、第三方响应透传这类简单场景下，才使用普通 `dict`。一旦返回结构会被多个模块依赖，应定义 result model 或 TypedDict。

推荐让 service 主函数读起来像流程：

```python
def translate_srt(input_file: Path, options: TranslateOptions) -> TranslateSrtResult:
    validate_options(options)
    segments = read_srt_segments(input_file)
    result = translate_segments(segments=segments, options=options)
    return write_translated_srt(result, options)
```

细节可以下沉到私有函数，但不要为了拆而拆。拆分后应该让主流程更容易读。

## Class 风格

Class 只在确实需要表达“有状态对象、稳定接口、可替换实现或领域实体”时使用。不要为了显得更正式，把一组无状态函数强行包成 class。

适合使用 class 的场景：

- 需要保存一组配置并反复执行行为，例如 `OpenAIChatClient` 保存 `model`、`api_key`、`base_url`、`timeout`。
- 需要表达稳定的数据结构，例如 options、result、status、manifest entry。
- 需要封装可替换实现，例如不同 client、runner、registry、resolver。
- 需要维护内部状态，并且状态生命周期清晰。
- 需要通过方法暴露一组强相关行为，且这些行为共享同一组字段或不变量。

不适合使用 class 的场景：

- 函数没有共享状态，只是顺序调用几个 helper。
- 只是为了把文件里的函数“分组”。
- 只是为了模拟 namespace。
- 只有一个 public 方法，且构造函数只是把参数原样保存一次使用。
- 需要大量 mutable internal state 才能读懂流程。

优先级规则：

1. 纯计算、无状态转换优先用函数。
2. 输入/输出数据优先用 dataclass 或 pydantic model。
3. 外部服务 client 可以用 class，尤其当它需要保存 base URL、token、timeout 或默认 headers。
4. 复杂流程优先用 service 函数和 options/result model，不要默认做成 service class。

Class 实现约束：

- 构造函数只接收对象真正需要长期持有的依赖或配置。
- 不在 `__init__` 中执行网络请求、文件写入、subprocess 等重 I/O。
- 如果 class 长期持有资源，例如 HTTP client、文件句柄、socket、worker 进程，必须提供明确生命周期：优先实现 context manager，或提供 `close()` 并由调用方负责关闭。
- public 方法应少而明确，避免一个 class 暴露一堆无关动作。
- mutable state 必须有明确生命周期；能用不可变对象时优先 `@dataclass(frozen=True)`。
- 不要通过继承复用业务逻辑，优先组合和小函数。
- 不要把 CLI 输出、Typer exit、Rich console 打印放进业务 class。
- class 内私有方法只服务于该 class 的不变量，不作为跨模块工具函数使用。
- 如果 class 只包含 `@staticmethod`，通常应改回普通函数。
- class 名称应表达领域角色，例如 `ProviderRegistry`、`OpenAIChatClient`、`ModelStatus`。

推荐：

```python
@dataclass(frozen=True)
class OpenAIChatClient:
    """HTTP client for OpenAI-compatible chat completion requests."""

    model: str
    api_key: str
    base_url: str
    timeout: float

    def translate_batch(self, batch: list[Segment]) -> dict[int, str]:
        """Translate one subtitle batch through the configured API."""
        ...
```

避免：

```python
class TranslationService:
    def translate_srt(self, input_file: Path, options: TranslateOptions) -> TranslateSrtResult:
        ...
```

如果 `TranslationService` 不持有依赖、不维护状态、也没有多个可替换实现，那么普通 `translate_srt()` 函数更清晰。

Class 测试应关注 public 方法和对象不变量，不直接测试内部私有方法。若私有方法复杂到必须单独测试，通常说明它应该被提升为 package 内的普通函数。

## 数据结构风格

业务输入和输出优先使用 dataclass 或 pydantic model。

- CLI options 转换成业务 options 后再进入 service。
- service 返回 result 对象，不直接依赖 CLI 输出格式。
- 需要 JSON 输出的 result 提供 `as_dict()`。
- 外部响应先解析成项目内部 model，再传给后续流程。

dataclass 适合轻量内部 options/result。pydantic model 适合需要校验、序列化或跨进程传输的数据。

## 常量风格

常量放在拥有它的 package 中，不为了“全局使用”就放到根目录。

例如：

- STT 默认模型属于 `stt/constants.py` 或 `providers/constants.py`。
- 翻译语言集合属于 `translation/constants.py`。
- 媒体扩展名属于 `media/constants.py`。
- CLI 帮助和展示相关常量属于 `cli/constants.py`。

常量应命名具体，避免 `DEFAULT_VALUE`、`CONFIG` 这类无法表达业务含义的名字。

## 错误处理

错误类型应有清晰边界。

- 通用用户错误继承 `SubGenError`。
- 网络/client 错误放在 `clients/errors.py`。
- 业务错误放在业务 package 的 `errors.py`。
- CLI 捕获业务错误后转换成用户输出和退出码。

不要在底层函数里直接 `typer.Exit` 或打印 CLI 文本。底层应该抛异常，由 CLI 层决定如何展示。

错误消息应：

- 能说明失败原因。
- 尽量包含可执行 hint。
- 不泄露 API key、token、authorization header 等敏感信息。
- 保持面向用户，而不是暴露内部堆栈细节。

## 外部 I/O 风格

外部 I/O 必须有明确边界。

- HTTP 请求放 `clients/`。
- ffmpeg、ffprobe、worker 进程放 `infrastructure/`。
- 文件读写放在拥有该文件语义的 package 中。
- CLI 不直接执行网络请求或 subprocess。

网络 client 应负责：

- 构造请求。
- 设置 timeout。
- 处理 HTTP/request/JSON 解析错误。
- 抛出 client-specific error。

业务 service 应负责：

- 决定何时调用 client。
- 将 client error 转换成业务错误。
- 记录或返回业务层需要的 warning/error 信息。

## CLI 风格

CLI command 函数只做四件事：

1. 接收 Typer 参数。
2. 合并 CLI、env、config。
3. 构造业务 options 并调用 service。
4. 打印结果或错误。

CLI 不实现算法，不写 provider retry loop，不直接处理大型 JSON 结构转换。

JSON 输出应统一通过 helper，保证 UTF-8 友好、缩进一致、敏感信息脱敏一致。

## Docstring 风格

每个 package 的 `__init__.py` 应有模块 docstring，说明该 package 的职责。

`__init__.py` 应保持轻量，只放 package docstring 和当前公共 API 的 re-export。不要在 `__init__.py` 中放业务逻辑、网络请求、文件 I/O、subprocess、配置加载或昂贵初始化。

所有非私有函数都应有一句简洁 docstring，说明“做什么”，不要重复参数类型。

推荐：

```python
def resolve_stt_provider(provider_id: str, model_id: str) -> ProviderResolution:
    """Resolve the STT provider/model pair without invoking workers or downloads."""
```

避免：

```python
def resolve_stt_provider(provider_id: str, model_id: str) -> ProviderResolution:
    """This function takes provider_id and model_id and returns ProviderResolution."""
```

私有函数仅在逻辑不明显、或封装了重要约束时添加 docstring。

## 代码格式

项目使用 Ruff 和 mypy。提交前至少运行：

```bash
uv run ruff format --check src\fast_sub tests
uv run ruff check src\fast_sub tests
uv run mypy src
uv run pytest
```

代码格式默认遵守：

- 使用 `from __future__ import annotations`。
- 使用现代类型语法，例如 `str | None`、`list[str]`。
- 避免无意义注释。
- 避免过深嵌套，优先 guard clause。
- 避免宽泛 `except Exception`，除非正在做边界兜底，并且会转换成明确错误。
- 不使用 mutable default 参数，使用 `field(default_factory=list)` 或 `None` 后初始化。

## 测试风格

测试应覆盖行为，而不是复制实现。

- CLI 测试关注参数、输出、退出码。
- Service 测试关注业务结果和错误路径。
- Client 测试关注请求构造、响应解析、异常转换。
- Model/store/pipeline 测试关注边界条件和回归风险。

调整已有代码结构时，先保证旧行为有测试覆盖，再移动代码。移动后测试应从新的 owner package 入口验证行为。

## 新代码检查清单

新增代码前确认：

1. 这个逻辑属于哪个 package？
2. 它处在 CLI、service、client/infrastructure、model/constants/errors 的哪一层？
3. 是否已有同类命名和组织方式可以沿用？
4. 是否需要新的 options/result model？
5. 是否需要业务错误类型，而不是直接抛 `RuntimeError`？
6. 是否需要 docstring？
7. 是否有测试覆盖正常路径和关键失败路径？

如果一个文件需要命名成 `utils.py` 才放得下，通常应该重新拆分职责。
