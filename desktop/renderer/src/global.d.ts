export {};

declare global {
  interface Window {
    fastSubSystem?: {
      selectMediaFiles: () => Promise<string[]>;
      selectFolder: () => Promise<string | null>;
      openPathMock: (path: string) => Promise<boolean>;
      getSecuritySnapshot: () => Promise<{
        contextIsolation: boolean;
        nodeIntegration: boolean;
        csp: boolean;
        exposesRawIpc: boolean;
      }>;
    };
  }
}
