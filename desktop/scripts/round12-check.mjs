import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const node = process.execPath;

function npmStep(name, args) {
  if (isWindows) {
    return {
      name,
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "npm", ...args],
      shell: false
    };
  }

  return {
    name,
    command: "npm",
    args,
    shell: false
  };
}
const full = process.argv.includes("--full");

const steps = [
  npmStep("typecheck", ["run", "typecheck"]),
  {
    name: "round12 renderer/main regression tests",
    command: node,
    args: [
      "node_modules/vitest/vitest.mjs",
      "run",
      "test/App.test.tsx",
      "test/daemonEventMapping.test.ts",
      "test/mockClient.test.ts",
      "test/round12Fixtures.test.ts"
    ],
    shell: false
  },
  npmStep("electron preload smoke", ["run", "smoke"])
];

if (full) {
  steps.push(npmStep("desktop build", ["run", "build"]));
}

function runStep(step) {
  return new Promise((resolveStep, rejectStep) => {
    console.log(`\n[round12] ${step.name}`);
    console.log(`[round12] > ${step.command} ${step.args.join(" ")}`);

    const child = spawn(step.command, step.args, {
      cwd: root,
      shell: step.shell,
      stdio: "inherit"
    });

    child.on("error", rejectStep);
    child.on("exit", (code) => {
      if (code === 0) {
        resolveStep();
        return;
      }
      rejectStep(new Error(`${step.name} failed with exit code ${code ?? "unknown"}`));
    });
  });
}

for (const step of steps) {
  await runStep(step);
}

console.log(`\n[round12] ok (${steps.length} steps)`);
