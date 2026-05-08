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
  { path: "\\\\NAS\\data\\others\\资料\\sample-podcast.wav", name: "sample-podcast.wav", size: "120 MB", duration: "28:40" }
];

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

export function makeFilesFromList(selected: FileList, limit = Number.POSITIVE_INFINITY): MediaFile[] {
  return Array.from(selected).slice(0, limit).map((file, index) => makeFile(pathForFile(file), index));
}

function pathForFile(file: File): string {
  const bridgePath = window.fastSubSystem?.getPathForFile?.(file);
  if (bridgePath) {
    return bridgePath;
  }
  const legacyPath = (file as File & { path?: string }).path;
  return legacyPath || file.name;
}
