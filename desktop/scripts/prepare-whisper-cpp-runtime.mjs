import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import process from "node:process";

const desktopRoot = process.cwd();
const repoRoot = resolve(desktopRoot, "..");
const target = `${process.platform}-${process.arch}`;
const version = process.env.FAST_SUB_WHISPER_CPP_VERSION || "v1.8.4";
const runtimeRoot = join(desktopRoot, "resources", "bin", target, "whisper-cpp");
const cacheRoot = join(repoRoot, ".release-cache", "whisper-cpp", version, target);
const sourceArchive = join(cacheRoot, `${version}.tar.gz`);
const sourceRoot = join(cacheRoot, `whisper.cpp-${version.replace(/^v/, "")}`);
const buildRoot = join(cacheRoot, "build");
const windowsZip = join(cacheRoot, "whisper-bin-x64.zip");

if (process.platform === "win32" && process.arch !== "x64") {
  fail(`prepare-whisper-cpp-runtime supports Windows x64 only; got ${target}.`);
}
if (process.platform === "darwin" && process.arch !== "arm64") {
  fail(`prepare-whisper-cpp-runtime supports macOS arm64 only; got ${target}.`);
}
if (process.platform !== "win32" && process.platform !== "darwin") {
  fail(`prepare-whisper-cpp-runtime supports win32-x64 and darwin-arm64; got ${target}.`);
}

mkdirSync(cacheRoot, { recursive: true });
rmSync(runtimeRoot, { recursive: true, force: true });
mkdirSync(runtimeRoot, { recursive: true });

if (process.platform === "win32") {
  await prepareWindowsRuntime();
} else {
  await prepareMacOSRuntime();
}

verifyRuntime();
console.log(`Prepared whisper.cpp runtime: ${runtimeRoot}`);

async function prepareWindowsRuntime() {
  const url = `https://github.com/ggml-org/whisper.cpp/releases/download/${version}/whisper-bin-x64.zip`;
  await download(url, windowsZip);
  const staging = join(cacheRoot, "windows-staging");
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    "& { param($zipPath, $destination) Expand-Archive -LiteralPath $zipPath -DestinationPath $destination -Force }",
    windowsZip,
    staging
  ], desktopRoot);
  const bin = findFirst(staging, ["whisper-cli.exe", "main.exe", "whisper-cpp.exe"]);
  if (!bin) {
    fail(`Downloaded whisper.cpp archive did not contain a known CLI binary: ${windowsZip}`);
  }
  cpSync(dirnamePath(bin), runtimeRoot, { recursive: true, force: true });
}

async function prepareMacOSRuntime() {
  const url = `https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${version}.tar.gz`;
  await download(url, sourceArchive);
  if (!existsSync(sourceRoot)) {
    run("tar", ["-xzf", sourceArchive, "-C", cacheRoot], desktopRoot);
  }
  rmSync(buildRoot, { recursive: true, force: true });
  mkdirSync(buildRoot, { recursive: true });
  run("cmake", [
    "-S",
    sourceRoot,
    "-B",
    buildRoot,
    "-DCMAKE_BUILD_TYPE=Release",
    "-DWHISPER_BUILD_TESTS=OFF",
    "-DWHISPER_BUILD_EXAMPLES=ON",
    "-DWHISPER_BUILD_SERVER=OFF",
    "-DGGML_NATIVE=OFF",
    "-DGGML_METAL=ON"
  ], desktopRoot);
  run("cmake", ["--build", buildRoot, "--config", "Release", "--target", "whisper-cli", "--parallel"], desktopRoot);
  const bin = findFirst(buildRoot, ["whisper-cli"]);
  if (!bin) {
    fail(`Built whisper.cpp tree did not contain whisper-cli: ${buildRoot}`);
  }
  cpSync(bin, join(runtimeRoot, "whisper-cli"));
  for (const dylib of findAll(buildRoot, [".dylib"])) {
    cpSync(dylib, join(runtimeRoot, basename(dylib)));
  }
  materializeExternalSymlinks(runtimeRoot);
  chmodSync(join(runtimeRoot, "whisper-cli"), 0o755);
  fixMacOSRuntimeLinks(join(runtimeRoot, "whisper-cli"));
}

function verifyRuntime() {
  const binary = findFirst(runtimeRoot, process.platform === "win32" ? ["whisper-cli.exe", "main.exe", "whisper-cpp.exe"] : ["whisper-cli"]);
  if (!binary) {
    fail(`Missing prepared whisper.cpp binary in ${runtimeRoot}`);
  }
  if (process.platform !== "win32") {
    chmodSync(binary, 0o755);
  }
  run(binary, ["--help"], desktopRoot);
}

function fixMacOSRuntimeLinks(binary) {
  for (const file of findAll(runtimeRoot, [""])) {
    if (!statSync(file).isFile()) {
      continue;
    }
    chmodSync(file, 0o755);
  }
  for (const rpath of macOSRPaths(binary)) {
    run("install_name_tool", ["-delete_rpath", rpath, binary], desktopRoot);
  }
  run("install_name_tool", ["-add_rpath", "@executable_path", binary], desktopRoot);
  for (const dylib of findAll(runtimeRoot, [".dylib"])) {
    run("install_name_tool", ["-id", `@rpath/${basename(dylib)}`, dylib], desktopRoot);
    for (const rpath of macOSRPaths(dylib)) {
      run("install_name_tool", ["-delete_rpath", rpath, dylib], desktopRoot);
    }
    run("install_name_tool", ["-add_rpath", "@loader_path", dylib], desktopRoot);
  }
}

async function download(url, targetPath) {
  if (existsSync(targetPath) && statSync(targetPath).size > 0) {
    return;
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
    fail(`Refusing to download whisper.cpp from unapproved URL: ${url}`);
  }
  console.log(`Downloading ${url}`);
  const response = await fetch(parsed);
  if (!response.ok || !response.body) {
    fail(`Download failed with HTTP ${response.status}: ${url}`);
  }
  await pipeline(response.body, createWriteStream(targetPath));
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
    env: process.env
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function findFirst(root, names) {
  if (!existsSync(root)) {
    return null;
  }
  const lowerNames = new Set(names.map((name) => name.toLowerCase()));
  for (const entry of walk(root)) {
    if (lowerNames.has(basename(entry).toLowerCase()) && statSync(entry).isFile()) {
      return entry;
    }
  }
  return null;
}

function findAll(root, suffixes) {
  if (!existsSync(root)) {
    return [];
  }
  return walk(root).filter((entry) => {
    if (!statSync(entry).isFile()) {
      return false;
    }
    return suffixes.some((suffix) => suffix === "" || entry.endsWith(suffix));
  });
}

function macOSRPaths(file) {
  const result = spawnSync("otool", ["-l", file], { encoding: "utf8", shell: false });
  if (result.status !== 0) {
    return [];
  }
  const rpaths = [];
  const lines = result.stdout.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes("cmd LC_RPATH")) {
      continue;
    }
    const pathLine = lines.slice(index, index + 5).find((line) => line.trim().startsWith("path "));
    const match = pathLine?.match(/^\s*path\s+(.+?)\s+\(offset\s+\d+\)$/);
    if (match) {
      rpaths.push(match[1]);
    }
  }
  return rpaths;
}

function walk(root) {
  const entries = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    entries.push(path);
    if (statSync(path).isDirectory()) {
      entries.push(...walk(path));
    }
  }
  return entries;
}

function dirnamePath(path) {
  return dirname(path);
}

function materializeExternalSymlinks(root) {
  const rootReal = realpathSync(root);
  for (const entry of walk(root)) {
    if (!lstatSync(entry).isSymbolicLink()) {
      continue;
    }
    const rawTarget = readlinkSync(entry);
    const target = isAbsolute(rawTarget) ? rawTarget : resolve(dirname(entry), rawTarget);
    const targetReal = realpathSync(target);
    if (targetReal.startsWith(`${rootReal}/`)) {
      continue;
    }
    rmSync(entry);
    cpSync(targetReal, entry, { recursive: true });
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
