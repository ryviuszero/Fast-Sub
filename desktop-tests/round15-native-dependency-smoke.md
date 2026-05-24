# Round 15 Native Dependency Smoke

本文件记录 Round 15 本机依赖 smoke 分层。目标是避免把真实网络、真实 FFmpeg 下载源或本机 PATH 状态混入默认验证，同时保留发布前真实安装检查。

## 默认离线 Smoke

默认命令：

```powershell
cd desktop
npm run package:dir
npm run smoke:native-deps
```

默认 `smoke:native-deps` 场景必须保持离线和 deterministic：

| 场景 | 目标 |
| --- | --- |
| `ffmpeg-missing` | 忽略系统 FFmpeg，验证缺失状态不创建下载 staging、不触发下载。 |
| `ffmpeg-custom` | 使用 fake `ffmpeg` / `ffprobe` pair，验证自定义目录 ready。 |
| `ffmpeg-app-private` | 使用隔离 userData fake app-private pair，验证 app-private ready。 |
| `ffmpeg-system-path` | 使用受控 PATH fake pair，验证系统 PATH 中同目录 pair ready。 |
| `whisper-cpp` | 验证 packaged whisper.cpp runtime 或受控 app-private fallback。 |

默认 smoke 不能访问真实 FFmpeg 下载源，不能因为本机系统 PATH 有 FFmpeg 而跳过待测场景，不能创建 `native-binaries/ffmpeg/staging-*` 或真实下载 artifact。

## 手动真实下载 Smoke

真实 FFmpeg 自动安装只放手动 release validation：

```powershell
cd desktop
npm run package:dir
npm run smoke:native-deps -- ffmpeg-install
```

通过条件：

- 结果 `ok=true`。
- `results.ffmpeg.source` 为 `app-private`，不能是 `system-path`。
- `nativeDependencies.aria2.source` 为 `bundled`，除非本轮明确验证 HTTPS fallback。
- 日志顺序必须是：达到预期大小 -> aria2 完成校验 -> 开始解压 -> 发布本地 FFmpeg -> 安装完成。
- `download-manifest.json` 包含 platform、arch、version、source URL、archive SHA256、license evidence 和 extracted bin layout。

## 回归事故记录

2026-05-25 修复的失败根因：

- gyan.dev `ffmpeg-release-essentials.zip` 包内同时包含 `ffmpeg.exe` 和 `ffprobe.exe`。
- 失败不是 FFmpeg 包缺少 ffprobe，而是 aria2 逻辑把目标文件大小达到 Content-Length 误判为下载完成。
- aria2 可能先预分配完整大小，内容和校验尚未完成；提前结束 aria2 后解压半成品 zip 会表现为 tar / PowerShell 都列不出条目，即 `<empty>`。

固定规则：

- 不能再以文件大小作为 aria2 下载完成条件。
- 必须等待 aria2 进程 `exit code 0`，并完成目标文件可写检查后才进入解压。
- 如果 aria2 在达到预期大小后长时间不退出，视为 aria2 路径失败，转普通 HTTPS fallback，不允许继续解压当前文件。
- 后续建议补离线 fake aria2 单测：fake aria2 先扩展目标文件到 Content-Length，再延迟退出；断言安装逻辑不会在 fake aria2 退出前解压。
