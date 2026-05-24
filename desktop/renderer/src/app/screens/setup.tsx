import type { RenderProps } from "../types";
import { CheckItem, Chrome, Divider } from "../components";
import { useRuntimeText, useT } from "../i18n";

export function SetupCheck(props: RenderProps) {
  const { environment, models, setScreen, installModel, repairDaemon, installFFmpegWithPackageManager } = props;
  const t = useT();
  const rt = useRuntimeText();
  const disconnected = environment?.health === "disconnected";
  const ffmpegInstalling = Boolean(environment?.ffmpegInstalling);
  const ffmpegMissing = environment ? !environment.ffmpegReady && !ffmpegInstalling : false;
  const asr = models.find((model) => model.id === "whisper-small");
  const asrModelKnownMissing = Boolean(asr && asr.state !== "ready");
  const localWorkerStatus = localWorkerCheckStatus(props);
  const asrInstallJob = asr ? props.modelInstallJobs[asr.id] : undefined;
  const asrInstalling = asr?.state === "installing" || asrInstallJob?.status === "queued" || asrInstallJob?.status === "running";
  const asrInstallBlocked = ffmpegInstalling;
  const asrInstallProgress = Math.max(0, Math.min(100, asrInstallJob?.progressPercent ?? asr?.progressPercent ?? 0));
  const memory = environment?.memory ? rt(environment.memory) : t("16 GB available");
  const disk = environment?.disk ? rt(environment.disk) : t("240 GB available");
  const ffmpegProgress = Math.max(0, Math.min(100, environment?.ffmpegInstallProgressPercent ?? 0));
  const ffmpegLogs = environment?.ffmpegInstallLogs ?? [];
  const ffmpegPackageManagers = packageManagersForOS(environment?.os);
  return (
    <div className="wf">
      <main className="content-flow setup-flow">
        <div>
          <h1>{t("Environment check")}</h1>
          <p className="subtle">{t("Checking local environment")}</p>
        </div>
        <section className="panel paper-muted">
          <CheckItem label={t("Local environment")} detail={`${environment?.os ?? "Windows"} · ${environment?.arch ?? "x64"} · ${memory} · ${disk}`} status="ready" />
          <Divider />
          <CheckItem label="FFmpeg / FFprobe" detail={environment?.ffmpegReady ? t("Used to extract audio tracks") : ffmpegInstalling ? t("FFmpeg installing detail") : t("FFmpeg auto install failed hint")} status={environment ? environment.ffmpegReady ? "ready" : ffmpegInstalling ? "checking" : "missing" : "checking"} />
          <Divider />
          <CheckItem label={t("Fast Sub service")} status={disconnected ? "failed" : "ready"} />
          <Divider />
          <CheckItem label={t("Local worker")} status={localWorkerStatus} />
          <Divider />
          <CheckItem label={t("Model storage directory")} status={environment?.modelDirectoryReady ? "ready" : "pending"} />
          <Divider />
          <CheckItem label={t("Network connection")} detail={t("Needed for first model download")} status="ready" />
        </section>
        {disconnected && (
          <section className="panel warn-panel">
            <h2>{t("Fast Sub service unavailable")}</h2>
            <p>{t("Repair service hint")}</p>
            <button className="btn primary" onClick={() => void repairDaemon()}>{t("Repair")}</button>
          </section>
        )}
        {ffmpegMissing && (
          <section className="panel warn-panel">
            <h2>{t("FFmpeg not ready")}</h2>
            <p>{t("FFmpeg auto install failed hint")}</p>
            <div className="row gap-8 wrap">
              <button className="btn primary" onClick={() => void repairDaemon()}>{t("Retry environment repair")}</button>
              {ffmpegPackageManagers.map((manager) => (
                <button className="btn" key={manager.id} onClick={() => void installFFmpegWithPackageManager(manager.id)}>{t(manager.label)}</button>
              ))}
            </div>
          </section>
        )}
        {ffmpegInstalling && (
          <section className="panel paper-muted">
            <h2>{t("Installing FFmpeg")}</h2>
            <p>{t("FFmpeg installing detail")}</p>
            <div className="progress accent"><i style={{ width: `${Math.max(8, ffmpegProgress)}%` }} /></div>
            <div className="diag-log" role="status" aria-label={t("FFmpeg install log")}>
              {(ffmpegLogs.length > 0 ? ffmpegLogs : [t("FFmpeg install starting")]).map((line) => <span key={line}>{rt(line)}</span>)}
            </div>
          </section>
        )}
        {asrModelKnownMissing && (
          <section className="panel warn-panel">
            <h2>{t("Default ASR model not ready")}</h2>
            <p>{t("Local transcription available after download")}</p>
            {asrInstalling && <div className="progress accent"><i style={{ width: `${Math.max(8, asrInstallProgress)}%` }} /></div>}
            {asrInstalling && <p className="caption no-margin">{t("Downloading")} {asrInstallProgress}%</p>}
            {asrInstallBlocked && !asrInstalling && <p className="caption no-margin">{t("Wait for FFmpeg install")}</p>}
            <button className="btn primary" disabled={asrInstalling || asrInstallBlocked} onClick={() => void installModel("whisper-small")}>{asrInstalling ? t("Downloading") : t("Download default model")}</button>
          </section>
        )}
        <div className="progress accent"><i style={{ width: disconnected || ffmpegMissing || ffmpegInstalling ? "45%" : "100%" }} /></div>
        <p className="center-text caption">{disconnected || ffmpegMissing || ffmpegInstalling ? t("Waiting for service repair") : t("Check complete 6 of 6")}</p>
        <button className="btn primary setup-next" disabled={disconnected || ffmpegMissing || ffmpegInstalling} onClick={() => setScreen(asrModelKnownMissing ? "main-empty" : "setup-done")}>{t("Enter app")}</button>
      </main>
    </div>
  );
}

function packageManagersForOS(os: string | undefined): Array<{ id: "scoop" | "winget" | "choco" | "brew"; label: string }> {
  if (os === "darwin") {
    return [{ id: "brew", label: "Install with Homebrew" }];
  }
  if (os === "win32" || !os) {
    return [
      { id: "scoop", label: "Install with Scoop" },
      { id: "winget", label: "Install with Winget" },
      { id: "choco", label: "Install with Chocolatey" }
    ];
  }
  return [];
}

function localWorkerCheckStatus(props: RenderProps): "ready" | "checking" | "missing" {
  if (!props.environment) {
    return "checking";
  }
  if (props.environment.health === "disconnected" || !props.environment.daemonReady) {
    return "checking";
  }
  const localFasterWhisper = props.providers.find((provider) => provider.id === "local-faster-whisper");
  if (!localFasterWhisper) {
    return props.environment.localTranscriptionReady ? "ready" : "checking";
  }
  return localFasterWhisper.state === "missing_dependency" ? "missing" : "ready";
}

export function SetupDone({ setScreen }: RenderProps) {
  const t = useT();
  return (
    <div className="wf">
      <Chrome />
      <main className="content-flow setup-flow">
        <div className="center-stack">
          <div className="success-mark">✓</div>
          <h1>{t("Setup ready")}</h1>
          <p className="subtle">{t("Environment ready message")}</p>
        </div>
        <section className="panel paper-muted">
          <h2>{t("Environment summary")}</h2>
          <CheckItem label={t("Local transcription")} detail={`whisper-small · ${t("local processing")}`} status="ready" />
          <Divider />
          <CheckItem label={t("Local translation")} detail={`NLLB · ${t("Can be adjusted later")}`} status="ready" />
          <Divider />
          <CheckItem label="FFmpeg" detail="mock available" status="ready" />
          <Divider />
          <CheckItem label={t("Remote API")} status="skip" />
        </section>
        <section className="panel dashed">
          <h2>{t("Default configuration")}</h2>
          <div className="summary-grid">
            <span>{t("Language")}<strong>{t("Auto detect")}</strong></span>
            <span>{t("Output")}<strong>SRT</strong></span>
            <span>{t("Location")}<strong>{t("Same as source file")}</strong></span>
            <span>{t("Device")}<strong>{t("Auto")}</strong></span>
          </div>
        </section>
        <div className="center-actions">
          <button className="btn ghost" onClick={() => setScreen("settings-general")}>{t("Change settings")}</button>
          <button className="btn primary wide-action" onClick={() => setScreen("main-empty")}>{t("Enter app")}</button>
        </div>
      </main>
    </div>
  );
}
