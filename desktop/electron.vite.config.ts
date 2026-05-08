import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/main",
      lib: {
        entry: resolve(__dirname, "main/index.ts")
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/preload",
      lib: {
        entry: resolve(__dirname, "preload/index.ts")
      },
      rollupOptions: {
        output: {
          entryFileNames: "index.cjs",
          format: "cjs"
        }
      }
    }
  },
  renderer: {
    root: ".",
    plugins: [react()],
    build: {
      outDir: "dist/renderer",
      rollupOptions: {
        input: resolve(__dirname, "index.html")
      }
    },
    server: {
      port: 5173,
      strictPort: false
    }
  }
});
