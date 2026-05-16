import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const desktopRoot = resolve(root, "desktop");
const picsDir = resolve(root, "desktop-tests", "pics");
const targetUrl = process.env.FAST_SUB_DESKTOP_TEST_URL || "http://127.0.0.1:5173/";

await mkdir(picsDir, { recursive: true });

const runnerPath = resolve(root, "desktop-tests", ".capture-runner.cjs");
const electronCli = resolve(desktopRoot, "node_modules", "electron", "cli.js");

const child = spawn(process.execPath, [electronCli, runnerPath], {
  cwd: desktopRoot,
  env: { ...process.env, FAST_SUB_DESKTOP_TEST_URL: targetUrl, FAST_SUB_DESKTOP_TEST_PICS: picsDir },
  stdio: "inherit",
  shell: false
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
