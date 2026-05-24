import { app } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type RuntimeCommands = {
  python?: string;
  pythonCli?: string;
  sttWorker?: string;
  pathDirs: string[];
};

export type WebTranslateHelperRuntime = {
  command: string;
  args: string[];
  electronRunAsNode: boolean;
};

export function platformArchName(): string {
  return `${process.platform}-${process.arch}`;
}

export function appResourcePath(...segments: string[]): string {
  const root = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), "resources");
  return join(root, ...segments);
}

export function packagedDaemonPath(): string | null {
  const executable = process.platform === "win32" ? "fast-sub-go.exe" : "fast-sub-go";
  const candidate = appResourcePath("bin", platformArchName(), executable);
  return existsSync(candidate) ? candidate : null;
}

export function privatePythonRuntimeCommands(): RuntimeCommands {
  const root = appResourcePath("python", platformArchName());
  const scriptsDir = process.platform === "win32" ? join(root, "Scripts") : join(root, "bin");
  const pythonDir = process.platform === "win32" ? root : join(root, "bin");
  const cliName = process.platform === "win32" ? "fast-sub.exe" : "fast-sub";
  const workerName = process.platform === "win32" ? "fast-sub-worker-faster-whisper.exe" : "fast-sub-worker-faster-whisper";
  const pythonName = process.platform === "win32" ? "python.exe" : "python";
  const python = join(pythonDir, pythonName);
  const cli = join(scriptsDir, cliName);
  const worker = join(scriptsDir, workerName);
  const pathDirs = [scriptsDir, pythonDir].filter((dir) => existsSync(dir));
  const pythonCommand = existsSync(python) ? quoteCommand(python) : undefined;
  return {
    python: pythonCommand,
    pythonCli: pythonCommand ? `${pythonCommand} -m fast_sub.app` : existsSync(cli) ? quoteCommand(cli) : undefined,
    sttWorker: pythonCommand ? `${pythonCommand} -m fast_sub_workers.faster_whisper` : existsSync(worker) ? quoteCommand(worker) : undefined,
    pathDirs
  };
}

export function webTranslateHelperRuntime(): WebTranslateHelperRuntime | null {
  const helper = resolveWebTranslateHelperPath();
  if (!existsSync(helper)) {
    return null;
  }
  return {
    command: process.execPath,
    args: [helper],
    electronRunAsNode: true
  };
}

function resolveWebTranslateHelperPath(): string {
  const packagedHelper = appResourcePath("web-translate-helper", "cli.mjs");
  if (existsSync(packagedHelper) || app.isPackaged) {
    return packagedHelper;
  }
  return join(app.getAppPath(), "web-translate-helper", "cli.mjs");
}

export function prependPathDirs(env: NodeJS.ProcessEnv, dirs: string[]): NodeJS.ProcessEnv {
  const separator = process.platform === "win32" ? ";" : ":";
  const current = env.Path ?? env.PATH ?? "";
  const existing = current.toLowerCase().split(separator).filter(Boolean);
  const missing = dirs.filter((dir) => !existing.includes(dir.toLowerCase()));
  if (missing.length === 0) {
    return env;
  }
  const next = current ? `${missing.join(separator)}${separator}${current}` : missing.join(separator);
  env.Path = next;
  env.PATH = next;
  return env;
}

function quoteCommand(value: string): string {
  return value.includes(" ") ? `"${value}"` : value;
}
