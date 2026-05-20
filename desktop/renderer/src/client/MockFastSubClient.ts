import type {
  ConfigViewModel,
  CreateJobRequest,
  EnvironmentStatus,
  FastSubClient,
  FFmpegPackageManager,
  HealthStatus,
  JobDetail,
  JobEvent,
  JobEventHandlers,
  JobLogEntry,
  JobResult,
  JobSummary,
  MockScenario,
  ModelStatus,
  ProviderStatus,
  UiError
} from "../../../shared/contracts/types";
import { redactSecretText } from "../../../shared/privacy/redaction";
import { baseEnvironment, baseModels, baseProviders, createSeedJob, defaultConfig, disconnectedError, mockPaths, redactedLogs } from "./mockFixtures";

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function clone<T>(value: T): T {
  return structuredClone(value);
}

function statusLabel(status: JobDetail["status"]): string {
  switch (status) {
    case "queued":
      return "等待中";
    case "running":
      return "正在生成";
    case "canceling":
      return "正在取消";
    case "succeeded":
      return "已完成";
    case "failed":
      return "已失败";
    case "canceled":
      return "已取消";
    case "interrupted":
      return "服务中断";
    default:
      return "未知状态";
  }
}

function titleForRequest(request: CreateJobRequest, file: string): string {
  const base = file.split(/[\\/]/).pop() ?? "字幕任务";
  if (request.type === "translate_srt") {
    return translatedTitle(base, request.outputFormat);
  }
  if (request.type === "burn_in") {
    return base.replace(/\.[^.]+$/, ".burned.mp4");
  }
  if (request.outputType === "translated_srt") {
    return base.replace(/\.[^.]+$/, `.translated.${request.outputFormat}`);
  }
  if (request.outputType === "bilingual_srt") {
    return base.replace(/\.[^.]+$/, `.bilingual.${request.outputFormat}`);
  }
  return base;
}

function translatedTitle(base: string, outputFormat: string): string {
  const extension = base.match(/\.[^.\\/]+$/)?.[0].toLowerCase() ?? "";
  if ([".txt", ".text", ".md", ".markdown"].includes(extension)) {
    return base.replace(/\.[^.\\/]+$/i, ".translated.txt");
  }
  return base.replace(/\.[^.\\/]+$/i, `.zh.${outputFormat}`);
}

function modelNameForRequest(request: CreateJobRequest): string {
  if (request.type === "translate_srt") {
    return request.modelId;
  }
  if ((request.outputType === "translated_srt" || request.outputType === "bilingual_srt") && request.translationModelId) {
    return `${request.modelId} + ${request.translationModelId}`;
  }
  return request.modelId;
}

function mockResultForJob(job: JobDetail): JobResult {
  return {
    subtitlePath: `${job.outputDirectory}\\${job.title.replace(/\.[^.]+$/, "")}.srt`,
    outputFolder: job.outputDirectory,
    summary: "已生成 mock 字幕",
    durationLabel: "00:48",
    language: job.language ?? "自动识别"
  };
}

function jobError(code = "mock_job_failed"): UiError {
  return {
    code,
    title: code === "daemon_disconnected" ? "服务中断" : "字幕生成失败",
    message: code === "daemon_disconnected" ? "本地服务中断，请修复后重新同步。" : "模拟转写在媒体分析阶段失败，请重试或查看诊断。",
    action: code === "daemon_disconnected" ? "一键修复" : "重试任务",
    recoveryActions: code === "daemon_disconnected" ? ["repair_daemon", "open_diagnostics"] : ["retry", "open_diagnostics"],
    diagnostic: redactSecretText(`${code}: Authorization: Bearer mock-token sk-secret`)
  };
}

export class MockFastSubClient implements FastSubClient {
  private scenario: MockScenario;
  private config: ConfigViewModel = clone(defaultConfig);
  private models: ModelStatus[] = clone(baseModels);
  private providers: ProviderStatus[] = clone(baseProviders);
  private jobs = new Map<string, JobDetail>();
  private sequence = 1;

  constructor(scenario: MockScenario = "setupReady") {
    this.scenario = scenario;
    this.applyScenario();
    const running = createSeedJob({
      id: "mock-running",
      displayId: "当前任务",
      status: "running",
      statusLabel: "正在生成",
      title: "sample-meeting.mp4",
      currentFile: "C:\\Users\\Example\\Videos\\sample-meeting.mp4",
      progressPercent: 62,
      stageLabel: "正在转写音频",
      inputPaths: ["C:\\Users\\Example\\Videos\\sample-meeting.mp4"],
      estimatedRemaining: "约 3 分钟"
    });
    this.jobs.set(running.id, running);
    const queuedA = createSeedJob({
      id: "mock-queued-lecture",
      displayId: "等待任务",
      status: "queued",
      statusLabel: "等待中",
      title: "sample-lecture.mov",
      currentFile: "D:\\资料\\视频\\sample-lecture.mov",
      inputPaths: ["D:\\资料\\视频\\sample-lecture.mov"]
    });
    this.jobs.set(queuedA.id, queuedA);
    const queuedB = createSeedJob({
      id: "mock-queued-podcast",
      displayId: "等待任务",
      status: "queued",
      statusLabel: "等待中",
      title: "sample-podcast.wav",
      currentFile: "\\\\NAS\\data\\others\\资料\\sample-podcast.wav",
      inputPaths: ["\\\\NAS\\data\\others\\资料\\sample-podcast.wav"]
    });
    this.jobs.set(queuedB.id, queuedB);
    const done = createSeedJob({
      id: "mock-history-done",
      displayId: "历史任务",
      status: "succeeded",
      statusLabel: "已完成",
      progressPercent: 100,
      stageLabel: "已完成",
      completedAt: "今天 10:18",
      result: {
        subtitlePath: "D:\\资料\\视频\\片段.srt",
        outputFolder: "D:\\资料\\视频",
        summary: "已生成 118 行字幕",
        durationLabel: "01:18",
        language: "自动识别"
      }
    });
    this.jobs.set(done.id, done);
    const failed = createSeedJob({
      id: "mock-history-failed",
      displayId: "失败任务",
      status: "failed",
      statusLabel: "已失败",
      title: "raw-cam.mov",
      currentFile: "D:\\资料\\视频\\raw-cam.mov",
      progressPercent: 18,
      stageLabel: "音频轨无法提取",
      inputPaths: ["D:\\资料\\视频\\raw-cam.mov"],
      error: jobError("media_extract_failed")
    });
    this.jobs.set(failed.id, failed);
  }

  setScenario(scenario: MockScenario): void {
    this.scenario = scenario;
    this.applyScenario();
  }

  async health(): Promise<HealthStatus> {
    await delay(10);
    return this.scenario === "daemonDisconnected" ? "disconnected" : "ok";
  }

  async version(): Promise<string> {
    return "Fast Sub Desktop Mock 0.11";
  }

  async getEnvironmentStatus(): Promise<EnvironmentStatus> {
    await delay(20);
    const env = clone(baseEnvironment);
    const asrReady = this.models.some((model) => model.kind === "asr" && model.id === this.config.asrModel && model.state === "ready");
    if (this.scenario === "daemonDisconnected") {
      return { ...env, health: "disconnected", daemonReady: false, error: disconnectedError, warnings: ["本地服务连接中断"] };
    }
    if (!asrReady) {
      return { ...env, localTranscriptionReady: false, warnings: ["默认 ASR 模型缺失"] };
    }
    if (this.scenario === "nllbInstallFailed") {
      return { ...env, localTranslationReady: false, warnings: ["默认翻译模型安装失败，但不影响生成原语音字幕"] };
    }
    return env;
  }

  async repairDaemon(): Promise<EnvironmentStatus> {
    this.setScenario("setupReady");
    return this.getEnvironmentStatus();
  }

  async installFFmpegWithPackageManager(_manager: FFmpegPackageManager): Promise<EnvironmentStatus> {
    return this.getEnvironmentStatus();
  }

  async installProviderDependency(providerId: string): Promise<ProviderStatus> {
    const provider = this.providers.find((item) => item.id === providerId);
    if (!provider) {
      throw new Error("unknown provider");
    }
    const next = { ...provider, state: "available" as const, enabled: true };
    this.providers = this.providers.map((item) => item.id === providerId ? next : item);
    return clone(next);
  }

  async getConfig(): Promise<ConfigViewModel> {
    return clone(this.config);
  }

  async updateConfig(patch: Partial<ConfigViewModel>): Promise<ConfigViewModel> {
    this.config = { ...this.config, ...patch };
    return clone(this.config);
  }

  async saveProviderSecret(providerId: string, alias: string, rawSecret: string): Promise<ConfigViewModel> {
    if (!rawSecret.trim()) {
      throw new Error("empty secret");
    }
    this.config = {
      ...this.config,
      apiProviderConfigs: {
        ...this.config.apiProviderConfigs,
        [providerId]: {
          ...(this.config.apiProviderConfigs?.[providerId] ?? {}),
          apiKeyAlias: alias,
          apiKeyStatus: "configured"
        }
      }
    };
    this.providers = this.providers.map((provider) => provider.id === providerId ? {
      ...provider,
      state: "available",
      enabled: true,
      checkMode: provider.kind === "api" ? "static" : provider.checkMode,
      maskedCredential: `${alias} (已保存)`
    } : provider);
    return clone(this.config);
  }

  async deleteProviderSecret(providerId: string, _alias: string): Promise<ConfigViewModel> {
    this.config = {
      ...this.config,
      apiProviderConfigs: {
        ...this.config.apiProviderConfigs,
        [providerId]: {
          ...(this.config.apiProviderConfigs?.[providerId] ?? {}),
          apiKeyAlias: "",
          apiKeyStatus: "missing"
        }
      }
    };
    this.providers = this.providers.map((provider) => provider.id === providerId ? {
      ...provider,
      state: "missing_api_key",
      enabled: false,
      maskedCredential: "未配置"
    } : provider);
    return clone(this.config);
  }

  async listModels(): Promise<ModelStatus[]> {
    return clone(this.models);
  }

  async installModel(modelId: string): Promise<ModelStatus> {
    const job = await this.createModelInstallJob(modelId);
    const model = this.models.find((item) => item.id === modelId);
    if (!model) {
      throw new Error("unknown model");
    }
    model.state = this.scenario === "modelInstallFailed" ? "failed" : "installing";
    model.installJobId = job.id;
    model.progressPercent = model.state === "installing" ? 8 : 42;
    model.diagnostic = model.state === "failed" ? "download token=[REDACTED]" : undefined;
    return clone(model);
  }

  async createModelInstallJob(modelId: string): Promise<JobDetail> {
    await delay(10);
    const model = this.models.find((item) => item.id === modelId);
    if (!model) {
      throw new Error("unknown model");
    }
    const id = `mock-model-install-${this.sequence++}`;
    const failed = this.scenario === "modelInstallFailed";
    const installing = this.scenario === "modelInstalling";
    const job = createSeedJob({
      id,
      displayId: `模型任务 ${this.sequence - 1}`,
      type: "model_install",
      title: `${model.name} 模型安装`,
      currentFile: model.name,
      inputPaths: [],
      outputDirectory: "Fast Sub 模型目录",
      providerName: model.kind === "translation" ? "本地翻译模型" : "本地转写模型",
      modelName: model.name,
      status: failed ? "failed" : installing ? "queued" : "succeeded",
      statusLabel: failed ? "已失败" : installing ? "等待中" : "已完成",
      progressPercent: failed ? 42 : installing ? 0 : 100,
      stageLabel: failed ? "模型下载失败" : installing ? "等待准备模型" : "已完成",
      result: !failed && !installing ? {
        subtitlePath: model.name,
        outputFolder: "Fast Sub 模型目录",
        summary: "模型已准备好",
        durationLabel: "00:06"
      } : undefined,
      error: failed ? jobError("model_install_failed") : undefined
    });
    this.jobs.set(id, job);
    model.state = failed ? "failed" : installing ? "installing" : "ready";
    model.installJobId = id;
    model.progressPercent = failed ? 42 : installing ? 0 : 100;
    return clone(job);
  }

  async verifyModel(modelId: string): Promise<ModelStatus> {
    const model = this.models.find((item) => item.id === modelId) ?? this.models[0];
    return clone({ ...model, state: model.state === "missing" ? "missing" : "ready" });
  }

  async removeModel(modelId: string): Promise<ModelStatus> {
    const model = this.models.find((item) => item.id === modelId);
    if (!model) {
      throw new Error("unknown model");
    }
    const next: ModelStatus = {
      ...model,
      state: "missing",
      progressPercent: undefined,
      installJobId: undefined,
      diagnostic: undefined
    };
    this.models = this.models.map((item) => item.id === modelId ? next : item);
    for (const [id, job] of this.jobs) {
      if (job.type === "model_install" && job.modelName === model.name && (job.status === "queued" || job.status === "running" || job.status === "canceling")) {
        this.jobs.set(id, { ...job, status: "canceled", statusLabel: "已取消", stageLabel: "已移除" });
      }
    }
    return clone(next);
  }

  async listProviders(): Promise<ProviderStatus[]> {
    return clone(this.providers);
  }

  async testProvider(providerId: string, mode: "static" | "live"): Promise<ProviderStatus> {
    const provider = this.providers.find((item) => item.id === providerId) ?? this.providers[0];
    if (mode === "live" && provider.kind === "web" && provider.requiresUploadConfirmation) {
      return clone({ ...provider, state: "disabled", privacyNote: `${provider.privacyNote} Live 测试需要单独确认上传。` });
    }
    if (mode === "live" && provider.kind === "api") {
      return clone({ ...provider, state: "available", enabled: true, checkMode: "live" });
    }
    return clone({ ...provider, checkMode: mode });
  }

  async createJob(request: CreateJobRequest): Promise<JobDetail> {
    await delay(20);
    const provider = this.providers.find((item) => item.id === request.providerId);
    const translationProvider = this.providers.find((item) => item.id === request.translationProviderId);
    if (provider?.requiresUploadConfirmation && !request.remoteUploadConfirmed) {
      throw new Error("remote upload confirmation required");
    }
    if (translationProvider?.requiresUploadConfirmation && !request.translationUploadConfirmed) {
      throw new Error("remote translation confirmation required");
    }
    const id = `mock-${this.sequence++}`;
    const file = request.inputPaths[0] ?? mockPaths.spaced;
    const providerName = provider?.name ?? (request.type === "translate_srt" ? "本地 NLLB 翻译" : "本地 Faster Whisper");
    const instantToolJob = request.type === "translate_srt" || request.type === "burn_in";
    const title = titleForRequest(request, file);
    const job = createSeedJob({
      id,
      displayId: `任务 ${this.sequence - 1}`,
      type: request.type,
      title,
      currentFile: file,
      inputPaths: request.inputPaths,
      outputDirectory: request.outputDirectory,
      providerName,
      modelName: modelNameForRequest(request),
      language: request.language,
      status: instantToolJob ? "succeeded" : "queued",
      statusLabel: instantToolJob ? "已完成" : "等待中",
      progressPercent: instantToolJob ? 100 : 0,
      stageLabel: instantToolJob ? "已完成" : "等待中",
      result: instantToolJob ? {
        subtitlePath: request.outputPath ?? `${request.outputDirectory}\\${title}`,
        outputFolder: (request.outputPath ?? request.outputDirectory).replace(/[\\/][^\\/]*$/, ""),
        summary: "mock 工具任务已完成",
        durationLabel: "00:03",
        language: request.targetLanguage ?? request.language
      } : undefined
    });
    this.jobs.set(id, job);
    return clone(job);
  }

  async listJobs(): Promise<JobSummary[]> {
    return Array.from(this.jobs.values()).map(({ logs: _logs, inputPaths: _inputPaths, result: _result, error: _error, estimatedRemaining: _estimatedRemaining, ...summary }) => clone(summary));
  }

  async getJob(jobId: string): Promise<JobDetail> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error("unknown job");
    }
    return clone(job);
  }

  async cancelJob(jobId: string): Promise<JobDetail> {
    const job = await this.getJob(jobId);
    const next = { ...job, status: "canceling" as const, statusLabel: "正在取消", stageLabel: "正在取消" };
    this.jobs.set(jobId, next);
    setTimeout(() => {
      const latest = this.jobs.get(jobId);
      if (latest?.status === "canceling") {
        this.jobs.set(jobId, { ...latest, status: "canceled", statusLabel: "已取消", stageLabel: "已取消" });
      }
    }, 800);
    return clone(next);
  }

  async cancelAllJobs(): Promise<JobSummary[]> {
    for (const [id, job] of this.jobs) {
      if (job.status === "queued" || job.status === "running") {
        this.jobs.set(id, { ...job, status: "canceling", statusLabel: "正在取消", stageLabel: "正在取消" });
      }
    }
    return this.listJobs();
  }

  async getJobResult(jobId: string): Promise<JobResult> {
    const job = await this.getJob(jobId);
    return job.result ?? mockResultForJob(job);
  }

  async getJobLogs(jobId: string): Promise<JobLogEntry[]> {
    const job = await this.getJob(jobId);
    return clone(job.logs);
  }

  async deleteJob(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
  }

  subscribeJobEvents(jobId: string, handlers: JobEventHandlers): () => void {
    let active = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const emit = (ms: number, eventFactory: () => JobEvent) => {
      timers.push(setTimeout(() => {
        if (!active) {
          return;
        }
        const event = eventFactory();
        this.applyEvent(jobId, event);
        handlers.onEvent(event);
      }, ms));
    };

    emit(0, () => ({ type: "snapshot", job: clone(this.jobs.get(jobId) ?? createSeedJob({ id: jobId })) }));
    if (this.scenario === "daemonDisconnected") {
      emit(60, () => ({ type: "failed", error: jobError("daemon_disconnected") }));
    } else if (this.scenario === "jobFailed") {
      emit(80, () => ({ type: "progress", progress: { status: "running", progressPercent: 28, stageLabel: "正在分析媒体", currentFile: mockPaths.spaced, estimatedRemaining: "约 1 分钟" } }));
      emit(160, () => ({ type: "failed", error: jobError() }));
    } else if (this.scenario === "jobCanceled") {
      emit(80, () => ({ type: "progress", progress: { status: "running", progressPercent: 20, stageLabel: "正在转写音频", currentFile: mockPaths.spaced } }));
      emit(120, () => ({ type: "progress", progress: { status: "canceling", progressPercent: 20, stageLabel: "正在取消", currentFile: mockPaths.spaced } }));
      emit(150, () => ({ type: "canceled" }));
    } else {
      emit(70, () => {
        const current = this.jobs.get(jobId);
        return { type: "progress", progress: { status: "running", progressPercent: 12, stageLabel: "正在检查文件", currentFile: current?.currentFile ?? "", estimatedRemaining: "约 2 分钟" } };
      });
      emit(140, () => {
        const current = this.jobs.get(jobId);
        return { type: "progress", progress: { status: "running", progressPercent: 48, stageLabel: "正在转写音频", currentFile: current?.currentFile ?? "", estimatedRemaining: "约 1 分钟" } };
      });
      emit(210, () => ({ type: "log_tail", logs: redactedLogs }));
      emit(280, () => {
        const current = this.jobs.get(jobId);
        return { type: "progress", progress: { status: "running", progressPercent: 86, stageLabel: "正在生成文件", currentFile: current?.currentFile ?? "", estimatedRemaining: "少于 30 秒" } };
      });
      emit(360, () => {
        const current = this.jobs.get(jobId);
        return { type: "succeeded", result: current ? mockResultForJob(current) : { subtitlePath: "subtitle.srt", outputFolder: "", summary: "已生成 mock 字幕", durationLabel: "00:48" } };
      });
    }

    return () => {
      active = false;
      timers.forEach(clearTimeout);
    };
  }

  private applyScenario(): void {
    this.models = clone(baseModels);
    this.providers = clone(baseProviders);
    if (this.scenario === "missingAsr") {
      this.models = this.models.map((model) => model.id === "whisper-small" ? { ...model, state: "missing" } : model);
    }
    if (this.scenario === "nllbInstallFailed") {
      this.models = this.models.map((model) => model.id === "nllb-200-distilled-600m-ct2-int8" ? { ...model, state: "failed", diagnostic: "download URL signature=[REDACTED]" } : model);
    }
    if (this.scenario === "modelInstallFailed") {
      this.models = this.models.map((model) => model.id === "whisper-small" ? { ...model, state: "failed", progressPercent: 42, diagnostic: "download URL signature=[REDACTED]" } : model);
    }
    if (this.scenario === "modelInstalling") {
      this.models = this.models.map((model) => model.id === "whisper-small" ? { ...model, state: "installing", progressPercent: 63 } : model);
    }
    if (this.scenario === "outputConflict" || this.scenario === "remoteProviderConfirmRequired") {
      this.providers = this.providers.map((provider) => provider.id === "api-openai-transcription" ? {
        ...provider,
        enabled: true,
        state: "available",
        maskedCredential: "openai-test (已保存)"
      } : provider);
    }
  }

  private applyEvent(jobId: string, event: JobEvent): void {
    const current = this.jobs.get(jobId);
    if (!current) {
      return;
    }
    if (event.type === "progress" && event.progress) {
      this.jobs.set(jobId, { ...current, ...event.progress, statusLabel: statusLabel(event.progress.status) });
    }
    if (event.type === "log_tail" && event.logs) {
      this.jobs.set(jobId, { ...current, logs: event.logs });
    }
    if (event.type === "succeeded" && event.result) {
      this.jobs.set(jobId, { ...current, status: "succeeded", statusLabel: "已完成", progressPercent: 100, stageLabel: "已完成", completedAt: "刚刚", result: event.result });
    }
    if (event.type === "failed" && event.error) {
      this.jobs.set(jobId, { ...current, status: "failed", statusLabel: "已失败", error: event.error, stageLabel: event.error.title });
    }
    if (event.type === "canceled") {
      this.jobs.set(jobId, { ...current, status: "canceled", statusLabel: "已取消", stageLabel: "已取消" });
    }
  }
}
