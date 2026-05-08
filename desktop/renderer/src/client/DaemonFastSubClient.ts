import type {
  ConfigViewModel,
  CreateJobRequest,
  EnvironmentStatus,
  FastSubClient,
  HealthStatus,
  JobDetail,
  JobEvent,
  JobEventHandlers,
  JobLogEntry,
  JobResult,
  JobSummary,
  ModelStatus,
  ProviderStatus
} from "../../../shared/contracts/types";

type SubscribeFn = (jobId: string, handlers: JobEventHandlers) => () => void;

export interface FastSubClientBridge {
  health(): Promise<HealthStatus>;
  version(): Promise<string>;
  getEnvironmentStatus(): Promise<EnvironmentStatus>;
  repairDaemon(): Promise<EnvironmentStatus>;
  getConfig(): Promise<ConfigViewModel>;
  updateConfig(patch: Partial<ConfigViewModel>): Promise<ConfigViewModel>;
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
  subscribeJobEvents: SubscribeFn;
}

export class DaemonFastSubClient implements FastSubClient {
  constructor(private readonly bridge: FastSubClientBridge) {}

  health(): Promise<HealthStatus> { return this.bridge.health(); }
  version(): Promise<string> { return this.bridge.version(); }
  getEnvironmentStatus(): Promise<EnvironmentStatus> { return this.bridge.getEnvironmentStatus(); }
  repairDaemon(): Promise<EnvironmentStatus> { return this.bridge.repairDaemon(); }
  getConfig(): Promise<ConfigViewModel> { return this.bridge.getConfig(); }
  updateConfig(patch: Partial<ConfigViewModel>): Promise<ConfigViewModel> { return this.bridge.updateConfig(patch); }
  listModels(): Promise<ModelStatus[]> { return this.bridge.listModels(); }
  installModel(modelId: string): Promise<ModelStatus> { return this.bridge.installModel(modelId); }
  createModelInstallJob(modelId: string): Promise<JobDetail> { return this.bridge.createModelInstallJob(modelId); }
  verifyModel(modelId: string): Promise<ModelStatus> { return this.bridge.verifyModel(modelId); }
  removeModel(modelId: string): Promise<ModelStatus> { return this.bridge.removeModel(modelId); }
  listProviders(): Promise<ProviderStatus[]> { return this.bridge.listProviders(); }
  testProvider(providerId: string, mode: "static" | "live"): Promise<ProviderStatus> { return this.bridge.testProvider(providerId, mode); }
  createJob(request: CreateJobRequest): Promise<JobDetail> { return this.bridge.createJob(request); }
  listJobs(): Promise<JobSummary[]> { return this.bridge.listJobs(); }
  getJob(jobId: string): Promise<JobDetail> { return this.bridge.getJob(jobId); }
  cancelJob(jobId: string): Promise<JobDetail> { return this.bridge.cancelJob(jobId); }
  cancelAllJobs(): Promise<JobSummary[]> { return this.bridge.cancelAllJobs(); }
  getJobResult(jobId: string): Promise<JobResult> { return this.bridge.getJobResult(jobId); }
  getJobLogs(jobId: string): Promise<JobLogEntry[]> { return this.bridge.getJobLogs(jobId); }
  deleteJob(jobId: string): Promise<void> { return this.bridge.deleteJob(jobId); }
  subscribeJobEvents(jobId: string, handlers: JobEventHandlers): () => void {
    return this.bridge.subscribeJobEvents(jobId, handlers);
  }
}

export function isJobEvent(value: unknown): value is JobEvent {
  return value !== null && typeof value === "object" && "type" in value;
}
