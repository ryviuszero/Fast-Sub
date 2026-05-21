import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const desktopRoot = process.cwd();
const repoRoot = resolve(desktopRoot, "..");
const target = `${process.platform}-${process.arch}`;
const binDir = join(desktopRoot, "resources", "bin", target);
const daemonName = process.platform === "win32" ? "fast-sub-go.exe" : "fast-sub-go";
const daemonOut = join(binDir, daemonName);
const pythonRoot = join(desktopRoot, "resources", "python", target);
const pythonScripts = process.platform === "win32" ? join(pythonRoot, "Scripts") : join(pythonRoot, "bin");
const pythonCli = join(pythonScripts, process.platform === "win32" ? "fast-sub.exe" : "fast-sub");
const sttWorker = join(pythonScripts, process.platform === "win32" ? "fast-sub-worker-faster-whisper.exe" : "fast-sub-worker-faster-whisper");
const pythonExe = process.platform === "win32" ? join(pythonRoot, "python.exe") : join(pythonRoot, "bin", "python");
const whisperCPPRoot = join(binDir, "whisper-cpp");
const whisperCPPBinary = join(whisperCPPRoot, process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli");
const allowMissingPython = process.argv.includes("--allow-missing-python") || process.env.FAST_SUB_RELEASE_ALLOW_MISSING_PYTHON === "1";

mkdirSync(binDir, { recursive: true });

run("go", ["build", "-o", daemonOut, "./cmd/fast-sub-go"], repoRoot);
if (process.platform !== "win32") {
  chmodSync(daemonOut, 0o755);
}
checkPrivatePythonRuntime();
checkWhisperCPPRuntime();

console.log(`Prepared Go daemon: ${daemonOut}`);
console.log(`Prepared Python runtime: ${pythonRoot}`);
console.log(`Prepared whisper.cpp runtime: ${whisperCPPRoot}`);

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      GOCACHE: process.env.GOCACHE || join(desktopRoot, ".gocache-release")
    }
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function checkWhisperCPPRuntime() {
  if (!existsSync(whisperCPPBinary)) {
    console.error(
      [
        "App-private whisper.cpp runtime is missing; refusing to build a release package that depends on user-installed whisper.cpp.",
        `- missing whisper.cpp binary: ${whisperCPPBinary}`,
        "Run `npm run prepare:whisper-cpp-runtime` before packaging."
      ].join("\n")
    );
    process.exit(1);
  }
  if (process.platform !== "win32") {
    chmodSync(whisperCPPBinary, 0o755);
  }
}

function checkPrivatePythonRuntime() {
  const missing = [
    [pythonRoot, "python runtime root"],
    [pythonExe, "Python executable"],
    ...(process.platform === "win32"
      ? [
          [pythonCli, "fast-sub Python CLI entry"],
          [sttWorker, "faster-whisper worker entry"]
        ]
      : [])
  ].filter(([path]) => !existsSync(path));
  if (missing.length === 0) {
    return;
  }
  const message = [
    "App-private Python runtime is missing; refusing to build a release package that depends on system Python/uv/global fast-sub.",
    ...missing.map(([path, label]) => `- missing ${label}: ${path}`),
    "Prepare desktop/resources/python/<platform>-<arch>/ with the portable Python runtime and installed Fast Sub scripts, or set FAST_SUB_RELEASE_ALLOW_MISSING_PYTHON=1 only for shell-only packaging diagnostics."
  ].join("\n");
  if (allowMissingPython) {
    console.warn(message);
    return;
  }
  console.error(message);
  process.exit(1);
}
