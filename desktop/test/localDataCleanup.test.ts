import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

let userDataPath = "";

vi.mock("electron", () => ({
  app: {
    getPath(name: string) {
      if (name !== "userData") {
        throw new Error(`Unexpected app path request: ${name}`);
      }
      return userDataPath;
    }
  }
}));

describe("cleanupLocalData", () => {
  afterEach(async () => {
    if (userDataPath) {
      await rm(userDataPath, { recursive: true, force: true });
      userDataPath = "";
    }
  });

  it("keeps aria2 when clearing native dependencies", async () => {
    userDataPath = join(tmpdir(), `fast-sub-cleanup-${process.pid}-${Date.now()}`);
    const ffmpegDir = join(userDataPath, "native-binaries", "ffmpeg", "bin");
    const whisperDir = join(userDataPath, "native-binaries", "whisper-cpp", "bin");
    const aria2Dir = join(userDataPath, "native-binaries", "aria2", "bin");
    await mkdir(ffmpegDir, { recursive: true });
    await mkdir(whisperDir, { recursive: true });
    await mkdir(aria2Dir, { recursive: true });
    await writeFile(join(ffmpegDir, "ffmpeg.exe"), "");
    await writeFile(join(whisperDir, "whisper-cli.exe"), "");
    await writeFile(join(aria2Dir, "aria2c.exe"), "");

    const { cleanupLocalData } = await import("../main/client/localDataCleanup");
    const result = await cleanupLocalData("native-binaries");

    expect(result.deleted).toEqual(expect.arrayContaining([
      join("native-binaries", "ffmpeg"),
      join("native-binaries", "whisper-cpp")
    ]));
    expect(existsSync(join(aria2Dir, "aria2c.exe"))).toBe(true);
    expect(existsSync(ffmpegDir)).toBe(false);
    expect(existsSync(whisperDir)).toBe(false);
  });
});
