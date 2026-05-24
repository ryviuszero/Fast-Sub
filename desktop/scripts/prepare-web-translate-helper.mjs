import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";

const desktopRoot = process.cwd();
const helperSource = join(desktopRoot, "web-translate-helper");
const helperTarget = join(desktopRoot, "resources", "web-translate-helper");
const selectedPackages = ["bing-translate-api", "@vitalets/google-translate-api"];

rmSync(helperTarget, { recursive: true, force: true });
mkdirSync(join(helperTarget, "node_modules"), { recursive: true });
cpSync(helperSource, helperTarget, { recursive: true });

const lock = await readPackageLock();
const packagePaths = collectPackagePaths(lock, selectedPackages);
for (const packagePath of packagePaths) {
  const source = join(desktopRoot, packagePath);
  if (!existsSync(source)) {
    throw new Error(`Missing installed helper dependency: ${source}`);
  }
  const target = join(helperTarget, packagePath);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

writeFileSync(
  join(helperTarget, "package.json"),
  `${JSON.stringify(
    {
      name: "fast-sub-web-translate-helper",
      private: true,
      type: "module",
      dependencies: Object.fromEntries(
        selectedPackages.map((name) => [name, lock.packages[`node_modules/${name}`]?.version])
      )
    },
    null,
    2
  )}\n`,
  "utf8"
);

console.log(`Prepared web translation helper: ${helperTarget}`);
console.log(`Copied helper runtime packages: ${packagePaths.length}`);

async function readPackageLock() {
  const fs = await import("node:fs/promises");
  return JSON.parse(await fs.readFile(join(desktopRoot, "package-lock.json"), "utf8"));
}

function collectPackagePaths(lock, roots) {
  const collected = new Set();
  const visit = (packageName) => {
    const packagePath = `node_modules/${packageName}`;
    if (collected.has(packagePath)) {
      return;
    }
    const meta = lock.packages?.[packagePath];
    if (!meta) {
      throw new Error(`Package ${packageName} is missing from package-lock.json`);
    }
    collected.add(packagePath);
    for (const dependency of Object.keys(meta.dependencies ?? {})) {
      visit(dependency);
    }
    for (const dependency of Object.keys(meta.optionalDependencies ?? {})) {
      if (lock.packages?.[`node_modules/${dependency}`]) {
        visit(dependency);
      }
    }
  };
  for (const root of roots) {
    visit(root);
  }
  return [...collected].sort();
}
