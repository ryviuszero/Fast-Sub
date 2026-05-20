import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const desktopRoot = process.cwd();
const unpackedRoot = process.env.FAST_SUB_PACKAGED_ROOT || join(desktopRoot, "dist-release", "win-unpacked");
const appExe = join(unpackedRoot, "Fast Sub.exe");
const smokeRoot = join(desktopRoot, "test-results", "round13-native-deps");
const scenario = process.argv[2] || "all";

if (!existsSync(appExe)) {
  fail(`Missing packaged app executable: ${appExe}`);
}

const scenarios = scenario === "all" ? ["ffmpeg", "ffmpeg-no-aria2", "whisper-cpp"] : [scenario];
const results = [];

for (const item of scenarios) {
  const userData = join(smokeRoot, item);
  rmSync(userData, { recursive: true, force: true });
  mkdirSync(userData, { recursive: true });
  const checks = item.startsWith("ffmpeg") ? "ffmpeg" : item === "whisper-cpp" ? "whisper-cpp" : item;
  const result = spawnSync(appExe, [], {
    cwd: desktopRoot,
    encoding: "utf8",
    shell: false,
    env: {
      ...process.env,
      FAST_SUB_SMOKE_NATIVE_DEPS: "1",
      FAST_SUB_SMOKE_NATIVE_DEPS_CHECKS: checks,
      FAST_SUB_SMOKE_USER_DATA: resolve(userData),
      ...(item === "ffmpeg-no-aria2" ? { FAST_SUB_DISABLE_ARIA2_AUTO_INSTALL: "1" } : {})
    },
    timeout: 35 * 60 * 1000
  });
  const summary = parseSummary(result.stdout);
  results.push({ scenario: item, status: result.status, summary });
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

function parseSummary(stdout) {
  const line = stdout.split(/\r?\n/).find((candidate) => candidate.startsWith("FAST_SUB_SMOKE_NATIVE_DEPS "));
  if (!line) {
    return null;
  }
  return JSON.parse(line.replace("FAST_SUB_SMOKE_NATIVE_DEPS ", ""));
}

function redact(value) {
  return value
    .replace(/"token"\s*:\s*"[^"]+"/g, '"token":"[redacted]"')
    .replace(/Authorization:\s*Bearer\s+\S+/gi, "Authorization: Bearer [redacted]");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
