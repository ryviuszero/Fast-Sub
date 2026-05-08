import type { ReactNode } from "react";
import { Settings } from "lucide-react";
import type { MockScenario, ProviderStatus } from "../../../shared/contracts/types";
import { debugScreens, scenarioOptions } from "./fixtures";
import type { MediaFile, Screen } from "./types";

export function AppMenu({ canGoBack, canGoForward, onBack, onForward, onNavigate }: { canGoBack: boolean; canGoForward: boolean; onBack: () => void; onForward: () => void; onNavigate: (screen: Screen) => void }) {
  return (
    <header className="app-menu" aria-label="应用菜单">
      <button aria-label="返回" className="menu-icon" disabled={!canGoBack} onClick={onBack}>←</button>
      <button aria-label="前进" className="menu-icon" disabled={!canGoForward} onClick={onForward}>→</button>
      <div className="menu-popover">
        <button className="menu-label" type="button">窗口</button>
        <div className="menu-panel" role="menu">
          <button role="menuitem" onClick={() => onNavigate("main-empty")}>字幕生成</button>
          <button role="menuitem" onClick={() => onNavigate("tool-translate")}>翻译SRT</button>
          <button role="menuitem" onClick={() => onNavigate("tool-burn-in")}>字幕烧录</button>
        </div>
      </div>
      <div className="menu-popover">
        <button className="menu-label" type="button">帮助</button>
        <div className="menu-panel help-panel" role="menu">
          <button role="menuitem" type="button">Fast Sub Document</button>
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
  const spinning = status === "checking";
  const icon = status === "ready" ? "✓" : status === "missing" || status === "failed" ? "!" : status === "skip" ? "−" : "○";
  const labelMap = { ready: "已就绪", checking: "检查中", pending: "待检查", missing: "缺失", skip: "可跳过", failed: "安装失败" };
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
      <Chip tone={tone}>{labelMap[status]}</Chip>
    </div>
  );
}

export function RemoteConfirmDialog({ provider, files, onCancel, onConfirm }: { provider?: ProviderStatus; files: MediaFile[]; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-backdrop">
      <section className="modal-card upload-confirm">
        <div className="between"><h2>确认使用 API 服务</h2><span className="warn-symbol">!</span></div>
        <p>{provider?.name ?? "远程 Provider"} 需要上传音频或字幕文本，可能产生费用。确认前不会创建任务。</p>
        <section className="panel warn-panel">
          <KV k="上传内容" v={files.map((file) => file.name).join("、")} />
          <KV k="服务商" v={provider?.name ?? "OpenAI 音频转写 API"} />
          <KV k="API key" v="sk-••••••••••••" mono />
        </section>
        <div className="row gap-8 end"><button className="btn ghost" onClick={onCancel}>取消</button><button className="btn primary" onClick={onConfirm}>确认并继续</button></div>
      </section>
    </div>
  );
}

export function DebugPanel({ screen, setScreen, scenario, setScenario, disabledScenario }: { screen: Screen; setScreen: (screen: Screen) => void; scenario: MockScenario; setScenario: (scenario: MockScenario) => void; disabledScenario: boolean }) {
  const groups = [
    ["页面", debugScreens],
    ["场景", scenarioOptions]
  ] as const;
  return (
    <aside className="debug-panel">
      <div className="debug-head"><strong>调试</strong><span>Ctrl+D</span></div>
      <h3>{groups[0][0]}</h3>
      <div className="debug-grid">
        {debugScreens.map((item) => <button key={item.id} className={screen === item.id ? "active" : ""} onClick={() => setScreen(item.id)}>{item.label}</button>)}
      </div>
      <h3>{groups[1][0]}</h3>
      <select value={scenario} onChange={(event) => setScenario(event.target.value as MockScenario)} disabled={disabledScenario}>
        {scenarioOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
    </aside>
  );
}

export function Footer({ onHistory, onSettings }: { onHistory: () => void; onSettings: () => void }) {
  return (
    <footer className="footer-line">
      <SettingsEntry onClick={onSettings} />
      <div className="row gap-8"><span>无进行中的任务</span><button className="btn sm ghost" onClick={onHistory}>历史记录</button></div>
    </footer>
  );
}

export function SettingsEntry({ onClick }: { onClick: () => void }) {
  return (
    <button className="settings-entry" onClick={onClick} type="button">
      <Settings aria-hidden="true" size={18} strokeWidth={2.2} />
      <span>设置</span>
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
