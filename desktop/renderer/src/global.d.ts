export {};

import type { FastSubClientBridge } from "./client/DaemonFastSubClient";

declare global {
  interface Window {
    fastSubSystem?: {
      selectMediaFiles: () => Promise<string[]>;
      selectMediaFolder: () => Promise<string[]>;
      selectFolder: () => Promise<string | null>;
      selectSubtitleOutputPath: (defaultPath: string) => Promise<string | null>;
      getPathForFile: (file: File) => string;
      openPathMock: (path: string) => Promise<boolean>;
      getSecuritySnapshot: () => Promise<{
        contextIsolation: boolean;
        nodeIntegration: boolean;
        csp: boolean;
        exposesRawIpc: boolean;
      }>;
    };
    fastSubClient?: FastSubClientBridge;
  }
}
