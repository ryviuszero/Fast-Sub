import type {
  ConfigViewModel,
  CreateJobRequest,
  EnvironmentStatus,
  HealthStatus,
  JobDetail,
  JobEventHandlers,
  JobLogEntry,
  JobResult,
  JobSummary,
  ModelStatus,
  ProviderStatus,
  UiError
} from "../../shared/contracts/types";
import { mapDaemonEventToJobEvent, type DaemonEventType } from "../../shared/contracts/daemonEventMapping";
import { existsSync } from "node:fs";
import { redactSecretText } from "../../shared/privacy/redaction";
import { type DaemonSession, DaemonProcessManager } from "./daemonProcess";
import { daemonTransportLog } from "./transportLog";
import { errorFromUnknown, uiError } from "./uiError";

type APIEnvelope = {
  schema_version: number;
  ok: boolean;
  result?: unknown;
  error?: { code?: string; message?: string; action_hint?: string; details?: unknown };
  warnings?: string[];
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? redactSecretText(value) : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function percentFrom(value: unknown): number {
  const progress = record(value);
  return Math.max(0, Math.min(100, num(progress.percent, num(progress.current, 0))));
}

function statusLabel(status: string): string {
  switch (status) {
    case "created":
    case "queued": return "等待中";
    case "running": return "正在生成";
    case "canceling": return "正在取消";
    case "succeeded": return "已完成";
    case "failed": return "已失败";
    case "canceled": return "已取消";
    case "interrupted": return "服务中断";
    default: return "未知状态";
  }
}

function stageLabel(stage: string, type = "transcribe"): string {
  switch (stage) {
    case "validating": return "正在检查文件";
    case "queued": return "等待开始";
    case "probing_media": return "正在分析媒体";
    case "installing_model": return "正在准备模型";
    case "extracting_audio": return "正在提取音频";
    case "preparing_upload": return "正在准备上传";
    case "loading_model": return "正在加载模型";
    case "transcribing": return "正在转写音频";
    case "translating": return "正在翻译字幕";
    case "burning_in": return "正在烧录字幕";
    case "rendering": return "正在生成文件";
    case "finalizing": return "正在收尾";
    case "done": return "已完成";
    case "starting": return type === "model_install" ? "正在准备模型" : "正在开始";
    default: return stage || "等待开始";
  }
}

function mapError(value: unknown): UiError | undefined {
  const err = record(value);
  const code = str(err.code, "");
  if (!code) {
    return undefined;
  }
  const stage = str(err.stage, "");
  const details = primitiveDetails(record(err.details));
  const message = str(err.message, "任务没有完成。");
  if (code === "output_exists" && details.output_path === undefined) {
    const outputPath = outputPathFromExistsMessage(message);
    if (outputPath) {
      details.output_path = outputPath;
    }
  }
  return {
    ...uiError(code, titleForError(code, stage), message, str(err.action_hint, "查看诊断并重试")),
    diagnostic: diagnosticForError(code, stage, message, details),
    details: {
      stage,
      ...details
    }
  };
}

function outputPathFromExistsMessage(message: string): string {
  const match = /^output already exists:\s*(.+)$/i.exec(message.trim());
  return match?.[1] ?? "";
}

function titleForError(code: string, stage: string): string {
  if (code === "unauthorized") {
    return "本地服务认证失效";
  }
  if (code === "ffmpeg_failed" && stage === "extract") {
    return "音频提取失败";
  }
  if (code === "ffprobe_failed") {
    return "媒体分析失败";
  }
  return "任务失败";
}

function diagnosticForError(code: string, stage: string, message: string, details: Record<string, string | number | boolean>): string {
  return redactSecretText(JSON.stringify({ code, stage, message, details }));
}

function primitiveDetails(value: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") {
      out[key] = redactSecretText(raw);
    } else if (typeof raw === "number" || typeof raw === "boolean") {
      out[key] = raw;
    }
  }
  return out;
}

function mapJob(value: unknown): JobDetail {
  const item = record(value);
  const type = str(item.type, "transcribe") as JobDetail["type"];
  const rawStatus = str(item.status, "queued");
  const inputPath = str(item.input_path, "");
  const outputPath = str(item.output_path, "");
  const result = mapResult(item.result, outputPath, { inputPath, type });
  const finishedAt = str(item.finished_at, "");
  const status = normalizeJobStatus(rawStatus, finishedAt, result);
  const provider = str(item.provider, "");
  const model = str(item.model, "");
  return {
    id: str(item.job_id, str(item.id, "job")),
    displayId: "任务",
    type,
    status,
    statusLabel: statusLabel(status),
    title: titleFor(type, inputPath, str(item.model, "")),
    currentFile: inputPath || str(item.model, "模型"),
    progressPercent: status === "succeeded" ? 100 : percentFrom(item.progress),
    stageLabel: status === "succeeded" ? "已完成" : stageLabel(str(item.stage, "queued"), type),
    createdAt: str(item.created_at, "刚刚"),
    completedAt: finishedAt,
    language: result?.language || str(item.language, ""),
    inputPaths: inputPath ? [inputPath] : [],
    outputDirectory: outputPath ? outputPath.replace(/[\\/][^\\/]*$/, "") : "",
    providerName: providerName(provider),
    modelName: model,
    result,
    error: mapError(item.error),
    logs: []
  };
}

function normalizeJobStatus(status: string, finishedAt: string, result?: JobResult): JobDetail["status"] {
  const normalized = (status === "created" ? "queued" : status) as JobDetail["status"];
  if (normalized === "queued" || normalized === "running" || normalized === "canceling") {
    if (finishedAt || hasPersistedResultOutput(result)) {
      return "succeeded";
    }
  }
  return normalized;
}

function hasPersistedResultOutput(result?: JobResult): boolean {
  if (!result?.subtitlePath) {
    return false;
  }
  try {
    return existsSync(result.subtitlePath);
  } catch {
    return false;
  }
}

function mapResult(value: unknown, fallbackOutput = "", repairContext: { inputPath?: string; type?: string } = {}): JobResult | undefined {
  const item = record(value);
  if (Object.keys(item).length === 0 && !fallbackOutput) {
    return undefined;
  }
  const outputs = Array.isArray(item.outputs) ? item.outputs.map(record) : [];
  const firstOutput = outputs[0];
  const outputPath = repairCorruptOutputPath(str(item.subtitle_path, str(item.output_path, str(firstOutput?.path, fallbackOutput))), repairContext.inputPath ?? "", repairContext.type ?? "");
  return {
    subtitlePath: outputPath,
    outputFolder: outputPath ? outputPath.replace(/[\\/][^\\/]*$/, "") : "",
    summary: str(item.summary, outputs.length > 0 ? "任务已完成" : "已生成输出"),
    durationLabel: item.elapsed_sec ? `${Math.round(num(item.elapsed_sec))} 秒` : "",
    language: str(item.language, "")
  };
}

function repairCorruptOutputPath(outputPath: string, inputPath: string, type: string): string {
  if (!outputPath || !inputPath || !hasReplacementChar(baseName(outputPath)) || hasReplacementChar(baseName(inputPath))) {
    return outputPath;
  }
  const directory = directoryName(outputPath) || directoryName(inputPath);
  if (!directory) {
    return outputPath;
  }
  const inputBase = baseName(inputPath);
  const stem = inputBase.replace(/\.[^.\\/]+$/, "");
  const ext = extensionName(outputPath) || (type === "burn_in" ? ".mp4" : ".srt");
  const suffix = type === "burn_in" ? ".burned" : type === "translate_srt" ? ".translated" : "";
  const sep = directory.includes("/") && !directory.includes("\\") ? "/" : "\\";
  return `${directory}${sep}${stem}${suffix}${ext}`;
}

function hasReplacementChar(value: string): boolean {
  return value.includes("\uFFFD");
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || "";
}

function directoryName(path: string): string {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  if (index <= 0) {
    return "";
  }
  if (index === 2 && /^[A-Za-z]:[\\/]/.test(path)) {
    return path.slice(0, 3);
  }
  return path.slice(0, index);
}

function extensionName(path: string): string {
  const name = baseName(path);
  const match = /\.[^.\\/]+$/.exec(name);
  return match?.[0] ?? "";
}

function isPlainTextTranslationInput(path: string): boolean {
  const extension = extensionName(path).toLowerCase();
  return [".txt", ".text", ".md", ".markdown"].includes(extension);
}

function titleFor(type: string, inputPath: string, model: string): string {
  if (type === "model_install") {
    return `${model || "模型"} 安装`;
  }
  const base = inputPath.split(/[\\/]/).pop() || "字幕任务";
  if (type === "translate_srt") {
    return base.replace(/\.[^.\\/]+$/i, isPlainTextTranslationInput(base) ? ".translated.txt" : ".translated.srt");
  }
  if (type === "burn_in") {
    return base.replace(/\.[^.]+$/, ".burned.mp4");
  }
  return base;
}

function providerName(id: string): string {
  const names: Record<string, string> = {
    "local-faster-whisper": "本地 Faster Whisper",
    "local-whisper-cpp": "本地 whisper.cpp",
    "api-openai-transcription": "OpenAI 音频转写 API",
    "local-nllb-ct2": "本地 NLLB 翻译",
    "web-bing": "Bing 网页翻译",
    "web-google": "Google 网页翻译",
    "api-openai-chat": "OpenAI 兼容翻译 API"
  };
  return names[id] ?? id;
}

export class MainDaemonFastSubClient {
  constructor(private readonly processManager: DaemonProcessManager) {}

  async health(): Promise<HealthStatus> {
    try {
      await this.request("/v1/health", { auth: false });
      return "ok";
    } catch {
      return "disconnected";
    }
  }

  async version(): Promise<string> {
    const result = record(await this.request("/v1/version", { auth: false }));
    return str(result.version, "Fast Sub daemon");
  }

  async getEnvironmentStatus(): Promise<EnvironmentStatus> {
    const [health, models] = await Promise.all([this.health(), this.listModels().catch(() => [] as ModelStatus[])]);
    const asrReady = models.some((model) => model.kind === "asr" && model.state === "ready");
    const translationReady = models.some((model) => model.kind === "translation" && model.state === "ready");
    return {
      health,
      os: process.platform,
      arch: process.arch,
      memory: "由本地服务检查",
      disk: "由本地服务检查",
      localTranscriptionReady: asrReady,
      localTranslationReady: translationReady,
      ffmpegReady: health === "ok",
      modelDirectoryReady: health === "ok",
      daemonReady: health === "ok",
      warnings: health === "ok" ? [] : ["本地服务连接中断"],
      error: health === "ok" ? undefined : uiError("daemon_disconnected", "本地服务暂时不可用", "请尝试一键修复后重新检查。")
    };
  }

  async repairDaemon(): Promise<EnvironmentStatus> {
    await this.processManager.repair();
    return this.getEnvironmentStatus();
  }

  async getConfig(): Promise<ConfigViewModel> {
    try {
      return mapConfig(await this.request("/v1/config"));
    } catch {
      return mapConfig({});
    }
  }

  async updateConfig(patch: Partial<ConfigViewModel>): Promise<ConfigViewModel> {
    return mapConfig(await this.request("/v1/config", {
      method: "PATCH",
      body: { schema_version: 1, patch: configPatch(patch) }
    }));
  }

  async listModels(): Promise<ModelStatus[]> {
    try {
      const result = record(await this.request("/v1/models"));
      const models = Array.isArray(result.models) ? result.models : [];
      return models.map(mapModel);
    } catch (error) {
      if (isDaemonUnavailable(error)) {
        return [];
      }
      throw error;
    }
  }

  async createModelInstallJob(modelId: string): Promise<JobDetail> {
    return this.createDaemonJob({
      schema_version: 1,
      type: "model_install",
      model_id: modelId,
      model: modelId,
      provider: modelId.includes("nllb") ? "local-nllb-ct2" : "local-faster-whisper",
      options: { verify_after_download: true }
    });
  }

  async installModel(modelId: string): Promise<ModelStatus> {
    const job = await this.createModelInstallJob(modelId);
    return { id: modelId, name: modelId, kind: modelId.includes("nllb") ? "translation" : "asr", state: "installing", sizeLabel: "准备中", progressPercent: 0, installJobId: job.id, requiredForMainFlow: modelId.includes("whisper") };
  }

  async verifyModel(modelId: string): Promise<ModelStatus> {
    const result = record(await this.request(`/v1/models/${encodeURIComponent(modelId)}/verify`, { method: "POST" }));
    return mapModel(result);
  }

  async removeModel(modelId: string): Promise<ModelStatus> {
    const result = record(await this.request(`/v1/models/${encodeURIComponent(modelId)}`, { method: "DELETE" }));
    return mapModel(result);
  }

  async listProviders(): Promise<ProviderStatus[]> {
    try {
      const result = record(await this.request("/v1/providers"));
      const providers = Array.isArray(result.providers) ? result.providers : [];
      return providers.map(mapProvider);
    } catch (error) {
      if (isDaemonUnavailable(error)) {
        return [];
      }
      throw error;
    }
  }

  async testProvider(providerId: string, mode: "static" | "live"): Promise<ProviderStatus> {
    try {
      const result = record(await this.request(`/v1/providers?provider_id=${encodeURIComponent(providerId)}&mode=${encodeURIComponent(mode)}`));
      return mapProvider(record(result.provider));
    } catch (error) {
      if (!isDaemonUnavailable(error)) {
        throw error;
      }
      const providers = await this.listProviders();
      return providers.find((provider) => provider.id === providerId) ?? mapProvider({ id: providerId, status: "not_implemented" });
    }
  }

  async createJob(request: CreateJobRequest): Promise<JobDetail> {
    const first = request.inputPaths[0] ?? "";
    const body = {
      schema_version: 1,
      type: request.type,
      input_path: first,
      subtitle_path: request.type === "burn_in" ? request.inputPaths[1] ?? "" : undefined,
      output_path: outputPathFor(request),
      output_type: request.outputType,
      output_format: request.outputFormat,
      provider: request.providerId,
      model: request.modelId,
      language: request.language,
      target_language: request.targetLanguage ?? "zh",
      translation_provider: request.translationProviderId,
      translation_model: request.translationModelId,
      translation_upload_confirmed: request.translationUploadConfirmed ?? false,
      word_timestamps: request.outputType === "original_srt" ? "off" : "auto",
      options: {
        yes: request.remoteUploadConfirmed,
        overwrite: request.outputConflict === "overwrite",
        output_conflict: request.outputConflict ?? "ask",
        output_type: request.outputType,
        translation_provider: request.translationProviderId,
        translation_model: request.translationModelId,
        translation_upload_confirmed: request.translationUploadConfirmed ?? false,
        target_language: request.targetLanguage ?? "zh",
        keep_temp: false,
        device: "auto"
      }
    };
    return this.createDaemonJob(body);
  }

  async listJobs(): Promise<JobSummary[]> {
    try {
      const result = record(await this.request("/v1/jobs"));
      const jobs = Array.isArray(result.jobs) ? result.jobs : [];
      return jobs.map((job) => {
        const { logs: _logs, inputPaths: _inputPaths, result: _result, error: _error, estimatedRemaining: _estimatedRemaining, ...summary } = mapJob(job);
        return summary;
      });
    } catch (error) {
      if (isDaemonUnavailable(error)) {
        return [];
      }
      throw error;
    }
  }

  async getJob(jobId: string): Promise<JobDetail> {
    return mapJob(await this.request(`/v1/jobs/${encodeURIComponent(jobId)}`));
  }

  async cancelJob(jobId: string): Promise<JobDetail> {
    await this.request(`/v1/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
    return this.getJob(jobId);
  }

  async cancelAllJobs(): Promise<JobSummary[]> {
    const jobs = await this.listJobs();
    await Promise.all(jobs.filter((job) => job.status === "queued" || job.status === "running").map((job) => this.cancelJob(job.id).catch(() => null)));
    return this.listJobs();
  }

  async getJobResult(jobId: string): Promise<JobResult> {
    const result = record(await this.request(`/v1/jobs/${encodeURIComponent(jobId)}/result`));
    return mapResult(result.result, "") ?? { subtitlePath: "", outputFolder: "", summary: "任务已完成", durationLabel: "" };
  }

  async getJobLogs(jobId: string): Promise<JobLogEntry[]> {
    const result = record(await this.request(`/v1/jobs/${encodeURIComponent(jobId)}/logs`));
    const lines = Array.isArray(result.lines) ? result.lines : [];
    return lines.map((line, index) => ({ time: `${index + 1}`, level: "info" as const, message: redactSecretText(String(line)) }));
  }

  async deleteJob(jobId: string): Promise<void> {
    await this.request(`/v1/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
  }

  subscribeJobEvents(jobId: string, handlers: JobEventHandlers): () => void {
    const controller = new AbortController();
    void this.streamJobEvents(jobId, handlers, controller);
    return () => controller.abort();
  }

  private async createDaemonJob(body: unknown): Promise<JobDetail> {
    daemonTransportLog("job.request", jobRequestSummary(body));
    const created = record(await this.request("/v1/jobs", { method: "POST", body }));
    const id = str(created.job_id, "");
    return id ? this.getJob(id) : mapJob(created);
  }

  private async request(path: string, options: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<unknown> {
    const session = await this.processManager.ensureStarted();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.auth !== false) {
      headers.Authorization = `Bearer ${session.token}`;
    }
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    let response: Response;
    const method = options.method ?? "GET";
    const startedAt = Date.now();
    daemonTransportLog("rest.request", { method, path, auth: options.auth !== false, bodyKind: options.body === undefined ? "none" : bodyKind(options.body) });
    try {
      response = await fetch(new URL(path, session.baseUrl), {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
    } catch (error) {
      daemonTransportLog("rest.error", { method, path, elapsedMs: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) });
      throw uiError("daemon_disconnected", "本地服务中断", error instanceof Error ? error.message : String(error));
    }
    const envelope = await parseEnvelope(response);
    daemonTransportLog("rest.response", { method, path, status: response.status, ok: envelope.ok, elapsedMs: Date.now() - startedAt, errorCode: envelope.error?.code ?? "" });
    if (!envelope.ok) {
      throw uiError(envelope.error?.code ?? "daemon_error", envelope.error?.code === "unauthorized" ? "本地服务认证失效" : "本地服务返回错误", envelope.error?.message ?? `HTTP ${response.status}`, envelope.error?.action_hint);
    }
    return envelope.result;
  }

  private async streamJobEvents(jobId: string, handlers: JobEventHandlers, controller: AbortController): Promise<void> {
    let lastEventId = "";
    for (let attempt = 0; attempt < 4 && !controller.signal.aborted; attempt += 1) {
      try {
        const session = await this.processManager.ensureStarted();
        daemonTransportLog("sse.connect", { jobId, attempt, lastEventId });
        lastEventId = await streamSSE(session, jobId, lastEventId, controller.signal, async (eventType, data) => {
          daemonTransportLog("sse.event", { jobId, eventType, lastEventId, ...eventSummary(data) });
          const event = mapDaemonEventToJobEvent({ event: eventType, data });
          if (event?.type === "events_lost") {
            handlers.onEvent(event);
            handlers.onEvent({ type: "snapshot", job: await this.getJob(jobId) });
            return;
          }
          if (event) {
            handlers.onEvent(event);
          }
        });
        return;
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
          daemonTransportLog("sse.closed", { jobId, attempt, reason: "unsubscribed" });
          return;
        }
        const mapped = errorFromUnknown(error, "daemon_sse_error");
        daemonTransportLog("sse.error", { jobId, attempt, code: mapped.code, message: mapped.message });
        if (mapped.code === "unauthorized" || controller.signal.aborted) {
          handlers.onError?.(mapped);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
  }
}

async function parseEnvelope(response: Response): Promise<APIEnvelope> {
  const text = await response.text();
  try {
    const envelope = JSON.parse(text) as APIEnvelope;
    if (envelope && typeof envelope.ok === "boolean") {
      return envelope;
    }
  } catch {
    // Fall through to synthetic envelope.
  }
  return { schema_version: 1, ok: false, error: { code: `http_${response.status}`, message: redactSecretText(text || response.statusText) }, warnings: [] };
}

async function streamSSE(session: DaemonSession, jobId: string, lastEventId: string, signal: AbortSignal, onEvent: (event: DaemonEventType, data: unknown) => Promise<void>): Promise<string> {
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
    Authorization: `Bearer ${session.token}`
  };
  if (lastEventId) {
    headers["Last-Event-ID"] = lastEventId;
  }
  const response = await fetch(new URL(`/v1/jobs/${encodeURIComponent(jobId)}/events`, session.baseUrl), { headers, signal });
  if (response.status === 401) {
    throw uiError("unauthorized", "本地服务认证失效", "本地服务 token 已失效，请修复连接。");
  }
  if (!response.ok || !response.body) {
    throw uiError(`http_${response.status}`, "任务事件连接失败", response.statusText);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventType: DaemonEventType = "heartbeat";
  let data = "";
  let eventId = lastEventId;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) {
      return eventId;
    }
    buffer += decoder.decode(chunk.value, { stream: true });
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? "";
    for (const line of parts) {
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim() as DaemonEventType;
      } else if (line.startsWith("id:")) {
        eventId = line.slice(3).trim();
      } else if (line.startsWith("data:")) {
        data += line.slice(5).trim();
      } else if (line.trim() === "") {
        const parsed = data ? JSON.parse(data) as unknown : {};
        await onEvent(eventType, parsed);
        data = "";
        eventType = "heartbeat";
      }
    }
  }
}

function mapConfig(value: unknown): ConfigViewModel {
  const item = record(value);
  const openai = record(item.openai_compatible);
  const apiProvidersRaw = record(item.api_providers);
  const apiProviderConfigs = Object.fromEntries(Object.entries(apiProvidersRaw).map(([providerId, raw]) => [providerId, mapApiProviderConfig(record(raw))]));
  const rawOutputType = str(item.output_type, "original_srt");
  return {
    defaultLanguage: str(item.language, "auto"),
    targetLanguage: str(item.target_language, "zh"),
    outputLocation: str(item.output_directory, "source") === "source" ? "source" : "custom",
    outputConflict: (str(item.output_conflict, "ask") as ConfigViewModel["outputConflict"]),
    outputFormat: (str(item.output_format, "srt") as ConfigViewModel["outputFormat"]),
    device: normalizeDevice(str(item.device, "auto")),
    outputType: ((rawOutputType === "burned_video" ? "original_srt" : rawOutputType) as ConfigViewModel["outputType"]),
    burnInVideo: bool(item.burn_in_video, rawOutputType === "burned_video"),
    asrProvider: str(item.default_asr_provider, "local-faster-whisper"),
    translationProvider: str(item.default_translation_provider, "local-nllb-ct2"),
    asrModel: str(item.default_asr_model, "whisper-small"),
    translationModel: str(item.default_translation_model, "nllb-200-distilled-600m-ct2-int8"),
    keepTempFiles: bool(item.keep_temp, false),
    wordTimestamps: bool(item.word_timestamps, false),
    folderScanIncludeSubfolders: bool(item.folder_scan_include_subfolders, false),
    folderScanMaxFiles: num(item.folder_scan_max_files, 100),
    apiKeyAlias: normalizeOpenAIKeyAlias(str(openai.api_key_alias, "FAST_SUB_OPENAI_API_KEY")),
    openAIBaseUrl: str(openai.base_url, "https://api.openai.com/v1"),
    openAIModel: str(openai.model, ""),
    openAIUploadFormat: (str(openai.upload_format, "wav") as ConfigViewModel["openAIUploadFormat"]),
    apiKeyStatus: (str(openai.api_key_status, "missing") as ConfigViewModel["apiKeyStatus"]),
    apiProviderConfigs
  };
}

function mapApiProviderConfig(openai: Record<string, unknown>): NonNullable<ConfigViewModel["apiProviderConfigs"]>[string] {
  return {
    apiKeyAlias: normalizeOpenAIKeyAlias(str(openai.api_key_alias, "FAST_SUB_OPENAI_API_KEY")),
    openAIBaseUrl: str(openai.base_url, "https://api.openai.com/v1"),
    openAIModel: str(openai.model, ""),
    openAIUploadFormat: (str(openai.upload_format, "wav") as ConfigViewModel["openAIUploadFormat"]),
    apiKeyStatus: (str(openai.api_key_status, "missing") as ConfigViewModel["apiKeyStatus"])
  };
}

function normalizeOpenAIKeyAlias(value: string): string {
  return value === "openai-default" ? "FAST_SUB_OPENAI_API_KEY" : value;
}

function configPatch(patch: Partial<ConfigViewModel>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (patch.defaultLanguage !== undefined) out.language = patch.defaultLanguage;
  if (patch.targetLanguage !== undefined) out.target_language = patch.targetLanguage;
  if (patch.outputLocation !== undefined) out.output_directory = patch.outputLocation === "source" ? "source" : "custom";
  if (patch.outputConflict !== undefined) out.output_conflict = patch.outputConflict;
  if (patch.outputFormat !== undefined) out.output_format = patch.outputFormat;
  if (patch.outputType !== undefined) out.output_type = patch.outputType;
  if (patch.burnInVideo !== undefined) out.burn_in_video = patch.burnInVideo;
  if (patch.device !== undefined) out.device = patch.device === "gpu" ? "cuda" : patch.device;
  if (patch.asrProvider !== undefined) out.default_asr_provider = patch.asrProvider;
  if (patch.translationProvider !== undefined) out.default_translation_provider = patch.translationProvider;
  if (patch.asrModel !== undefined) out.default_asr_model = patch.asrModel;
  if (patch.translationModel !== undefined) out.default_translation_model = patch.translationModel;
  if (patch.keepTempFiles !== undefined) out.keep_temp = patch.keepTempFiles;
  if (patch.wordTimestamps !== undefined) out.word_timestamps = patch.wordTimestamps;
  if (patch.folderScanIncludeSubfolders !== undefined) out.folder_scan_include_subfolders = patch.folderScanIncludeSubfolders;
  if (patch.folderScanMaxFiles !== undefined) out.folder_scan_max_files = patch.folderScanMaxFiles;
  if (patch.openAIBaseUrl !== undefined || patch.openAIModel !== undefined || patch.openAIUploadFormat !== undefined || patch.apiKeyAlias !== undefined) {
    out.openai_compatible = {
      base_url: patch.openAIBaseUrl,
      model: patch.openAIModel,
      upload_format: patch.openAIUploadFormat,
      api_key_alias: patch.apiKeyAlias
    };
  }
  if (patch.apiProviderConfigs !== undefined) {
    out.api_providers = Object.fromEntries(Object.entries(patch.apiProviderConfigs).map(([providerId, cfg]) => [providerId, {
      base_url: cfg.openAIBaseUrl,
      model: cfg.openAIModel,
      upload_format: cfg.openAIUploadFormat,
      api_key_alias: cfg.apiKeyAlias
    }]));
  }
  return out;
}

function normalizeDevice(value: string): ConfigViewModel["device"] {
  if (value === "cuda" || value === "gpu") return "gpu";
  if (value === "cpu") return "cpu";
  return "auto";
}

function mapModel(value: unknown): ModelStatus {
  const item = record(value);
  const id = str(item.id, str(item.model_id, ""));
  const status = str(item.status, str(item.state, "missing"));
  return {
    id,
    name: str(item.name, id),
    kind: id.includes("nllb") || str(item.kind, str(item.type, "")) === "translation" || str(item.type, "") === "translate" ? "translation" : "asr",
    state: status === "available" || status === "installed" || status === "ready" ? "ready" : status === "installing" ? "installing" : status === "failed" ? "failed" : "missing",
    sizeLabel: str(item.size_label, item.size_bytes ? `${Math.round(num(item.size_bytes) / 1024 / 1024)} MB` : "未知大小"),
    backend: str(item.backend, ""),
    compatibleProviders: stringArray(item.compatible_providers),
    defaultFor: stringArray(item.default_for),
    recommendation: modelRecommendation(id, str(item.type, ""), str(item.backend, "")),
    progressPercent: typeof item.progress_percent === "number" ? item.progress_percent : undefined,
    requiredForMainFlow: id.includes("whisper-small"),
    diagnostic: str(item.diagnostic, "")
  };
}

function mapProvider(value: unknown): ProviderStatus {
  const item = record(value);
  const id = str(item.id, "");
  const location = str(item.location, "");
  const kind = (str(item.kind, location === "api" || id.startsWith("api-") ? "api" : location === "web" || id.startsWith("web-") ? "web" : location === "native" || id.includes("whisper-cpp") ? "native" : "local") as ProviderStatus["kind"]);
  const type = str(item.type, "");
  const capability = (str(item.capability, type === "translation" || type === "translate" || id.includes("nllb") || id.startsWith("web-") || id === "api-openai-chat" ? "translation" : "stt") as ProviderStatus["capability"]);
  const state = str(item.status, str(item.state, "available")) as ProviderStatus["state"];
  return {
    id,
    name: str(item.name, providerName(id)),
    kind,
    capability,
    state,
    enabled: state === "available",
    privacyNote: str(item.privacy_note, kind === "api" ? "会上传内容，可能产生费用。" : kind === "web" ? "会把字幕文本发送到第三方网页翻译服务。" : "本地处理，不上传。"),
    requiresUploadConfirmation: kind === "api" || kind === "web",
    requiresApiKey: bool(item.requires_api_key, kind === "api"),
    requiresModel: bool(item.requires_model, false),
    supportsBatch: bool(item.supports_batch, false),
    supportsWordTimestamps: bool(item.supports_word_timestamps, false),
    supportedLanguages: stringArray(item.supported_languages),
    capabilities: stringArray(item.capabilities),
    compatibleModelTypes: stringArray(item.compatible_model_types),
    maskedCredential: str(item.masked_credential, state === "missing_api_key" ? "未配置" : "")
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function modelRecommendation(id: string, type: string, backend: string): string {
  if (id === "whisper-base") return "快速预览、低内存机器和短音频。";
  if (id === "whisper-small") return "默认推荐，速度和准确率比较均衡。";
  if (id.includes("large-v3-turbo")) return "更高准确率，适合长音频和更好的硬件。";
  if (backend === "whisper.cpp") return "Native 本地路径，适合轻依赖和 CPU 场景。";
  if (type === "translate" || id.includes("nllb")) return "本地离线翻译，适合隐私优先的字幕文本。";
  return "可用于兼容 Provider 的本地任务。";
}

function outputPathFor(request: CreateJobRequest): string {
  if (request.outputPath) {
    return request.outputPath;
  }
  const first = request.inputPaths[0] ?? "output";
  const base = first.split(/[\\/]/).pop() ?? "output";
  const stem = base.replace(/\.[^.]+$/, "");
  const directory = request.outputDirectory || first.replace(/[\\/][^\\/]*$/, "");
  const sep = directory.includes("/") && !directory.includes("\\") ? "/" : "\\";
  if (request.type === "translate_srt") {
    const extension = isPlainTextTranslationInput(first) ? "txt" : request.outputFormat;
    return `${directory}${sep}${stem}.translated.${extension}`;
  }
  if (request.type === "burn_in") return `${directory}${sep}${stem}.burned.mp4`;
  return `${directory}${sep}${stem}.${request.outputFormat}`;
}

function bodyKind(value: unknown): string {
  const item = record(value);
  const type = str(item.type, "");
  if (type) {
    return `job:${type}`;
  }
  if ("patch" in item) {
    return "config-patch";
  }
  return "json";
}

function isDaemonUnavailable(error: unknown): boolean {
  const item = record(error);
  const code = str(item.code, "");
  return code === "daemon_runtime_missing" || code === "daemon_disconnected" || code === "daemon_ready_timeout" || code === "daemon_exited_early";
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("aborted"));
}

function eventSummary(value: unknown): Record<string, unknown> {
  const item = record(value);
  const error = record(item.error);
  return {
    status: str(item.status, ""),
    stage: str(item.stage, str(error.stage, "")),
    code: str(item.code, str(error.code, "")),
    message: str(error.message, ""),
    actionHint: str(error.action_hint, ""),
    exitCode: num(record(error.details).exit_code, 0),
    stderrTail: str(record(error.details).stderr_tail, "")
  };
}

function jobRequestSummary(value: unknown): Record<string, unknown> {
  const item = record(value);
  const inputPath = str(item.input_path, "");
  const subtitlePath = str(item.subtitle_path, "");
  const outputPath = str(item.output_path, "");
  return {
    type: str(item.type, "transcribe"),
    inputPath,
    inputExists: inputPath ? existsSync(inputPath) : false,
    subtitlePath,
    subtitleExists: subtitlePath ? existsSync(subtitlePath) : undefined,
    outputPath,
    provider: str(item.provider, ""),
    model: str(item.model, ""),
    outputType: str(item.output_type, ""),
    language: str(item.language, ""),
    targetLanguage: str(item.target_language, ""),
    translationProvider: str(item.translation_provider, ""),
    translationModel: str(item.translation_model, "")
  };
}
