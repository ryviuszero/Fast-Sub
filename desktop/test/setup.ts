import "@testing-library/jest-dom/vitest";

Object.defineProperty(window, "fastSubSystem", {
  value: {
    selectMediaFiles: async () => [],
    selectMediaFolder: async () => [],
    selectFolder: async () => null,
    selectSubtitleOutputPath: async () => null,
    getPathForFile: (file: File) => (file as File & { path?: string }).path ?? file.name,
    openPathMock: async () => true,
    getSecuritySnapshot: async () => ({
      contextIsolation: true,
      nodeIntegration: false,
      csp: true,
      exposesRawIpc: false
    })
  },
  writable: true
});
