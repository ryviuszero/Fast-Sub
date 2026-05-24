import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { packagedLayout } from "./release-platform.mjs";

const desktopRoot = process.cwd();
const layout = packagedLayout(desktopRoot);
const smokeRoot = join(desktopRoot, "test-results", "round15-native-deps");
const scenario = process.argv[2] || "all";

if (!existsSync(layout.appExecutable)) {
  fail(`Missing packaged app executable: ${layout.appExecutable}`);
}

// Default scenarios are offline/deterministic and suitable for release smoke or CI-like
// validation after package:dir. `ffmpeg-install` intentionally performs a real network
// download and must stay a manual release-validation scenario.
const defaultScenarios = ["ffmpeg-missing", "ffmpeg-custom", "ffmpeg-app-private", "ffmpeg-system-path", "whisper-cpp"];
const scenarios = scenario === "all" ? defaultScenarios : [scenario];
const results = [];

for (const item of scenarios) {
  const userData = join(smokeRoot, item);
  rmSync(userData, { recursive: true, force: true });
  mkdirSync(userData, { recursive: true });
  const customBin = join(smokeRoot, `${item}-custom-bin`);
  const systemBin = join(smokeRoot, `${item}-system-bin`);
  const appPrivateBin = join(userData, "native-binaries", "ffmpeg", "bin");
  rmSync(customBin, { recursive: true, force: true });
  rmSync(systemBin, { recursive: true, force: true });
  if (item === "ffmpeg-custom") {
    createFakeFFmpegPair(customBin);
  }
  if (item === "ffmpeg-app-private") {
    createFakeFFmpegPair(appPrivateBin);
  }
  if (item === "ffmpeg-system-path") {
    createFakeFFmpegPair(systemBin);
  }
  const checks = checksForScenario(item);
  const result = spawnSync(layout.appExecutable, [], {
    cwd: desktopRoot,
    encoding: "utf8",
    shell: false,
    env: {
      ...process.env,
      FAST_SUB_SMOKE_NATIVE_DEPS: "1",
      FAST_SUB_SMOKE_NATIVE_DEPS_CHECKS: checks,
      FAST_SUB_SMOKE_USER_DATA: resolve(userData),
      ...(item === "ffmpeg-custom" ? { FAST_SUB_SMOKE_FFMPEG_BIN_DIR: resolve(customBin), FAST_SUB_IGNORE_SYSTEM_FFMPEG: "1" } : {}),
      ...(item === "ffmpeg-app-private" ? { FAST_SUB_IGNORE_SYSTEM_FFMPEG: "1" } : {}),
      ...(item === "ffmpeg-missing" ? { FAST_SUB_IGNORE_SYSTEM_FFMPEG: "1" } : {}),
      ...(item === "ffmpeg-system-path" ? pathEnvWith(systemBin) : {})
    },
    timeout: 35 * 60 * 1000
  });
  const summary = parseSummary(result.stdout);
  results.push({ scenario: item, status: result.status, summary });
  if (item.startsWith("ffmpeg-") && item !== "ffmpeg-install" && hasNativeDownloadArtifacts(userData)) {
    fail(`Detect-only smoke created native download artifacts for ${item}.`);
  }
  if (result.status !== 0 || !summary?.ok) {
    fail(
      [
        `Native dependency smoke failed: ${item}`,
        redact(result.stdout.trim()),
        redact(result.stderr.trim())
      ].filter(Boolean).join("\n")
    );
  }
}

console.log(`Native dependency smoke passed: ${JSON.stringify(results, null, 2)}`);

function checksForScenario(value) {
  if (value === "ffmpeg-install") {
    return "ffmpeg-install";
  }
  if (value === "whisper-cpp") {
    return "whisper-cpp";
  }
  return value;
}

function createFakeFFmpegPair(binDir) {
  mkdirSync(binDir, { recursive: true });
  const fakeSource = fakeExecutableSource();
  for (const name of executableNames()) {
    const target = join(binDir, name);
    copyFileSync(fakeSource, target);
    try {
      chmodSync(target, 0o755);
    } catch {
      // Windows ignores POSIX mode bits.
    }
  }
}

function fakeExecutableSource() {
  const out = join(smokeRoot, process.platform === "win32" ? "fake-version.exe" : "fake-version");
  if (existsSync(out)) {
    return out;
  }
  const source = join(smokeRoot, "fake-version.go");
  writeFileSync(source, "package main\n\nimport \"fmt\"\n\nfunc main() { fmt.Println(\"ffmpeg version smoke\") }\n", "utf8");
  const built = spawnSync("go", ["build", "-o", out, source], {
    cwd: desktopRoot,
    encoding: "utf8",
    shell: false
  });
  if (built.status !== 0 || !existsSync(out)) {
    fail(`Failed to build fake FFmpeg binary for smoke.\n${built.stdout}\n${built.stderr}`);
  }
  try {
    chmodSync(out, 0o755);
  } catch {
    // Windows ignores POSIX mode bits.
  }
  return out;
}

function executableNames() {
  return process.platform === "win32" ? ["ffmpeg.exe", "ffprobe.exe"] : ["ffmpeg", "ffprobe"];
}

function pathEnvWith(binDir) {
  const current = process.env.Path ?? process.env.PATH ?? "";
  const separator = process.platform === "win32" ? ";" : ":";
  const entries = [resolve(binDir)];
  if (process.platform === "win32") {
    entries.push(dirname(layout.appExecutable));
  }
  if (current) {
    entries.push(current);
  }
  const next = entries.join(separator);
  return process.platform === "win32" ? { Path: next, PATH: next } : { PATH: next };
}

function hasNativeDownloadArtifacts(userData) {
  const root = join(userData, "native-binaries");
  if (!existsSync(root)) {
    return false;
  }
  const entries = listFiles(root);
  return entries.some((entry) => /staging-|\.zip$|source\.txt$|download-manifest\.json$/i.test(entry));
}

function listFiles(root) {
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    out.push(path);
    if (entry.isDirectory()) {
      out.push(...listFiles(path));
    }
  }
  return out;
}

function parseSummary(stdout) {
  const line = stdout.split(/\r?\n/).find((candidate) => candidate.startsWith("FAST_SUB_SMOKE_NATIVE_DEPS "));
  if (!line) {
    return null;
  }
  return JSON.parse(line.replace("FAST_SUB_SMOKE_NATIVE_DEPS ", ""));
}

function redact(value) {
  return value
    .replaceAll(resolve(desktopRoot), "[redacted-desktop-root]")
    .replaceAll(resolve(smokeRoot), "[redacted-smoke-root]")
    .replace(/"token"\s*:\s*"[^"]+"/g, '"token":"[redacted]"')
    .replace(/Authorization:\s*Bearer\s+\S+/gi, "Authorization: Bearer [redacted]");
}

function fail(message) {
  console.error(redact(message));
  process.exit(1);
}
