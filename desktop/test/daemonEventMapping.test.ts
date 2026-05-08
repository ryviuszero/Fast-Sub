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

  it("does not leak tokens, Authorization, API keys, or raw JSON envelope", () => {
    const serialized = JSON.stringify(fixtures.map(mapDaemonEventToJobEvent));
    expect(containsSecret(serialized)).toBe(false);
    expect(serialized).not.toContain("schema_version");
    expect(serialized).not.toContain("Authorization: Bearer raw-token");
    expect(serialized).not.toContain("sk-secret");
  });
});
