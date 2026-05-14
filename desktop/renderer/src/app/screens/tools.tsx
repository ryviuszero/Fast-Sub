import { useRef, useState, type DragEvent } from "react";
import type { RenderProps } from "../types";
import { Chrome, SettingRow, SettingsEntry } from "../components";
import { useT } from "../i18n";

export function ToolTranslate({ setScreen, startToolJob, translationReady, providers, config, updateConfig }: RenderProps) {
  const t = useT();
  const srtInputRef = useRef<HTMLInputElement | null>(null);
  const [srtName, setSrtName] = useState(t("No SRT selected"));
  const [srtPath, setSrtPath] = useState("");
  const [translateStatus, setTranslateStatus] = useState<"idle" | "done" | "failed">("idle");
  const translationProviders = providers.filter((provider) => provider.capability === "translation");
  const translationProvider = translationProviders.find((provider) => provider.id === config.translationProvider);
  const usesWebTranslation = translationProvider?.id === "web-bing" || translationProvider?.id === "web-google";
  const providerReady = Boolean(translationProvider?.enabled && translationProvider.state === "available");
  const canTranslate = translationReady && providerReady;
  const readinessMessage = !providerReady
    ? t("Translation provider unavailable hint")
    : t("Default translation model not ready hint");
  const pickSrt = (files: FileList | null) => {
    const file = files?.[0];
    if (file) {
      setSrtName(file.name);
      setSrtPath(pathForFile(file));
      setTranslateStatus("idle");
    }
    if (srtInputRef.current) {
      srtInputRef.current.value = "";
    }
  };
  const dropSrt = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    pickSrt(event.dataTransfer.files);
  };
  const startTranslate = async () => {
    if (!canTranslate) {
      setTranslateStatus("idle");
      return;
    }
    if (!srtPath) {
      setTranslateStatus("failed");
      return;
    }
    await startToolJob("translate_srt", [srtPath]);
  };
  return (
    <div className="wf">
      <Chrome title={t("Translated subtitles")} back onBack={() => setScreen("main-empty")} />
      <main className="content-flow">
        <div><h2>{t("Translate existing SRT")}</h2><span className="caption">{t("Standalone translate tool description")}</span></div>
        <input ref={srtInputRef} aria-label={t("Choose SRT file")} className="native-file-picker" type="file" accept=".srt,.txt,.text,.md,.markdown,text/plain,text/markdown" onChange={(event) => pickSrt(event.currentTarget.files)} />
        <section className="drop-zone small" onClick={() => srtInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={dropSrt}><h2>{t("Drop SRT file")}</h2><span>{srtName}</span><div className="row gap-8"><button className="btn" onClick={(event) => { event.stopPropagation(); srtInputRef.current?.click(); }}>{t("Choose SRT")}</button><button className="btn ghost" onClick={(event) => event.stopPropagation()}>{t("Paste subtitle text")}</button></div></section>
        {!canTranslate && (
          <section className="panel warn-panel">
            <h2>{t("Translation environment not ready")}</h2>
            <p>{readinessMessage}</p>
            <div className="row gap-8">
              <button className="btn primary" onClick={() => setScreen("settings-providers")}>{t("Configure translation Provider")}</button>
              <button className="btn ghost" onClick={() => setScreen("settings-models")}>{t("View models")}</button>
            </div>
          </section>
        )}
        <section className="panel">
          <h3>{t("Translation settings")}</h3>
          <SettingRow label={t("Source language")}><select value={config.defaultLanguage} onChange={(event) => void updateConfig({ defaultLanguage: event.currentTarget.value })}><option value="auto">{t("Auto detect")}</option><option value="zh">{t("Chinese")}</option><option value="en">{t("English")}</option><option value="ja">{t("Japanese")}</option><option value="ko">{t("Korean")}</option></select></SettingRow>
          <SettingRow label={t("Target language")}><select value={config.targetLanguage} onChange={(event) => void updateConfig({ targetLanguage: event.currentTarget.value })}><option value="zh">{t("Simplified Chinese")}</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option></select></SettingRow>
          <div className="setting-row setting-row-top">
            <span>{t("Translation Provider")}</span>
            <div className="setting-control-with-note">
              <select aria-label={t("Translation Provider")} value={config.translationProvider} onChange={(event) => void updateConfig({ translationProvider: event.currentTarget.value })}>
                {translationProviders.map((provider) => <option key={provider.id} value={provider.id}>{providerOptionLabel(provider, t)}</option>)}
              </select>
              {usesWebTranslation && <p className="caption no-margin">{t("Web translation large file warning body")}</p>}
            </div>
          </div>
        </section>
        {translateStatus === "failed" && <section className="panel warn-panel"><h2>{t("Translation failed")}</h2><p>{t("Choose SRT file first")}</p></section>}
      </main>
      <div className="action-footer"><SettingsEntry onClick={() => setScreen("settings-general")} /><div className="row gap-8"><button className="btn primary" disabled={!canTranslate} onClick={() => void startTranslate()}>{t("Start translation")}</button></div></div>
    </div>
  );
}

function providerOptionLabel(provider: RenderProps["providers"][number], t: (key: string) => string): string {
  const prefix = provider.kind === "local" ? t("Local") : provider.kind === "web" ? t("Web") : provider.kind === "api" ? "API" : "Native";
  const state = provider.state === "available" ? "" : ` (${providerStateLabel(provider.state, t)})`;
  return `${prefix} · ${provider.name}${state}`;
}

function providerStateLabel(state: RenderProps["providers"][number]["state"], t: (key: string) => string): string {
  switch (state) {
    case "missing_dependency": return t("Missing dependency");
    case "missing_model": return t("Missing model");
    case "missing_api_key": return t("Missing API key");
    case "invalid_config": return t("Config needs review");
    case "disabled": return t("Disabled");
    case "not_implemented": return t("Unavailable");
    default: return t("Available");
  }
}

export function ToolBurnIn({ setScreen, startToolJob }: RenderProps) {
  const t = useT();
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const subtitleInputRef = useRef<HTMLInputElement | null>(null);
  const [videoName, setVideoName] = useState(t("No video selected"));
  const [videoPath, setVideoPath] = useState("");
  const [subtitleName, setSubtitleName] = useState(t("No subtitle selected"));
  const [subtitlePath, setSubtitlePath] = useState("");
  const [burnStatus, setBurnStatus] = useState<"idle" | "done" | "failed">("idle");
  const pickVideo = (files: FileList | null) => {
    const file = files?.[0];
    if (file) {
      setVideoName(file.name);
      setVideoPath(pathForFile(file));
      setBurnStatus("idle");
    }
    if (videoInputRef.current) {
      videoInputRef.current.value = "";
    }
  };
  const pickSubtitle = (files: FileList | null) => {
    const file = files?.[0];
    if (file) {
      setSubtitleName(file.name);
      setSubtitlePath(pathForFile(file));
      setBurnStatus("idle");
    }
    if (subtitleInputRef.current) {
      subtitleInputRef.current.value = "";
    }
  };
  const canBurn = Boolean(videoPath && subtitlePath);
  const startBurnIn = async () => {
    if (!canBurn) {
      setBurnStatus("failed");
      return;
    }
    await startToolJob("burn_in", [videoPath, subtitlePath]);
  };
  return (
    <div className="wf">
      <Chrome title={t("Burn-in subtitles")} back onBack={() => setScreen("main-empty")} />
      <main className="content-flow">
        <div><h2>{t("Burn subtitles into video")}</h2><span className="caption">{t("Standalone burn-in tool description")}</span></div>
        <input ref={videoInputRef} aria-label={t("Choose burn-in video file")} className="native-file-picker" type="file" accept=".mp4,.mov,.mkv,video/*" onChange={(event) => pickVideo(event.currentTarget.files)} />
        <input ref={subtitleInputRef} aria-label={t("Choose burn-in subtitle file")} className="native-file-picker" type="file" accept=".srt,.ass,.vtt,text/plain" onChange={(event) => pickSubtitle(event.currentTarget.files)} />
        <div className="two-col"><section className="drop-zone small" onClick={() => videoInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); pickVideo(event.dataTransfer.files); }}><h2>{t("Choose video")}</h2><span>{videoName}</span></section><section className="drop-zone small" onClick={() => subtitleInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); pickSubtitle(event.dataTransfer.files); }}><h2>{t("Choose subtitle")}</h2><span>{subtitleName}</span></section></div>
        {burnStatus === "failed" && <section className="panel warn-panel"><h2>{t("Burn-in failed")}</h2><p>{t("Choose video and subtitle first")}</p></section>}
      </main>
      <div className="action-footer"><SettingsEntry onClick={() => setScreen("settings-general")} /><div className="row gap-8"><button className="btn ghost" onClick={() => setScreen("main-empty")}>{t("Cancel")}</button><button className="btn primary" onClick={() => void startBurnIn()}>{t("Start burn-in")}</button></div></div>
    </div>
  );
}

function pathForFile(file: File): string {
  const bridgePath = window.fastSubSystem?.getPathForFile?.(file);
  if (bridgePath) {
    return bridgePath;
  }
  return (file as File & { path?: string }).path || file.name;
}
