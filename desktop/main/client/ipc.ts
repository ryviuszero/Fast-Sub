import { app, ipcMain, type WebContents } from "electron";
import { join } from "node:path";
import type { CreateJobRequest, JobEventHandlers } from "../../shared/contracts/types";
import { DaemonProcessManager } from "./daemonProcess";
import { MainDaemonFastSubClient } from "./daemonClient";
import { errorFromUnknown } from "./uiError";

const processManager = new DaemonProcessManager();
const client = new MainDaemonFastSubClient(processManager);
const subscriptions = new Map<string, () => void>();

export function registerFastSubClientIpc(): void {
  handle("fast-sub-client:health", () => client.health());
  handle("fast-sub-client:version", () => client.version());
  handle("fast-sub-client:get-environment-status", () => client.getEnvironmentStatus());
  handle("fast-sub-client:repair-daemon", () => client.repairDaemon());
  handle("fast-sub-client:get-config", () => client.getConfig());
  handle("fast-sub-client:update-config", (_event, patch: unknown) => client.updateConfig(patch as Parameters<typeof client.updateConfig>[0]));
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

export const secretStorePath = join(app.getPath("userData"), "provider-secrets");
