import type { JobDetail, JobEvent, JobLogEntry, UiError } from "./types";
import { redactSecretText } from "../privacy/redaction";

export type DaemonEventType =
  | "created"
  | "queued"
  | "started"
  | "progress"
  | "log"
  | "warning"
  | "completed"
  | "failed"
  | "canceled"
  | "interrupted"
  | "events_lost"
  | "heartbeat";

export interface DaemonEventFixture {
  event: DaemonEventType;
  data: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringField(record: Record<string, unknown>, key: string, fallback = ""): string {
  const value = record[key];
  return typeof value === "string" ? redactSecretText(value) : fallback;
}

function numberField(record: Record<string, unknown>, key: string, fallback = 0): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function uiError(title: string, message: string, code: string): UiError {
  return {
    code,
    title,
    message: redactSecretText(message),
    action: "查看诊断并重试",
    recoveryActions: ["retry", "open_diagnostics"],
    diagnostic: redactSecretText(`${code}: ${message}`)
  };
}

function jobFromRecord(record: Record<string, unknown>): JobDetail {
  const status = stringField(record, "status", "queued");
  return {
    id: "redacted-job",
    displayId: "任务",
    type: "transcribe",
    status: status === "running" || status === "succeeded" || status === "failed" || status === "canceled" || status === "interrupted" ? status : "queued",
    statusLabel: status === "succeeded" ? "已完成" : status === "failed" ? "已失败" : status === "canceled" ? "已取消" : "等待中",
    title: stringField(record, "title", "字幕生成任务"),
    currentFile: stringField(record, "current_file", "已选择的媒体"),
    progressPercent: numberField(record, "percent", 0),
    stageLabel: stringField(record, "stage_label", "等待开始"),
    createdAt: stringField(record, "created_at", "刚刚"),
    inputPaths: [stringField(record, "input_path", "C:\\Users\\Example\\Videos\\a b.mp4")],
    outputDirectory: stringField(record, "output_path", "C:\\Users\\Example\\Videos"),
    providerName: "本地转写",
    modelName: "Whisper Small",
    logs: []
  };
}

export function mapDaemonEventToJobEvent(fixture: DaemonEventFixture): JobEvent | null {
  const record = asRecord(fixture.data);
  switch (fixture.event) {
    case "created":
    case "queued":
      return { type: "snapshot", job: jobFromRecord(record) };
    case "started":
    case "progress":
      return {
        type: "progress",
        progress: {
          status: "running",
          progressPercent: numberField(record, "percent", fixture.event === "started" ? 3 : 0),
          stageLabel: stringField(record, "stage_label", "正在生成字幕"),
          currentFile: stringField(record, "current_file", "已选择的媒体"),
          estimatedRemaining: stringField(record, "eta", "")
        }
      };
    case "log": {
      const entry: JobLogEntry = {
        time: stringField(record, "time", "now"),
        level: "info",
        message: stringField(record, "message", "日志已更新")
      };
      return { type: "log_tail", logs: [entry] };
    }
    case "warning": {
      const warning = stringField(record, "message", "有一个非阻断提醒");
      return {
        type: "progress",
        progress: {
          status: "running",
          progressPercent: numberField(record, "percent", 50),
          stageLabel: "正在生成字幕",
          currentFile: stringField(record, "current_file", "已选择的媒体"),
          warning
        },
        logs: [{ time: stringField(record, "time", "now"), level: "warning", message: warning }]
      };
    }
    case "completed":
      return {
        type: "succeeded",
        result: {
          subtitlePath: stringField(record, "subtitle_path", "C:\\Users\\Example\\Videos\\a b.srt"),
          outputFolder: stringField(record, "output_folder", "C:\\Users\\Example\\Videos"),
          summary: "字幕已生成",
          durationLabel: stringField(record, "duration", "00:42")
        }
      };
    case "failed":
      return { type: "failed", error: uiError("生成失败", stringField(record, "message", "任务失败"), stringField(record, "code", "job_failed")) };
    case "canceled":
      return { type: "canceled" };
    case "interrupted":
      return { type: "failed", error: uiError("服务中断", stringField(record, "message", "本地服务中断"), "daemon_interrupted") };
    case "events_lost":
      return { type: "events_lost" };
    case "heartbeat":
      return null;
    default:
      return null;
  }
}
