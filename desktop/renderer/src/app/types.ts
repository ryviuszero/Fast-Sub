import type { ConfigViewModel, EnvironmentStatus, JobDetail, JobSummary, ModelStatus, ProviderStatus } from "../../../shared/contracts/types";

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

export type RenderProps = {
  screen: Screen;
  setScreen: (screen: Screen) => void;
  environment: EnvironmentStatus | null;
  models: ModelStatus[];
  providers: ProviderStatus[];
  config: ConfigViewModel;
  setConfig: (config: ConfigViewModel) => void;
  uiLanguage: UiLanguage;
  setUiLanguage: (language: UiLanguage) => void;
  files: MediaFile[];
  setFiles: (files: MediaFile[]) => void;
  outputDirectoryLabel: string;
  asrReady: boolean;
  translationReady: boolean;
  jobs: JobSummary[];
  activeJob: JobDetail | null;
  addFiles: () => Promise<void>;
  addFolder: () => Promise<void>;
  addDroppedFiles: (files: FileList) => void;
  chooseOutputDirectory: () => Promise<boolean>;
  openJob: (jobId: string, screen: Screen) => Promise<void>;
  startJob: (options?: { conflictResolved?: boolean; remoteUploadConfirmed?: boolean }) => Promise<void>;
  startToolJob: (type: "translate_srt" | "burn_in", inputPaths: string[]) => Promise<JobDetail>;
  retryJob: () => Promise<void>;
  openMock: (path: string) => Promise<void>;
  cancelJob: () => Promise<void>;
  cancelAllJobs: () => Promise<void>;
  deleteJob: () => Promise<void>;
  installModel: (id: string) => Promise<void>;
  repairDaemon: () => Promise<void>;
  testProvider: (id: string, mode: "static" | "live") => Promise<ProviderStatus>;
  updateConfig: (patch: Partial<ConfigViewModel>) => Promise<void>;
};
