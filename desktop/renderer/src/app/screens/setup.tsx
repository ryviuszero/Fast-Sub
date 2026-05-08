import type { RenderProps } from "../types";
import { CheckItem, Chrome, Divider } from "../components";

export function SetupCheck({ environment, models, setScreen, installModel, repairDaemon }: RenderProps) {
  const disconnected = environment?.health === "disconnected";
  const asr = models.find((model) => model.id === "whisper-small");
  return (
    <div className="wf">
      <main className="content-flow setup-flow">
        <div>
          <h1>环境检查</h1>
          <p className="subtle">正在检查本机运行环境，确保一切就绪...</p>
        </div>
        <section className="panel paper-muted">
          <CheckItem label="本机环境" detail={`${environment?.os ?? "Windows"} · ${environment?.arch ?? "x64"} · ${environment?.memory ?? "16 GB 可用"} · ${environment?.disk ?? "240 GB 可用"}`} status="ready" />
          <Divider />
          <CheckItem label="FFmpeg / FFprobe" detail="用于提取音频轨" status={environment?.ffmpegReady ? "ready" : "checking"} />
          <Divider />
          <CheckItem label="Fast Sub 服务" status={disconnected ? "failed" : "ready"} />
          <Divider />
          <CheckItem label="本地 Worker" status={environment?.localTranscriptionReady ? "ready" : "pending"} />
          <Divider />
          <CheckItem label="模型存储目录" status={environment?.modelDirectoryReady ? "ready" : "pending"} />
          <Divider />
          <CheckItem label="网络连接" detail="首次需要下载模型" status="ready" />
        </section>
        {disconnected && (
          <section className="panel warn-panel">
            <h2>Fast Sub 服务暂时不可用</h2>
            <p>点击一键修复会重新准备本地服务状态。</p>
            <button className="btn primary" onClick={() => void repairDaemon()}>一键修复</button>
          </section>
        )}
        {asr?.state !== "ready" && (
          <section className="panel warn-panel">
            <h2>默认 ASR 模型未准备</h2>
            <p>下载完成后即可使用本地转写。</p>
            <button className="btn primary" onClick={() => void installModel("whisper-small")}>下载默认模型</button>
          </section>
        )}
        <div className="progress accent"><i style={{ width: disconnected ? "45%" : "100%" }} /></div>
        <p className="center-text caption">{disconnected ? "等待修复服务..." : "检查完成 6 / 6"}</p>
        <button className="btn primary setup-next" disabled={disconnected || asr?.state !== "ready"} onClick={() => setScreen("setup-done")}>进入主界面</button>
      </main>
    </div>
  );
}

export function SetupDone({ setScreen }: RenderProps) {
  return (
    <div className="wf">
      <Chrome />
      <main className="content-flow setup-flow">
        <div className="center-stack">
          <div className="success-mark">✓</div>
          <h1>准备就绪</h1>
          <p className="subtle">环境已配置完成，可以开始使用了。</p>
        </div>
        <section className="panel paper-muted">
          <h2>环境总结</h2>
          <CheckItem label="本地转写" detail="whisper-small · 本地处理" status="ready" />
          <Divider />
          <CheckItem label="本地翻译" detail="NLLB · 可稍后调整" status="ready" />
          <Divider />
          <CheckItem label="FFmpeg" detail="mock available" status="ready" />
          <Divider />
          <CheckItem label="远程 API" status="skip" />
        </section>
        <section className="panel dashed">
          <h2>默认配置</h2>
          <div className="summary-grid">
            <span>语言<strong>自动识别</strong></span>
            <span>输出<strong>SRT</strong></span>
            <span>位置<strong>与源文件相同</strong></span>
            <span>设备<strong>自动</strong></span>
          </div>
        </section>
        <div className="center-actions">
          <button className="btn ghost" onClick={() => setScreen("settings-general")}>更改设置</button>
          <button className="btn primary wide-action" onClick={() => setScreen("main-empty")}>进入主界面</button>
        </div>
      </main>
    </div>
  );
}
