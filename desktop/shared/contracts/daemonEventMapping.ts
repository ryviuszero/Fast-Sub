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

function uiError(title: string, message: string, code: string, details?: Record<string, string | number | boolean>): UiError {
  return {
    code,
    title,
    message: redactSecretText(message),
    action: "查看诊断并重试",
    recoveryActions: ["retry", "open_diagnostics"],
    diagnostic: redactSecretText(`${code}: ${message}`),
    details
  };
}

function errorFromRecord(record: Record<string, unknown>): UiError {
  const nested = asRecord(record.error);
  const source = Object.keys(nested).length > 0 ? nested : record;
  const code = stringField(source, "code", "job_failed");
  const stage = stringField(source, "stage", "");
  const title = code === "ffmpeg_failed" && stage === "extract"
    ? "音频轨无法提取"
    : "生成失败";
  const details: Record<string, string | number | boolean> = {};
  if (stage) {
    details.stage = stage;
  }
  for (const [key, value] of Object.entries(asRecord(source.details))) {
    if (typeof value === "string") {
      details[key] = redactSecretText(value);
    } else if (typeof value === "number" || typeof value === "boolean") {
      details[key] = value;
    }
  }
  const message = stringField(source, "message", "任务失败");
  if (code === "output_exists" && details.output_path === undefined) {
    const outputPath = outputPathFromExistsMessage(message);
    if (outputPath) {
      details.output_path = outputPath;
    }
  }
  return uiError(title, message, code, details);
}

function outputFolderFor(path: string, fallback = ""): string {
  if (!path) {
    return fallback;
  }
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  if (index <= 0) {
    return fallback;
  }
  if (index === 2 && /^[A-Za-z]:[\\/]/.test(path)) {
    return path.slice(0, 3);
  }
  return path.slice(0, index);
}

function durationLabel(record: Record<string, unknown>): string {
  const explicit = stringField(record, "duration", "");
  if (explicit) {
    return explicit;
  }
  const elapsed = numberField(record, "elapsed_sec", 0);
  return elapsed > 0 ? `${Math.round(elapsed)} 秒` : "";
}

function outputPathFromExistsMessage(message: string): string {
  const match = /^output already exists:\s*(.+)$/i.exec(message.trim());
  return match?.[1] ?? "";
}

function jobFromRecord(record: Record<string, unknown>): JobDetail {
  const status = stringField(record, "status", "queued");
  const inputPath = stringField(record, "input_path", "");
  const outputPath = stringField(record, "output_path", "");
  const title = stringField(record, "title", inputPath.split(/[\\/]/).pop() || stringField(record, "current_file", "字幕任务"));
  return {
    id: stringField(record, "job_id", stringField(record, "id", "")),
    displayId: "任务",
    type: "transcribe",
    status: status === "running" || status === "succeeded" || status === "failed" || status === "canceled" || status === "interrupted" ? status : "queued",
    statusLabel: status === "succeeded" ? "已完成" : status === "failed" ? "已失败" : status === "canceled" ? "已取消" : "等待中",
    title,
    currentFile: stringField(record, "current_file", inputPath),
    progressPercent: numberField(record, "percent", 0),
    stageLabel: stringField(record, "stage_label", ""),
    createdAt: stringField(record, "created_at", ""),
    inputPaths: inputPath ? [inputPath] : [],
    outputDirectory: outputFolderFor(outputPath, ""),
    providerName: stringField(record, "provider", ""),
    modelName: stringField(record, "model", ""),
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
      {
        const outputPath = stringField(record, "subtitle_path", stringField(record, "output_path", ""));
        const outputFolder = stringField(record, "output_folder", outputFolderFor(outputPath, ""));
        return {
          type: "succeeded",
          result: {
            subtitlePath: outputPath,
            outputFolder,
            summary: stringField(record, "summary", "字幕已生成"),
            durationLabel: durationLabel(record),
            language: stringField(record, "language", "")
          }
        };
      }
    case "failed":
      return { type: "failed", error: errorFromRecord(record) };
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
