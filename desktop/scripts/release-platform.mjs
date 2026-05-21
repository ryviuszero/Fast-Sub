import { existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

export function releaseTarget() {
  return `${process.platform}-${process.arch}`;
}

export function defaultUnpackedRoot(desktopRoot) {
  if (process.platform === "darwin") {
    return join(desktopRoot, "dist-release", `mac-${process.arch}`);
  }
  if (process.platform === "win32") {
    return join(desktopRoot, "dist-release", "win-unpacked");
  }
  return join(desktopRoot, "dist-release", `linux-${process.arch}-unpacked`);
}

export function packagedLayout(desktopRoot) {
  const unpackedRoot = process.env.FAST_SUB_PACKAGED_ROOT || defaultUnpackedRoot(desktopRoot);
  const macAppRoot =
    process.platform === "darwin"
      ? unpackedRoot.endsWith(".app")
        ? unpackedRoot
        : join(unpackedRoot, "Fast Sub.app")
      : null;
  const appExecutable =
    process.platform === "darwin"
      ? join(macAppRoot, "Contents", "MacOS", "Fast Sub")
      : process.platform === "win32"
        ? join(unpackedRoot, "Fast Sub.exe")
        : join(unpackedRoot, "fast-sub-desktop");
  const resourcesRoot =
    process.platform === "darwin"
      ? join(macAppRoot, "Contents", "Resources")
      : join(unpackedRoot, "resources");
  const target = releaseTarget();
  const daemonExecutable = process.platform === "win32" ? "fast-sub-go.exe" : "fast-sub-go";
  const pythonExecutable = process.platform === "win32" ? "python.exe" : "python";
  const cliExecutable = process.platform === "win32" ? "fast-sub.exe" : "fast-sub";
  const workerExecutable =
    process.platform === "win32" ? "fast-sub-worker-faster-whisper.exe" : "fast-sub-worker-faster-whisper";
  const pythonRoot = join(resourcesRoot, "python", target);
  const pythonBin = process.platform === "win32" ? pythonRoot : join(pythonRoot, "bin");
  const pythonScripts = process.platform === "win32" ? join(pythonRoot, "Scripts") : join(pythonRoot, "bin");
  return {
    target,
    unpackedRoot,
    appExecutable,
    resourcesRoot,
    daemonExecutable: join(resourcesRoot, "bin", target, daemonExecutable),
    pythonRoot,
    pythonExecutable: join(pythonBin, pythonExecutable),
    fastSubCli: join(pythonScripts, cliExecutable),
    sttWorker: join(pythonScripts, workerExecutable),
    pythonBin,
    pythonScripts
  };
}

export function packagedRuntimeEnv(layout, extra = {}) {
  const separator = process.platform === "win32" ? ";" : ":";
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const currentPath = process.env[pathKey] || process.env.PATH || "";
  const pathDirs = [layout.pythonScripts, layout.pythonBin].filter((dir) => existsSync(dir));
  const pythonCommand = quoteCommand(layout.pythonExecutable);
  const nextPath = [pathDirs.join(separator), currentPath].filter(Boolean).join(separator);
  return {
    ...process.env,
    FAST_SUB_PACKAGED_RUNTIME_ONLY: "1",
    FAST_SUB_PYTHON: pythonCommand,
    FAST_SUB_PYTHON_CLI: `${pythonCommand} -m fast_sub.app`,
    FAST_SUB_STT_WORKER_COMMAND: `${pythonCommand} -m fast_sub_workers.faster_whisper`,
    [pathKey]: nextPath,
    ...extra
  };
}

export function assertLayoutExists(layout, entries) {
  const missing = entries.filter(([path]) => !existsSync(path));
  if (missing.length > 0) {
    throw new Error(missing.map(([path, label]) => `Missing ${label}: ${path}`).join("\n"));
  }
}

function quoteCommand(value) {
  return value.includes(" ") ? `"${value}"` : value;
}
