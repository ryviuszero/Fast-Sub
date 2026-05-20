import { rmSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

rmSync(join(process.cwd(), "dist-release"), { recursive: true, force: true });
