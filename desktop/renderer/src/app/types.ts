import type { ConfigViewModel, EnvironmentStatus, FFmpegPackageManager, JobDetail, JobLogEntry, JobSummary, ModelStatus, ProviderStatus } from "../../../shared/contracts/types";

export type Screen =
  | "setup-check"
  | "setup-done"
  | "main-empty"
  | "main-files"
  | "main-advanced"
  | "main-missing"
  | "main-conflict"
  | "main-generating"
  | "main-done"
  | "queue-list"
  | "queue-detail"
  | "queue-failed"
  | "settings-general"
  | "settings-models"
  | "settings-api"
  | "settings-providers"
  | "settings-diagnostics"
  | "settings-benchmark"
  | "tool-translate"
  | "tool-burn-in";

export type MediaFile = { path: string; name: string; size: string; duration: string };
export type UiLanguage = "system" | "zh" | "en";
export type UiFontStyle = "system" | "sketch";
export type QueueFilter = "all" | "running" | "done" | "failed";

export type RenderProps = {
  screen: Screen;
  setScreen: (screen: Screen) => void;
  providerSettingsFocus: ProviderStatus["capability"] | null;
  openProviderSettings: (focus?: ProviderStatus["capability"]) => void;
  environment: EnvironmentStatus | null;
  models: ModelStatus[];
  providers: ProviderStatus[];
  config: ConfigViewModel;
  setConfig: (config: ConfigViewModel) => void;
  uiLanguage: UiLanguage;
  setUiLanguage: (language: UiLanguage) => void;
  uiFontStyle: UiFontStyle;
  setUiFontStyle: (style: UiFontStyle) => void;
  files: MediaFile[];
  setFiles: (files: MediaFile[]) => void;
  fileImportPending: boolean;
  fileImportCount: number | null;
  outputDirectoryLabel: string;
  asrReady: boolean;
  translationReady: boolean;
  jobs: JobSummary[];
  modelInstallJobs: Record<string, JobDetail>;
  queueInitialFilter: QueueFilter;
  activeBatchJobIds: string[];
  activeJob: JobDetail | null;
  completedBatchJobs: JobDetail[];
  addFiles: () => Promise<void>;
  addFolder: () => Promise<void>;
  addDroppedFiles: (files: FileList) => void;
  chooseOutputDirectory: () => Promise<boolean>;
  chooseSubtitleOutputPath: (defaultPath: string) => Promise<string | null>;
  openJob: (jobId: string, screen: Screen) => Promise<void>;
  getJobLogs: (jobId: string) => Promise<JobLogEntry[]>;
  openRunningQueue: () => void;
  startJob: (options?: { conflictResolved?: boolean; inputPaths?: string[]; outputConflict?: ConfigViewModel["outputConflict"]; outputPath?: string; remoteUploadConfirmed?: boolean }) => Promise<void>;
  startToolJob: (type: "translate_srt" | "burn_in", inputPaths: string[], options?: { remoteUploadConfirmed?: boolean }) => Promise<JobDetail | null>;
  retryJob: () => Promise<void>;
  openMock: (path: string) => Promise<void>;
  cancelJob: () => Promise<void>;
  cancelJobs: (jobIds: string[]) => Promise<void>;
  cancelAllJobs: () => Promise<void>;
  deleteJob: () => Promise<void>;
  deleteJobs: (jobIds: string[]) => Promise<void>;
  installModel: (id: string) => Promise<void>;
  removeModel: (id: string) => Promise<void>;
  repairDaemon: () => Promise<void>;
  installFFmpegWithPackageManager: (manager: FFmpegPackageManager) => Promise<void>;
  installProviderDependency: (id: string) => Promise<void>;
  testProvider: (id: string, mode: "static" | "live") => Promise<ProviderStatus>;
  updateConfig: (patch: Partial<ConfigViewModel>) => Promise<void>;
  saveProviderSecret: (providerId: string, alias: string, rawSecret: string) => Promise<void>;
  deleteProviderSecret: (providerId: string, alias: string) => Promise<void>;
};
