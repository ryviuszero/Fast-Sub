import type { FastSubClient, MockScenario } from "../../../shared/contracts/types";
import { DaemonFastSubClient } from "../client/DaemonFastSubClient";
import { MockFastSubClient } from "../client/MockFastSubClient";
import type { MediaFile, Screen } from "./types";

export const scenarioOptions: { value: MockScenario; labelKey: string }[] = [
  { value: "setupReady", labelKey: "Scenario setup ready" },
  { value: "missingAsr", labelKey: "Scenario missing ASR" },
  { value: "nllbInstallFailed", labelKey: "Scenario translation model failed" },
  { value: "modelInstalling", labelKey: "Scenario model installing" },
  { value: "modelInstallFailed", labelKey: "Scenario model install failed" },
  { value: "jobSuccess", labelKey: "Scenario job success" },
  { value: "jobFailed", labelKey: "Scenario job failed" },
  { value: "jobCanceled", labelKey: "Scenario job canceled" },
  { value: "outputConflict", labelKey: "Scenario output conflict" },
  { value: "remoteProviderConfirmRequired", labelKey: "Scenario remote confirm" },
  { value: "daemonDisconnected", labelKey: "Scenario service interrupted" }
];

export const debugScreens: { id: Screen; labelKey: string }[] = [
  { id: "setup-check", labelKey: "Screen environment check" },
  { id: "setup-done", labelKey: "Screen setup done" },
  { id: "main-empty", labelKey: "Screen empty state" },
  { id: "main-files", labelKey: "Screen files added" },
  { id: "main-advanced", labelKey: "Screen detailed settings" },
  { id: "main-missing", labelKey: "Screen model not ready" },
  { id: "main-conflict", labelKey: "Screen output conflict" },
  { id: "main-generating", labelKey: "Screen generating" },
  { id: "main-done", labelKey: "Screen completed" },
  { id: "queue-list", labelKey: "Screen task list" },
  { id: "queue-detail", labelKey: "Screen task detail" },
  { id: "queue-failed", labelKey: "Screen failed detail" },
  { id: "settings-general", labelKey: "Screen general settings" },
  { id: "settings-models", labelKey: "Screen model management" },
  { id: "settings-providers", labelKey: "Screen providers" },
  { id: "settings-diagnostics", labelKey: "Screen diagnostics" },
  { id: "settings-benchmark", labelKey: "Screen benchmark" },
  { id: "tool-translate", labelKey: "Screen translate SRT" },
  { id: "tool-burn-in", labelKey: "Screen burn-in subtitles" }
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
