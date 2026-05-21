import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const desktopRoot = process.cwd();
const repoRoot = resolve(desktopRoot, "..");
const target = `${process.platform}-${process.arch}`;
const pythonVersion = process.env.FAST_SUB_RELEASE_PYTHON_VERSION || "3.11.15";
const managedInstallDir = join(repoRoot, ".uv-python");
const runtimeRoot = join(desktopRoot, "resources", "python", target);
const pythonExe = process.platform === "win32" ? join(runtimeRoot, "python.exe") : join(runtimeRoot, "bin", "python");
const scriptsDir = process.platform === "win32" ? join(runtimeRoot, "Scripts") : join(runtimeRoot, "bin");

if (!/^\d+\.\d+\.\d+$/.test(pythonVersion)) {
  console.error(
    `FAST_SUB_RELEASE_PYTHON_VERSION must pin an exact patch version, for example 3.11.15; got ${pythonVersion}`
  );
  process.exit(1);
}

const platformInstallName = managedPythonInstallName(pythonVersion);

if (!platformInstallName) {
  console.error(
    `prepare-python-runtime supports win32-x64 and darwin-arm64 release hosts; got ${target}.`
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
materializeExternalSymlinks(runtimeRoot);

run("uv", [
  "pip",
  "install",
  "--python",
  pythonExe,
  "--system",
  "--break-system-packages",
  "--compile-bytecode",
  "--link-mode",
  "copy",
  ".[local-asr,local-translate]"
]);

if (process.platform === "win32") {
  verify(join(scriptsDir, "fast-sub.exe"), ["--help"]);
  verify(join(scriptsDir, "fast-sub-worker-faster-whisper.exe"), ["--help"]);
}
verify(pythonExe, ["-m", "fast_sub.app", "--help"]);
verify(pythonExe, ["-m", "fast_sub_workers.faster_whisper", "--help"]);
verify(pythonExe, [
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

function managedPythonInstallName(version) {
  if (process.platform === "win32" && process.arch === "x64") {
    return `cpython-${version}-windows-x86_64-none`;
  }
  if (process.platform === "darwin" && process.arch === "arm64") {
    return `cpython-${version}-macos-aarch64-none`;
  }
  return null;
}

function materializeExternalSymlinks(root) {
  const rootReal = realpathSync(root);
  for (const entry of walk(root)) {
    const stat = lstatSync(entry);
    if (!stat.isSymbolicLink()) {
      continue;
    }
    const rawTarget = readlinkSync(entry);
    const target = isAbsolute(rawTarget) ? rawTarget : resolve(dirname(entry), rawTarget);
    const targetReal = realpathSync(target);
    if (targetReal.startsWith(`${rootReal}/`)) {
      continue;
    }
    rmSync(entry);
    cpSync(targetReal, entry, { recursive: true });
  }
}

function walk(root) {
  const entries = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    entries.push(path);
    if (lstatSync(path).isDirectory()) {
      entries.push(...walk(path));
    }
  }
  return entries;
}
