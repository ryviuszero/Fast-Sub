import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const desktopRoot = process.cwd();
const repoRoot = resolve(desktopRoot, "..");
const target = `${process.platform}-${process.arch}`;
const pythonVersion = process.env.FAST_SUB_RELEASE_PYTHON_VERSION || "3.11.15";
const managedInstallDir = join(repoRoot, ".uv-python");
const runtimeRoot = join(desktopRoot, "resources", "python", target);

if (!/^\d+\.\d+\.\d+$/.test(pythonVersion)) {
  console.error(
    `FAST_SUB_RELEASE_PYTHON_VERSION must pin an exact patch version, for example 3.11.15; got ${pythonVersion}`
  );
  process.exit(1);
}

const platformInstallName =
  process.platform === "win32" && process.arch === "x64"
    ? `cpython-${pythonVersion}-windows-x86_64-none`
    : null;

if (!platformInstallName) {
  console.error(
    `prepare-python-runtime currently supports win32-x64 only; ${target} must be prepared on its release host.`
  );
  process.exit(1);
}

run("uv", [
  "python",
  "install",
  pythonVersion,
  "--install-dir",
  managedInstallDir,
  "--no-bin",
  "--no-registry",
  "--managed-python"
]);

const managedRuntime = join(managedInstallDir, platformInstallName);
if (!existsSync(managedRuntime)) {
  console.error(`uv did not produce the expected managed Python runtime: ${managedRuntime}`);
  process.exit(1);
}

rmSync(runtimeRoot, { recursive: true, force: true });
mkdirSync(join(runtimeRoot, ".."), { recursive: true });
cpSync(managedRuntime, runtimeRoot, { recursive: true });

run("uv", [
  "pip",
  "install",
  "--python",
  join(runtimeRoot, "python.exe"),
  "--system",
  "--break-system-packages",
  "--compile-bytecode",
  "--link-mode",
  "copy",
  ".[local-asr,local-translate]"
]);

verify(join(runtimeRoot, "Scripts", "fast-sub.exe"), ["--help"]);
verify(join(runtimeRoot, "Scripts", "fast-sub-worker-faster-whisper.exe"), ["--help"]);
verify(join(runtimeRoot, "python.exe"), ["-m", "fast_sub.app", "--help"]);
verify(join(runtimeRoot, "python.exe"), ["-m", "fast_sub_workers.faster_whisper", "--help"]);
verify(join(runtimeRoot, "python.exe"), [
  "-c",
  "import fast_sub, faster_whisper, ctranslate2, sentencepiece; print('ok')"
]);

console.log(`Prepared app-private Python runtime: ${runtimeRoot}`);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      UV_CACHE_DIR: process.env.UV_CACHE_DIR || join(repoRoot, ".uv-cache")
    }
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function verify(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
