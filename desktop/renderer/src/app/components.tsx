import type { ReactNode } from "react";
import { Settings } from "lucide-react";
import type { JobDetail, JobSummary, MockScenario, ProviderStatus } from "../../../shared/contracts/types";
import { debugScreens, scenarioOptions } from "./fixtures";
import { useRuntimeText, useT } from "./i18n";
import type { MediaFile, Screen } from "./types";

const HELP_DOCUMENT_URL = "https://ryviuszero.github.io/Fast-Sub/";

export function AppMenu({ canGoBack, canGoForward, onBack, onForward, onNavigate }: { canGoBack: boolean; canGoForward: boolean; onBack: () => void; onForward: () => void; onNavigate: (screen: Screen) => void }) {
  const t = useT();
  const openHelpDocument = () => {
    void window.fastSubSystem?.openExternalURL(HELP_DOCUMENT_URL);
  };
  return (
    <header className="app-menu" aria-label={t("Application menu")}>
      <button aria-label={t("Back")} className="menu-icon" disabled={!canGoBack} onClick={onBack}>←</button>
      <button aria-label={t("Forward")} className="menu-icon" disabled={!canGoForward} onClick={onForward}>→</button>
      <div className="menu-popover">
        <button className="menu-label" type="button">{t("Window")}</button>
        <div className="menu-panel" role="menu">
          <button role="menuitem" onClick={() => onNavigate("main-empty")}>{t("Generate subtitles")}</button>
          <button role="menuitem" onClick={() => onNavigate("tool-translate")}>{t("Translate SRT")}</button>
          <button role="menuitem" onClick={() => onNavigate("tool-burn-in")}>{t("Burn-in subtitles")}</button>
        </div>
      </div>
      <div className="menu-popover">
        <button className="menu-label" type="button">{t("Help")}</button>
        <div className="menu-panel help-panel" role="menu">
          <button role="menuitem" type="button" onClick={openHelpDocument}>{t("Fast Sub Document")}</button>
        </div>
      </div>
    </header>
  );
}

export function Chrome(props: { title?: string; right?: ReactNode; back?: boolean; onBack?: () => void }) {
  const { title = "Fast Sub", right, back } = props;
  if (!back && !right && title === "Fast Sub") {
    return null;
  }
  return (
    <div className="chrome">
      <span className="spacer" />
      {right}
    </div>
  );
}

export function Chip({ tone = "muted", children }: { tone?: "ok" | "accent" | "warn" | "muted"; children: ReactNode }) {
  return <span className={`chip ${tone}`}>{children}</span>;
}

export function CheckItem({ label, detail, status }: { label: string; detail?: string; status: "ready" | "checking" | "pending" | "missing" | "skip" | "failed" }) {
  const t = useT();
  const spinning = status === "checking";
  const icon = status === "ready" ? "✓" : status === "missing" || status === "failed" ? "!" : status === "skip" ? "−" : "○";
  const labelMap = { ready: "Ready status", checking: "Checking", pending: "Pending", missing: "Missing", skip: "Optional", failed: "Install failed" };
  const tone = status === "ready" ? "ok" : status === "checking" ? "accent" : status === "missing" || status === "failed" ? "warn" : "muted";
  return (
    <div className="check-row">
      <div className="row mid gap-8">
        {spinning ? <span className="spin" /> : <span className={`check-icon ${tone}`}>{icon}</span>}
        <div className="col">
          <span className="body-strong">{label}</span>
          {detail && <span className="caption">{detail}</span>}
        </div>
      </div>
      <Chip tone={tone}>{t(labelMap[status])}</Chip>
    </div>
  );
}

export function RemoteConfirmDialog({ provider, files, onCancel, onConfirm }: { provider?: ProviderStatus; files: MediaFile[]; onCancel: () => void; onConfirm: () => void }) {
  const t = useT();
  const rt = useRuntimeText();
  const previewLimit = 24;
  const uploadPreview = files.slice(0, previewLimit).map((file) => file.name).join("、");
  const remainingFiles = Math.max(0, files.length - previewLimit);
  const providerName = provider?.name ? rt(provider.name) : t("Remote Provider");
  return (
    <div className="modal-backdrop">
      <section className="modal-card upload-confirm">
        <div className="between"><h2>{t("Confirm API provider")}</h2><span className="warn-symbol">!</span></div>
        <p>{providerName} {t("Remote provider upload warning")}</p>
        <section className="panel warn-panel upload-confirm-body">
          <div className="upload-confirm-list">
            <span>{t("Upload content")}</span>
            <strong>{remainingFiles > 0 ? t("Upload preview with more", { preview: uploadPreview, count: remainingFiles }) : uploadPreview}</strong>
          </div>
          <KV k={t("Provider")} v={providerName} />
          <KV k="API key" v="sk-••••••••••••" mono />
        </section>
        <div className="row gap-8 end upload-confirm-actions"><button className="btn ghost" onClick={onCancel} type="button">{t("Cancel")}</button><button className="btn primary" onClick={onConfirm} type="button">{t("Confirm and continue")}</button></div>
      </section>
    </div>
  );
}

export function NativeDependencyDialog({ message, onCancel, onChooseDirectory, onInstall }: { message: string; onCancel: () => void; onChooseDirectory: () => void; onInstall: () => void }) {
  const t = useT();
  const rt = useRuntimeText();
  return (
    <div className="modal-backdrop">
      <section className="modal-card upload-confirm">
        <div className="between"><h2>{t("FFmpeg required title")}</h2><span className="warn-symbol">!</span></div>
        <p>{t("FFmpeg required body")}</p>
        <section className="panel warn-panel upload-confirm-body">
          <p className="caption no-margin">{rt(message)}</p>
          <p className="caption no-margin">{t("FFmpeg private download note")}</p>
        </section>
        <div className="row gap-8 end upload-confirm-actions">
          <button className="btn ghost" onClick={onCancel} type="button">{t("Cancel")}</button>
          <button className="btn" onClick={onChooseDirectory} type="button">{t("Choose FFmpeg directory")}</button>
          <button className="btn primary" onClick={onInstall} type="button">{t("Download FFmpeg")}</button>
        </div>
      </section>
    </div>
  );
}

export function DebugPanel({ screen, setScreen, scenario, setScenario, disabledScenario }: { screen: Screen; setScreen: (screen: Screen) => void; scenario: MockScenario; setScenario: (scenario: MockScenario) => void; disabledScenario: boolean }) {
  const t = useT();
  const groups = [
    ["Pages", debugScreens],
    ["Scenarios", scenarioOptions]
  ] as const;
  return (
    <aside className="debug-panel">
      <div className="debug-head"><strong>{t("Debug")}</strong><span>Ctrl+D</span></div>
      <h3>{t(groups[0][0])}</h3>
      <div className="debug-grid">
        {debugScreens.map((item) => <button key={item.id} className={screen === item.id ? "active" : ""} onClick={() => setScreen(item.id)}>{t(item.labelKey)}</button>)}
      </div>
      <h3>{t(groups[1][0])}</h3>
      <select value={scenario} onChange={(event) => setScenario(event.target.value as MockScenario)} disabled={disabledScenario}>
        {scenarioOptions.map((item) => <option key={item.value} value={item.value}>{t(item.labelKey)}</option>)}
      </select>
    </aside>
  );
}

export function Footer({ activeJob, jobs, onHistory, onSettings }: { activeJob?: JobDetail | null; jobs?: JobSummary[]; onHistory: () => void; onSettings: () => void }) {
  const t = useT();
  const activeStatuses = new Set(["queued", "running", "canceling"]);
  const activeIds = new Set((jobs ?? []).filter((job) => activeStatuses.has(job.status)).map((job) => job.id));
  if (activeJob && activeStatuses.has(activeJob.status)) {
    activeIds.add(activeJob.id);
  }
  const activeCount = activeIds.size;
  return (
    <footer className="footer-line">
      <SettingsEntry onClick={onSettings} />
      <div className="row gap-8">
        <span>{activeCount > 0 ? t("Active tasks", { count: activeCount }) : t("No active tasks")}</span>
        <button className="btn sm ghost" onClick={onHistory}>{t(activeCount > 0 ? "View active tasks" : "History")}</button>
      </div>
    </footer>
  );
}

export function SettingsEntry({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button className="settings-entry" onClick={onClick} type="button">
      <Settings aria-hidden="true" size={18} strokeWidth={2.2} />
      <span>{t("Settings")}</span>
    </button>
  );
}

export function Divider() {
  return <div className="divider" />;
}

export function Tabs({ items, active, onSelect }: { items: string[]; active: number; onSelect?: (index: number) => void }) {
  return (
    <div className="tabs">
      {items.map((item, index) => onSelect ? (
        <button className={index === active ? "on" : ""} key={item} onClick={() => onSelect(index)} type="button">{item}</button>
      ) : (
        <span className={index === active ? "on" : ""} key={item}>{item}</span>
      ))}
    </div>
  );
}

export function Segment({ items, active, onSelect }: { items: string[]; active: number; onSelect?: (index: number) => void }) {
  return (
    <div className="seg">
      {items.map((item, index) => onSelect ? (
        <button className={index === active ? "on" : ""} key={item} onClick={() => onSelect(index)} type="button">{item}</button>
      ) : (
        <span className={index === active ? "on" : ""} key={item}>{item}</span>
      ))}
    </div>
  );
}

export function Toggle({ on, onClick, ariaLabel }: { on: boolean; onClick?: () => void; ariaLabel?: string }) {
  if (onClick) {
    return <button aria-label={ariaLabel} aria-pressed={on} className={`toggle ${on ? "on" : ""}`} onClick={onClick} type="button"><i /></button>;
  }
  return <span className={`toggle ${on ? "on" : ""}`}><i /></span>;
}

export function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="setting-row"><span>{label}</span>{children}</div>;
}

export function KV({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return <div className="kv"><span>{k}</span><strong className={mono ? "mono" : ""}>{v}</strong></div>;
}
