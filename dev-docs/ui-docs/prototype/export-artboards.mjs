import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const TARGET_URL = process.env.FAST_SUB_PROTOTYPE_URL ?? "http://127.0.0.1:5174/";
const OUTPUT_DIR = new URL("./reference/round11/", import.meta.url);
const OUTPUT_PATH = fileURLToPath(OUTPUT_DIR);

const artboards = [
  ["s1", "01-setup-environment-check"],
  ["s2", "02-setup-install-missing"],
  ["s2b", "03-setup-install-diagnostics"],
  ["s3", "04-setup-download-asr-model"],
  ["s4", "05-setup-download-translation-model"],
  ["s5", "06-setup-done"],
  ["s6", "07-setup-model-download-failed"],
  ["m1", "08-main-empty-drop-zone"],
  ["m2", "09-main-files-ready"],
  ["m2b", "10-main-advanced-settings"],
  ["m2c", "11-main-models-missing"],
  ["m2d", "12-main-output-conflict"],
  ["m3", "13-main-generating"],
  ["m4", "14-main-done-results"],
  ["t1", "15-tool-translate-srt"],
  ["t2", "16-tool-burn-in"],
  ["q1", "17-queue-list"],
  ["q2", "18-queue-detail"],
  ["q3", "19-queue-failed-detail"],
  ["st1", "20-settings-general"],
  ["st2", "21-settings-models"],
  ["st2b", "22-settings-model-maintenance"],
  ["st3", "23-settings-api"],
  ["st3b", "24-settings-api-upload-confirm"],
  ["st3c", "25-settings-providers"],
  ["st4", "26-settings-diagnostics"],
  ["st4a", "27-settings-daemon-recovery"],
  ["st4b", "28-settings-structured-diagnostics"],
  ["st5", "29-settings-config-mapping"],
  ["st6", "30-settings-benchmark-plan"]
];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getWebSocketDebuggerUrl() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT" });
      const payload = await response.json();
      if (typeof payload.webSocketDebuggerUrl === "string") {
        return payload.webSocketDebuggerUrl;
      }
    } catch {
      try {
        const response = await fetch("http://127.0.0.1:9222/json/list");
        const pages = await response.json();
        const page = pages.find((item) => item.type === "page" && typeof item.webSocketDebuggerUrl === "string");
        if (page) {
          return page.webSocketDebuggerUrl;
        }
      } catch {
        await delay(100);
      }
    }
  }
  throw new Error("Chrome DevTools endpoint did not become ready on 127.0.0.1:9222.");
}

function createCdpClient(url) {
  const socket = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id && pending.has(payload.id)) {
      const { resolve, reject } = pending.get(payload.id);
      pending.delete(payload.id);
      if (payload.error) {
        reject(new Error(payload.error.message));
      } else {
        resolve(payload.result);
      }
    }
  });

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  return {
    async send(method, params = {}) {
      await ready;
      const id = nextId;
      nextId += 1;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
    },
    async close() {
      await ready;
      socket.close();
    }
  };
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const wsUrl = await getWebSocketDebuggerUrl();
  const cdp = createCdpClient(wsUrl);

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1800,
    height: 1400,
    deviceScaleFactor: 1,
    mobile: false
  });
  await cdp.send("Page.navigate", { url: TARGET_URL });
  await delay(2500);
  await cdp.send("Runtime.evaluate", {
    expression: "document.fonts && document.fonts.ready",
    awaitPromise: true
  });

  const index = [];
  for (const [id, slug] of artboards) {
    const evaluation = await cdp.send("Runtime.evaluate", {
      expression: `(() => {
        const el = document.getElementById(${JSON.stringify(id)});
        if (!el) return null;
        const board = el.querySelector(':scope > div:nth-child(2)');
        const target = board || el;
        const rect = target.getBoundingClientRect();
        return {
          x: rect.x + window.scrollX,
          y: rect.y + window.scrollY,
          width: rect.width,
          height: rect.height,
          label: el.querySelector(':scope > div:first-child')?.textContent || ${JSON.stringify(slug)}
        };
      })()`,
      returnByValue: true
    });
    const rect = evaluation.result.value;
    if (!rect) {
      throw new Error(`Artboard not found: ${id}`);
    }
    const screenshot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: {
        x: Math.max(0, rect.x),
        y: Math.max(0, rect.y),
        width: rect.width,
        height: rect.height,
        scale: 1
      }
    });
    const fileName = `${slug}.png`;
    await writeFile(join(OUTPUT_PATH, fileName), Buffer.from(screenshot.data, "base64"));
    index.push({ id, label: rect.label, file: fileName, width: Math.round(rect.width), height: Math.round(rect.height) });
    console.log(`exported ${fileName}`);
  }

  const markdown = [
    "# Round 11 Prototype Visual References",
    "",
    `Source: ${TARGET_URL}`,
    "",
    "| # | Artboard | File | Size |",
    "|---:|---|---|---|",
    ...index.map((item, i) => `| ${i + 1} | ${item.label} | [${item.file}](./${item.file}) | ${item.width}x${item.height} |`),
    ""
  ].join("\n");
  await writeFile(new URL("./reference/round11/README.md", import.meta.url), markdown, "utf8");
  await cdp.close();
}

await main();
