export type HealthStatus = "ok" | "degraded" | "disconnected";
export type ModelKind = "asr" | "translation";
export type ModelState = "ready" | "missing" | "installing" | "failed" | "verifying";
export type ProviderKind = "local" | "web" | "api" | "native";
export type ProviderCapability = "stt" | "translation";
export type ProviderState = "available" | "missing_dependency" | "missing_model" | "missing_api_key" | "invalid_config" | "disabled" | "not_implemented";
export type JobKind = "transcribe" | "model_install" | "translate_srt" | "burn_in";
export type JobStatus = "queued" | "running" | "canceling" | "succeeded" | "failed" | "canceled" | "interrupted";
export type JobStage =
  | "validating"
  | "queued"
  | "probing_media"
  | "installing_model"
  | "extracting_audio"
  | "preparing_upload"
  | "loading_model"
  | "transcribing"
  | "translating"
  | "burning_in"
  | "rendering"
  | "finalizing"
  | "done";
export type JobEventType = "snapshot" | "progress" | "log_tail" | "succeeded" | "failed" | "canceled" | "events_lost";
export type RecoveryAction = "retry" | "install_model" | "open_settings" | "open_diagnostics" | "repair_daemon" | "dismiss";
export type FFmpegPackageManager = "scoop" | "winget" | "choco";
export type MockScenario =
  | "setupReady"
  | "missingAsr"
  | "nllbInstallFailed"
  | "modelInstalling"
  | "modelInstallFailed"
  | "jobSuccess"
  | "jobFailed"
  | "jobCanceled"
  | "outputConflict"
  | "remoteProviderConfirmRequired"
  | "daemonDisconnected";

export interface UiError {
  code: string;
  title: string;
  message: string;
  action: string;
  recoveryActions: RecoveryAction[];
  diagnostic: string;
  details?: Record<string, string | number | boolean>;
}

export interface EnvironmentStatus {
  health: HealthStatus;
  os: string;
  arch: string;
  memory: string;
  disk: string;
  localTranscriptionReady: boolean;
  localTranslationReady: boolean;
  ffmpegReady: boolean;
  ffmpegInstalling?: boolean;
  ffmpegInstallProgressPercent?: number;
  ffmpegInstallLogs?: string[];
  modelDirectoryReady: boolean;
  daemonReady: boolean;
  warnings: string[];
  error?: UiError;
}

export interface ModelStatus {
  id: string;
  name: string;
  kind: ModelKind;
  state: ModelState;
  sizeLabel: string;
  backend?: string;
  compatibleProviders?: string[];
  defaultFor?: string[];
  recommendation?: string;
  progressPercent?: number;
  installJobId?: string;
  requiredForMainFlow: boolean;
  diagnostic?: string;
}

export interface ProviderStatus {
  id: string;
  name: string;
  kind: ProviderKind;
  capability: ProviderCapability;
  state: ProviderState;
  checkMode?: "static" | "live";
  enabled: boolean;
  privacyNote: string;
  requiresUploadConfirmation: boolean;
  requiresApiKey?: boolean;
  requiresModel?: boolean;
  supportsBatch?: boolean;
  supportsWordTimestamps?: boolean;
  supportedLanguages?: string[];
  capabilities?: string[];
  compatibleModelTypes?: string[];
  maskedCredential?: string;
}

export interface ConfigViewModel {
  defaultLanguage: string;
  targetLanguage: string;
  outputLocation: "source" | "custom";
  outputConflict: "ask" | "overwrite" | "skip";
  outputFormat: "srt" | "vtt" | "txt" | "json";
  device: "auto" | "cpu" | "gpu";
  outputType: "original_srt" | "translated_srt" | "bilingual_srt" | "burned_video";
  burnInVideo: boolean;
  asrProvider: string;
  translationProvider: string;
  asrModel: string;
  translationModel: string;
  keepTempFiles: boolean;
  wordTimestamps: boolean;
  folderScanIncludeSubfolders: boolean;
  folderScanMaxFiles: number;
  apiKeyAlias?: string;
  openAIBaseUrl?: string;
  openAIModel?: string;
  openAIUploadFormat?: "wav" | "mp3" | "m4a";
  apiKeyStatus?: "missing" | "configured" | "unknown";
  apiProviderConfigs?: Record<string, ApiProviderConfigViewModel>;
}

export interface ApiProviderConfigViewModel {
  apiKeyAlias?: string;
  openAIBaseUrl?: string;
  openAIModel?: string;
  openAIUploadFormat?: "wav" | "mp3" | "m4a";
  apiKeyStatus?: "missing" | "configured" | "unknown";
}

export interface FolderScanOptions {
  includeSubfolders: boolean;
  maxFiles: number;
}

export interface CreateJobRequest {
  type: JobKind;
  inputPaths: string[];
  outputDirectory: string;
  outputPath?: string;
  outputType: ConfigViewModel["outputType"];
  outputFormat: ConfigViewModel["outputFormat"];
  outputConflict?: ConfigViewModel["outputConflict"];
  language: string;
  targetLanguage?: string;
  providerId: string;
  modelId: string;
  translationProviderId?: string;
  translationModelId?: string;
  translationUploadConfirmed?: boolean;
  remoteUploadConfirmed: boolean;
}

export interface JobResult {
  subtitlePath: string;
  outputFolder: string;
  summary: string;
  durationLabel: string;
  language?: string;
}

export interface JobLogEntry {
  time: string;
  level: "info" | "warning" | "error";
  message: string;
}

export interface JobSummary {
  id: string;
  displayId: string;
  type: JobKind;
  status: JobStatus;
  statusLabel: string;
  title: string;
  currentFile: string;
  progressPercent: number;
  stageLabel: string;
  createdAt: string;
  completedAt?: string;
  language?: string;
  providerName?: string;
  modelName?: string;
  outputDirectory?: string;
}

export interface JobDetail extends JobSummary {
  inputPaths: string[];
  outputDirectory: string;
  providerName: string;
  modelName: string;
  estimatedRemaining?: string;
  result?: JobResult;
  error?: UiError;
  logs: JobLogEntry[];
}

export interface JobEvent {
  type: JobEventType;
  job?: JobDetail;
  progress?: Pick<JobSummary, "status" | "progressPercent" | "stageLabel" | "currentFile"> & {
    estimatedRemaining?: string;
    warning?: string;
  };
  result?: JobResult;
  error?: UiError;
  logs?: JobLogEntry[];
}

export type JobEventHandlers = {
  onEvent: (event: JobEvent) => void;
  onError?: (error: UiError) => void;
};

export interface FastSubClient {
  health(): Promise<HealthStatus>;
  version(): Promise<string>;
  getEnvironmentStatus(): Promise<EnvironmentStatus>;
  repairDaemon(): Promise<EnvironmentStatus>;
  installFFmpegWithPackageManager(manager: FFmpegPackageManager): Promise<EnvironmentStatus>;
  installProviderDependency(providerId: string): Promise<ProviderStatus>;
  getConfig(): Promise<ConfigViewModel>;
  updateConfig(patch: Partial<ConfigViewModel>): Promise<ConfigViewModel>;
  saveProviderSecret(providerId: string, alias: string, rawSecret: string): Promise<ConfigViewModel>;
  deleteProviderSecret(providerId: string, alias: string): Promise<ConfigViewModel>;
  listModels(): Promise<ModelStatus[]>;
  installModel(modelId: string): Promise<ModelStatus>;
  createModelInstallJob(modelId: string): Promise<JobDetail>;
  verifyModel(modelId: string): Promise<ModelStatus>;
  removeModel(modelId: string): Promise<ModelStatus>;
  listProviders(): Promise<ProviderStatus[]>;
  testProvider(providerId: string, mode: "static" | "live"): Promise<ProviderStatus>;
  createJob(request: CreateJobRequest): Promise<JobDetail>;
  listJobs(): Promise<JobSummary[]>;
  getJob(jobId: string): Promise<JobDetail>;
  cancelJob(jobId: string): Promise<JobDetail>;
  cancelAllJobs(): Promise<JobSummary[]>;
  getJobResult(jobId: string): Promise<JobResult>;
  getJobLogs(jobId: string): Promise<JobLogEntry[]>;
  deleteJob(jobId: string): Promise<void>;
  subscribeJobEvents(jobId: string, handlers: JobEventHandlers): () => void;
}
