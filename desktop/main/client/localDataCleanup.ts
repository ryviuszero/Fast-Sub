import { app } from "electron";
import { rm, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { LocalDataCleanupResult, LocalDataCleanupTarget } from "../../shared/contracts/types";

const cacheDirectoryNames = [
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache"
];

export async function cleanupLocalData(target: LocalDataCleanupTarget): Promise<LocalDataCleanupResult> {
  const userData = resolve(app.getPath("userData"));
  const candidates = cleanupCandidates(userData, target);
  const deleted: string[] = [];
  const skipped: string[] = [];
  for (const candidate of candidates) {
    const path = safeUserDataChild(userData, candidate);
    if (!path) {
      skipped.push(candidate);
      continue;
    }
    if (!await exists(path)) {
      skipped.push(relative(userData, path) || path);
      continue;
    }
    await rm(path, { recursive: true, force: true });
    deleted.push(relative(userData, path) || path);
  }
  return { target, deleted, skipped };
}

export function normalizeLocalDataCleanupTarget(value: unknown): LocalDataCleanupTarget {
  if (value === "jobs" || value === "native-binaries" || value === "cache") {
    return value;
  }
  throw new Error("invalid local data cleanup target");
}

function cleanupCandidates(userData: string, target: LocalDataCleanupTarget): string[] {
  switch (target) {
    case "jobs":
      return [join(userData, ".fast-sub", "jobs")];
    case "native-binaries":
      return [join(userData, "native-binaries")];
    case "cache":
      return cacheDirectoryNames.map((name) => join(userData, name));
  }
}

function safeUserDataChild(userData: string, candidate: string): string | null {
  const resolved = resolve(candidate);
  const rel = relative(userData, resolved);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    return null;
  }
  return resolved;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
