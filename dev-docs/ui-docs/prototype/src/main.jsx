import React from "react";
import { createRoot } from "react-dom/client";
import { transform } from "@babel/standalone";
import designCanvasSource from "../design-canvas.jsx?raw";
import tweaksPanelSource from "../tweaks-panel.jsx?raw";
import sharedSource from "../v2/shared.jsx?raw";
import setupSource from "../v2/setup.jsx?raw";
import mainQueueSource from "../v2/main-queue.jsx?raw";
import settingsSource from "../v2/settings.jsx?raw";
import appSource from "../v2/app.jsx?raw";

window.React = React;
window.ReactDOM = { createRoot };

const sources = [
  designCanvasSource,
  tweaksPanelSource,
  sharedSource,
  setupSource,
  mainQueueSource,
  settingsSource,
  appSource,
];

for (const source of sources) {
  const { code } = transform(source, {
    presets: ["react"],
    filename: "fast-sub-ui-prototype.jsx",
  });
  (0, eval)(code);
}
