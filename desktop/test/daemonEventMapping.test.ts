import { describe, expect, it } from "vitest";
import { containsSecret } from "../shared/privacy/redaction";
import { mapDaemonEventToJobEvent, type DaemonEventFixture } from "../shared/contracts/daemonEventMapping";

const fixtures: DaemonEventFixture[] = [
  { event: "created", data: { status: "created", title: "clip.mp4", token: "secret" } },
  { event: "queued", data: { status: "queued", percent: 0 } },
  { event: "started", data: { percent: 2, stage_label: "正在检查文件" } },
  { event: "progress", data: { percent: 55, stage_label: "正在转写音频", current_file: "C:\\media\\clip.mp4" } },
  { event: "log", data: { message: "Authorization: Bearer raw-token sk-secret", time: "10:00" } },
  { event: "warning", data: { message: "signed url https://example.test/a?signature=abc", percent: 60 } },
  { event: "completed", data: { subtitle_path: "C:\\media\\clip.srt", output_folder: "C:\\media" } },
  { event: "failed", data: { code: "provider_error", message: "api_key='sk-secret'" } },
  { event: "canceled", data: {} },
  { event: "interrupted", data: { message: "token raw-secret" } },
  { event: "events_lost", data: {} },
  { event: "heartbeat", data: {} }
];

describe("daemon event mapping fixture", () => {
  it("maps daemon SSE events into UI JobEvent types", () => {
    const mapped = fixtures.map(mapDaemonEventToJobEvent);
    expect(mapped.map((event) => event?.type ?? "ignored")).toEqual([
      "snapshot",
      "snapshot",
      "progress",
      "progress",
      "log_tail",
      "progress",
      "succeeded",
      "failed",
      "canceled",
      "failed",
      "events_lost",
      "ignored"
    ]);
  });

  it("maps Go daemon completed results from output_path", () => {
    const mapped = mapDaemonEventToJobEvent({
      event: "completed",
      data: {
        input_path: "C:\\media\\en-podcast-10m.wav",
        output_path: "C:\\media\\en-podcast-10m.srt",
        elapsed_sec: 17.8,
        provider: "local-faster-whisper",
        model: "whisper-small"
      }
    });
    expect(mapped?.type).toBe("succeeded");
    if (mapped?.type !== "succeeded") {
      throw new Error("expected succeeded event");
    }
    expect(mapped.result).toBeDefined();
    if (!mapped.result) {
      throw new Error("expected result");
    }
    expect(mapped.result.subtitlePath).toBe("C:\\media\\en-podcast-10m.srt");
    expect(mapped.result.outputFolder).toBe("C:\\media");
    expect(mapped.result.durationLabel).toBe("18 秒");
  });

  it("does not inject placeholder paths for minimal queue events", () => {
    const mapped = mapDaemonEventToJobEvent({ event: "queued", data: { status: "queued" } });
    expect(mapped?.type).toBe("snapshot");
    if (mapped?.type !== "snapshot" || !mapped.job) {
      throw new Error("expected snapshot event");
    }
    expect(mapped.job.outputDirectory).toBe("");
    expect(mapped.job.inputPaths).toEqual([]);
    expect(JSON.stringify(mapped)).not.toContain("C:\\Users\\Example");
  });

  it("extracts output_exists target path into error details", () => {
    const mapped = mapDaemonEventToJobEvent({
      event: "failed",
      data: {
        status: "failed",
        error: {
          code: "output_exists",
          stage: "rendering",
          message: "output already exists: F:\\game\\others\\input.srt",
          details: {}
        }
      }
    });
    expect(mapped?.type).toBe("failed");
    if (mapped?.type !== "failed") {
      throw new Error("expected failed event");
    }
    expect(mapped.error).toBeDefined();
    if (!mapped.error) {
      throw new Error("expected error");
    }
    expect(mapped.error.details?.output_path).toBe("F:\\game\\others\\input.srt");
  });

  it("does not leak tokens, Authorization, API keys, or raw JSON envelope", () => {
    const serialized = JSON.stringify(fixtures.map(mapDaemonEventToJobEvent));
    expect(containsSecret(serialized)).toBe(false);
    expect(serialized).not.toContain("schema_version");
    expect(serialized).not.toContain("Authorization: Bearer raw-token");
    expect(serialized).not.toContain("sk-secret");
  });
});
