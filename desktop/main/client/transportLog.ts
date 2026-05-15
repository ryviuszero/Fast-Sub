import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { redactSecretText } from "../../shared/privacy/redaction";

type TransportLogConfig = {
  enabled: boolean;
  logFile?: string;
  mirrorConsole: boolean;
};

let warnedFileWrite = false;
const config = loadTransportLogConfig();

export function daemonTransportLog(event: string, fields: Record<string, unknown> = {}): void {
  if (!config.enabled) {
    return;
  }
  const safeFields = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, redactValue(key, value)])
  );
  const line = `[fast-sub-daemon] ${new Date().toISOString()} ${event} ${JSON.stringify(safeFields)}`;
  if (config.mirrorConsole) {
    console.log(line);
  }
  if (config.logFile) {
    writeLogFile(config.logFile, line);
  }
}

function loadTransportLogConfig(): TransportLogConfig {
  const fileConfig = readConfigFile();
  const envEnabled = process.env.FAST_SUB_DEBUG_DAEMON;
  const enabled = envEnabled === "1" || (envEnabled === undefined && fileConfig.enabled === true);
  const logFile = process.env.FAST_SUB_DEBUG_DAEMON_LOG
    ? resolve(process.env.FAST_SUB_DEBUG_DAEMON_LOG)
    : fileConfig.logFile;
  const mirrorConsole = process.env.FAST_SUB_DEBUG_DAEMON_CONSOLE === "1" || fileConfig.mirrorConsole === true || (envEnabled === "1" && !logFile);
  return { enabled, logFile, mirrorConsole };
}

function readConfigFile(): Partial<TransportLogConfig> {
  const explicit = process.env.FAST_SUB_DEBUG_DAEMON_CONFIG;
  const candidates = explicit ? [resolve(explicit)] : [join(process.cwd(), "local", "daemon-debug.json")];
  const configPath = candidates.find((candidate) => existsSync(candidate));
  if (!configPath) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    const logFileValue = typeof record.logFile === "string" && record.logFile.length > 0
      ? resolveLogFile(configPath, record.logFile)
      : undefined;
    return {
      enabled: record.enabled === true,
      logFile: logFileValue,
      mirrorConsole: record.mirrorConsole === true
    };
  } catch {
    return {};
  }
}

function resolveLogFile(configPath: string, value: string): string {
  return isAbsolute(value) ? value : resolve(dirname(configPath), value);
}

function writeLogFile(path: string, line: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${line}\n`, "utf8");
  } catch (error) {
    if (!warnedFileWrite) {
      warnedFileWrite = true;
      console.warn(`[fast-sub-daemon] transport log file write failed: ${redactSecretText(error instanceof Error ? error.message : String(error))}`);
    }
  }
}

function redactValue(key: string, value: unknown): unknown {
  const lower = key.toLowerCase();
  if (lower.includes("token") || lower.includes("authorization") || lower.includes("secret") || lower.includes("key")) {
    return "[REDACTED]";
  }
  if (typeof value === "string") {
    return redactSecretText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(key, item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [childKey, redactValue(childKey, childValue)])
    );
  }
  return value;
}
