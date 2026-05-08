import "@testing-library/jest-dom/vitest";

Object.defineProperty(window, "fastSubSystem", {
  value: {
    selectMediaFiles: async () => [],
    selectFolder: async () => null,
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
