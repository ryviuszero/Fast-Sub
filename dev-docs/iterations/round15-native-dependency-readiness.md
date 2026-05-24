# Round 15：本机依赖可用性与 FFmpeg 配置体验

## 概要

Round 15 处理公开发布后暴露出的本机依赖体验问题：用户在首次启动或 Provider 页面刷新时看到 FFmpeg、FFprobe、aria2 反复安装，且 Windows 打包版当前只识别应用私有 FFmpeg 目录，不支持使用系统已安装的 FFmpeg，也不支持用户选择已有目录。

本轮目标是把“依赖检测”和“依赖安装”拆开：检测只报告状态，不触发下载；用户真正开始需要 FFmpeg 的任务时，再给出明确的修复入口。aria2 改为 Windows 包内置下载加速器，降低用户理解和安装成本。

## 目标

- Windows packaged app 支持用户选择已有 `ffmpeg` / `ffprobe` 所在目录。
- Windows packaged app 支持识别系统 `PATH` 中同目录的 `ffmpeg.exe` 和 `ffprobe.exe`。
- 保留 app 私有 FFmpeg 下载目录，作为用户明确选择“自动下载”后的安装目标。
- `getEnvironmentStatus()` 只做检测，不自动启动 FFmpeg、FFprobe 或 aria2 下载。
- 首次启动不再因为 FFmpeg / FFprobe 缺失阻止进入主界面。
- 真正启动需要 FFmpeg 的任务时再阻断，并提供“选择已有目录”、“自动下载”、“取消”三个恢复动作。
- Windows 包内置 `aria2c.exe`，用于 FFmpeg 下载加速；下载失败时自动回退普通 HTTPS，不要求用户理解 aria2。
- Provider、设置、诊断页展示清晰的依赖来源、状态、失败原因和下一步动作。
- 保持 renderer 只通过 typed `FastSubClient` 使用本机依赖能力，不直接调用 shell、路径探测或第三方下载器。

## 非目标

- 不把 FFmpeg / FFprobe 直接打进 Windows installer 或 portable zip。
- 不改变模型安装策略；模型仍由用户显式安装，不随包分发。
- 不重写媒体处理 pipeline，也不引入 CGo FFmpeg binding。
- 不把系统包管理器作为普通用户主路径；`scoop`、`winget`、`choco`、`brew` 最多保留为诊断/高级 fallback。
- 不让 renderer 接触 raw command、完整下载 URL、Authorization、daemon token、secret 或 provider response。
- 不要求用户安装 Python、Node、Go、aria2 或包管理器。
- 不在默认测试中访问真实网络、真实 FFmpeg、真实模型或 GPU。
- 不在 Round 15 优化“音频文件绕过 FFmpeg”的媒体 pipeline；是否需要 FFmpeg 先按当前实际 pipeline 判断，后续另开轮次优化。
- 不把 proxy、镜像源编辑、下载器高级参数暴露成普通用户设置。

## 当前状态和问题

当前实现中存在以下细节问题，需要在 Round 15 一并修正：

- `desktop/main/client/daemonClient.ts` 的 `getEnvironmentStatus()` 会调用 `ensureFFmpegInstalled()`，环境检查本身可能触发下载。
- `createJob()` 和 FFmpeg 依赖错误重试路径也会调用 `ensureFFmpegInstalled()`，缺依赖时可能直接进入下载，而不是先让用户选择处理方式。
- Windows packaged app 的 `ffmpegCandidateBinDirectories()` 只包含 app 私有目录；系统 `PATH` fallback 只在非打包态启用。
- packaged daemon 启动时固定注入 `FAST_SUB_PACKAGED_RUNTIME_ONLY=1` 和 `FAST_SUB_FFMPEG_BIN_DIR=ffmpegBinDirectory()`，Go 侧因此不会查找系统 PATH。
- 首次启动页把 `ffmpegMissing` 当作进入主界面的 hard blocker，导致用户即使只想先进入设置或诊断也被卡住。
- aria2 当前是运行时下载到 `userData/native-binaries/aria2/bin`，失败后虽然可回退普通下载，但用户仍会看到“正在下载 aria2”，增加理解负担。
- `EnvironmentStatus` 目前只有 `ffmpegReady`、`ffmpegInstalling`、进度和日志，无法表达依赖来源、用户自定义目录、版本、最后失败原因或是否可自动下载。

## 已确认决策

- aria2 改为 Windows 包内置，不再让用户处理 aria2 安装。
- FFmpeg / FFprobe 不随安装包分发，继续作为用户环境或显式下载依赖。
- 第一优先级是让用户使用已有 FFmpeg / FFprobe 目录，避免重复下载和占用空间。
- 自动下载仍保留，但必须是用户明确触发，不能由普通刷新、检测、进入页面、Provider 静态检查触发。
- 缺少 FFmpeg / FFprobe 不阻止进入主界面；只在转写、烧录等需要媒体处理的动作启动前阻断。
- SRT/TXT 翻译不需要 FFmpeg，不应被 FFmpeg 缺失阻断。
- Windows 第一版必须处理；macOS 维持现有系统目录探测和 app 私有下载路径，但 contract 设计应能复用到 macOS。
- aria2 进入 Windows 包前必须先完成 license / notice / source access / redistribution 盘点；未完成时不得发布正式 artifact。
- FFmpeg 自动下载源必须锁定版本、来源、SHA256、license evidence 和解压后目录结构；下载后必须验证 `ffmpeg` / `ffprobe` 版本。

## 分支计划

推荐分支：

```text
codex/round15-native-dependency-readiness
```

本轮建议使用一个主分支推进，避免 Electron main、preload、renderer、Go runtime env、release resource 和文档说明漂移。实现顺序按 15.1 到 15.8 推进；每个主要单元完成后同步更新 `dev-docs/ui-docs/project-tracker.md`。

建议拆分 gate：

- `15.3a aria2 license / release inventory`：先确认 aria2 license 文本、源码获取说明、第三方声明、打包路径和分发义务。
- `15.3b bundled aria2 resource wiring`：只有 15.3a 通过后，才把 `aria2c.exe` 作为 Windows packaged resource 打包。

如果 15.3a 未通过，继续完成 15.1、15.2、15.4、15.5、15.6、15.7 和 15.8；bundled aria2 延后，不阻塞 FFmpeg detect-only、自定义目录和任务前 gate 的主价值。但包含 bundled aria2 的正式 release artifact 必须等 15.3a 通过后才能发布。

合并到 `master` 前必须满足：

- 环境检测不再触发 FFmpeg / FFprobe / aria2 下载。
- Windows packaged app 可以使用自定义 FFmpeg / FFprobe 目录。
- Windows packaged app 可以使用同目录的系统 PATH FFmpeg / FFprobe。
- 缺 FFmpeg / FFprobe 时首次启动可以进入主界面。
- 需要 FFmpeg 的任务启动前会出现明确恢复动作，不会创建半失败 job。
- 若本轮发布包含 bundled aria2，Windows packaged resources 内必须包含可运行的 bundled aria2，且 license notice 已更新；若 aria2 license gate 未通过，正式 release artifact 不得包含 aria2，并且 FFmpeg 下载必须回退普通 HTTPS。
- FFmpeg 自动下载源、版本、SHA256 和 license evidence 已记录；缺少这些信息时不能发布正式 artifact。
- Packaged smoke 使用干净 userData、受控 PATH，并确认没有命中开发目录或仓库内资源。

## 依赖解析策略

Round 15 使用统一 resolver，按以下顺序解析 FFmpeg / FFprobe：

1. 用户自定义目录。
2. app 私有下载目录：`userData/native-binaries/ffmpeg/bin`。
3. 系统 `PATH` 中同目录的 `ffmpeg` 和 `ffprobe`。
4. macOS 已知系统目录：`/opt/homebrew/bin`、`/usr/local/bin`、`/usr/bin`。
5. 缺失状态。

重要约束：

- 第一版要求 `ffmpeg` 和 `ffprobe` 来自同一目录，因为 packaged daemon 目前通过单个 `FAST_SUB_FFMPEG_BIN_DIR` 传递给 Go。
- 如果 PATH 中能运行 `ffmpeg` 和 `ffprobe`，但二者不在同一目录，状态应标记为不可用并提示用户选择包含二者的目录。
- Windows 系统 PATH 解析必须使用 `where.exe ffmpeg` 和 `where.exe ffprobe` 获取实际候选路径；macOS / Linux 开发态可使用 `command -v` 或等价 lookup。只接受二者 resolved dirname 相同的候选组合，不能只依赖 `ffmpeg -version` / `ffprobe -version` 是否能运行。
- 解析成功后 Electron main 将实际目录注入 daemon env：`FAST_SUB_FFMPEG_BIN_DIR=<resolved-bin-dir>`。
- packaged runtime 仍保留 `FAST_SUB_PACKAGED_RUNTIME_ONLY=1`，但该模式下允许 Electron main 传入经过验证的自定义目录、app 私有目录或 PATH 解析目录。
- Go 侧不直接扫描任意系统 PATH；Go 只信任 Electron main 注入的受控目录，保持 packaged runtime 边界清晰。
- 目录验证不能只检查文件存在。必须执行 `ffmpeg -version` 和 `ffprobe -version`，解析版本并确认二者都可运行。
- 只有 `ffmpeg` 或只有 `ffprobe` 时必须标记为 `missing`，不得进入 ready；用户提示必须明确需要同一目录中同时包含二者。
- 验证失败时不得覆盖已有可用配置；返回结构化错误并保留旧配置。
- 自定义目录和系统 PATH 目录只要求可读；app 私有下载目录还必须可写。
- 系统 PATH 只作为便利来源。Windows Explorer 启动时 PATH 可能不同于 PowerShell，因此 UI 恢复主路径仍是“选择已有目录”。

FFmpeg 自动下载策略：

- 自动下载入口只允许由用户点击“自动下载 FFmpeg”触发。
- 下载目标固定为 app 私有目录：`userData/native-binaries/ffmpeg/bin`。
- 下载 manifest 必须记录平台、架构、FFmpeg 版本、来源 URL、归档 SHA256、license evidence 和解压后相对路径。
- manifest 和 release docs 可以记录完整来源 URL；用户诊断、安装日志、测试快照和公开 smoke 记录不得显示完整 URL。
- 下载完成后必须校验归档 SHA256、解压文件存在、`ffmpeg -version` 和 `ffprobe -version` 可运行。
- 已存在且验证通过的 app 私有 FFmpeg 不重新下载；只有用户显式重试或修复损坏安装时才覆盖。

aria2 解析策略：

1. Windows packaged resources：`resources/bin/win32-x64/aria2/aria2c.exe`。
2. 兼容旧版 userData 目录：`userData/native-binaries/aria2/bin/aria2c.exe`。
3. 开发态系统 `PATH` 中的 `aria2c`。
4. 不可用时回退普通 HTTPS 下载。

aria2 不进入普通用户设置主流程。诊断页可以显示“下载加速器：已内置 / 不可用，自动回退普通下载”。

aria2 使用约束：

- 只作为 FFmpeg 自动下载的受控 CLI 加速器。
- 不开放 aria2 RPC、配置文件编辑、proxy credential、BitTorrent、Metalink 或任意下载 URL 给 renderer。
- aria2 不可用时自动回退普通 HTTPS 下载；aria2 缺失不能导致 FFmpeg 下载功能整体不可用。
- aria2 输出必须经过 redaction 和截断后才能进入日志、诊断或测试快照。

## Contract 调整

`EnvironmentStatus` 需要补充本机依赖状态，建议新增：

```ts
type NativeDependencySource = "custom" | "app-private" | "system-path" | "bundled" | "missing" | "installing" | "failed";

interface NativeDependencyView {
  ready: boolean;
  source: NativeDependencySource;
  binDir?: string;
  displayPath?: string;
  version?: string;
  installing?: boolean;
  progressPercent?: number;
  lastError?: string;
  logs?: string[];
}

interface FFmpegDependencyView {
  ready: boolean;
  source: NativeDependencySource;
  binDir?: string;
  displayPath?: string;
  ffmpegVersion?: string;
  ffprobeVersion?: string;
  installing?: boolean;
  progressPercent?: number;
  lastError?: string;
  logs?: string[];
}
```

FFmpeg / FFprobe 在 UI contract 中作为一个 pair 表达，因为自定义配置、app 私有下载目录和 packaged daemon env 都以同一个 binDir 为边界。`EnvironmentStatus` 中继续保留 `ffmpegReady`、`ffmpegInstalling` 等旧字段用于兼容，但 renderer 新 UI 应优先使用：

```ts
nativeDependencies?: {
  ffmpegPair: FFmpegDependencyView;
  aria2?: NativeDependencyView;
}
```

`FastSubClient` 建议新增：

```ts
checkNativeDependencies(): Promise<EnvironmentStatus>;
installFFmpeg(): Promise<EnvironmentStatus>;
setFFmpegDirectory(binDir: string): Promise<EnvironmentStatus>;
clearFFmpegDirectory(): Promise<EnvironmentStatus>;
verifyFFmpegDirectory(binDir: string): Promise<NativeDependencyView>;
```

约束：

- `checkNativeDependencies()` 和 `getEnvironmentStatus()` 都不得启动下载。
- `installFFmpeg()` 是唯一普通用户自动下载入口。
- `setFFmpegDirectory()` 必须先验证目录中 `ffmpeg` 和 `ffprobe` 均可运行，再持久化。
- `clearFFmpegDirectory()` 只清除自定义目录，不删除 app 私有 FFmpeg。
- 选择目录仍通过已有 `fastSubSystem.selectFolder()` 进入主进程；renderer 不直接访问文件系统。
- 所有返回给 renderer 的错误消息必须脱敏，不能包含 secret、token、signed URL、proxy credential 或 raw command。
- `displayPath` 可以在 UI 中显示给当前用户，但日志、smoke 记录、测试快照和诊断导出必须使用脱敏路径或 basename。
- `logs` 只能包含 redacted 摘要，不能包含完整命令行、完整下载 URL、未脱敏本机路径或完整异常堆栈。

## 持久化策略

FFmpeg 自定义目录由 Electron main 负责持久化，建议使用 app `userData` 下的桌面配置文件，而不是写入 Go daemon 主配置。

原因：

- FFmpeg 目录主要影响 packaged daemon 启动 env，属于 Electron main 管理的本机 runtime 配置。
- 这样不会改变 Go daemon 公开 `/v1/config` contract，也避免 Python CLI / Go CLI 独立用法继承桌面私有路径。
- 后续如果需要 CLI 共享配置，再单独设计 Go config 字段。

配置内容只保存目录路径和更新时间，不保存下载 URL、命令行或探测输出。读取后每次仍需重新验证，避免用户删除目录后继续显示 ready。

配置容错：

- 配置文件不存在时按未配置处理。
- 配置 JSON 损坏时备份为 `.broken` 文件并按未配置处理，不能阻止应用启动。
- 持久化目录失效时不自动删除配置；状态标记为 `failed` 或 `missing`，并提示用户重新选择或清除。
- `clearFFmpegDirectory()` 只删除自定义目录配置，不删除 app 私有 FFmpeg、下载缓存或系统 PATH 中的文件。

## UI 流程

### 首次启动

- FFmpeg / FFprobe 缺失显示为 warning，不阻止“进入应用”。
- 继续阻止本地服务不可用等真正无法进入应用的状态。
- 默认 ASR 模型缺失保持现有非阻塞策略，用户可进入主界面后按提示下载。
- 首次启动页提供两个清晰动作：
  - 选择已有 FFmpeg 目录。
  - 自动下载 FFmpeg。
- 不再展示 Scoop、Winget、Chocolatey、Homebrew 作为普通主按钮。

### 主界面

- 如果 FFmpeg / FFprobe 缺失，主界面顶部显示轻量 warning banner。
- banner 文案说明：“转写和烧录需要 FFmpeg / FFprobe；字幕翻译仍可继续使用。”
- banner 提供“选择目录”、“自动下载”、“打开诊断”三个动作。
- banner 不遮挡拖拽、选择文件、设置入口和任务队列入口。
- “自动下载 FFmpeg”文案必须说明下载位置是应用私有目录，不会修改系统 PATH。
- “系统 PATH”来源文案使用“检测到系统 FFmpeg”，但不要把它作为唯一推荐恢复方式。

### 启动任务前阻断

当用户启动以下任务时，必须先按当前 pipeline 的实际需求确认 FFmpeg / FFprobe 可用：

- `transcribe`
- `burn_in`
- 主流程选择 `burned_video` 输出时的后续烧录步骤

细则：

- 本地 ASR、API ASR 或其他远程 ASR 只要输入需要媒体探测、视频读入、音频提取或格式转换，就必须先通过 FFmpeg gate。
- 不能因为选择 API provider 就绕过 FFmpeg gate；视频输入上传前仍可能需要本地提取音频。
- 如果后续 pipeline 支持某些音频输入完全绕过 FFmpeg，必须先补充 contract 和测试，再放宽 gate。

不需要 FFmpeg 的任务：

- `translate_srt`
- 纯文本翻译
- 模型安装
- Provider API key 配置和连接检查
- Provider 静态检查和 Provider 页面刷新

阻断弹窗要求：

- 标题：需要 FFmpeg / FFprobe。
- 内容：说明当前任务需要它来读取媒体、提取音频或烧录字幕。
- 操作：
  - 选择已有目录。
  - 自动下载。
  - 取消。
- 用户取消时不创建 job。
- 用户选择目录或下载成功后，重新检测并继续原任务。
- 下载失败时保留在弹窗或诊断面板内显示失败原因和重试动作，不进入半失败任务。

### 设置和诊断

设置或诊断页增加“本机依赖”区域：

- FFmpeg / FFprobe 状态。
- 来源：自定义目录、应用私有目录、系统 PATH、缺失、安装中。
- 可复制/可查看的 display path；公开截图和日志仍需脱敏。
- 操作：重新检查、选择目录、清除自定义目录、自动下载。
- aria2 状态：已内置、旧版 userData、系统 PATH、不可用。
- 最近安装日志和最近失败原因。
- 版本：显示 `ffmpeg` 和 `ffprobe` 解析出的版本；版本缺失或无法解析时显示为“未知版本”并保留诊断动作。
- 下载源：只在诊断详情中显示脱敏后的来源名称，不显示完整 URL。

## 实现分解

### 15.1 Contract 和类型

- 扩展 `EnvironmentStatus` 的本机依赖字段。
- 扩展 `FastSubClient`、preload IPC 和 main IPC。
- 保留旧 FFmpeg 字段，避免一次性重写所有 UI。
- 更新 mock client 和 fixture，覆盖 ready、missing、custom、installing、failed 场景。

验收：

- `npm run typecheck` 通过。
- mock-first UI 不因新增字段缺失崩溃。

### 15.2 Native dependency resolver

- 将检测函数和安装函数拆开。
- 新增 detect-only `checkFFmpegAvailable()` 公共入口。
- `getEnvironmentStatus()` 改为只调用检测入口。
- `ensureFFmpegInstalled()` 改名或收窄为用户显式下载入口，避免误用。
- 支持自定义目录、app 私有目录、系统 PATH 同目录解析。
- packaged daemon env 使用已验证目录。
- Provider 静态检查、Provider 页面刷新、设置页打开和诊断页打开都只能调用 detect-only 路径。
- 验证目录时执行并解析 `ffmpeg -version` / `ffprobe -version`；失败时不覆盖旧可用配置。

验收：

- 刷新环境状态不会创建下载任务或写入 staging 目录。
- 缺 FFmpeg 时不会自动下载 aria2 或 FFmpeg。
- 自定义目录删除后会回到缺失或其他可用来源。
- PATH 中 `ffmpeg` / `ffprobe` 不同目录时标记不可用，并提示选择包含二者的目录。
- 只有 `ffmpeg` 或只有 `ffprobe` 时标记为 `missing`，并提示需要同时包含 FFmpeg 和 FFprobe。
- 无效自定义目录不会覆盖已有可用目录。

### 15.3a aria2 license / release inventory

- 确认 aria2 版本、来源、SHA256、license 文本、源码获取方式和第三方 notice。
- 确认 GPL-2.0-or-later 分发义务是否接受。
- 更新 `THIRD_PARTY_NOTICES.md`、license inventory 和 release docs 草案。
- 如果 license / notice 未完成，本轮不得发布包含 bundled aria2 的正式 artifact。

验收：

- aria2 license 记录进入 `THIRD_PARTY_NOTICES.md` 或明确标记为 release blocker。
- Windows release docs 说明 aria2 只作为下载加速器，失败会回退普通 HTTPS。
- 未通过 license gate 时，15.3b 不执行，但 15.1、15.2、15.4、15.5、15.6、15.7 可继续。

### 15.3b Bundled aria2

- 增加 Windows release resource 准备步骤，把固定版本 `aria2c.exe` 放入 `desktop/resources/bin/win32-x64/aria2/`。
- 版本、来源和校验值必须锁定在脚本或 manifest 中。
- packaged resolver 优先使用 bundled aria2。
- 移除普通用户路径上的 aria2 自动下载。
- 保留旧 userData aria2 作为兼容 fallback。
- 不开放 aria2 RPC、配置文件编辑、proxy credential 或任意 URL 下载入口。

验收：

- `win-unpacked/resources/bin/win32-x64/aria2/aria2c.exe --version` 可运行。
- packaged smoke 断言 bundled aria2 存在。
- 缺 aria2 不影响 FFmpeg 普通 HTTPS 下载。
- aria2 stdout/stderr 进入日志前已脱敏和截断。

### 15.3c FFmpeg 下载 manifest 和校验

- 为 FFmpeg 自动下载补充 manifest：平台、架构、版本、来源 URL、SHA256、license evidence、解压后目录结构。
- 下载完成后校验归档 SHA256 和 `ffmpeg` / `ffprobe` 版本。
- 已验证通过的 app 私有 FFmpeg 不重复下载。

验收：

- manifest 信息进入 release docs 或下载脚本注释。
- 篡改 SHA256 时安装失败且不覆盖旧可用安装。
- 下载成功后环境状态显示 `app-private` source 和版本。

### 15.4 FFmpeg 自定义目录

- 使用 `selectFolder()` 选择目录。
- main 进程验证目录中存在并可运行 `ffmpeg` 与 `ffprobe`。
- 验证通过后持久化自定义目录。
- 验证失败时返回结构化错误，不保存。
- 清除自定义目录后重新检测其他来源。
- 验证必须确认同目录、可执行、版本可解析；版本不可解析时允许标记 ready 但必须显示“未知版本”和诊断提示。
- 读取已保存目录时每次重新验证；目录移动或外接盘断开时标记为 `failed` 或 `missing`，不删除配置。

验收：

- 用户选择有效目录后，环境状态显示 `custom` source。
- repair daemon 后 Go 侧 `ffmpeg` / `ffprobe` 能使用该目录。
- 无效目录不会覆盖已有可用配置。
- 配置文件损坏时会备份并恢复到未配置状态，不阻止启动。

### 15.5 UI gate 调整

- 首次启动页移除 FFmpeg hard blocker。
- 主界面增加非阻塞 warning banner。
- `startJob()` 和 `startToolJob()` 在创建 job 前执行 FFmpeg readiness gate。
- gate 成功后继续原始任务，包含远程上传确认、输出冲突处理和批量任务路径。
- `translate_srt` 不走 FFmpeg gate。
- API ASR 的视频输入仍走 FFmpeg gate；不能因为是远程 provider 就跳过本地媒体准备检查。
- gate 触发点必须早于 job 创建；用户取消或修复失败时不得创建 job。

验收：

- 缺 FFmpeg 时用户可以进入主界面。
- 缺 FFmpeg 时启动转写显示恢复弹窗，不创建 job。
- 缺 FFmpeg 时启动烧录显示恢复弹窗，不创建 job。
- 缺 FFmpeg 时启动字幕翻译不显示 FFmpeg 弹窗。
- 缺 FFmpeg 时 API ASR 视频输入也显示恢复弹窗，不创建 job。

### 15.6 诊断和文案

- 设置 / 诊断页增加本机依赖区域。
- 安装失败、网络失败、目录无效、权限失败分别提供可执行建议。
- 中文和英文 i18n 同步。
- 不显示 raw command、完整异常堆栈或未脱敏路径片段。
- 用户可见文案区分“检测到系统 FFmpeg”、“用户选择目录”、“应用私有目录”和“缺失”。
- 自动下载文案明确下载到应用私有目录，不修改系统 PATH。
- 诊断导出、测试快照和公开 smoke 记录使用脱敏路径。

验收：

- 中英文 UI 都有本机依赖文案。
- 失败状态能给出下一步动作。
- 诊断日志不包含 secret、token、Authorization 或 raw command。
- 诊断日志不包含完整下载 URL、完整本机路径或未截断异常堆栈。

### 15.7 测试和 packaged smoke

- TypeScript 单元测试覆盖 resolver 顺序、detect-only 行为、自定义目录、PATH 同目录、PATH 不同目录、安装失败。
- TypeScript 单元测试覆盖只有 `ffmpeg`、只有 `ffprobe`、二者同目录、二者不同目录四种 pair 判断。
- Renderer 测试覆盖首次启动非阻塞、主界面 warning、任务前 gate、翻译不受阻断。
- Go 测试覆盖 `FAST_SUB_PACKAGED_RUNTIME_ONLY=1` 下只使用注入目录。
- packaged smoke 覆盖 bundled aria2、自定义 FFmpeg 目录、app 私有 FFmpeg 目录和缺失场景。
- 默认测试不访问真实网络；真实下载只放入手动 smoke 或 release validation。
- Packaged smoke 必须使用干净 userData 和受控 PATH。
- Packaged smoke 必须验证没有命中开发目录、仓库内 `desktop/resources` staging 目录或系统临时开发依赖。
- Windows smoke 至少覆盖四类来源：custom、app-private、system-path、missing。
- Provider 页面刷新和静态检查 smoke 必须验证不会触发 FFmpeg / FFprobe / aria2 下载。
- `getEnvironmentStatus()` 连续调用两次不得改变 install state、创建 staging 目录、写入 aria2/FFmpeg userData 或触发 daemon repair。

建议验证命令：

```bash
go test ./internal/ffmpeg ./internal/jobs
cd desktop && npm run typecheck
cd desktop && npm test
cd desktop && npm run package:dir
cd desktop && npm run smoke:packaged
cd desktop && npm run smoke:native-deps
```

### 15.8 文档和发布说明

- 更新 `README.md` 的系统需求和首次运行说明。
- 更新 `help-docs/help/first-run-and-models.md` 或对应帮助页，说明 FFmpeg 可用来源和缺失时的处理。
- 更新 `help-docs/help/troubleshooting.md`，加入“FFmpeg / FFprobe 一直安装不成功”。
- 更新 `dev-docs/release/windows.md`，记录 bundled aria2 和 FFmpeg 自定义目录 smoke。
- 更新 `THIRD_PARTY_NOTICES.md`，把 aria2 从 `download-only` 调整为 Windows `bundle-ok` 或 `needs-review` 后再进入 release。
- 更新 `desktop-tests/round15` 或 release validation 记录。
- 更新帮助文案，说明系统 PATH 来源只是便利能力；推荐用户通过“选择已有目录”固定配置。
- 更新 release checklist，加入 FFmpeg 下载 manifest、SHA256、license evidence 和 packaged smoke 自包含验证。

## 风险和处理

- aria2 使用 GPL-2.0-or-later。进入包前必须确认通知、license 文本和分发义务；未完成前不能发布正式 artifact。
- FFmpeg 构建可能包含 LGPL/GPL 组件。自动下载源和 license evidence 未确认前，不能把该下载路径标记为 release-ready。
- Windows Explorer 启动的应用继承 PATH 可能不同于 PowerShell。系统 PATH 支持只能作为便利能力，自定义目录仍是主要恢复路径。
- 用户选择的目录可能位于外接盘或被移动。每次启动必须重新验证，不可只信任持久化路径。
- FFmpeg 和 FFprobe 来自不同目录会增加 Go env contract 复杂度。第一版要求同目录，后续再评估双路径 contract。
- 自动下载仍可能被网络、代理、杀毒软件或公司策略阻断。失败文案必须引导用户选择已有目录，而不是无限重试。
- 如果下载中修复 daemon，可能打断正在运行任务。Round 15 应延续现有 active job 检查，只有无活跃任务时 repair daemon。
- Packaged smoke 如果 PATH 未隔离，可能误用开发机全局 FFmpeg。Round 15 smoke 必须记录实际 resolved source 和 resolved path 类型。

## Definition of Done

- 环境检查、刷新状态、打开设置、Provider 静态检查都不会自动下载 FFmpeg、FFprobe 或 aria2。
- Windows packaged app 在没有 FFmpeg 时可以进入主界面。
- 需要 FFmpeg 的任务在缺依赖时有明确恢复弹窗，且不会创建失败 job。
- 用户可以选择已有 FFmpeg / FFprobe 目录并完成真实转写 smoke。
- 自动下载 FFmpeg 成功后可以完成真实转写 smoke。
- Windows packaged app 使用 bundled aria2 加速下载，且 aria2 license notice 已随包发布。
- 如果 bundled aria2 license gate 未通过，正式 artifact 不包含 aria2，并且 FFmpeg 下载能回退普通 HTTPS。
- FFmpeg 自动下载 manifest 包含版本、来源、SHA256 和 license evidence。
- 自定义目录验证失败不会覆盖旧可用配置。
- Provider 静态检查不会触发 FFmpeg、FFprobe 或 aria2 下载。
- Packaged smoke 在干净 userData 和受控 PATH 下验证 custom、app-private、system-path、missing 四种状态，且不会命中开发目录。
- README、help docs、Windows release docs 和 tracker 均已同步。
- `git diff --check`、TypeScript、Go、renderer 测试和 Windows packaged smoke 通过。
