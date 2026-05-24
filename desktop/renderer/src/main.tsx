import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

window.fastSubSystem?.reportStartupTiming?.("renderer-entry", {
  performance_now_ms: Math.round(performance.now())
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

window.fastSubSystem?.reportStartupTiming?.("react-render-called", {
  performance_now_ms: Math.round(performance.now())
});
