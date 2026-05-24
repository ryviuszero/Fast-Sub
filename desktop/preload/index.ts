import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { ConfigViewModel, CreateJobRequest, FFmpegPackageManager, FolderScanOptions, JobEvent, JobEventHandlers, LocalDataCleanupTarget } from "../shared/contracts/types";

type SecuritySnapshot = {
  contextIsolation: boolean;
  nodeIntegration: boolean;
  csp: boolean;
  exposesRawIpc: boolean;
};

const api = {
  selectMediaFiles: (): Promise<string[]> => ipcRenderer.invoke("fast-sub:select-media-files") as Promise<string[]>,
  selectMediaFolder: (options?: Partial<FolderScanOptions>): Promise<string[]> => ipcRenderer.invoke("fast-sub:select-media-folder", options) as Promise<string[]>,
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke("fast-sub:select-folder") as Promise<string | null>,
  selectSubtitleOutputPath: (defaultPath: string): Promise<string | null> => ipcRenderer.invoke("fast-sub:select-subtitle-output-path", defaultPath) as Promise<string | null>,
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  openPathMock: (path: string): Promise<boolean> => ipcRenderer.invoke("fast-sub:open-path-mock", path) as Promise<boolean>,
  openExternalURL: (url: string): Promise<boolean> => ipcRenderer.invoke("fast-sub:open-external-url", url) as Promise<boolean>,
  reportStartupTiming: (mark: string, details?: Record<string, unknown>): void => {
    ipcRenderer.send("fast-sub:startup-timing", mark, details ?? {});
  },
  getSecuritySnapshot: (): Promise<SecuritySnapshot> =>
    ipcRenderer.invoke("fast-sub:security-snapshot") as Promise<SecuritySnapshot>
};

contextBridge.exposeInMainWorld("fastSubSystem", api);

let subscriptionSequence = 1;

const clientApi = {
  health: () => ipcRenderer.invoke("fast-sub-client:health"),
  version: () => ipcRenderer.invoke("fast-sub-client:version"),
  getEnvironmentStatus: () => ipcRenderer.invoke("fast-sub-client:get-environment-status"),
  checkNativeDependencies: () => ipcRenderer.invoke("fast-sub-client:check-native-dependencies"),
  repairDaemon: () => ipcRenderer.invoke("fast-sub-client:repair-daemon"),
  installFFmpeg: () => ipcRenderer.invoke("fast-sub-client:install-ffmpeg"),
  installFFmpegWithPackageManager: (manager: FFmpegPackageManager) => ipcRenderer.invoke("fast-sub-client:install-ffmpeg-package-manager", manager),
  chooseFFmpegDirectory: () => ipcRenderer.invoke("fast-sub-client:choose-ffmpeg-directory"),
  clearFFmpegDirectory: () => ipcRenderer.invoke("fast-sub-client:clear-ffmpeg-directory"),
  installProviderDependency: (providerId: string) => ipcRenderer.invoke("fast-sub-client:install-provider-dependency", providerId),
  getConfig: () => ipcRenderer.invoke("fast-sub-client:get-config"),
  updateConfig: (patch: Partial<ConfigViewModel>) => ipcRenderer.invoke("fast-sub-client:update-config", patch),
  saveProviderSecret: (providerId: string, alias: string, rawSecret: string) => ipcRenderer.invoke("fast-sub-client:save-provider-secret", providerId, alias, rawSecret),
  deleteProviderSecret: (providerId: string, alias: string) => ipcRenderer.invoke("fast-sub-client:delete-provider-secret", providerId, alias),
  listModels: () => ipcRenderer.invoke("fast-sub-client:list-models"),
  installModel: (modelId: string) => ipcRenderer.invoke("fast-sub-client:install-model", modelId),
  createModelInstallJob: (modelId: string) => ipcRenderer.invoke("fast-sub-client:create-model-install-job", modelId),
  verifyModel: (modelId: string) => ipcRenderer.invoke("fast-sub-client:verify-model", modelId),
  removeModel: (modelId: string) => ipcRenderer.invoke("fast-sub-client:remove-model", modelId),
  listProviders: () => ipcRenderer.invoke("fast-sub-client:list-providers"),
  testProvider: (providerId: string, mode: "static" | "live") => ipcRenderer.invoke("fast-sub-client:test-provider", providerId, mode),
  createJob: (request: CreateJobRequest) => ipcRenderer.invoke("fast-sub-client:create-job", request),
  listJobs: () => ipcRenderer.invoke("fast-sub-client:list-jobs"),
  getJob: (jobId: string) => ipcRenderer.invoke("fast-sub-client:get-job", jobId),
  cancelJob: (jobId: string) => ipcRenderer.invoke("fast-sub-client:cancel-job", jobId),
  cancelAllJobs: () => ipcRenderer.invoke("fast-sub-client:cancel-all-jobs"),
  getJobResult: (jobId: string) => ipcRenderer.invoke("fast-sub-client:get-job-result", jobId),
  getJobLogs: (jobId: string) => ipcRenderer.invoke("fast-sub-client:get-job-logs", jobId),
  deleteJob: (jobId: string) => ipcRenderer.invoke("fast-sub-client:delete-job", jobId),
  cleanupLocalData: (target: LocalDataCleanupTarget) => ipcRenderer.invoke("fast-sub-client:cleanup-local-data", target),
  subscribeJobEvents: (jobId: string, handlers: JobEventHandlers) => {
    const subscriptionId = `sub_${subscriptionSequence++}`;
    const onEvent = (_event: Electron.IpcRendererEvent, id: string, jobEvent: JobEvent) => {
      if (id === subscriptionId) {
        handlers.onEvent(jobEvent);
      }
    };
    const onError = (_event: Electron.IpcRendererEvent, id: string, error: unknown) => {
      if (id === subscriptionId) {
        handlers.onError?.(error as Parameters<NonNullable<JobEventHandlers["onError"]>>[0]);
      }
    };
    ipcRenderer.on("fast-sub-client:job-event", onEvent);
    ipcRenderer.on("fast-sub-client:job-error", onError);
    void ipcRenderer.invoke("fast-sub-client:subscribe-job-events", jobId, subscriptionId);
    return () => {
      ipcRenderer.off("fast-sub-client:job-event", onEvent);
      ipcRenderer.off("fast-sub-client:job-error", onError);
      void ipcRenderer.invoke("fast-sub-client:unsubscribe-job-events", subscriptionId);
    };
  }
};

contextBridge.exposeInMainWorld("fastSubClient", clientApi);
