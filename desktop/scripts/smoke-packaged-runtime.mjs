import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import process from "node:process";
import { assertLayoutExists, packagedLayout, packagedRuntimeEnv } from "./release-platform.mjs";

const desktopRoot = process.cwd();
const layout = packagedLayout(desktopRoot);
const daemonSmokeRoot = join(desktopRoot, "test-results", "round13-packaged-daemon");
const daemonRepairSmokeRoot = join(desktopRoot, "test-results", "round13-daemon-repair");

try {
  assertLayoutExists(layout, [
    [layout.appExecutable, "packaged app executable"],
    [join(layout.resourcesRoot, "app.asar"), "app.asar"],
    [layout.webTranslateHelper, "packaged web translation helper"],
    [join(layout.resourcesRoot, "web-translate-helper", "node_modules", "bing-translate-api"), "packaged Bing web translation dependency"],
    [join(layout.resourcesRoot, "web-translate-helper", "node_modules", "@vitalets", "google-translate-api"), "packaged Google web translation dependency"],
    [layout.daemonExecutable, "packaged Go daemon"],
    [layout.pythonExecutable, "app-private Python executable"]
  ]);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

run(layout.appExecutable, [], {
  env: {
    ...process.env,
    FAST_SUB_SMOKE: "1"
  }
});
rmSync(daemonRepairSmokeRoot, { recursive: true, force: true });
mkdirSync(daemonRepairSmokeRoot, { recursive: true });
run(layout.appExecutable, [], {
  env: {
    ...process.env,
    FAST_SUB_SMOKE_DAEMON_REPAIR: "1",
    FAST_SUB_SMOKE_USER_DATA: daemonRepairSmokeRoot
  }
});
if (process.platform === "win32") {
  run(layout.fastSubCli, ["--version"], { cwd: layout.pythonScripts });
  run(layout.sttWorker, ["--help"], { cwd: layout.pythonScripts });
}
run(layout.pythonExecutable, ["-m", "fast_sub.app", "--version"]);
run(layout.pythonExecutable, ["-m", "fast_sub_workers.faster_whisper", "--help"]);
run(layout.pythonExecutable, [
  "-c",
  "import fast_sub, faster_whisper, ctranslate2, sentencepiece; print('packaged-python-ok')"
]);
await smokeDaemonReady();

console.log("Packaged runtime smoke passed.");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: desktopRoot,
    encoding: "utf8",
    shell: false,
    ...options
  });
  if (result.status !== 0) {
    fail(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        result.stdout?.trim(),
        result.stderr?.trim()
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
}

function smokeDaemonReady() {
  rmSync(daemonSmokeRoot, { recursive: true, force: true });
  mkdirSync(daemonSmokeRoot, { recursive: true });
  return new Promise((resolve) => {
    const child = spawn(layout.daemonExecutable, ["serve", "--json-ready", "--host", "127.0.0.1", "--port", "0"], {
      cwd: daemonSmokeRoot,
      shell: false,
      env: packagedRuntimeEnv(layout),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      fail("Packaged daemon did not emit ready JSON within timeout.");
    }, 8000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      tryReady();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("exit", () => {
      clearTimeout(timer);
      fail(`Packaged daemon exited before ready.\n${redactDaemonReady(stdout)}\n${stderr.trim()}`);
    });

    function tryReady() {
      const line = stdout.split(/\r?\n/).find((candidate) => candidate.trim().startsWith("{"));
      if (!line) {
        return;
      }
      let ready;
      try {
        ready = JSON.parse(line);
      } catch {
        return;
      }
      if (ready?.ready !== true || !ready.base_url || !ready.token || !ready.pid) {
        fail(`Packaged daemon ready JSON was incomplete: ${redactDaemonReady(line)}`);
      }
      clearTimeout(timer);
      child.removeAllListeners("exit");
      smokeDaemonHttp(ready)
        .then(() => {
          child.kill("SIGTERM");
          resolve();
        })
        .catch((error) => {
          child.kill("SIGTERM");
          fail(error instanceof Error ? error.message : String(error));
        });
    }
  });
}

async function smokeDaemonHttp(ready) {
  const health = await fetch(`${ready.base_url}/v1/health`);
  if (health.status !== 200) {
    throw new Error(`Packaged daemon health returned ${health.status}.`);
  }
  const unauthorized = await fetch(`${ready.base_url}/v1/config`);
  if (unauthorized.status !== 401) {
    throw new Error(`Packaged daemon protected endpoint returned ${unauthorized.status} without auth; expected 401.`);
  }
  const config = await fetch(`${ready.base_url}/v1/config`, {
    headers: {
      Authorization: `Bearer ${ready.token}`
    }
  });
  if (config.status !== 200) {
    throw new Error(`Packaged daemon authenticated config returned ${config.status}.`);
  }
  await smokeDaemonSSE(ready);
}

async function smokeDaemonSSE(ready) {
  const job = await createFailingJob(ready);
  await waitForTerminalJob(ready, job.job_id);
  await readSSEUntil(ready, job.job_id, "", "event:");
  await readSSEUntil(ready, job.job_id, "", "failed", true);
  const eventLog = join(daemonSmokeRoot, ".fast-sub", "jobs", job.job_id, "events.jsonl");
  const events = readFileSync(eventLog, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const trimmed = events.filter((event) => event.id >= 3).map((event) => JSON.stringify(event)).join("\n");
  writeFileSync(eventLog, `${trimmed}\n`);
  await readSSEUntil(ready, job.job_id, "1", "events_lost");
}

async function createFailingJob(ready) {
  const response = await fetch(`${ready.base_url}/v1/jobs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ready.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      schema_version: 1,
      type: "transcribe",
      input_path: join(daemonSmokeRoot, "missing-input.mp4"),
      output_path: join(daemonSmokeRoot, "missing-input.srt"),
      provider: "local-faster-whisper",
      model: "whisper-small"
    })
  });
  if (response.status !== 200) {
    throw new Error(`Packaged daemon failing job create returned ${response.status}: ${await response.text()}`);
  }
  const envelope = await response.json();
  const job = envelope?.result;
  if (!job?.job_id) {
    throw new Error(`Packaged daemon failing job create returned invalid payload: ${JSON.stringify(envelope)}`);
  }
  return job;
}

async function waitForTerminalJob(ready, jobId) {
  const terminal = new Set(["succeeded", "failed", "canceled", "interrupted"]);
  const started = Date.now();
  while (Date.now() - started < 15000) {
    const response = await fetch(`${ready.base_url}/v1/jobs/${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${ready.token}` }
    });
    if (response.status !== 200) {
      throw new Error(`Packaged daemon get job returned ${response.status}.`);
    }
    const envelope = await response.json();
    const status = envelope?.result?.status;
    if (terminal.has(status)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Packaged daemon failing job did not reach a terminal status.");
}

async function readSSEUntil(ready, jobId, lastEventId, expected, abortAfterFirst = false) {
  const controller = new AbortController();
  const headers = {
    Authorization: `Bearer ${ready.token}`,
    Accept: "text/event-stream"
  };
  if (lastEventId) {
    headers["Last-Event-ID"] = lastEventId;
  }
  const response = await fetch(`${ready.base_url}/v1/jobs/${encodeURIComponent(jobId)}/events`, {
    headers,
    signal: controller.signal
  });
  if (response.status !== 200 || !response.body) {
    throw new Error(`Packaged daemon SSE returned ${response.status}.`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const started = Date.now();
  try {
    while (Date.now() - started < 5000) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      text += decoder.decode(chunk.value, { stream: true });
      if (text.includes(expected)) {
        controller.abort();
        return text;
      }
      if (abortAfterFirst && text.includes("\n\n")) {
        controller.abort();
        return text;
      }
    }
  } finally {
    controller.abort();
  }
  throw new Error(`Packaged daemon SSE did not include ${expected}. Received: ${text.slice(0, 500)}`);
}

function redactDaemonReady(value) {
  return value.replace(/"token"\s*:\s*"[^"]+"/g, '"token":"[redacted]"');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
