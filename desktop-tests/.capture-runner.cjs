const { app, BrowserWindow } = require("electron");
const { writeFile } = require("node:fs/promises");
const { join } = require("node:path");

const targetUrl = process.env.FAST_SUB_DESKTOP_TEST_URL;
const picsDir = process.env.FAST_SUB_DESKTOP_TEST_PICS;
console.log(`[capture] target=${targetUrl || ""} pics=${picsDir || ""}`);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function clickByText(win, text) {
  await win.webContents.executeJavaScript(`
    (() => {
      const button = Array.from(document.querySelectorAll("button")).find((item) => item.textContent.trim() === ${JSON.stringify(text)});
      if (!button) throw new Error("button not found: ${text}");
      button.click();
    })()
  `);
  await sleep(200);
}

async function openDebug(win) {
  await win.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('button[aria-label="打开调试面板"]');
      if (!button) throw new Error("debug button not found");
      button.click();
    })()
  `);
  await sleep(200);
}

async function setDebugScreen(win, screenLabel) {
  await openDebug(win);
  await win.webContents.executeJavaScript(`
    (() => {
      const button = Array.from(document.querySelectorAll(".debug-panel button")).find((item) => item.textContent.trim() === ${JSON.stringify(screenLabel)});
      if (!button) throw new Error("debug screen not found: ${screenLabel}");
      button.click();
    })()
  `);
  await sleep(250);
  await openDebug(win);
}

async function addSyntheticFiles(win) {
  await win.webContents.executeJavaScript(`
    (() => {
      const input = document.querySelector('input[aria-label="选择视频文件"]');
      const data = new DataTransfer();
      data.items.add(new File(["mock"], "real-audit-input.mp4", { type: "video/mp4" }));
      Object.defineProperty(data.files[0], "path", { value: "F:\\\\game\\\\others\\\\real-audit-input.mp4" });
      input.files = data.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    })()
  `);
  await sleep(300);
}

async function capture(win, fileName) {
  const image = await win.webContents.capturePage();
  await writeFile(join(picsDir, fileName), image.toPNG());
  console.log(`[capture] ${fileName}`);
}

(async () => {
  await app.whenReady();
  const win = new BrowserWindow({
    width: 1748,
    height: 1116,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  await win.loadURL(targetUrl);
  await sleep(800);
  await capture(win, "01-setup-check.png");

  await clickByText(win, "进入主界面");
  await clickByText(win, "进入主界面");
  await capture(win, "02-main-empty.png");

  await addSyntheticFiles(win);
  await capture(win, "03-main-files-real-path.png");

  await clickByText(win, "生成字幕");
  await sleep(120);
  await capture(win, "04-main-generating-real-job.png");

await sleep(2200);
  await capture(win, "05-main-done-real-result.png");

  await setDebugScreen(win, "失败详情");
  await capture(win, "06-queue-failed-no-hardcoded-fallback.png");

  await app.quit();
})().catch((error) => {
  console.error(error);
  app.exit(1);
});
