import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const mainSource = readFileSync(join(root, "main", "index.ts"), "utf8");
const preloadSource = readFileSync(join(root, "preload", "index.ts"), "utf8");
const html = readFileSync(join(root, "index.html"), "utf8");

const required = [
  ["contextIsolation: true", mainSource.includes("contextIsolation: true")],
  ["nodeIntegration: false", mainSource.includes("nodeIntegration: false")],
  ["CSP meta", html.includes("Content-Security-Policy")],
  ["dev CSP supports Vite websocket", mainSource.includes("ws://localhost:5173")],
  ["contextBridge allowlist", preloadSource.includes("contextBridge.exposeInMainWorld")],
  ["no raw ipcRenderer exposure", !preloadSource.includes("exposeInMainWorld(\"ipcRenderer\"")],
  ["renderer build output", existsSync(join(root, "dist", "renderer", "index.html"))],
  ["main build output", existsSync(join(root, "dist", "main", "index.js"))],
  ["preload build output", existsSync(join(root, "dist", "preload", "index.cjs"))]
];

const failed = required.filter(([, ok]) => !ok);
if (failed.length > 0) {
  console.error("Smoke checks failed:");
  for (const [name] of failed) {
    console.error(`- ${name}`);
  }
  process.exit(1);
}

const electronPath = require("electron");
const child = spawn(electronPath, [root], {
  cwd: root,
  env: {
    ...process.env,
    FAST_SUB_SMOKE: "1",
    ELECTRON_RENDERER_URL: ""
  },
  stdio: ["ignore", "pipe", "pipe"]
});

let stdout = "";
let stderr = "";
const timeout = setTimeout(() => {
  child.kill();
  console.error("Electron smoke timed out.");
  console.error(stderr);
  process.exit(1);
}, 15000);

child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});

child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

child.on("exit", (code) => {
  clearTimeout(timeout);
  if (code !== 0) {
    console.error("Electron smoke failed.");
    console.error(stderr);
    process.exit(code ?? 1);
  }
  const readyLine = stdout.split(/\r?\n/).find((line) => line.startsWith("FAST_SUB_SMOKE_RENDERER_READY "));
  if (!readyLine) {
    console.error("Electron smoke did not reach renderer.");
    console.error(stdout);
    console.error(stderr);
    process.exit(1);
  }
  const snapshot = JSON.parse(readyLine.replace("FAST_SUB_SMOKE_RENDERER_READY ", ""));
  const expectedApi = ["selectMediaFiles", "selectFolder", "openPathMock", "getSecuritySnapshot"];
  const missingApi = expectedApi.filter((key) => !snapshot.apiKeys.includes(key));
  if (!snapshot.hasRoot || !snapshot.hasFastSubApi || missingApi.length > 0 || !snapshot.contextIsolation || snapshot.nodeIntegration || !snapshot.csp) {
    console.error("Electron smoke renderer snapshot failed:");
    console.error(JSON.stringify(snapshot, null, 2));
    process.exit(1);
  }
  console.log("Smoke checks passed without starting a real daemon or network call.");
});
