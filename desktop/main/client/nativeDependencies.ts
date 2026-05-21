import { app } from "electron";
import { execFile, spawn } from "node:child_process";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { chmod, cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { redactSecretText } from "../../shared/privacy/redaction";
import type { FFmpegPackageManager } from "../../shared/contracts/types";
import { daemonTransportLog } from "./transportLog";

const windowsFFmpegURL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const windowsAria2URL = "https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip";
const windowsWhisperCPPURL = "https://github.com/ggml-org/whisper.cpp/releases/latest/download/whisper-bin-x64.zip";
const ffmpegStaticReleaseBaseURL = "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1";

export type NativeDependencyStatus = {
  available: boolean;
  installedNow: boolean;
  installing: boolean;
  progressPercent: number;
  binDir?: string;
  message?: string;
  logs: string[];
};

type InstallState = {
  installing: boolean;
  installedNow: boolean;
  progressPercent: number;
  logs: string[];
  message?: string;
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

export function whisperCPPBinDirectory(): string {
  return join(app.getPath("userData"), "native-binaries", "whisper-cpp", "bin");
}

export function whisperCPPCommandPath(): string | null {
  return firstExistingWhisperCPPExecutable();
}

function aria2ExecutablePath(): string {
  return join(app.getPath("userData"), "native-binaries", "aria2", "bin", "aria2c.exe");
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

export async function ensureFFmpegInstalled(): Promise<NativeDependencyStatus> {
  const existing = await checkFFmpegAvailable();
  if (existing.available) {
    const installedNow = installState.installedNow;
    installState = { ...installState, installing: false, installedNow: false, progressPercent: 100 };
    return { ...existing, installedNow, installing: false, progressPercent: 100, logs: installState.logs };
  }
  if (installTask) {
    return { ...existing, installedNow: false, installing: true, progressPercent: installState.progressPercent, message: installState.message, logs: installState.logs };
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

export async function installFFmpegWithPackageManager(manager: FFmpegPackageManager): Promise<NativeDependencyStatus> {
  if (!packageManagerAllowedOnPlatform(manager)) {
    return { available: false, installedNow: false, installing: false, progressPercent: 0, message: `${manager} is not available on ${process.platform}.`, logs: installState.logs };
  }
  installState = { installing: true, installedNow: false, progressPercent: 5, logs: [] };
  try {
    const command = packageManagerCommand(manager);
    pushLog(`正在通过 ${manager} 安装 FFmpeg。`, 10);
    await runPackageManager(command.command, command.args);
    pushLog(`${manager} 安装命令已完成，正在验证 FFmpeg。`, 90);
    const status = await checkFFmpegAvailable();
    if (status.available) {
      pushLog("FFmpeg 已安装完成。", 100);
      return { ...status, installedNow: true, installing: false, progressPercent: 100, logs: installState.logs };
    }
    return { ...status, installedNow: false, installing: false, progressPercent: 90, message: `${manager} completed but ffmpeg or ffprobe was not found.`, logs: installState.logs };
  } catch (error) {
    const message = redactSecretText(error instanceof Error ? error.message : String(error));
    pushLog(`${manager} 安装失败：${message}`, installState.progressPercent);
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

async function checkFFmpegAvailable(): Promise<NativeDependencyStatus> {
  const env = prependNativeDependencyPath({ ...process.env });
  const checks = await Promise.all(ffmpegCandidateBinDirectories().map(async (binDir) => {
    const [ffmpeg, ffprobe] = await Promise.all([
      canRun(join(binDir, ffmpegExecutableName("ffmpeg")), env),
      canRun(join(binDir, ffmpegExecutableName("ffprobe")), env)
    ]);
    return { binDir, available: ffmpeg && ffprobe };
  }));
  const available = checks.find((check) => check.available);
  const pathFallback = available ? true : !app.isPackaged && await canRun("ffmpeg", env) && await canRun("ffprobe", env);
  const ready = Boolean(available) || pathFallback;
  const binDir = available?.binDir ?? privateFFmpegBinDirectory();
  return {
    available: ready,
    installedNow: false,
    installing: false,
    progressPercent: ready ? 100 : 0,
    binDir,
    message: ready ? "FFmpeg is available." : "FFmpeg or ffprobe is missing.",
    logs: installState.logs
  };
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
  await mkdir(root, { recursive: true });
  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });
  pushLog("开始准备 FFmpeg / FFprobe。", 5);
  const aria2Path = await ensureAria2Installed();
  daemonTransportLog("native-dependency.download", { dependency: "ffmpeg", source: "gyan.dev" });
  if (aria2Path) {
    await downloadFileWithAria2(windowsFFmpegURL, zipPath, aria2Path, "FFmpeg", 20, 65);
  } else {
    await downloadFile(windowsFFmpegURL, zipPath, "FFmpeg", 10, 65);
  }
  pushLog("FFmpeg 下载完成，正在解压。", 68);
  daemonTransportLog("native-dependency.extract", { dependency: "ffmpeg" });
  await expandZip(zipPath, tempDir);
  pushLog("解压完成，正在发布本地 FFmpeg。", 88);
  const extractedBin = await findFFmpegBin(tempDir);
  if (!extractedBin) {
    throw new Error("Downloaded FFmpeg archive did not contain ffmpeg.exe and ffprobe.exe.");
  }
  await rm(binDir, { recursive: true, force: true });
  await mkdir(binDir, { recursive: true });
  await cp(extractedBin, binDir, { recursive: true, force: true });
  await writeFile(join(root, "source.txt"), `${windowsFFmpegURL}\n`, "utf8");
  await rm(tempDir, { recursive: true, force: true });
  await rm(zipPath, { force: true });
  pushLog("FFmpeg 已安装完成。", 100);
}

function startInstallTask(): void {
  installState = { installing: true, installedNow: false, progressPercent: 1, logs: [] };
  lastProgressLogPrefix = "";
  installTask = installPlatformFFmpeg()
    .then(() => {
      installState = { ...installState, installing: false, installedNow: true, progressPercent: 100, message: "FFmpeg installed." };
    })
    .catch((error) => {
      const message = redactSecretText(error instanceof Error ? error.message : String(error));
      pushLog(`FFmpeg 安装失败：${message}`, installState.progressPercent);
      installState = { ...installState, installing: false, installedNow: false, message };
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
  await downloadMacOSGzipBinary(urls.ffmpeg, join(staging, "ffmpeg.gz"), join(staging, "ffmpeg"), "FFmpeg", aria2Path, 10, 45);
  await downloadMacOSGzipBinary(urls.ffprobe, join(staging, "ffprobe.gz"), join(staging, "ffprobe"), "FFprobe", aria2Path, 46, 80);
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

async function downloadMacOSGzipBinary(url: string, gzipPath: string, outputPath: string, label: string, aria2Path: string | null, progressStart: number, progressEnd: number): Promise<void> {
  if (aria2Path) {
    await downloadFileWithAria2(url, gzipPath, aria2Path, label, progressStart, progressEnd);
  } else {
    await downloadFile(url, gzipPath, label, progressStart, progressEnd);
  }
  await pipeline(createReadStream(gzipPath), createGunzip(), createWriteStream(outputPath));
  await rm(gzipPath, { force: true });
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
  const bundled = aria2ExecutablePath();
  if (await canRun(bundled, process.env)) {
    pushLog("已启用 aria2 加速下载。", 8);
    return bundled;
  }
  if (await canRun("aria2c", process.env, ["--version"])) {
    pushLog("已启用系统 aria2 加速下载。", 8);
    return "aria2c";
  }
  if (process.platform !== "win32") {
    pushLog("未检测到系统 aria2，改用普通 HTTPS 下载。", 8);
    return null;
  }
  const ariaRoot = join(app.getPath("userData"), "native-binaries", "aria2");
  const installId = `${process.pid}-${Date.now()}`;
  const zipPath = join(ariaRoot, `aria2-${installId}.zip`);
  const staging = join(ariaRoot, `staging-${installId}`);
  try {
    await mkdir(staging, { recursive: true });
    pushLog("未检测到 aria2，正在下载 aria2 加速器。", 8);
    try {
      await downloadFile(windowsAria2URL, zipPath, "aria2", 8, 18);
    } catch (error) {
      pushLog(`Node 下载 aria2 失败，改用 PowerShell 下载：${redactSecretText(error instanceof Error ? error.message : String(error))}`, 10);
      await downloadFileWithPowerShell(windowsAria2URL, zipPath, "aria2", 8, 18);
    }
    pushLog("aria2 下载完成，正在解压。", 19);
    await expandZip(zipPath, staging);
    const aria2Bin = await findFile(staging, "aria2c.exe");
    if (!aria2Bin) {
      throw new Error("Downloaded aria2 archive did not contain aria2c.exe.");
    }
    const binDir = join(ariaRoot, "bin");
    await rm(binDir, { recursive: true, force: true });
    await mkdir(binDir, { recursive: true });
    await cp(aria2Bin, join(binDir, "aria2c.exe"), { force: true });
    await writeFile(join(ariaRoot, "source.txt"), `${windowsAria2URL}\n`, "utf8");
    pushLog("aria2 已准备好，开始加速下载 FFmpeg。", 20);
    return bundled;
  } catch (error) {
    pushLog(`aria2 准备失败，改用普通下载：${redactSecretText(error instanceof Error ? error.message : String(error))}`, 10);
    return null;
  } finally {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    await rm(zipPath, { force: true }).catch(() => undefined);
  }
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
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let completedAt = 0;
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
        pushLog(`aria2 正在下载 ${label}：${formatBytes(info.size)}${total > 0 ? ` / ${formatBytes(total)}` : ""}`, downloadProgress(progressStart, progressEnd, info.size, total));
        if (info.size !== lastSize) {
          lastSize = info.size;
          lastChangedAt = Date.now();
        }
        if (total > 0 && info.size >= total) {
          if (completedAt === 0) {
            completedAt = Date.now();
            pushLog(`${label} 下载文件已完整，正在等待 aria2 结束。`, progressEnd + 1);
          }
          if (Date.now() - completedAt > 5000) {
            pushLog("aria2 未及时退出，已按完整下载文件继续安装。", progressEnd + 2);
            child.kill();
            settle(resolve);
          }
          return;
        }
        if (Date.now() - lastChangedAt > 120000) {
          child.kill();
          settle(() => reject(new Error(`${label} aria2 download stalled for more than 120 seconds.`)));
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
        settle(resolve);
        return;
      }
      void stat(target).then((info) => {
        if (total > 0 && info.size >= total) {
          settle(resolve);
          return;
        }
        settle(() => reject(new Error(redactSecretText(stderr || `aria2 exited with code ${code}`))));
      }).catch(() => {
        settle(() => reject(new Error(redactSecretText(stderr || `aria2 exited with code ${code}`))));
      });
    });
  });
  const info = await stat(target);
  if (total > 0 && info.size !== total) {
    throw new Error(`${label} aria2 download was incomplete (${info.size}/${total} bytes).`);
  }
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
  await new Promise<void>((resolve, reject) => {
    execFile(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "& { param($zipPath, $destination) Expand-Archive -LiteralPath $zipPath -DestinationPath $destination -Force }",
        zipPath,
        destination
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

function downloadProgress(start: number, end: number, downloaded: number, total: number): number {
  if (total <= 0) {
    return start;
  }
  return start + Math.round((Math.min(downloaded, total) / total) * (end - start));
}

async function findFile(root: string, filename: string): Promise<string | null> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const child = join(root, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === filename.toLowerCase()) {
      return child;
    }
    if (entry.isDirectory()) {
      const found = await findFile(child, filename);
      if (found) {
        return found;
      }
    }
  }
  return null;
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
