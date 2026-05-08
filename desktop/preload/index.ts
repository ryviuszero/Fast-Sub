import { contextBridge, ipcRenderer } from "electron";

type SecuritySnapshot = {
  contextIsolation: boolean;
  nodeIntegration: boolean;
  csp: boolean;
  exposesRawIpc: boolean;
};

const api = {
  selectMediaFiles: (): Promise<string[]> => ipcRenderer.invoke("fast-sub:select-media-files") as Promise<string[]>,
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke("fast-sub:select-folder") as Promise<string | null>,
  openPathMock: (path: string): Promise<boolean> => ipcRenderer.invoke("fast-sub:open-path-mock", path) as Promise<boolean>,
  getSecuritySnapshot: (): Promise<SecuritySnapshot> =>
    ipcRenderer.invoke("fast-sub:security-snapshot") as Promise<SecuritySnapshot>
};

contextBridge.exposeInMainWorld("fastSubSystem", api);
