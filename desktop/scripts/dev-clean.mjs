import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

const desktopRoot = process.cwd();
const userData = join(desktopRoot, ".dev-user-data");
const electronVite = join(desktopRoot, "node_modules", "electron-vite", "bin", "electron-vite.js");

if (!existsSync(electronVite)) {
  console.error(`Missing electron-vite CLI: ${electronVite}`);
  process.exit(1);
}

rmSync(userData, { recursive: true, force: true });
mkdirSync(userData, { recursive: true });
writeFileSync(join(userData, "fast-sub-go.toml"), "# Fast Sub clean dev config.\n", "utf8");
console.log(`Starting Fast Sub dev with clean userData: ${userData}`);

const electronViteArgs = process.argv.length > 2 ? process.argv.slice(2) : ["dev"];
const child = spawn(process.execPath, [electronVite, ...electronViteArgs], {
  cwd: desktopRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    FAST_SUB_SMOKE_USER_DATA: userData
  }
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(signal === "SIGINT" ? 130 : 1);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
