import { app, ipcMain, type WebContents } from "electron";
import type { CreateJobRequest, FFmpegPackageManager, JobEventHandlers } from "../../shared/contracts/types";
import { DaemonProcessManager } from "./daemonProcess";
import { MainDaemonFastSubClient } from "./daemonClient";
import { defaultSecretStorePath, SafeStorageSecretStore } from "./secretStore";
import { errorFromUnknown, uiError } from "./uiError";

export const secretStorePath = defaultSecretStorePath();

const processManager = new DaemonProcessManager();
const client = new MainDaemonFastSubClient(processManager);
const secretStore = new SafeStorageSecretStore(secretStorePath);
const subscriptions = new Map<string, () => void>();

export function registerFastSubClientIpc(): void {
  handle("fast-sub-client:health", () => client.health());
  handle("fast-sub-client:version", () => client.version());
  handle("fast-sub-client:get-environment-status", () => client.getEnvironmentStatus());
  handle("fast-sub-client:repair-daemon", () => client.repairDaemon());
  handle("fast-sub-client:install-ffmpeg-package-manager", (_event, manager: unknown) => client.installFFmpegWithPackageManager(normalizeFFmpegPackageManager(manager)));
  handle("fast-sub-client:install-provider-dependency", (_event, providerId: unknown) => client.installProviderDependency(String(providerId)));
  handle("fast-sub-client:get-config", () => client.getConfig());
  handle("fast-sub-client:update-config", (_event, patch: unknown) => client.updateConfig(patch as Parameters<typeof client.updateConfig>[0]));
  handle("fast-sub-client:save-provider-secret", async (_event, providerId: unknown, alias: unknown, rawSecret: unknown) => {
    const id = String(providerId);
    const safeAlias = normalizeSecretAlias(id, alias);
    const secret = String(rawSecret);
    if (!secret.trim()) {
      throw uiError("secret_empty", "密钥为空", "请输入 API key 后再保存。");
    }
    await secretStore.save(id, safeAlias, secret);
    const updated = await client.updateConfig({ apiProviderConfigs: { [id]: { apiKeyAlias: safeAlias, apiKeyStatus: "configured" } } });
    await client.repairDaemon().catch(() => undefined);
    return updated;
  });
  handle("fast-sub-client:delete-provider-secret", async (_event, providerId: unknown, alias: unknown) => {
    const id = String(providerId);
    const safeAlias = normalizeSecretAlias(id, alias);
    await secretStore.delete(id, safeAlias);
    const updated = await client.updateConfig({ apiProviderConfigs: { [id]: { apiKeyAlias: "", apiKeyStatus: "missing" } } });
    await client.repairDaemon().catch(() => undefined);
    return updated;
  });
  handle("fast-sub-client:list-models", () => client.listModels());
  handle("fast-sub-client:install-model", (_event, modelId: unknown) => client.installModel(String(modelId)));
  handle("fast-sub-client:create-model-install-job", (_event, modelId: unknown) => client.createModelInstallJob(String(modelId)));
  handle("fast-sub-client:verify-model", (_event, modelId: unknown) => client.verifyModel(String(modelId)));
  handle("fast-sub-client:remove-model", (_event, modelId: unknown) => client.removeModel(String(modelId)));
  handle("fast-sub-client:list-providers", () => client.listProviders());
  handle("fast-sub-client:test-provider", (_event, providerId: unknown, mode: unknown) => client.testProvider(String(providerId), mode === "live" ? "live" : "static"));
  handle("fast-sub-client:create-job", (_event, request: unknown) => client.createJob(request as CreateJobRequest));
  handle("fast-sub-client:list-jobs", () => client.listJobs());
  handle("fast-sub-client:get-job", (_event, jobId: unknown) => client.getJob(String(jobId)));
  handle("fast-sub-client:cancel-job", (_event, jobId: unknown) => client.cancelJob(String(jobId)));
  handle("fast-sub-client:cancel-all-jobs", () => client.cancelAllJobs());
  handle("fast-sub-client:get-job-result", (_event, jobId: unknown) => client.getJobResult(String(jobId)));
  handle("fast-sub-client:get-job-logs", (_event, jobId: unknown) => client.getJobLogs(String(jobId)));
  handle("fast-sub-client:delete-job", (_event, jobId: unknown) => client.deleteJob(String(jobId)));

  ipcMain.handle("fast-sub-client:subscribe-job-events", (event, jobId: unknown, subscriptionId: unknown) => {
    const id = String(subscriptionId);
    subscriptions.get(id)?.();
    const webContents = event.sender;
    subscriptions.set(id, client.subscribeJobEvents(String(jobId), handlersFor(webContents, id)));
    return true;
  });

  ipcMain.handle("fast-sub-client:unsubscribe-job-events", (_event, subscriptionId: unknown) => {
    const id = String(subscriptionId);
    subscriptions.get(id)?.();
    subscriptions.delete(id);
    return true;
  });

  app.on("before-quit", () => {
    for (const unsubscribe of subscriptions.values()) {
      unsubscribe();
    }
    subscriptions.clear();
    void processManager.stop();
  });
}

function handlersFor(webContents: WebContents, subscriptionId: string): JobEventHandlers {
  return {
    onEvent: (jobEvent) => {
      if (!webContents.isDestroyed()) {
        webContents.send("fast-sub-client:job-event", subscriptionId, jobEvent);
      }
    },
    onError: (error) => {
      if (!webContents.isDestroyed()) {
        webContents.send("fast-sub-client:job-error", subscriptionId, error);
      }
    }
  };
}

function handle(channel: string, fn: Parameters<typeof ipcMain.handle>[1]): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return await fn(event, ...args);
    } catch (error) {
      throw errorFromUnknown(error);
    }
  });
}

function normalizeSecretAlias(providerId: string, alias: unknown): string {
  const requested = String(alias || "").trim();
  if (providerId.startsWith("api-openai") && (!requested || requested === "openai-default")) {
    return providerId === "api-openai-chat" ? "FAST_SUB_OPENAI_CHAT_API_KEY" : "FAST_SUB_OPENAI_TRANSCRIPTION_API_KEY";
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(requested)) {
    return requested;
  }
  if (providerId.startsWith("api-openai")) {
    return providerId === "api-openai-chat" ? "FAST_SUB_OPENAI_CHAT_API_KEY" : "FAST_SUB_OPENAI_TRANSCRIPTION_API_KEY";
  }
  return `FAST_SUB_${providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
}

function normalizeFFmpegPackageManager(value: unknown): FFmpegPackageManager {
  if (value === "winget" || value === "choco") {
    return value;
  }
  return "scoop";
}
