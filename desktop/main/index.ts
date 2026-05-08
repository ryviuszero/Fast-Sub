import { app, BrowserWindow, Menu, dialog, ipcMain } from "electron";
import type { OpenDialogOptions } from "electron";
import { join } from "node:path";

const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL ?? (!app.isPackaged ? "http://localhost:5173" : "");
const SMOKE_MODE = process.env.FAST_SUB_SMOKE === "1";
const PROD_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";
const DEV_CSP = "default-src 'self' http://localhost:5173 ws://localhost:5173; script-src 'self' http://localhost:5173 'unsafe-inline' 'unsafe-eval'; style-src 'self' http://localhost:5173 'unsafe-inline'; img-src 'self' data: http://localhost:5173; font-src 'self' data: http://localhost:5173; connect-src 'self' http://localhost:5173 ws://localhost:5173; object-src 'none'; base-uri 'self'; frame-ancestors 'none'";

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

ipcMain.handle("fast-sub:open-path-mock", (_event, path: unknown) => {
  return typeof path === "string" && path.length > 0;
});

ipcMain.handle("fast-sub:security-snapshot", () => ({
  contextIsolation: true,
  nodeIntegration: false,
  csp: true,
  exposesRawIpc: false
}));

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
