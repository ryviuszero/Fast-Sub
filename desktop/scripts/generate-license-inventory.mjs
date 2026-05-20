import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const desktopRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(desktopRoot, "..");
const outputRoot = join(repoRoot, "desktop-tests", "licenses");
const pythonLicenseOverrides = {
  sentencepiece: {
    license: "Apache-2.0",
    evidence: "https://github.com/google/sentencepiece/blob/master/LICENSE"
  },
  typing_extensions: {
    license: "PSF-2.0",
    evidence: "https://pypi.org/project/typing-extensions/4.15.0/"
  }
};

mkdirSync(outputRoot, { recursive: true });

const npmReport = generateNpmReport();
const pythonReport = generatePythonReport();
const goReport = generateGoReport();
const summary = summarize(npmReport, pythonReport, goReport);

writeJSON(join(outputRoot, "npm-licenses.json"), npmReport);
writeJSON(join(outputRoot, "python-licenses.json"), pythonReport);
writeFileSync(join(outputRoot, "go-licenses.md"), goReport.markdown, "utf8");
writeJSON(join(outputRoot, "license-summary.json"), summary);

console.log(JSON.stringify({
  outputRoot,
  npm: { total: npmReport.packages.length, needsReview: npmReport.packages.filter((item) => item.policy === "needs-review").length },
  python: { total: pythonReport.packages.length, needsReview: pythonReport.packages.filter((item) => item.policy === "needs-review").length },
  go: { total: goReport.modules.length, needsReview: goReport.modules.filter((item) => item.policy === "needs-review").length }
}, null, 2));

function generateNpmReport() {
  const lockPath = join(desktopRoot, "package-lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const packages = Object.entries(lock.packages ?? {})
    .filter(([path]) => path.startsWith("node_modules/"))
    .map(([path, meta]) => {
      const name = path.replace(/^node_modules\//, "");
      const license = normalizeLicense(meta.license);
      const devOnly = meta.dev === true || meta.devOptional === true;
      return {
        name,
        version: stringValue(meta.version),
        license,
        scope: devOnly ? "build-test" : "runtime",
        policy: devOnly ? "manual-user-install" : policyForLicense(license),
        source: "desktop/package-lock.json"
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    generated_at: new Date().toISOString(),
    source: "desktop/package-lock.json",
    packages
  };
}

function generatePythonReport() {
  const sitePackages = join(desktopRoot, "resources", "python", platformArch(), "Lib", "site-packages");
  const packages = readdirSync(sitePackages, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".dist-info"))
    .map((entry) => packageFromDistInfo(join(sitePackages, entry.name)))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    generated_at: new Date().toISOString(),
    source: `desktop/resources/python/${platformArch()}/Lib/site-packages/*.dist-info/METADATA`,
    packages
  };
}

function packageFromDistInfo(distInfoPath) {
  const metadataPath = join(distInfoPath, "METADATA");
  let raw = "";
  try {
    raw = readFileSync(metadataPath, "utf8");
  } catch {
    return {
      name: basename(distInfoPath).replace(/\.dist-info$/, ""),
      version: "",
      license: "UNKNOWN",
      scope: "runtime",
      policy: "needs-review",
      source: metadataPath
    };
  }
  const headers = parseMetadataHeaders(raw);
  const name = headers.Name || basename(distInfoPath).replace(/\.dist-info$/, "");
  const override = pythonLicenseOverrides[name.toLowerCase()];
  const license = normalizeLicense(override?.license || headers["License-Expression"] || headers.License || licenseFromClassifiers(headers.Classifier ?? []));
  return {
    name,
    version: headers.Version || "",
    license,
    scope: "runtime",
    policy: pythonPolicy(name, license),
    source: metadataPath,
    evidence: override?.evidence
  };
}

function generateGoReport() {
  const goMod = readFileSync(join(repoRoot, "go.mod"), "utf8");
  const modules = [];
  for (const line of goMod.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("module ") || trimmed.startsWith("go ") || trimmed.startsWith("//") || trimmed === "require (" || trimmed === ")") {
      continue;
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      modules.push({
        module: parts[0],
        version: parts[1],
        license: "UNKNOWN",
        scope: "compiled",
        policy: "needs-review",
        source: "go.mod"
      });
    }
  }
  const markdown = [
    "# Go License Inventory",
    "",
    "Generated from `go.mod`.",
    "",
    "| Module | Version | License | Policy |",
    "| --- | --- | --- | --- |",
    ...(
      modules.length
        ? modules.map((item) => `| \`${item.module}\` | \`${item.version}\` | ${item.license} | \`${item.policy}\` |`)
        : ["| Go standard library only | Go toolchain version from build host | BSD-style Go license | `bundle-ok` |"]
    ),
    ""
  ].join("\n");
  return { generated_at: new Date().toISOString(), source: "go.mod", modules, markdown };
}

function summarize(npmReport, pythonReport, goReport) {
  const all = [
    ...npmReport.packages.map((item) => ({ ecosystem: "npm", name: item.name, version: item.version, license: item.license, policy: item.policy, scope: item.scope })),
    ...pythonReport.packages.map((item) => ({ ecosystem: "python", name: item.name, version: item.version, license: item.license, policy: item.policy, scope: item.scope })),
    ...goReport.modules.map((item) => ({ ecosystem: "go", name: item.module, version: item.version, license: item.license, policy: item.policy, scope: item.scope }))
  ];
  return {
    generated_at: new Date().toISOString(),
    counts: {
      total: all.length,
      bundle_ok: all.filter((item) => item.policy === "bundle-ok").length,
      download_only: all.filter((item) => item.policy === "download-only").length,
      manual_user_install: all.filter((item) => item.policy === "manual-user-install").length,
      needs_review: all.filter((item) => item.policy === "needs-review").length,
      blocked: all.filter((item) => item.policy === "blocked").length
    },
    needs_review: all.filter((item) => item.policy === "needs-review"),
    blocked: all.filter((item) => item.policy === "blocked")
  };
}

function parseMetadataHeaders(raw) {
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) break;
    if (/^\s/.test(line)) continue;
    const index = line.indexOf(":");
    if (index < 0) continue;
    const key = line.slice(0, index);
    const value = line.slice(index + 1).trim();
    if (result[key] === undefined) {
      result[key] = value;
    } else if (Array.isArray(result[key])) {
      result[key].push(value);
    } else {
      result[key] = [result[key], value];
    }
  }
  return result;
}

function licenseFromClassifiers(value) {
  const classifiers = Array.isArray(value) ? value : [value];
  const licenseClassifiers = classifiers.filter((item) => item.startsWith("License ::"));
  return licenseClassifiers.join("; ");
}

function normalizeLicense(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(" OR ") || "UNKNOWN";
  }
  const text = stringValue(value).trim();
  if (!text || text.toLowerCase() === "unknown") return "UNKNOWN";
  return text.replace(/\s+/g, " ");
}

function pythonPolicy(name, license) {
  const lowerName = name.toLowerCase();
  if (lowerName === "fast-sub") return "bundle-ok";
  return policyForLicense(license);
}

function policyForLicense(license) {
  const normalized = license.toLowerCase();
  if (!normalized || normalized === "unknown") return "needs-review";
  if (normalized.includes("agpl") || normalized.includes("gpl")) return "needs-review";
  if (normalized.includes("cc-by-nc") || normalized.includes("non-commercial") || normalized.includes("noncommercial")) return "needs-review";
  if (normalized.includes("psf") || normalized.includes("mit") || normalized.includes("bsd") || normalized.includes("apache") || normalized.includes("isc") || normalized.includes("python software foundation") || normalized.includes("mpl")) {
    return "bundle-ok";
  }
  return "needs-review";
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function platformArch() {
  if (process.platform === "win32" && process.arch === "x64") return "win32-x64";
  return `${process.platform}-${process.arch}`;
}

function writeJSON(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
