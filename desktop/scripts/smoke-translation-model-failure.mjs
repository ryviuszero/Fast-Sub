import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { packagedLayout, packagedRuntimeEnv } from "./release-platform.mjs";

const desktopRoot = process.cwd();
const layout = packagedLayout(desktopRoot);
const smokeRoot = join(desktopRoot, "test-results", "round13-translation-model-failure");
const modelStore = join(smokeRoot, "empty-model-store");
const input = join(smokeRoot, "missing-model-input.srt");
const output = join(smokeRoot, "missing-model-output.zh.srt");

if (!existsSync(layout.daemonExecutable)) {
  fail(`Missing packaged daemon: ${layout.daemonExecutable}`);
}

rmSync(smokeRoot, { recursive: true, force: true });
mkdirSync(modelStore, { recursive: true });
writeFileSync(input, "1\n00:00:00,000 --> 00:00:01,000\nhello\n", "utf8");

const ready = await startDaemon();
try {
  const job = await createTranslateJob(ready);
  const terminal = await waitForTerminalJob(ready, job.job_id);
  const error = terminal?.error ?? {};
  if (terminal.status !== "failed" || error.code !== "missing_model") {
    fail(`Expected missing_model failed job, got ${JSON.stringify(terminal)}`);
  }
  console.log("Translation model failure smoke passed.");
} finally {
  ready.child.kill("SIGTERM");
}

function startDaemon() {
  return new Promise((resolve) => {
    const child = spawn(layout.daemonExecutable, ["serve", "--json-ready", "--host", "127.0.0.1", "--port", "0"], {
      cwd: smokeRoot,
      shell: false,
      env: packagedRuntimeEnv(layout, {
        FAST_SUB_MODEL_STORE_DIR: modelStore,
        FAST_SUB_GO_CONFIG: join(smokeRoot, "fast-sub-go.toml")
      }),
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
      const line = stdout.split(/\r?\n/).find((candidate) => candidate.trim().startsWith("{"));
      if (!line) {
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        return;
      }
      if (parsed?.ready !== true || !parsed.base_url || !parsed.token) {
        return;
      }
      clearTimeout(timer);
      child.removeAllListeners("exit");
      resolve({ ...parsed, child });
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("exit", () => {
      clearTimeout(timer);
      fail(`Packaged daemon exited before ready.\n${redactDaemonReady(stdout)}\n${stderr.trim()}`);
    });
  });
}

async function createTranslateJob(ready) {
  const response = await fetch(`${ready.base_url}/v1/jobs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ready.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      schema_version: 1,
      type: "translate_srt",
      input_path: input,
      output_path: output,
      provider: "local-nllb-ct2",
      language: "en",
      target_language: "zh",
      model: "nllb-200-distilled-600m-ct2-int8",
      options: { overwrite: true }
    })
  });
  if (response.status !== 200) {
    fail(`Create translate job returned ${response.status}: ${await response.text()}`);
  }
  const envelope = await response.json();
  const job = envelope?.result;
  if (!job?.job_id) {
    fail(`Create translate job returned invalid payload: ${JSON.stringify(envelope)}`);
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
      fail(`Get job returned ${response.status}: ${await response.text()}`);
    }
    const envelope = await response.json();
    const job = envelope?.result;
    if (terminal.has(job?.status)) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail("Translate job did not reach a terminal status.");
}

function redactDaemonReady(value) {
  return value.replace(/"token"\s*:\s*"[^"]+"/g, '"token":"[redacted]"');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
