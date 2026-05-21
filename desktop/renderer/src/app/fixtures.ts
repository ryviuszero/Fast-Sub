import type { FastSubClient, MockScenario } from "../../../shared/contracts/types";
import { DaemonFastSubClient } from "../client/DaemonFastSubClient";
import { MockFastSubClient } from "../client/MockFastSubClient";
import type { MediaFile, Screen } from "./types";

export const scenarioOptions: { value: MockScenario; label: string }[] = [
  { value: "setupReady", label: "环境就绪" },
  { value: "missingAsr", label: "缺少 ASR 模型" },
  { value: "nllbInstallFailed", label: "翻译模型失败" },
  { value: "modelInstalling", label: "模型安装中" },
  { value: "modelInstallFailed", label: "模型安装失败" },
  { value: "jobSuccess", label: "任务成功" },
  { value: "jobFailed", label: "任务失败" },
  { value: "jobCanceled", label: "任务取消" },
  { value: "outputConflict", label: "输出冲突" },
  { value: "remoteProviderConfirmRequired", label: "远程确认" },
  { value: "daemonDisconnected", label: "服务中断" }
];

export const debugScreens: { id: Screen; label: string }[] = [
  { id: "setup-check", label: "环境检测" },
  { id: "setup-done", label: "设置完成" },
  { id: "main-empty", label: "空状态" },
  { id: "main-files", label: "已添加文件" },
  { id: "main-advanced", label: "详细设置" },
  { id: "main-missing", label: "模型未准备" },
  { id: "main-conflict", label: "输出冲突" },
  { id: "main-generating", label: "生成中" },
  { id: "main-done", label: "已完成" },
  { id: "queue-list", label: "任务列表" },
  { id: "queue-detail", label: "任务详情" },
  { id: "queue-failed", label: "失败详情" },
  { id: "settings-general", label: "通用设置" },
  { id: "settings-models", label: "模型管理" },
  { id: "settings-providers", label: "Provider" },
  { id: "settings-diagnostics", label: "诊断" },
  { id: "settings-benchmark", label: "Benchmark" },
  { id: "tool-translate", label: "翻译SRT" },
  { id: "tool-burn-in", label: "字幕烧录" }
];

export const seedFiles: MediaFile[] = [
  { path: "C:\\Users\\Example\\Videos\\sample-meeting.mp4", name: "sample-meeting.mp4", size: "1.2 GB", duration: "45:12" },
  { path: "D:\\资料\\视频\\sample-lecture.mov", name: "sample-lecture.mov", size: "680 MB", duration: "32:05" },
  { path: "\\\\NAS\\share\\media\\podcast-episode.wav", name: "podcast-episode.wav", size: "120 MB", duration: "28:40" }
];

const SUPPORTED_MEDIA_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".wav", ".m4a", ".mp3"]);
const SKIPPED_MEDIA_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

export function createClient(scenario: MockScenario): FastSubClient {
  const viteMode = (import.meta as ImportMeta & { env?: { MODE?: string } }).env?.MODE;
  if (window.fastSubClient && viteMode !== "test") {
    return new DaemonFastSubClient(window.fastSubClient);
  }
  return new MockFastSubClient(scenario);
}

export function makeFile(path: string, index = 0): MediaFile {
  const fallback = seedFiles[index % seedFiles.length];
  return {
    path,
    name: path.split(/[\\/]/).pop() ?? fallback.name,
    size: fallback.size,
    duration: fallback.duration
  };
}

export function isSupportedMediaPath(path: string): boolean {
  const name = path.split(/[\\/]/).pop()?.trim().toLowerCase() ?? "";
  if (!name || SKIPPED_MEDIA_NAMES.has(name)) {
    return false;
  }
  const dotIndex = name.lastIndexOf(".");
  return dotIndex > 0 && SUPPORTED_MEDIA_EXTENSIONS.has(name.slice(dotIndex));
}

export function filterSupportedMediaPaths(paths: string[], limit = Number.POSITIVE_INFINITY): string[] {
  const safeLimit = Math.max(0, Math.floor(limit));
  return paths.filter(isSupportedMediaPath).slice(0, safeLimit);
}

export function makeFilesFromList(
  selected: FileList,
  limit = Number.POSITIVE_INFINITY,
  options: { includeSubfolders?: boolean } = {}
): MediaFile[] {
  const includeSubfolders = options.includeSubfolders === true;
  return Array.from(selected)
    .filter((file) => includeSubfolders || isTopLevelFolderFile(file))
    .filter((file) => isSupportedMediaPath(pathForFile(file)))
    .slice(0, Math.max(0, Math.floor(limit)))
    .map((file, index) => makeFile(pathForFile(file), index));
}

function isTopLevelFolderFile(file: File): boolean {
  const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";
  if (!relativePath) {
    return true;
  }
  return relativePath.split("/").filter(Boolean).length <= 2;
}

function pathForFile(file: File): string {
  const bridgePath = window.fastSubSystem?.getPathForFile?.(file);
  if (bridgePath) {
    return bridgePath;
  }
  const legacyPath = (file as File & { path?: string }).path;
  return legacyPath || file.name;
}
