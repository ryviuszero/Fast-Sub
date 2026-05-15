import { app, BrowserWindow, Menu, dialog, ipcMain, shell } from "electron";
import type { OpenDialogOptions, SaveDialogOptions } from "electron";
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { registerFastSubClientIpc } from "./client/ipc";

const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL ?? (!app.isPackaged ? "http://localhost:5173" : "");
const SMOKE_MODE = process.env.FAST_SUB_SMOKE === "1";
const PROD_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
const DEV_CSP = "default-src 'self' http://localhost:5173 ws://localhost:5173; script-src 'self' http://localhost:5173 'unsafe-inline' 'unsafe-eval'; style-src 'self' http://localhost:5173 'unsafe-inline'; img-src 'self' data: http://localhost:5173; font-src 'self' data: http://localhost:5173; connect-src 'self' http://localhost:5173 ws://localhost:5173; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
const MEDIA_EXTENSIONS = new Set([".mp4", ".mkv", ".mov", ".mp3", ".wav", ".m4a"]);
const DEFAULT_FOLDER_SCAN_MAX_FILES = 100;
const MAX_FOLDER_SCAN_MAX_FILES = 500;
const SKIPPED_FOLDER_SCAN_DIRS = new Set([".git", ".hg", ".svn", ".venv", "venv", "node_modules", "dist", "build", "__pycache__"]);

type FolderScanOptions = {
  includeSubfolders: boolean;
  maxFiles: number;
};

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 620,
    title: "Fast Sub",
    autoHideMenuBar: true,
    backgroundColor: "#f0eee9",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.setMenuBarVisibility(false);

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [app.isPackaged ? PROD_CSP : DEV_CSP]
      }
    });
  });

  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`Fast Sub renderer failed to load ${validatedURL}: ${errorCode} ${errorDescription}`);
    if (SMOKE_MODE) {
      app.exit(1);
    }
  });

  win.webContents.once("did-finish-load", async () => {
    if (!SMOKE_MODE) {
      return;
    }
    const rendererSnapshot = await win.webContents.executeJavaScript(`({
      title: document.title,
      hasRoot: Boolean(document.querySelector("#root")),
      hasFastSubApi: Boolean(window.fastSubSystem),
      apiKeys: Object.keys(window.fastSubSystem ?? {})
    })`);
    console.log(`FAST_SUB_SMOKE_RENDERER_READY ${JSON.stringify({
      ...rendererSnapshot,
      contextIsolation: true,
      nodeIntegration: false,
      csp: true
    })}`);
    app.quit();
  });

  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

ipcMain.handle("fast-sub:select-media-files", async (event) => {
  const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const options: OpenDialogOptions = {
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Media", extensions: ["mp4", "mkv", "mov", "mp3", "wav", "m4a"] }]
  };
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("fast-sub:select-folder", async (event) => {
  const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const options: OpenDialogOptions = { properties: ["openDirectory"] };
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] ?? null;
});

ipcMain.handle("fast-sub:select-media-folder", async (event, rawOptions: unknown) => {
  const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const options: OpenDialogOptions = { properties: ["openDirectory"] };
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) {
    return [];
  }
  return listMediaFiles(result.filePaths[0], normalizeFolderScanOptions(rawOptions));
});

ipcMain.handle("fast-sub:select-subtitle-output-path", async (event, defaultPath: unknown) => {
  const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const options: SaveDialogOptions = {
    defaultPath: typeof defaultPath === "string" ? defaultPath : undefined,
    filters: [{ name: "SRT Subtitles", extensions: ["srt"] }]
  };
  const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
  return result.canceled ? null : result.filePath ?? null;
});

ipcMain.handle("fast-sub:open-path-mock", async (_event, path: unknown) => {
  if (typeof path !== "string" || path.length === 0 || /^https?:\/\//i.test(path)) {
    return false;
  }
  const error = await shell.openPath(path);
  return error.length === 0;
});

ipcMain.handle("fast-sub:security-snapshot", () => ({
  contextIsolation: true,
  nodeIntegration: false,
  csp: true,
  exposesRawIpc: false
}));

registerFastSubClientIpc();

async function listMediaFiles(root: string, options: FolderScanOptions): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    if (out.length >= options.maxFiles) {
      return;
    }
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    for (const entry of entries) {
      if (out.length >= options.maxFiles) {
        return;
      }
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        if (options.includeSubfolders && !SKIPPED_FOLDER_SCAN_DIRS.has(entry.name.toLowerCase())) {
          await walk(path);
        }
      } else if (entry.isFile() && MEDIA_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        out.push(path);
      }
    }
  }
  await walk(root);
  return out;
}

function normalizeFolderScanOptions(value: unknown): FolderScanOptions {
  const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawMax = typeof item.maxFiles === "number" ? item.maxFiles : DEFAULT_FOLDER_SCAN_MAX_FILES;
  return {
    includeSubfolders: item.includeSubfolders === true,
    maxFiles: Math.max(1, Math.min(MAX_FOLDER_SCAN_MAX_FILES, Math.floor(rawMax)))
  };
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  if (SMOKE_MODE) {
    setTimeout(() => {
      console.error("FAST_SUB_SMOKE_TIMEOUT");
      app.exit(1);
    }, 10000).unref();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
