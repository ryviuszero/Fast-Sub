import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
const aria2VendorBinary = join(desktopRoot, "vendor", "aria2", target, process.platform === "win32" ? "aria2c.exe" : "aria2c");
const aria2ResourceDir = join(binDir, "aria2");
const aria2ResourceBinary = join(aria2ResourceDir, process.platform === "win32" ? "aria2c.exe" : "aria2c");
const aria2Win32X64SHA256 = "be2099c214f63a3cb4954b09a0becd6e2e34660b886d4c898d260febfe9d70c2";
const allowMissingPython = process.argv.includes("--allow-missing-python") || process.env.FAST_SUB_RELEASE_ALLOW_MISSING_PYTHON === "1";

mkdirSync(binDir, { recursive: true });

run("go", ["build", "-o", daemonOut, "./cmd/fast-sub-go"], repoRoot);
if (process.platform !== "win32") {
  chmodSync(daemonOut, 0o755);
}
prepareAria2Runtime();
checkPrivatePythonRuntime();
checkWhisperCPPRuntime();

console.log(`Prepared Go daemon: ${daemonOut}`);
console.log(`Prepared Python runtime: ${pythonRoot}`);
console.log(`Prepared whisper.cpp runtime: ${whisperCPPRoot}`);
if (existsSync(aria2ResourceBinary)) {
  console.log(`Prepared aria2 runtime: ${aria2ResourceBinary}`);
}

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

function prepareAria2Runtime() {
  if (!existsSync(aria2VendorBinary)) {
    if (process.platform === "win32") {
      console.error(
        [
          "Bundled aria2 runtime is missing; refusing to build a Windows package without the expected download accelerator resource.",
          `- missing aria2 binary: ${aria2VendorBinary}`,
          "Restore desktop/vendor/aria2/win32-x64/aria2c.exe before packaging."
        ].join("\n")
      );
      process.exit(1);
    }
    return;
  }
  if (process.platform === "win32" && process.arch === "x64") {
    const actual = sha256FileSync(aria2VendorBinary);
    if (actual !== aria2Win32X64SHA256) {
      console.error(
        [
          "Bundled aria2 runtime checksum mismatch; refusing to build with an unverified binary.",
          `- aria2 binary: ${aria2VendorBinary}`,
          `- expected sha256: ${aria2Win32X64SHA256}`,
          `- actual sha256:   ${actual}`
        ].join("\n")
      );
      process.exit(1);
    }
  }
  mkdirSync(aria2ResourceDir, { recursive: true });
  copyFileSync(aria2VendorBinary, aria2ResourceBinary);
  if (process.platform !== "win32") {
    chmodSync(aria2ResourceBinary, 0o755);
  }
}

function sha256FileSync(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex").toLowerCase();
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
