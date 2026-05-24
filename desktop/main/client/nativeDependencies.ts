import { app } from "electron";
import { execFile, spawn } from "node:child_process";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { redactSecretText } from "../../shared/privacy/redaction";
import type { FFmpegDependencyView, FFmpegPackageManager, NativeDependencyView, NativeDependencySource } from "../../shared/contracts/types";
import { daemonTransportLog } from "./transportLog";

const windowsFFmpegURL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const windowsFFmpegSHA256URL = `${windowsFFmpegURL}.sha256`;
const windowsWhisperCPPURL = "https://github.com/ggml-org/whisper.cpp/releases/latest/download/whisper-bin-x64.zip";
const ffmpegStaticReleaseBaseURL = "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1";

export type NativeDependencyStatus = {
  available: boolean;
  installedNow: boolean;
  installing: boolean;
  progressPercent: number;
  binDir?: string;
  source?: NativeDependencySource;
  ffmpegVersion?: string;
  ffprobeVersion?: string;
  message?: string;
  logs: string[];
};

type FFmpegDesktopConfig = {
  ffmpegBinDir?: string;
  updatedAt?: string;
};

type InstallState = {
  installing: boolean;
  installedNow: boolean;
  progressPercent: number;
  logs: string[];
  message?: string;
  installFailed?: boolean;
};

let installTask: Promise<void> | null = null;
let whisperCPPInstallTask: Promise<void> | null = null;
let installState: InstallState = {
  installing: false,
  installedNow: false,
  progressPercent: 0,
  logs: []
};
let whisperCPPInstallState: InstallState = {
  installing: false,
  installedNow: false,
  progressPercent: 0,
  logs: []
};
let lastProgressLogPrefix = "";
let lastWhisperCPPProgressLogPrefix = "";

export function ffmpegBinDirectory(): string {
  return firstExistingFFmpegBinDirectory() ?? privateFFmpegBinDirectory();
}

export async function resolvedFFmpegBinDirectory(): Promise<string | null> {
  const status = await checkFFmpegAvailable();
  return status.available ? status.binDir ?? null : null;
}

export function whisperCPPBinDirectory(): string {
  return join(app.getPath("userData"), "native-binaries", "whisper-cpp", "bin");
}

export function whisperCPPCommandPath(): string | null {
  return firstExistingWhisperCPPExecutable();
}

function aria2ExecutablePath(): string {
  return join(app.getPath("userData"), "native-binaries", "aria2", "bin", "aria2c.exe");
}

function bundledAria2ExecutablePath(): string {
  const target = `${process.platform}-${process.arch}`;
  const base = app.isPackaged ? process.resourcesPath : join(process.cwd(), "resources");
  return join(base, "bin", target, "aria2", process.platform === "win32" ? "aria2c.exe" : "aria2c");
}

function bundledWhisperCPPBinDirectory(): string {
  const target = `${process.platform}-${process.arch}`;
  if (app.isPackaged) {
    return join(process.resourcesPath, "bin", target, "whisper-cpp");
  }
  return join(process.cwd(), "resources", "bin", target, "whisper-cpp");
}

function privateFFmpegBinDirectory(): string {
  return join(app.getPath("userData"), "native-binaries", "ffmpeg", "bin");
}

function ffmpegDesktopConfigPath(): string {
  return join(app.getPath("userData"), "desktop-runtime-config.json");
}

function ffmpegExecutableName(name: "ffmpeg" | "ffprobe"): string {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function whisperCPPExecutableNames(): string[] {
  return process.platform === "win32" ? ["whisper-cli.exe", "main.exe", "whisper-cpp.exe"] : ["whisper-cli", "main", "whisper-cpp"];
}

function firstExistingFFmpegBinDirectory(): string | null {
  return ffmpegCandidateBinDirectories().find((binDir) => {
    return existsSync(join(binDir, ffmpegExecutableName("ffmpeg"))) && existsSync(join(binDir, ffmpegExecutableName("ffprobe")));
  }) ?? null;
}

function firstExistingWhisperCPPExecutable(): string | null {
  for (const binDir of whisperCPPCandidateBinDirectories()) {
    for (const name of whisperCPPExecutableNames()) {
      const candidate = join(binDir, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function ffmpegCandidateBinDirectories(): string[] {
  const dirs = [privateFFmpegBinDirectory()];
  if (process.platform === "darwin" && process.env.FAST_SUB_IGNORE_SYSTEM_FFMPEG !== "1") {
    dirs.push("/opt/homebrew/bin", "/usr/local/bin", "/usr/bin");
  }
  return [...new Set(dirs)];
}

async function readFFmpegDesktopConfig(): Promise<FFmpegDesktopConfig> {
  const configPath = ffmpegDesktopConfigPath();
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as unknown;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      return {
        ffmpegBinDir: typeof record.ffmpegBinDir === "string" ? record.ffmpegBinDir : undefined,
        updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined
      };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    await rename(configPath, `${configPath}.broken`).catch(() => undefined);
  }
  return {};
}

async function writeFFmpegDesktopConfig(config: FFmpegDesktopConfig): Promise<void> {
  const configPath = ffmpegDesktopConfigPath();
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export async function setFFmpegDirectory(binDir: string): Promise<NativeDependencyStatus> {
  const verified = await verifyFFmpegPairDirectory(binDir, "custom");
  if (!verified.ready) {
    return statusFromFFmpegView(verified, false);
  }
  await writeFFmpegDesktopConfig({ ffmpegBinDir: binDir, updatedAt: new Date().toISOString() });
  return statusFromFFmpegView(verified, false);
}

export async function clearFFmpegDirectory(): Promise<NativeDependencyStatus> {
  const config = await readFFmpegDesktopConfig();
  await writeFFmpegDesktopConfig({ ...config, ffmpegBinDir: undefined, updatedAt: new Date().toISOString() });
  return checkFFmpegAvailable();
}

export async function verifyFFmpegDirectory(binDir: string): Promise<NativeDependencyView> {
  const verified = await verifyFFmpegPairDirectory(binDir, "custom");
  return {
    ready: verified.ready,
    source: verified.source,
    binDir: verified.binDir,
    displayPath: verified.displayPath,
    version: verified.ffmpegVersion,
    lastError: verified.lastError
  };
}

function whisperCPPCandidateBinDirectories(): string[] {
  const dirs = [bundledWhisperCPPBinDirectory(), whisperCPPBinDirectory()];
  if (!app.isPackaged && process.platform === "darwin" && process.env.FAST_SUB_IGNORE_SYSTEM_WHISPER_CPP !== "1") {
    dirs.push("/opt/homebrew/bin", "/usr/local/bin");
  }
  return [...new Set(dirs)];
}

export function prependNativeDependencyPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const whisperCPPCommand = whisperCPPCommandPath();
  const binDirs = [ffmpegBinDirectory(), whisperCPPBinDirectory(), ...(whisperCPPCommand ? [dirname(whisperCPPCommand)] : [])];
  const separator = process.platform === "win32" ? ";" : ":";
  const current = env.Path ?? env.PATH ?? "";
  const existing = current.toLowerCase().split(separator);
  const missing = binDirs.filter((binDir) => !existing.includes(binDir.toLowerCase()));
  const next = missing.length === 0 ? current : current ? `${missing.join(separator)}${separator}${current}` : missing.join(separator);
  env.Path = next;
  env.PATH = next;
  return env;
}

export async function installFFmpeg(): Promise<NativeDependencyStatus> {
  const existing = await checkFFmpegAvailable();
  if (installTask) {
    return { ...existing, installedNow: false, installing: true, progressPercent: installState.progressPercent, message: installState.message, logs: installState.logs };
  }
  if (existing.available && existing.source === "app-private") {
    const installedNow = installState.installedNow;
    installState = { ...installState, installing: false, installedNow: false, progressPercent: 100 };
    return { ...existing, installedNow, installing: false, progressPercent: 100, logs: installState.logs };
  }
  if (process.env.FAST_SUB_DISABLE_FFMPEG_AUTO_INSTALL === "1") {
    return { available: false, installedNow: false, installing: false, progressPercent: 0, message: "FFmpeg auto-install is disabled.", logs: installState.logs };
  }
  if (process.platform !== "win32" && process.platform !== "darwin") {
    return {
      available: false,
      installedNow: false,
      installing: false,
      progressPercent: 0,
      message: "Automatic FFmpeg installation is currently implemented for Windows and macOS only.",
      logs: installState.logs
    };
  }
  startInstallTask();
  return { ...existing, installedNow: false, installing: true, progressPercent: installState.progressPercent, message: installState.message, logs: installState.logs };
}

export async function ensureFFmpegInstalled(): Promise<NativeDependencyStatus> {
  return installFFmpeg();
}

export async function installFFmpegWithPackageManager(manager: FFmpegPackageManager): Promise<NativeDependencyStatus> {
  if (!packageManagerAllowedOnPlatform(manager)) {
    return { available: false, installedNow: false, installing: false, progressPercent: 0, message: `${manager} is not available on ${process.platform}.`, logs: installState.logs };
  }
  installState = { installing: true, installedNow: false, progressPercent: 5, logs: [], installFailed: false };
  try {
    const command = packageManagerCommand(manager);
    pushLog(`正在通过 ${manager} 安装 FFmpeg。`, 10);
    await runPackageManager(command.command, command.args);
    pushLog(`${manager} 安装命令已完成，正在验证 FFmpeg。`, 90);
    const status = await checkFFmpegAvailable();
    if (status.available) {
      pushLog("FFmpeg 已安装完成。", 100);
      installState = { ...installState, installFailed: false };
      return { ...status, installedNow: true, installing: false, progressPercent: 100, logs: installState.logs };
    }
    return { ...status, installedNow: false, installing: false, progressPercent: 90, message: `${manager} completed but ffmpeg or ffprobe was not found.`, logs: installState.logs };
  } catch (error) {
    const message = redactSecretText(error instanceof Error ? error.message : String(error));
    pushLog(`${manager} 安装失败：${message}`, installState.progressPercent);
    installState = { ...installState, message, installFailed: true };
    return { available: false, installedNow: false, installing: false, progressPercent: installState.progressPercent, message, logs: installState.logs };
  } finally {
    installState = { ...installState, installing: false };
  }
}

export async function ensureWhisperCPPInstalled(): Promise<NativeDependencyStatus> {
  const existing = await checkWhisperCPPAvailable();
  if (existing.available) {
    const installedNow = whisperCPPInstallState.installedNow;
    whisperCPPInstallState = { ...whisperCPPInstallState, installing: false, installedNow: false, progressPercent: 100 };
    return { ...existing, installedNow, installing: false, progressPercent: 100, logs: whisperCPPInstallState.logs };
  }
  if (whisperCPPInstallTask) {
    return {
      ...existing,
      installedNow: false,
      installing: true,
      progressPercent: whisperCPPInstallState.progressPercent,
      message: whisperCPPInstallState.message,
      logs: whisperCPPInstallState.logs
    };
  }
  if (process.env.FAST_SUB_DISABLE_WHISPER_CPP_AUTO_INSTALL === "1") {
    return { available: false, installedNow: false, installing: false, progressPercent: 0, message: "whisper.cpp auto-install is disabled.", logs: whisperCPPInstallState.logs };
  }
  if (process.platform !== "win32") {
    return {
      available: false,
      installedNow: false,
      installing: false,
      progressPercent: 0,
      message: app.isPackaged
        ? "Packaged whisper.cpp runtime is missing. Reinstall Fast Sub or download a package that includes the native runtime."
        : "Automatic whisper.cpp installation is currently implemented for Windows only. On macOS, run npm run prepare:whisper-cpp-runtime before packaging or install whisper-cpp for development.",
      logs: whisperCPPInstallState.logs
    };
  }
  startWhisperCPPInstallTask();
  return {
    ...existing,
    installedNow: false,
    installing: true,
    progressPercent: whisperCPPInstallState.progressPercent,
    message: whisperCPPInstallState.message,
    logs: whisperCPPInstallState.logs
  };
}

export async function checkFFmpegAvailable(): Promise<NativeDependencyStatus> {
  const view = await resolveFFmpegPair();
  return statusFromFFmpegView(view, false);
}

export async function getNativeDependencyViews(): Promise<{ ffmpegPair: FFmpegDependencyView; aria2: NativeDependencyView }> {
  const [ffmpegPair, aria2] = await Promise.all([resolveFFmpegPair(), resolveAria2View()]);
  return { ffmpegPair, aria2 };
}

async function resolveFFmpegPair(): Promise<FFmpegDependencyView> {
  if (installTask || installState.installing) {
    return {
      ready: false,
      source: "installing",
      displayPath: "app-private",
      installing: true,
      progressPercent: installState.progressPercent,
      lastError: installState.message ?? "FFmpeg installation is in progress.",
      logs: installState.logs
    };
  }
  const config = await readFFmpegDesktopConfig();
  if (config.ffmpegBinDir) {
    const custom = await verifyFFmpegPairDirectory(config.ffmpegBinDir, "custom");
    if (custom.ready) {
      return custom;
    }
    return { ...custom, source: "failed" };
  }
  const appPrivate = await verifyFFmpegPairDirectory(privateFFmpegBinDirectory(), "app-private");
  if (appPrivate.ready) {
    return appPrivate;
  }
  const pathPair = await resolveSystemPathFFmpegPair();
  if (pathPair.ready) {
    return installState.installFailed && installState.message
      ? {
          ...pathPair,
          lastError: `App-private FFmpeg install failed: ${installState.message}`,
          logs: installState.logs
        }
      : pathPair;
  }
  if (pathPair.lastError) {
    return pathPair;
  }
  if (process.platform === "darwin" && process.env.FAST_SUB_IGNORE_SYSTEM_FFMPEG !== "1") {
    for (const binDir of ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]) {
      const known = await verifyFFmpegPairDirectory(binDir, "system-path");
      if (known.ready) {
        return known;
      }
    }
  }
  return {
    ready: false,
    source: "missing",
    displayPath: "FFmpeg / FFprobe",
    lastError: "FFmpeg and FFprobe must be available in the same directory.",
    logs: installState.logs
  };
}

async function resolveSystemPathFFmpegPair(): Promise<FFmpegDependencyView> {
  const [ffmpegPaths, ffprobePaths] = await Promise.all([lookPaths("ffmpeg"), lookPaths("ffprobe")]);
  if (ffmpegPaths.length === 0 && ffprobePaths.length === 0) {
    return { ready: false, source: "missing" };
  }
  if (ffmpegPaths.length === 0 || ffprobePaths.length === 0) {
    return {
      ready: false,
      source: "missing",
      lastError: "PATH must contain both FFmpeg and FFprobe in the same directory.",
      logs: installState.logs
    };
  }
  const ffprobeDirs = new Set(ffprobePaths.map((path) => normalizedDirectoryKey(path)));
  for (const ffmpegPath of ffmpegPaths) {
    const key = normalizedDirectoryKey(ffmpegPath);
    if (!ffprobeDirs.has(key)) {
      continue;
    }
    const verified = await verifyFFmpegPairDirectory(dirname(ffmpegPath), "system-path");
    if (verified.ready) {
      return verified;
    }
  }
  return {
    ready: false,
    source: "missing",
    lastError: "PATH contains FFmpeg and FFprobe in different directories. Choose a directory that contains both files.",
    logs: installState.logs
  };
}

async function verifyFFmpegPairDirectory(binDir: string, source: NativeDependencySource): Promise<FFmpegDependencyView> {
  const ffmpegPath = join(binDir, ffmpegExecutableName("ffmpeg"));
  const ffprobePath = join(binDir, ffmpegExecutableName("ffprobe"));
  const [ffmpeg, ffprobe] = await Promise.all([
    runVersion(ffmpegPath),
    runVersion(ffprobePath)
  ]);
  const ready = ffmpeg.ok && ffprobe.ok;
  const missing = !existsSync(ffmpegPath) || !existsSync(ffprobePath);
  return {
    ready,
    source: ready ? source : missing ? "missing" : "failed",
    binDir,
    displayPath: displayPathFor(binDir),
    ffmpegVersion: ffmpeg.version || "unknown",
    ffprobeVersion: ffprobe.version || "unknown",
    installing: false,
    progressPercent: ready ? 100 : 0,
    lastError: ready ? undefined : missing ? "The selected directory must contain both ffmpeg and ffprobe." : redactSecretText(ffmpeg.error || ffprobe.error || "FFmpeg or FFprobe could not run."),
    logs: installState.logs
  };
}

function statusFromFFmpegView(view: FFmpegDependencyView, installedNow: boolean): NativeDependencyStatus {
  return {
    available: view.ready,
    installedNow,
    installing: Boolean(view.installing),
    progressPercent: view.progressPercent ?? (view.ready ? 100 : 0),
    binDir: view.binDir,
    source: view.source,
    ffmpegVersion: view.ffmpegVersion,
    ffprobeVersion: view.ffprobeVersion,
    message: view.ready ? "FFmpeg is available." : view.lastError ?? "FFmpeg or ffprobe is missing.",
    logs: view.logs ?? installState.logs
  };
}

async function runVersion(command: string): Promise<{ ok: boolean; version: string; error?: string }> {
  return new Promise((resolve) => {
    const child = execFile(command, ["-version"], { env: process.env, windowsHide: true, timeout: 5000 }, (error, stdout, stderr) => {
      resolve({ ok: !error, version: firstLine(stdout), error: error ? redactSecretText(stderr || stdout || error.message) : undefined });
    });
    child.on("error", (error) => resolve({ ok: false, version: "", error: redactSecretText(error.message) }));
  });
}

async function lookPaths(binary: "ffmpeg" | "ffprobe"): Promise<string[]> {
  if (process.env.FAST_SUB_IGNORE_SYSTEM_FFMPEG === "1") {
    return [];
  }
  const target = ffmpegExecutableName(binary).toLowerCase();
  const found: string[] = [];
  const seen = new Set<string>();
  for (const entry of pathEntries()) {
    const key = entry.toLowerCase();
    if (!entry || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const candidate = join(entry, target);
    if (existsSync(candidate)) {
      found.push(candidate);
    }
  }
  return found;
}

function pathEntries(): string[] {
  const values = [process.env.Path, process.env.PATH].filter((value): value is string => typeof value === "string");
  const separator = process.platform === "win32" ? ";" : ":";
  return values.flatMap((value) => value.split(separator).map((entry) => entry.trim()).filter(Boolean));
}

function normalizedDirectoryKey(path: string): string {
  const dir = dirname(path);
  return process.platform === "win32" ? dir.toLowerCase() : dir;
}

async function resolveAria2View(): Promise<NativeDependencyView> {
  const bundled = bundledAria2ExecutablePath();
  if (await canRun(bundled, process.env, ["--version"])) {
    return { ready: true, source: "bundled", binDir: dirname(bundled), displayPath: "bundled aria2", version: "aria2 bundled" };
  }
  const legacy = aria2ExecutablePath();
  if (await canRun(legacy, process.env, ["--version"])) {
    return { ready: true, source: "app-private", binDir: dirname(legacy), displayPath: "legacy app-private aria2", version: "aria2" };
  }
  if (!app.isPackaged && await canRun("aria2c", process.env, ["--version"])) {
    return { ready: true, source: "system-path", displayPath: "system aria2", version: "aria2" };
  }
  return { ready: false, source: "missing", displayPath: "HTTPS fallback", lastError: "aria2 is not available; FFmpeg download will use normal HTTPS." };
}

async function checkWhisperCPPAvailable(): Promise<NativeDependencyStatus> {
  const env = prependNativeDependencyPath({ ...process.env });
  const executable = firstExistingWhisperCPPExecutable();
  const bundled = executable ? await canRun(executable, env, ["--help"]) : false;
  const pathBinary = bundled ? true : !app.isPackaged && await canRun("whisper-cli", env, ["--help"]);
  const binDir = executable ? dirname(executable) : whisperCPPBinDirectory();
  return {
    available: bundled || pathBinary,
    installedNow: false,
    installing: false,
    progressPercent: bundled || pathBinary ? 100 : 0,
    binDir,
    message: bundled || pathBinary ? "whisper.cpp is available." : "whisper.cpp binary is missing.",
    logs: whisperCPPInstallState.logs
  };
}

async function canRun(command: string, env: NodeJS.ProcessEnv, args = ["-version"]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = execFile(command, args, { env, windowsHide: true, timeout: 5000 }, (error) => {
      resolve(!error);
    });
    child.on("error", () => resolve(false));
  });
}

function packageManagerCommand(manager: FFmpegPackageManager): { command: string; args: string[] } {
  switch (manager) {
    case "scoop":
      return { command: "scoop", args: ["install", "ffmpeg"] };
    case "winget":
      return { command: "winget", args: ["install", "--id", "Gyan.FFmpeg", "--exact", "--source", "winget", "--accept-package-agreements", "--accept-source-agreements"] };
    case "choco":
      return { command: "choco", args: ["install", "ffmpeg", "-y"] };
    case "brew":
      return { command: "brew", args: ["install", "ffmpeg"] };
  }
}

function packageManagerAllowedOnPlatform(manager: FFmpegPackageManager): boolean {
  if (process.platform === "win32") {
    return manager === "scoop" || manager === "winget" || manager === "choco";
  }
  if (process.platform === "darwin") {
    return manager === "brew";
  }
  return false;
}

async function runPackageManager(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = execFile(command, args, { windowsHide: true, timeout: 10 * 60 * 1000 }, (error, stdout, stderr) => {
      if (stdout.trim()) {
        pushLog(redactSecretText(lastNonEmptyLine(stdout)), 55);
      }
      if (error) {
        reject(new Error(redactSecretText(stderr || stdout || error.message)));
        return;
      }
      resolve();
    });
    child.on("error", (error) => reject(error));
  });
}

async function installWindowsFFmpeg(): Promise<void> {
  const root = join(app.getPath("userData"), "native-binaries", "ffmpeg");
  const binDir = join(root, "bin");
  const installId = `${process.pid}-${Date.now()}`;
  const tempDir = join(root, `staging-${installId}`);
  const zipPath = join(root, `ffmpeg-release-essentials-${installId}.zip`);
  try {
    await mkdir(root, { recursive: true });
    await rm(tempDir, { recursive: true, force: true });
    await mkdir(tempDir, { recursive: true });
    pushLog("开始准备 FFmpeg / FFprobe。", 5);
    const aria2Path = await ensureAria2Installed();
    daemonTransportLog("native-dependency.download", { dependency: "ffmpeg", source: "gyan.dev" });
    if (aria2Path) {
      try {
        await downloadFileWithAria2(windowsFFmpegURL, zipPath, aria2Path, "FFmpeg", 20, 65);
      } catch (error) {
        const message = redactSecretText(error instanceof Error ? error.message : String(error));
        pushLog(`aria2 下载 FFmpeg 失败，改用普通 HTTPS 下载：${message}`, 20);
        await rm(zipPath, { force: true }).catch(() => undefined);
        await rm(`${zipPath}.aria2`, { force: true }).catch(() => undefined);
        await downloadFile(windowsFFmpegURL, zipPath, "FFmpeg", 20, 65);
      }
    } else {
      await downloadFile(windowsFFmpegURL, zipPath, "FFmpeg", 10, 65);
    }
    const expectedArchiveSHA256 = await fetchExpectedSHA256(windowsFFmpegSHA256URL, "FFmpeg SHA256");
    const archiveSHA256 = await sha256File(zipPath);
    if (archiveSHA256.toLowerCase() !== expectedArchiveSHA256.toLowerCase()) {
      throw new Error("Downloaded FFmpeg archive SHA256 did not match the upstream checksum.");
    }
    pushLog("FFmpeg 下载完成，正在解压。", 68);
    daemonTransportLog("native-dependency.extract", { dependency: "ffmpeg" });
    const extractedBin = await expandFFmpegArchive(zipPath, tempDir);
    pushLog("解压完成，正在发布本地 FFmpeg。", 88);
    await rm(binDir, { recursive: true, force: true });
    await mkdir(binDir, { recursive: true });
    await cp(extractedBin, binDir, { recursive: true, force: true });
    const verified = await verifyFFmpegPairDirectory(binDir, "app-private");
    if (!verified.ready) {
      throw new Error(verified.lastError ?? "Downloaded FFmpeg or FFprobe could not run.");
    }
    await writeFile(join(root, "source.txt"), `${windowsFFmpegURL}\n`, "utf8");
    await writeFFmpegDownloadManifest(root, {
      platform: "win32",
      arch: process.arch,
      version: verified.ffmpegVersion ?? "unknown",
      sourceURL: windowsFFmpegURL,
      checksumURL: windowsFFmpegSHA256URL,
      archiveSHA256,
      licenseEvidence: "https://www.gyan.dev/ffmpeg/builds/ links release archives with .sha256 and FFmpeg license notices; formal release must retain current evidence.",
      extractedBinRelativePath: "bin"
    });
    pushLog("FFmpeg 已安装完成。", 100);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    await rm(zipPath, { force: true }).catch(() => undefined);
    await rm(`${zipPath}.aria2`, { force: true }).catch(() => undefined);
  }
}

function startInstallTask(): void {
  installState = { installing: true, installedNow: false, progressPercent: 1, logs: [], installFailed: false };
  lastProgressLogPrefix = "";
  installTask = installPlatformFFmpeg()
    .then(() => {
      installState = { ...installState, installing: false, installedNow: true, progressPercent: 100, message: "FFmpeg installed.", installFailed: false };
    })
    .catch((error) => {
      const message = redactSecretText(error instanceof Error ? error.message : String(error));
      pushLog(`FFmpeg 安装失败：${message}`, installState.progressPercent);
      installState = { ...installState, installing: false, installedNow: false, message, installFailed: true };
    })
    .finally(() => {
      installTask = null;
    });
}

async function installPlatformFFmpeg(): Promise<void> {
  if (process.platform === "darwin") {
    await installMacOSFFmpeg();
    return;
  }
  await installWindowsFFmpeg();
}

async function installMacOSFFmpeg(): Promise<void> {
  const root = join(app.getPath("userData"), "native-binaries", "ffmpeg");
  const binDir = join(root, "bin");
  const installId = `${process.pid}-${Date.now()}`;
  const staging = join(root, `staging-${installId}`);
  await mkdir(staging, { recursive: true });
  await mkdir(root, { recursive: true });
  pushLog("开始准备 macOS FFmpeg / FFprobe。", 5);
  const aria2Path = await ensureAria2Installed();
  const urls = macOSFFmpegURLs();
  daemonTransportLog("native-dependency.download", { dependency: "ffmpeg", source: "github.com/eugeneware/ffmpeg-static", platform: process.platform, arch: process.arch });
  const ffmpegArchiveSHA256 = await downloadMacOSGzipBinary(urls.ffmpeg, join(staging, "ffmpeg.gz"), join(staging, "ffmpeg"), "FFmpeg", aria2Path, 10, 45);
  const ffprobeArchiveSHA256 = await downloadMacOSGzipBinary(urls.ffprobe, join(staging, "ffprobe.gz"), join(staging, "ffprobe"), "FFprobe", aria2Path, 46, 80);
  await chmod(join(staging, "ffmpeg"), 0o755);
  await chmod(join(staging, "ffprobe"), 0o755);
  const [ffmpegOK, ffprobeOK] = await Promise.all([
    canRun(join(staging, "ffmpeg"), process.env),
    canRun(join(staging, "ffprobe"), process.env)
  ]);
  if (!ffmpegOK || !ffprobeOK) {
    throw new Error("Downloaded macOS FFmpeg or FFprobe could not run.");
  }
  await rm(binDir, { recursive: true, force: true });
  await mkdir(binDir, { recursive: true });
  await cp(join(staging, "ffmpeg"), join(binDir, "ffmpeg"), { force: true });
  await cp(join(staging, "ffprobe"), join(binDir, "ffprobe"), { force: true });
  await writeFile(join(root, "source.txt"), `${urls.ffmpeg}\n${urls.ffprobe}\n`, "utf8");
  await writeFFmpegDownloadManifest(root, {
    platform: "darwin",
    arch: process.arch,
    version: firstLine((await runVersion(join(binDir, "ffmpeg"))).version),
    sourceURL: ffmpegStaticReleaseBaseURL,
    archiveSHA256: `ffmpeg:${ffmpegArchiveSHA256};ffprobe:${ffprobeArchiveSHA256}`,
    archives: [
      { name: "ffmpeg", sourceURL: urls.ffmpeg, archiveSHA256: ffmpegArchiveSHA256, outputRelativePath: "bin/ffmpeg" },
      { name: "ffprobe", sourceURL: urls.ffprobe, archiveSHA256: ffprobeArchiveSHA256, outputRelativePath: "bin/ffprobe" }
    ],
    licenseEvidence: "https://github.com/eugeneware/ffmpeg-static release notes include FFmpeg 6.1.1 build and license metadata.",
    extractedBinRelativePath: "bin"
  });
  await rm(staging, { recursive: true, force: true });
  pushLog("macOS FFmpeg 已安装完成。", 100);
}

function macOSFFmpegURLs(): { ffmpeg: string; ffprobe: string } {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return {
    ffmpeg: `${ffmpegStaticReleaseBaseURL}/ffmpeg-darwin-${arch}.gz`,
    ffprobe: `${ffmpegStaticReleaseBaseURL}/ffprobe-darwin-${arch}.gz`
  };
}

async function downloadMacOSGzipBinary(url: string, gzipPath: string, outputPath: string, label: string, aria2Path: string | null, progressStart: number, progressEnd: number): Promise<string> {
  if (aria2Path) {
    await downloadFileWithAria2(url, gzipPath, aria2Path, label, progressStart, progressEnd);
  } else {
    await downloadFile(url, gzipPath, label, progressStart, progressEnd);
  }
  const archiveSHA256 = await sha256File(gzipPath);
  await pipeline(createReadStream(gzipPath), createGunzip(), createWriteStream(outputPath));
  await rm(gzipPath, { force: true });
  return archiveSHA256;
}

function startWhisperCPPInstallTask(): void {
  whisperCPPInstallState = { installing: true, installedNow: false, progressPercent: 1, logs: [] };
  lastWhisperCPPProgressLogPrefix = "";
  whisperCPPInstallTask = installPlatformWhisperCPP()
    .then(() => {
      whisperCPPInstallState = { ...whisperCPPInstallState, installing: false, installedNow: true, progressPercent: 100, message: "whisper.cpp installed." };
    })
    .catch((error) => {
      const message = redactSecretText(error instanceof Error ? error.message : String(error));
      pushWhisperCPPLog(`whisper.cpp 安装失败：${message}`, whisperCPPInstallState.progressPercent);
      whisperCPPInstallState = { ...whisperCPPInstallState, installing: false, installedNow: false, message };
    })
    .finally(() => {
      whisperCPPInstallTask = null;
    });
}

async function installPlatformWhisperCPP(): Promise<void> {
  await installWindowsWhisperCPP();
}

async function installWindowsWhisperCPP(): Promise<void> {
  const root = join(app.getPath("userData"), "native-binaries", "whisper-cpp");
  const binDir = join(root, "bin");
  const installId = `${process.pid}-${Date.now()}`;
  const tempDir = join(root, `staging-${installId}`);
  const zipPath = join(root, `whisper-bin-x64-${installId}.zip`);
  await mkdir(root, { recursive: true });
  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });
  pushWhisperCPPLog("开始准备 whisper.cpp。", 5);
  daemonTransportLog("native-dependency.download", { dependency: "whisper-cpp", source: "github.com/ggml-org/whisper.cpp" });
  try {
    await downloadFile(windowsWhisperCPPURL, zipPath, "whisper.cpp", 10, 70, pushWhisperCPPLog);
  } catch (error) {
    pushWhisperCPPLog(`Node 下载 whisper.cpp 失败，改用 PowerShell 下载：${redactSecretText(error instanceof Error ? error.message : String(error))}`, 12);
    await downloadFileWithPowerShell(windowsWhisperCPPURL, zipPath, "whisper.cpp", 10, 70, pushWhisperCPPLog);
  }
  pushWhisperCPPLog("whisper.cpp 下载完成，正在解压。", 72);
  daemonTransportLog("native-dependency.extract", { dependency: "whisper-cpp" });
  await expandZip(zipPath, tempDir);
  const extractedBin = await findWhisperCPPBin(tempDir);
  if (!extractedBin) {
    throw new Error("Downloaded whisper.cpp archive did not contain whisper-cli.exe.");
  }
  await rm(binDir, { recursive: true, force: true });
  await mkdir(binDir, { recursive: true });
  await cp(extractedBin, binDir, { recursive: true, force: true });
  await writeFile(join(root, "source.txt"), `${windowsWhisperCPPURL}\n`, "utf8");
  await rm(tempDir, { recursive: true, force: true });
  await rm(zipPath, { force: true });
  pushWhisperCPPLog("whisper.cpp 已安装完成。", 100);
}

async function ensureAria2Installed(): Promise<string | null> {
  if (process.env.FAST_SUB_DISABLE_ARIA2_AUTO_INSTALL === "1") {
    pushLog("aria2 自动准备已禁用，改用普通 HTTPS 下载。", 8);
    return null;
  }
  const bundled = bundledAria2ExecutablePath();
  if (await canRun(bundled, process.env, ["--version"])) {
    pushLog("已启用内置 aria2 加速下载。", 8);
    return bundled;
  }
  const legacy = aria2ExecutablePath();
  if (await canRun(legacy, process.env, ["--version"])) {
    pushLog("已启用旧版应用私有 aria2 加速下载。", 8);
    return legacy;
  }
  if (app.isPackaged) {
    pushLog("未检测到内置 aria2，改用普通 HTTPS 下载。", 8);
    return null;
  }
  if (await canRun(bundled, process.env)) {
    pushLog("已启用 aria2 加速下载。", 8);
    return bundled;
  }
  if (await canRun("aria2c", process.env, ["--version"])) {
    pushLog("已启用系统 aria2 加速下载。", 8);
    return "aria2c";
  }
  pushLog("未检测到 aria2，改用普通 HTTPS 下载。", 8);
  return null;
}

async function downloadFileWithPowerShell(url: string, target: string, label: string, progressStart: number, progressEnd: number, logProgress = pushLog): Promise<void> {
  const parsed = new URL(url);
  if (!isApprovedDownloadURL(parsed)) {
    throw new Error(`Refusing to download ${label} from an unapproved source.`);
  }
  await rm(target, { force: true }).catch(() => undefined);
  logProgress(`正在通过 PowerShell 下载 ${label}。`, progressStart);
  await new Promise<void>((resolve, reject) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "& { param($uri, $outFile) $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $outFile }",
        url,
        target
      ],
      { windowsHide: true, timeout: 120000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(redactSecretText(stderr || stdout || error.message)));
          return;
        }
        resolve();
      }
    );
  });
  const info = await stat(target);
  logProgress(`${label} 下载完成：${formatBytes(info.size)}`, progressEnd);
}

async function downloadFile(url: string, target: string, label: string, progressStart: number, progressEnd: number, logProgress = pushLog): Promise<void> {
  const parsed = new URL(url);
  if (!isApprovedDownloadURL(parsed)) {
    throw new Error(`Refusing to download ${label} from an unapproved source.`);
  }
  const response = await fetch(parsed);
  if (!response.ok || !response.body) {
    throw new Error(`${label} download failed with HTTP ${response.status}.`);
  }
  const total = Number(response.headers.get("content-length") ?? "0");
  const writer = createWriteStream(target);
  const finished = new Promise<void>((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
  });
  const reader = response.body.getReader();
  let downloaded = 0;
  let lastProgressAt = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      downloaded += chunk.value.byteLength;
      writer.write(chunk.value);
      if (Date.now() - lastProgressAt > 800 || downloaded === total) {
        lastProgressAt = Date.now();
        logProgress(`正在下载 ${label}：${formatBytes(downloaded)}${total > 0 ? ` / ${formatBytes(total)}` : ""}`, downloadProgress(progressStart, progressEnd, downloaded, total));
      }
    }
  } finally {
    writer.end();
  }
  await finished;
  if (total > 0 && downloaded !== total) {
    throw new Error(`${label} download was incomplete (${downloaded}/${total} bytes).`);
  }
}

async function downloadFileWithAria2(url: string, target: string, aria2Path: string, label = "FFmpeg", progressStart = 20, progressEnd = 65): Promise<void> {
  const parsed = new URL(url);
  if (!isApprovedDownloadURL(parsed)) {
    throw new Error(`Refusing to download ${label} from an unapproved source.`);
  }
  const total = await remoteContentLength(url);
  await rm(target, { force: true }).catch(() => undefined);
  await rm(`${target}.aria2`, { force: true }).catch(() => undefined);
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let expectedSizeAt = 0;
    let lastSize = 0;
    let lastChangedAt = Date.now();
    const settle = (fn: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearInterval(timer);
      fn();
    };
    const child = spawn(aria2Path, [
      "--allow-overwrite=true",
      "--auto-file-renaming=false",
      "--continue=true",
      "--max-connection-per-server=16",
      "--min-split-size=1M",
      "--split=16",
      "--summary-interval=0",
      "--console-log-level=warn",
      "--dir",
      target.replace(/[\\/][^\\/]*$/, ""),
      "--out",
      target.split(/[\\/]/).pop() ?? "ffmpeg.zip",
      url
    ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    const timer = setInterval(() => {
      void stat(target).then((info) => {
        if (info.size !== lastSize) {
          lastSize = info.size;
          lastChangedAt = Date.now();
        }
        if (total > 0 && info.size >= total) {
          if (expectedSizeAt === 0) {
            expectedSizeAt = Date.now();
            pushLog(`${label} 下载文件已达到预期大小，等待 aria2 校验收尾。`, progressEnd + 1);
          }
          if (Date.now() - expectedSizeAt > 60000) {
            void killProcessTree(child.pid).then(() => {
              settle(() => reject(new Error(`${label} aria2 reached the expected size but did not finish verification within 60 seconds.`)));
            }).catch((error) => {
              settle(() => reject(error));
            });
          }
          return;
        }
        pushLog(`aria2 正在下载 ${label}：${formatBytes(info.size)}${total > 0 ? ` / ${formatBytes(total)}` : ""}`, downloadProgress(progressStart, progressEnd, info.size, total));
        if (Date.now() - lastChangedAt > 120000) {
          void killProcessTree(child.pid).then(() => {
            settle(() => reject(new Error(`${label} aria2 download stalled for more than 120 seconds.`)));
          }).catch((error) => {
            settle(() => reject(error));
          });
        }
      }).catch(() => undefined);
    }, 1000);
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-2000);
    });
    child.once("error", (error) => {
      settle(() => reject(error));
    });
    child.once("exit", (code) => {
      if (settled) {
        return;
      }
      if (code === 0) {
        void waitForWritableFile(target, 5000)
          .then(() => {
            pushLog("aria2 已完成校验，继续安装。", progressEnd + 2);
            settle(resolve);
          })
          .catch((error) => settle(() => reject(error)));
        return;
      }
      settle(() => reject(new Error(redactSecretText(stderr || `aria2 exited with code ${code}`))));
    });
  });
  const info = await stat(target);
  if (total > 0 && info.size !== total) {
    throw new Error(`${label} aria2 download was incomplete (${info.size}/${total} bytes).`);
  }
}

async function waitForWritableFile(path: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  let latestError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      const handle = await open(path, "r+");
      await handle.close();
      return;
    } catch (error) {
      latestError = error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(redactSecretText(latestError instanceof Error ? latestError.message : "Downloaded file is still locked."));
}

async function remoteContentLength(url: string): Promise<number> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    if (!response.ok) {
      return 0;
    }
    return Number(response.headers.get("content-length") ?? "0");
  } catch {
    return 0;
  }
}

function isApprovedDownloadURL(parsed: URL): boolean {
  return parsed.protocol === "https:" && ["www.gyan.dev", "github.com"].includes(parsed.hostname);
}

async function expandZip(zipPath: string, destination: string): Promise<void> {
  if (process.platform === "win32") {
    try {
      await runBoundedProcess("tar.exe", ["-xf", zipPath, "-C", destination], 5 * 60 * 1000);
      return;
    } catch (error) {
      pushLog(`tar 解压失败，改用 PowerShell 解压：${redactSecretText(error instanceof Error ? error.message : String(error))}`, 72);
    }
  }
  await runBoundedProcess(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "& { param($zipPath, $destination) Expand-Archive -LiteralPath $zipPath -DestinationPath $destination -Force }",
      zipPath,
      destination
    ],
    5 * 60 * 1000
  );
}

async function expandFFmpegArchive(zipPath: string, destination: string): Promise<string> {
  const attempts: string[] = [];
  if (process.platform === "win32") {
    await rm(destination, { recursive: true, force: true });
    await mkdir(destination, { recursive: true });
    try {
      await runBoundedProcess("tar.exe", ["-xf", zipPath, "-C", destination], 5 * 60 * 1000);
      const found = await findFFmpegBin(destination);
      if (found) {
        return found;
      }
      const entries = await summarizeDirectory(destination);
      attempts.push(`tar extracted without FFmpeg pair; entries: ${entries}`);
      pushLog(`tar 解压未找到 FFmpeg pair，改用 PowerShell 兼容解压。条目：${entries}`, 72);
    } catch (error) {
      attempts.push(`tar failed: ${redactSecretText(error instanceof Error ? error.message : String(error))}`);
    }
    await rm(destination, { recursive: true, force: true });
    await mkdir(destination, { recursive: true });
    try {
      await expandZipWithDotNet(zipPath, destination);
      const found = await findFFmpegBin(destination);
      if (found) {
        return found;
      }
      const entries = await summarizeDirectory(destination);
      attempts.push(`PowerShell extracted without FFmpeg pair; entries: ${entries}`);
    } catch (error) {
      attempts.push(`PowerShell failed: ${redactSecretText(error instanceof Error ? error.message : String(error))}`);
    }
    throw new Error(`Downloaded FFmpeg archive did not contain ffmpeg.exe and ffprobe.exe. ${attempts.join(" | ")}`);
  }
  await expandZip(zipPath, destination);
  const found = await findFFmpegBin(destination);
  if (found) {
    return found;
  }
  throw new Error(`Downloaded FFmpeg archive did not contain ffmpeg and ffprobe. Entries: ${await summarizeDirectory(destination)}`);
}

async function expandZipWithDotNet(zipPath: string, destination: string): Promise<void> {
  await runBoundedProcess(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      [
        "& {",
        "param($zipPath, $destination)",
        "Add-Type -AssemblyName System.IO.Compression.FileSystem;",
        "[System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $destination)",
        "}"
      ].join(" "),
      zipPath,
      destination
    ],
    5 * 60 * 1000
  );
}

async function runBoundedProcess(command: string, args: string[], timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let settled = false;
    let stderr = "";
    const finish = (fn: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      void killProcessTree(child.pid)
        .then(() => {
          finish(() => reject(new Error(`${command} timed out after ${Math.round(timeoutMs / 1000)} seconds.`)));
        })
        .catch((error) => {
          finish(() => reject(error));
        });
    }, timeoutMs);
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-2000);
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code) => {
      if (code === 0) {
        finish(resolve);
        return;
      }
      finish(() => reject(new Error(redactSecretText(stderr || `${command} exited with code ${code}`))));
    });
  });
}

async function killProcessTree(pid: number | undefined): Promise<void> {
  if (!pid) {
    return;
  }
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      execFile("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 10000 }, () => resolve());
    });
    return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Process already exited.
  }
}

function pushLog(message: string, progressPercent: number): void {
  const progressPrefix = progressLogPrefix(message);
  const logs = progressPrefix && progressPrefix === lastProgressLogPrefix
    ? [...installState.logs.slice(0, -1), `${new Date().toLocaleTimeString()} ${message}`]
    : [...installState.logs, `${new Date().toLocaleTimeString()} ${message}`];
  if (progressPrefix) {
    lastProgressLogPrefix = progressPrefix;
  } else {
    lastProgressLogPrefix = "";
  }
  installState = {
    ...installState,
    progressPercent: Math.max(installState.progressPercent, Math.min(100, progressPercent)),
    logs: logs.slice(-80)
  };
}

function pushWhisperCPPLog(message: string, progressPercent: number): void {
  const progressPrefix = progressLogPrefix(message);
  const logs = progressPrefix && progressPrefix === lastWhisperCPPProgressLogPrefix
    ? [...whisperCPPInstallState.logs.slice(0, -1), `${new Date().toLocaleTimeString()} ${message}`]
    : [...whisperCPPInstallState.logs, `${new Date().toLocaleTimeString()} ${message}`];
  if (progressPrefix) {
    lastWhisperCPPProgressLogPrefix = progressPrefix;
  } else {
    lastWhisperCPPProgressLogPrefix = "";
  }
  whisperCPPInstallState = {
    ...whisperCPPInstallState,
    progressPercent: Math.max(whisperCPPInstallState.progressPercent, Math.min(100, progressPercent)),
    logs: logs.slice(-80)
  };
}

function progressLogPrefix(message: string): string {
  if (message.startsWith("正在下载 FFmpeg：")) {
    return "download:ffmpeg";
  }
  if (message.startsWith("aria2 正在下载 FFmpeg：") || message.startsWith("aria2 正在下载 FFprobe：")) {
    return "aria2:ffmpeg";
  }
  if (message.startsWith("正在下载 aria2：")) {
    return "download:aria2";
  }
  if (message.startsWith("正在下载 whisper.cpp：")) {
    return "download:whisper-cpp";
  }
  return "";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function lastNonEmptyLine(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) ?? "";
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function fetchExpectedSHA256(url: string, label: string): Promise<string> {
  const parsed = new URL(url);
  if (!isApprovedDownloadURL(parsed)) {
    throw new Error(`Refusing to download ${label} from an unapproved source.`);
  }
  const response = await fetch(parsed);
  if (!response.ok) {
    throw new Error(`${label} download failed with HTTP ${response.status}.`);
  }
  const text = await response.text();
  const match = text.match(/\b[a-fA-F0-9]{64}\b/);
  if (!match) {
    throw new Error(`${label} did not contain a valid SHA256 checksum.`);
  }
  return match[0].toLowerCase();
}

async function writeFFmpegDownloadManifest(root: string, manifest: {
  platform: string;
  arch: string;
  version: string;
  sourceURL: string;
  checksumURL?: string;
  archiveSHA256: string;
  archives?: Array<{
    name: string;
    sourceURL: string;
    archiveSHA256: string;
    outputRelativePath: string;
  }>;
  licenseEvidence: string;
  extractedBinRelativePath: string;
}): Promise<void> {
  await writeFile(join(root, "download-manifest.json"), `${JSON.stringify({
    schema_version: 1,
    dependency: "ffmpeg",
    ...manifest,
    recorded_at: new Date().toISOString()
  }, null, 2)}\n`, "utf8");
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] ?? "";
}

function displayPathFor(value: string): string {
  const name = value.split(/[\\/]/).filter(Boolean).at(-1) ?? value;
  if (value === privateFFmpegBinDirectory()) {
    return "app-private FFmpeg";
  }
  return name || value;
}

function downloadProgress(start: number, end: number, downloaded: number, total: number): number {
  if (total <= 0) {
    return start;
  }
  return start + Math.round((Math.min(downloaded, total) / total) * (end - start));
}

async function findFFmpegBin(root: string): Promise<string | null> {
  const entries = await readdir(root, { withFileTypes: true });
  const hasFFmpeg = entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === "ffmpeg.exe");
  const hasFFprobe = entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === "ffprobe.exe");
  if (hasFFmpeg && hasFFprobe) {
    return root;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const child = join(root, entry.name);
    const info = await stat(child);
    if (!info.isDirectory()) {
      continue;
    }
    const found = await findFFmpegBin(child);
    if (found) {
      return found;
    }
  }
  return null;
}

async function summarizeDirectory(root: string): Promise<string> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  if (entries.length === 0) {
    return "<empty>";
  }
  return entries.slice(0, 12).map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`).join(", ");
}

async function findWhisperCPPBin(root: string): Promise<string | null> {
  const entries = await readdir(root, { withFileTypes: true });
  const names = whisperCPPExecutableNames().map((name) => name.toLowerCase());
  const hasWhisperCLI = entries.some((entry) => entry.isFile() && names.includes(entry.name.toLowerCase()));
  if (hasWhisperCLI) {
    return root;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const child = join(root, entry.name);
    const info = await stat(child);
    if (!info.isDirectory()) {
      continue;
    }
    const found = await findWhisperCPPBin(child);
    if (found) {
      return found;
    }
  }
  return null;
}
