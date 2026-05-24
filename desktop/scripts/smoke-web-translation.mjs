import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { packagedLayout, packagedRuntimeEnv } from "./release-platform.mjs";

const desktopRoot = process.cwd();
const layout = packagedLayout(desktopRoot);
const smokeRoot = join(desktopRoot, "test-results", "round14-web-translation-smoke");
const modelStore = join(smokeRoot, "empty-model-store");
const input = join(smokeRoot, "round14-web-input.srt");
const timeoutMs = Number(process.env.FAST_SUB_WEB_SMOKE_TIMEOUT_MS || "90000");
const providers = ["web-bing", "web-google"];
const forbidden = ["js2py", "ai-cloudscraper", "translators"];

assertPackagedLayout();
rmSync(smokeRoot, { recursive: true, force: true });
mkdirSync(modelStore, { recursive: true });
writeFileSync(input, "1\n00:00:00,000 --> 00:00:01,000\nhello world\n", "utf8");

const dependencyScan = scanDependencies();
const ready = await startDaemon();
const results = [];

try {
  for (const provider of providers) {
    const output = join(smokeRoot, `${provider}.zh.srt`);
    const job = await createTranslateJob(ready, provider, output);
    const terminal = await waitForTerminalJob(ready, job.job_id, provider);
    results.push({
      provider,
      language_pair: "en->zh",
      status: terminal.status,
      error_code: terminal.error?.code ?? null,
      output_exists: existsSync(output),
      redaction: assertRedactionSafe(terminal),
      dependency_scan: dependencyScan.status
    });
    if (terminal.status !== "succeeded") {
      fail(`Expected ${provider} web translation to succeed, got ${JSON.stringify(redactJob(terminal))}`);
    }
  }
} finally {
  ready.child.kill("SIGTERM");
}

const summary = {
  schema_version: 1,
  packaged_root: layout.unpackedRoot,
  helper_outside_asar: layout.webTranslateHelper.includes(`${process.platform === "win32" ? "\\resources\\" : "/Resources/"}`),
  uses_packaged_electron_as_node: true,
  api_key_required: false,
  results,
  dependency_scan: dependencyScan
};
writeFileSync(join(smokeRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(`Web translation packaged smoke passed: ${join(smokeRoot, "summary.json")}`);

function assertPackagedLayout() {
  const missing = [
    [layout.daemonExecutable, "packaged daemon"],
    [layout.appExecutable, "packaged app executable"],
    [layout.pythonExecutable, "packaged Python runtime"],
    [layout.webTranslateHelper, "packaged web translation helper"]
  ].filter(([path]) => !existsSync(path));
  if (missing.length > 0) {
    fail(missing.map(([path, label]) => `Missing ${label}: ${path}`).join("\n"));
  }
}

function scanDependencies() {
  const roots = [
    join(layout.resourcesRoot, "python", layout.target),
    join(layout.resourcesRoot, "web-translate-helper")
  ];
  const hits = [];
  for (const root of roots) {
    if (!existsSync(root)) {
      continue;
    }
    for (const path of walk(root)) {
      const lower = path.toLowerCase();
      for (const term of forbidden) {
        if (lower.includes(term)) {
          hits.push({ term, path: path.replace(layout.resourcesRoot, "[resources]") });
        }
      }
    }
  }
  if (hits.length > 0) {
    fail(`Forbidden dependency metadata found: ${JSON.stringify(hits, null, 2)}`);
  }
  return { status: "pass", forbidden, roots: roots.map((root) => root.replace(layout.resourcesRoot, "[resources]")) };
}

function walk(root) {
  const paths = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    paths.push(path);
    if (statSync(path).isDirectory()) {
      paths.push(...walk(path));
    }
  }
  return paths;
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

async function createTranslateJob(ready, provider, output) {
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
      provider,
      language: "en",
      target_language: "zh",
      translation_upload_confirmed: true,
      options: { overwrite: true, yes: true }
    })
  });
  if (response.status !== 200) {
    fail(`Create ${provider} translate job returned ${response.status}: ${await response.text()}`);
  }
  const envelope = await response.json();
  const job = envelope?.result;
  if (!job?.job_id) {
    fail(`Create ${provider} translate job returned invalid payload: ${JSON.stringify(envelope)}`);
  }
  return job;
}

async function waitForTerminalJob(ready, jobId, provider) {
  const terminal = new Set(["succeeded", "failed", "canceled", "interrupted"]);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const response = await fetch(`${ready.base_url}/v1/jobs/${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${ready.token}` }
    });
    if (response.status !== 200) {
      fail(`Get ${provider} job returned ${response.status}: ${await response.text()}`);
    }
    const envelope = await response.json();
    const job = envelope?.result;
    if (terminal.has(job?.status)) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail(`${provider} web translate job did not reach a terminal status.`);
}

function assertRedactionSafe(job) {
  const serialized = JSON.stringify(redactJob(job));
  for (const value of ["Authorization", "Bearer ", "token", "FAST_SUB_WEB_TRANSLATE_HELPER", layout.webTranslateHelper]) {
    if (serialized.includes(value)) {
      fail(`Unredacted sensitive value found in job payload: ${value}`);
    }
  }
  return "pass";
}

function redactJob(job) {
  return {
    job_id: job?.job_id,
    status: job?.status,
    provider: job?.provider,
    error: job?.error ? { code: job.error.code, message: job.error.message, action_hint: job.error.action_hint } : null
  };
}

function redactDaemonReady(value) {
  return value.replace(/"token"\s*:\s*"[^"]+"/g, '"token":"[redacted]"');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
