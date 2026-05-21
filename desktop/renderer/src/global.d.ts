export {};

import type { FastSubClientBridge } from "./client/DaemonFastSubClient";
import type { FolderScanOptions } from "../../shared/contracts/types";

declare global {
  interface Window {
    fastSubSystem?: {
      selectMediaFiles: () => Promise<string[]>;
      selectMediaFolder: (options?: Partial<FolderScanOptions>) => Promise<string[]>;
      selectFolder: () => Promise<string | null>;
      selectSubtitleOutputPath: (defaultPath: string) => Promise<string | null>;
      getPathForFile: (file: File) => string;
      openPathMock: (path: string) => Promise<boolean>;
      openExternalURL: (url: string) => Promise<boolean>;
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
