import { describe, expect, it, vi } from "vitest";
import { MockFastSubClient } from "../renderer/src/client/MockFastSubClient";
import { mockPaths } from "../renderer/src/client/mockFixtures";

describe("MockFastSubClient", () => {
  it("reports a ready setup by default", async () => {
    const client = new MockFastSubClient("setupReady");
    const env = await client.getEnvironmentStatus();
    expect(env.localTranscriptionReady).toBe(true);
    expect(env.daemonReady).toBe(true);
  });

  it("marks missing ASR as blocking the main flow", async () => {
    const client = new MockFastSubClient("missingAsr");
    const models = await client.listModels();
    expect(models.find((model) => model.id === "whisper-small")?.state).toBe("missing");
  });

  it("marks failed ASR installation as blocking the main flow", async () => {
    const client = new MockFastSubClient("modelInstallFailed");
    const models = await client.listModels();
    const env = await client.getEnvironmentStatus();
    expect(models.find((model) => model.id === "whisper-small")?.state).toBe("failed");
    expect(env.localTranscriptionReady).toBe(false);
  });

  it("keeps NLLB install failure non-blocking for transcription", async () => {
    const client = new MockFastSubClient("nllbInstallFailed");
    const env = await client.getEnvironmentStatus();
    expect(env.localTranscriptionReady).toBe(true);
    expect(env.localTranslationReady).toBe(false);
  });

  it("returns unsubscribe from job event subscriptions", async () => {
    const client = new MockFastSubClient("jobSuccess");
    const job = await client.createJob({
      type: "transcribe",
      inputPaths: [mockPaths.spaced],
      outputDirectory: mockPaths.output,
      outputType: "original_srt",
      language: "auto",
      providerId: "local-faster-whisper",
      modelId: "whisper-small",
      remoteUploadConfirmed: false
    });
    vi.useFakeTimers();
    const events: string[] = [];
    const unsubscribe = client.subscribeJobEvents(job.id, { onEvent: (event) => events.push(event.type) });
    vi.advanceTimersByTime(80);
    unsubscribe();
    vi.advanceTimersByTime(1000);
    expect(events).toEqual(["snapshot", "progress"]);
    vi.useRealTimers();
  });

  it("moves cancel requests through a canceling state", async () => {
    const client = new MockFastSubClient("jobSuccess");
    const job = await client.createJob({
      type: "transcribe",
      inputPaths: [mockPaths.spaced],
      outputDirectory: mockPaths.output,
      outputType: "original_srt",
      language: "auto",
      providerId: "local-faster-whisper",
      modelId: "whisper-small",
      remoteUploadConfirmed: false
    });
    const canceling = await client.cancelJob(job.id);
    expect(canceling.status).toBe("canceling");
  });

  it("creates model installation as a job", async () => {
    const client = new MockFastSubClient("setupReady");
    const job = await client.createModelInstallJob("whisper-small");
    expect(job.type).toBe("model_install");
    expect(job.title).toContain("Whisper Small");
    const models = await client.listModels();
    expect(models.find((model) => model.id === "whisper-small")?.installJobId).toBe(job.id);
  });

  it("blocks remote providers until upload is confirmed", async () => {
    vi.useRealTimers();
    const client = new MockFastSubClient("remoteProviderConfirmRequired");
    await expect(client.createJob({
      type: "transcribe",
      inputPaths: [mockPaths.spaced],
      outputDirectory: mockPaths.output,
      outputType: "original_srt",
      language: "auto",
      providerId: "api-openai-transcription",
      modelId: "whisper-small",
      remoteUploadConfirmed: false
    })).rejects.toThrow("remote upload confirmation required");
  });
});
