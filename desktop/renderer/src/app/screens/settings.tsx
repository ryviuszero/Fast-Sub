import { useEffect, useRef, useState, type RefObject } from "react";
import type { ConfigViewModel, LocalDataCleanupTarget, ModelStatus, ProviderState, ProviderStatus } from "../../../../shared/contracts/types";
import { redactSecretText } from "../../../../shared/privacy/redaction";
import type { RenderProps, Screen, UiFontStyle, UiLanguage } from "../types";
import { Chip, Chrome, KV, Segment, SettingRow, Toggle } from "../components";
import { useT } from "../i18n";
import packageJson from "../../../../package.json";

export function SettingsPage(props: RenderProps & { tab: "general" | "models" | "api" | "providers" | "diagnostics" | "benchmark" }) {
  const t = useT();
  return (
    <div className="wf">
      <Chrome title={t("Settings")} />
      <main className="settings-shell">
        <aside className="settings-nav">
          {[
            ["settings-general", "◎", t("General")],
            ["settings-models", "◇", t("Models")],
            ["settings-providers", "◌", t("Provider")],
            ["settings-diagnostics", "⚙", t("Diagnostics")],
            ["settings-benchmark", "▣", t("Benchmark")]
          ].map(([id, icon, label]) => <button key={id} className={props.screen === id ? "active" : ""} onClick={() => id === "settings-providers" ? props.openProviderSettings() : props.setScreen(id as Screen)}>{icon} {label}</button>)}
          <span className="caption version">v{packageJson.version}</span>
        </aside>
        <section className="settings-content">
          {props.tab === "general" && <SettingsGeneral {...props} />}
          {props.tab === "models" && <SettingsModels {...props} />}
          {props.tab === "providers" && <SettingsProviders {...props} />}
          {props.tab === "diagnostics" && <SettingsDiagnostics {...props} />}
          {props.tab === "benchmark" && <SettingsBenchmark />}
        </section>
      </main>
    </div>
  );
}

export function SettingsGeneral(props: RenderProps) {
  const t = useT();
  const [translationOutputWarning, setTranslationOutputWarning] = useState(false);
  const uiLanguages: Array<{ label: string; value: UiLanguage }> = [
    { label: t("Follow system"), value: "system" },
    { label: t("Simplified Chinese"), value: "zh" },
    { label: "English", value: "en" }
  ];
  const fontStyles: Array<{ label: string; value: UiFontStyle }> = [
    { label: t("System font"), value: "system" },
    { label: t("Handwritten font"), value: "sketch" }
  ];
  const outputTypes: Array<{ label: string; value: ConfigViewModel["outputType"] }> = [
    { label: t("Original subtitles"), value: "original_srt" },
    { label: t("Translated subtitles"), value: "translated_srt" },
    { label: t("Bilingual subtitles"), value: "bilingual_srt" }
  ];
  const outputFormats: Array<{ label: string; value: ConfigViewModel["outputFormat"] }> = [
    { label: "SRT", value: "srt" },
    { label: "VTT", value: "vtt" },
    { label: "TXT", value: "txt" },
    { label: "JSON", value: "json" }
  ];
  const conflictModes: Array<{ label: string; value: ConfigViewModel["outputConflict"] }> = [
    { label: t("Ask"), value: "ask" },
    { label: t("Overwrite"), value: "overwrite" },
    { label: t("Skip"), value: "skip" }
  ];
  const outputTypeIndex = Math.max(0, outputTypes.findIndex((item) => item.value === props.config.outputType));
  const outputFormatIndex = Math.max(0, outputFormats.findIndex((item) => item.value === props.config.outputFormat));
  const conflictIndex = Math.max(0, conflictModes.findIndex((item) => item.value === props.config.outputConflict));
  const deviceIndex = props.config.device === "cpu" ? 1 : props.config.device === "gpu" ? 2 : 0;
  const folderScanMaxOptions = [50, 100, 200, 500];
  const uiLanguageIndex = Math.max(0, uiLanguages.findIndex((item) => item.value === props.uiLanguage));
  const fontStyleIndex = Math.max(0, fontStyles.findIndex((item) => item.value === props.uiFontStyle));
  const asrProviders = props.providers.filter((provider) => provider.capability === "stt");
  const translationProviders = props.providers.filter((provider) => provider.capability === "translation");
  const canUseTranslationOutput = translationOutputReady(props.config, props.providers, props.translationReady);
  const selectOutputType = (outputType: ConfigViewModel["outputType"]) => {
    if (outputTypeNeedsTranslation(outputType) && !canUseTranslationOutput) {
      setTranslationOutputWarning(true);
      return;
    }
    setTranslationOutputWarning(false);
    void props.updateConfig({ outputType });
  };
  return (
    <div className="settings-list">
      <h2>{t("General")}</h2>
      <h3>{t("Interface")}</h3>
      <SettingRow label={t("Language")}><Segment items={uiLanguages.map((item) => item.label)} active={uiLanguageIndex} onSelect={(index) => props.setUiLanguage(uiLanguages[index].value)} /></SettingRow>
      <SettingRow label={t("Font")}><Segment items={fontStyles.map((item) => item.label)} active={fontStyleIndex} onSelect={(index) => props.setUiFontStyle(fontStyles[index].value)} /></SettingRow>
      <SettingRow label={t("Scan subfolders")}><Toggle ariaLabel={t("Set scan subfolders")} on={props.config.folderScanIncludeSubfolders} onClick={() => void props.updateConfig({ folderScanIncludeSubfolders: !props.config.folderScanIncludeSubfolders })} /></SettingRow>
      <SettingRow label={t("Maximum folder files")}><select aria-label={t("Maximum folder files")} value={props.config.folderScanMaxFiles} onChange={(event) => void props.updateConfig({ folderScanMaxFiles: Number(event.currentTarget.value) })}>{folderScanMaxOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></SettingRow>
      <h3>{t("Transcription")}</h3>
      <SettingRow label={t("Default transcription Provider")}>
        <ProviderDropdown
          label={t("Default transcription Provider")}
          providers={asrProviders}
          value={props.config.asrProvider}
          onChange={(value) => void props.updateConfig({ asrProvider: value })}
        />
      </SettingRow>
      <SettingRow label={t("Device")}><Segment items={[t("Auto"), "CPU", "GPU"]} active={deviceIndex} onSelect={(index) => void props.updateConfig({ device: (["auto", "cpu", "gpu"] as ConfigViewModel["device"][])[index] })} /></SettingRow>
      <SettingRow label={t("Word timestamps")}><Toggle ariaLabel={t("Set word timestamps")} on={props.config.wordTimestamps} onClick={() => void props.updateConfig({ wordTimestamps: !props.config.wordTimestamps })} /></SettingRow>
      <h3>{t("Translation")}</h3>
      <SettingRow label={t("Default translation Provider")}>
        <ProviderDropdown
          label={t("Default translation Provider")}
          providers={translationProviders}
          value={props.config.translationProvider}
          onChange={(value) => void props.updateConfig({ translationProvider: value })}
        />
      </SettingRow>
      <SettingRow label={t("Target language")}><select value={props.config.targetLanguage} onChange={(event) => void props.updateConfig({ targetLanguage: event.target.value })}><option value="zh">{t("Simplified Chinese")}</option><option value="en">{t("English")}</option><option value="ja">{t("Japanese")}</option><option value="ko">{t("Korean")}</option></select></SettingRow>
      <h3>{t("Defaults")}</h3>
      <SettingRow label={t("Output content")}><Segment items={outputTypes.map((item) => item.label)} active={outputTypeIndex} onSelect={(index) => selectOutputType(outputTypes[index].value)} /></SettingRow>
      {translationOutputWarning && (
        <div className="blocking-note" role="status">
          <span>{t("Translation output not ready")}</span>
          <button className="btn sm primary" onClick={() => props.openProviderSettings("translation")} type="button">{t("Configure translation Provider")}</button>
        </div>
      )}
      <SettingRow label={t("Subtitle language")}><select value={props.config.defaultLanguage} onChange={(event) => void props.updateConfig({ defaultLanguage: event.target.value })}><option value="auto">{t("Auto detect")}</option><option value="zh">{t("Chinese")}</option><option value="en">{t("English")}</option><option value="ja">{t("Japanese")}</option><option value="ko">{t("Korean")}</option></select></SettingRow>
      <SettingRow label={t("Output format")}><Segment items={outputFormats.map((item) => item.label)} active={outputFormatIndex} onSelect={(index) => void props.updateConfig({ outputFormat: outputFormats[index].value })} /></SettingRow>
      <SettingRow label={t("Burn-in video")}><Toggle ariaLabel={t("Burn-in video")} on={props.config.burnInVideo} onClick={() => void props.updateConfig({ burnInVideo: !props.config.burnInVideo })} /></SettingRow>
      <SettingRow label={t("When file exists")}><Segment items={conflictModes.map((item) => item.label)} active={conflictIndex} onSelect={(index) => void props.updateConfig({ outputConflict: conflictModes[index].value })} /></SettingRow>
    </div>
  );
}

function ProviderDropdown({ label, providers, value, onChange }: { label: string; providers: ProviderStatus[]; value: string; onChange: (value: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const selected = providers.find((provider) => provider.id === value) ?? providers[0];
  const selectProvider = (provider: ProviderStatus) => {
    if (!provider.enabled || provider.state !== "available") {
      return;
    }
    setOpen(false);
    onChange(provider.id);
  };
  return (
    <div className="settings-provider-dropdown">
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        className="quick-select-button settings-provider-button"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{selected ? providerOptionLabel(selected, t) : t("Not configured")}</span>
        <span aria-hidden="true">›</span>
      </button>
      {open && (
        <div className="quick-select-menu settings-provider-menu" role="listbox">
          {providers.map((provider) => {
            const disabled = !provider.enabled || provider.state !== "available";
            return (
              <button
                aria-selected={provider.id === value}
                className={provider.id === value ? "selected" : ""}
                disabled={disabled}
                key={provider.id}
                onClick={() => selectProvider(provider)}
                role="option"
                title={disabled ? providerStateLabel(provider.state, t) : undefined}
                type="button"
              >
                {providerOptionLabel(provider, t)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function outputTypeNeedsTranslation(outputType: ConfigViewModel["outputType"]): boolean {
  return outputType === "translated_srt" || outputType === "bilingual_srt";
}

function translationOutputReady(config: ConfigViewModel, providers: ProviderStatus[], translationReady: boolean): boolean {
  const provider = providers.find((item) => item.id === config.translationProvider);
  return translationReady && Boolean(provider && providerCanRun(provider));
}

function providerCanRun(provider: ProviderStatus): boolean {
  if (!provider.enabled || provider.state !== "available") {
    return false;
  }
  return provider.kind !== "api" || provider.checkMode === "live";
}

export function SettingsModels({ models, modelInstallJobs, installModel, removeModel, config, updateConfig }: RenderProps) {
  const t = useT();
  const asrModels = models.filter((model) => model.kind === "asr");
  const translationModels = models.filter((model) => model.kind === "translation");
  return (
    <div className="settings-list">
      <div className="between"><h2>{t("Model management")}</h2><span className="caption">{t("Storage path")}: ~/.fastsub/models</span></div>
      <p className="caption">{t("Models page description")}</p>
      <h3>{t("Transcription models")}</h3>
      {asrModels.map((model) => (
        <ModelCard key={model.id} model={model} installJob={modelInstallJobs[model.id]} isDefault={config.asrModel === model.id || Boolean(model.defaultFor?.includes(config.asrProvider))} onInstall={() => void installModel(model.id)} onRemove={() => void removeModel(model.id)} onDefault={() => void updateConfig({ asrModel: model.id })} />
      ))}
      <h3>{t("Translation models")}</h3>
      {translationModels.map((model) => (
        <ModelCard key={model.id} model={model} installJob={modelInstallJobs[model.id]} isDefault={config.translationModel === model.id || Boolean(model.defaultFor?.includes(config.translationProvider))} onInstall={() => void installModel(model.id)} onRemove={() => void removeModel(model.id)} onDefault={() => void updateConfig({ translationModel: model.id })} />
      ))}
    </div>
  );
}

function ModelCard({ model, installJob, isDefault, onInstall, onRemove, onDefault }: { model: ModelStatus; installJob?: RenderProps["activeJob"]; isDefault: boolean; onInstall: () => void; onRemove: () => void; onDefault: () => void }) {
  const t = useT();
  const taskLabel = model.kind === "translation" ? t("Translation") : t("Transcription");
  const installing = installJob?.status === "queued" || installJob?.status === "running" || installJob?.status === "canceling" || model.state === "installing";
  const failed = installJob?.status === "failed" || model.state === "failed";
  const ready = installJob?.status === "succeeded" || model.state === "ready";
  const missing = !installing && !failed && !ready;
  const progress = Math.max(0, Math.min(100, installJob?.progressPercent ?? model.progressPercent ?? 0));
  const stageLabel = modelInstallStageLabel(installJob, t);
  const failureMessage = installJob?.error?.message || model.diagnostic;
  const failureAction = installJob?.error?.action;
  const failureDiagnostic = installJob?.error?.diagnostic && installJob.error.diagnostic !== failureMessage ? installJob.error.diagnostic : "";
  const recentLogs = installJob?.logs?.slice(-3) ?? [];
  return (
    <article className={`model-card model-card-rich ${ready ? "ok-card" : "dashed"}`}>
      <div className="model-main">
        <div className="row gap-8 wrap">
          <strong>{model.name}</strong>
          {isDefault && <Chip tone="accent">{t("Current default")}</Chip>}
          <Chip>{taskLabel}</Chip>
          {model.backend && <Chip tone="muted">{model.backend}</Chip>}
        </div>
        <span>{model.sizeLabel} · {t("Compatible with")} {formatProviders(model.compatibleProviders, t)}</span>
        <p className="caption no-margin">{modelRecommendation(model, t)}</p>
        {installing && (
          <div className="model-install-progress" role="status" aria-label={t("Model download progress", { name: model.name })}>
            <div className="between">
              <strong>{progress}%</strong>
              <span>{stageLabel}</span>
            </div>
            <div className="bar sm"><span style={{ width: `${progress}%` }} /></div>
          </div>
        )}
        {failed && failureMessage && <p className="caption warn-text no-margin">{failureMessage}</p>}
        {failed && failureAction && <p className="caption no-margin">{failureAction}</p>}
        {failed && failureDiagnostic && <p className="caption mono no-margin">{failureDiagnostic}</p>}
        {recentLogs.length > 0 && (
          <div className="model-install-log" aria-label="模型安装日志">
            {recentLogs.map((log, index) => (
              <p key={`${log.time}-${index}`} className={`caption no-margin ${log.level === "error" ? "warn-text" : ""}`}>{log.message}</p>
            ))}
          </div>
        )}
      </div>
      <div className="row gap-8 wrap end">
        {ready && <Chip tone="ok">{t("Available")}</Chip>}
        {installing && <Chip tone="accent">{t("Downloading")} {progress}%</Chip>}
        {failed && <Chip tone="warn">{t("Install failed")}</Chip>}
        {missing && <Chip tone="muted">{t("Not installed")}</Chip>}
        {ready && !isDefault && <button className="btn sm ghost" onClick={onDefault}>{t("Set as default")}</button>}
        {failed && <button className="btn sm" onClick={onInstall}>{t("Retry download")}</button>}
        {missing && <button className="btn sm" onClick={onInstall}>{t("Download")}</button>}
        {!missing && <button className="btn sm ghost" onClick={onRemove}>{t("Remove")}</button>}
      </div>
    </article>
  );
}

function providerStateLabel(state: ProviderState, t: (key: string) => string = (key) => key): string {
  const labels: Record<ProviderState, string> = {
    available: "Available",
    missing_dependency: "Missing dependency",
    missing_model: "Missing model",
    missing_api_key: "Missing API key",
    invalid_config: "Config needs review",
    disabled: "Disabled",
    not_implemented: "Unavailable"
  };
  return t(labels[state]);
}

function modelInstallStageLabel(job: RenderProps["activeJob"] | undefined, t: (key: string) => string): string {
  if (!job || job.status === "queued") {
    return t("Waiting to download");
  }
  if (job.status === "canceling") {
    return t("Canceling download");
  }
  if (job.status === "canceled") {
    return t("Download canceled");
  }
  if (job.status === "failed") {
    return t("Model download failed");
  }
  if (job.status === "succeeded") {
    return t("Model is ready");
  }
  const stage = job.stageLabel;
  if (stage.includes("校验") || stage.includes("验证") || stage.includes("verify")) {
    return t("Verifying model");
  }
  if (stage.includes("解压") || stage.includes("准备")) {
    return t("Preparing model");
  }
  return t("Downloading model");
}

function providerStateTone(provider: ProviderStatus): "ok" | "accent" | "warn" | "muted" {
  if (provider.state === "available") {
    return "ok";
  }
  if (provider.requiresUploadConfirmation) {
    return "warn";
  }
  return "muted";
}

function providerOptionLabel(provider: ProviderStatus, t: (key: string) => string = (key) => key): string {
  const state = provider.kind === "api" && provider.state === "missing_api_key" ? t("Needs connection check") : providerStateLabel(provider.state, t);
  const prefix = provider.kind === "local" ? t("Local") : provider.kind === "api" ? "API" : provider.kind === "web" ? t("Web") : "Native";
  return `${prefix} · ${providerDisplayName(provider, t)}${provider.enabled && provider.state === "available" ? "" : ` (${state})`}`;
}

function providerKindLabel(kind: ProviderStatus["kind"], t: (key: string) => string = (key) => key): string {
  switch (kind) {
    case "api": return "API";
    case "web": return t("Web");
    case "native": return "Native";
    default: return t("Local");
  }
}

function formatProviders(values: string[] | undefined, t: (key: string) => string): string {
  if (!values || values.length === 0) {
    return t("Compatible Provider");
  }
  return values.map((value) => providerNameFromId(value, t)).join(" / ");
}

function providerNameFromId(id: string, t: (key: string) => string): string {
  const labels: Record<string, string> = {
    "local-faster-whisper": "Local Faster Whisper",
    "local-whisper-cpp": "Local whisper.cpp",
    "api-openai-transcription": "OpenAI Transcription API",
    "local-nllb-ct2": "Local NLLB Translation",
    "web-bing": "Bing Web Translation",
    "web-google": "Google Web Translation",
    "api-openai-chat": "OpenAI-compatible Translation API"
  };
  return t(labels[id] ?? id);
}

function providerDisplayName(provider: ProviderStatus, t: (key: string) => string): string {
  return providerNameFromId(provider.id, t);
}

function providerPrivacyNote(provider: ProviderStatus, t: (key: string) => string): string {
  const notes: Record<string, string> = {
    "local-faster-whisper": "Local Faster Whisper privacy note",
    "local-whisper-cpp": "Local whisper.cpp privacy note",
    "api-openai-transcription": "OpenAI Transcription API privacy note",
    "local-nllb-ct2": "Local NLLB privacy note",
    "web-bing": "Bing Web Translation privacy note",
    "web-google": "Google Web Translation privacy note",
    "api-openai-chat": "OpenAI-compatible Translation API privacy note"
  };
  return notes[provider.id] ? t(notes[provider.id]) : provider.privacyNote;
}

function modelRecommendation(model: ModelStatus, t: (key: string) => string): string {
  if (model.id === "whisper-base") return t("Whisper Base recommendation");
  if (model.id === "whisper-small") return t("Whisper Small recommendation");
  if (model.id.includes("large-v3-turbo")) return t("Whisper Large Turbo recommendation");
  if (model.backend === "whisper.cpp") return t("Whisper cpp recommendation");
  if (model.kind === "translation") return t("Translation model recommendation");
  return model.recommendation ?? t("Generic model recommendation");
}

export function SettingsProviders(props: RenderProps) {
  const t = useT();
  const { providers, models, config, updateConfig, testProvider, installModel, modelInstallJobs } = props;
  const transcriptionSectionRef = useRef<HTMLElement>(null);
  const translationSectionRef = useRef<HTMLElement>(null);
  const [providerViews, setProviderViews] = useState(providers);
  const [refreshLabel, setRefreshLabel] = useState("Not refreshed");
  const [providerDrafts, setProviderDrafts] = useState<Record<string, ProviderDraft>>(() => providerDraftsFromConfig(providers, config));
  const [providerChecks, setProviderChecks] = useState<Record<string, ProviderCheckState>>({});

  useEffect(() => {
    setProviderViews(providers);
    setProviderChecks((current) => {
      const next = { ...current };
      for (const provider of providers) {
        if (provider.kind === "api" && provider.checkMode === "live" && provider.state === "available") {
          next[provider.id] = { status: "ok", message: "Connection check passed" };
        }
      }
      return next;
    });
  }, [providers]);

  useEffect(() => {
    setProviderDrafts((current) => {
      const next = { ...current };
      for (const provider of providers) {
        next[provider.id] = current[provider.id] ?? providerDraftFromConfig(config, provider.id);
      }
      return next;
    });
  }, [config, providers]);

  const updateProviderDraft = (providerId: string, patch: Partial<ProviderDraft>) => {
    setProviderDrafts((current) => ({
      ...current,
      [providerId]: { ...(current[providerId] ?? providerDraftFromConfig(config, providerId)), ...patch }
    }));
  };

  const refreshProviders = async () => {
    setRefreshLabel("Checking");
    const nextProviders = await Promise.all(providerViews.map((provider) => testProvider(provider.id, "static")));
    setProviderViews(nextProviders);
    setProviderChecks(Object.fromEntries(nextProviders.map((provider) => [provider.id, {
      status: provider.state === "available" ? "ok" : "failed",
      message: provider.state === "available" ? providerCheckPassedLabel(provider) : providerStateLabel(provider.state, t)
    } satisfies ProviderCheckState])));
    setRefreshLabel("Refreshed");
  };

  const runProviderCheck = async (providerId: string) => {
    setProviderChecks((current) => ({ ...current, [providerId]: { status: "checking", message: "Checking" } }));
    try {
      const currentProvider = providerViews.find((provider) => provider.id === providerId);
      const mode = currentProvider?.kind === "api" ? "live" : "static";
      if (currentProvider?.kind === "api") {
        const draft = providerDrafts[providerId] ?? providerDraftFromConfig(config, providerId);
        await updateConfig({
          apiProviderConfigs: {
            [providerId]: {
              openAIBaseUrl: draft.openAIBaseUrl,
              openAIModel: draft.openAIModel,
              apiKeyAlias: providerSecretAliasForId(providerId, config),
              apiKeyStatus: apiProviderConfig(config, providerId).apiKeyStatus
            }
          }
        });
      }
      const checked = await testProvider(providerId, mode);
      setProviderViews((current) => current.map((provider) => provider.id === providerId ? checked : provider));
      setProviderChecks((current) => ({ ...current, [providerId]: {
        status: checked.state === "available" ? "ok" : "failed",
        message: checked.state === "available" ? (mode === "live" ? "Connection check passed" : providerCheckPassedLabel(checked)) : providerStateLabel(checked.state, t)
      } }));
    } catch {
      setProviderChecks((current) => ({ ...current, [providerId]: { status: "failed", message: "Check failed" } }));
    }
  };

  useEffect(() => {
    const target = props.providerSettingsFocus === "translation" ? translationSectionRef.current
      : props.providerSettingsFocus === "stt" ? transcriptionSectionRef.current
        : null;
    target?.scrollIntoView({ block: "start" });
  }, [props.providerSettingsFocus]);

  return (
    <div className="settings-list">
      <div className="between"><h2>{t("Provider")}</h2><div className="row gap-8"><Chip tone={refreshLabel === "Refreshed" ? "ok" : "muted"}>{t(refreshLabel)}</Chip><button className="btn sm ghost" onClick={() => void refreshProviders()}>{t("Refresh status")}</button></div></div>
      <p className="caption">{t("Provider page description")}</p>
      <ProviderSection
        sectionRef={transcriptionSectionRef}
        title={t("Transcription Provider")}
        description={t("Transcription Provider description")}
        providers={providerViews.filter((provider) => provider.capability === "stt")}
        models={models.filter((model) => model.kind === "asr")}
        activeProvider={config.asrProvider}
        activeModel={config.asrModel}
        onProvider={(asrProvider) => void updateConfig({ asrProvider })}
        onModel={(asrModel) => void updateConfig({ asrModel })}
        testProvider={testProvider}
        config={config}
        updateConfig={updateConfig}
        saveProviderSecret={props.saveProviderSecret}
        deleteProviderSecret={props.deleteProviderSecret}
        checks={providerChecks}
        runProviderCheck={runProviderCheck}
        providerDrafts={providerDrafts}
        updateProviderDraft={updateProviderDraft}
        installProviderDependency={props.installProviderDependency}
        installModel={installModel}
        modelInstallJobs={modelInstallJobs}
      />
      <ProviderSection
        sectionRef={translationSectionRef}
        title={t("Translation Provider")}
        description={t("Translation Provider description")}
        providers={providerViews.filter((provider) => provider.capability === "translation")}
        models={models.filter((model) => model.kind === "translation")}
        activeProvider={config.translationProvider}
        activeModel={config.translationModel}
        onProvider={(translationProvider) => void updateConfig({ translationProvider })}
        onModel={(translationModel) => void updateConfig({ translationModel })}
        testProvider={testProvider}
        config={config}
        updateConfig={updateConfig}
        saveProviderSecret={props.saveProviderSecret}
        deleteProviderSecret={props.deleteProviderSecret}
        checks={providerChecks}
        runProviderCheck={runProviderCheck}
        providerDrafts={providerDrafts}
        updateProviderDraft={updateProviderDraft}
        installProviderDependency={props.installProviderDependency}
        installModel={installModel}
        modelInstallJobs={modelInstallJobs}
      />
    </div>
  );
}

type ProviderDraft = {
  model: string;
  device: ConfigViewModel["device"];
  wordTimestamps: boolean;
  sourceLanguage: string;
  targetLanguage: string;
  openAIBaseUrl: string;
  openAIModel: string;
};

type ProviderCheckState = {
  status: "idle" | "checking" | "ok" | "failed";
  message: string;
};

function providerDraftFromConfig(config: ConfigViewModel, providerId = ""): ProviderDraft {
  const providerConfig = providerId ? apiProviderConfig(config, providerId) : undefined;
  return {
    model: "",
    device: config.device,
    wordTimestamps: config.wordTimestamps,
    sourceLanguage: config.defaultLanguage,
    targetLanguage: config.targetLanguage,
    openAIBaseUrl: providerConfig?.openAIBaseUrl ?? config.openAIBaseUrl ?? "",
    openAIModel: providerConfig?.openAIModel ?? config.openAIModel ?? ""
  };
}

function providerDraftsFromConfig(providers: ProviderStatus[], config: ConfigViewModel): Record<string, ProviderDraft> {
  return Object.fromEntries(providers.map((provider) => [provider.id, providerDraftFromConfig(config, provider.id)]));
}

function ProviderSection(props: {
  sectionRef?: RefObject<HTMLElement | null>;
  title: string;
  description: string;
  providers: ProviderStatus[];
  models: ModelStatus[];
  activeProvider: string;
  activeModel: string;
  onProvider: (id: string) => void;
  onModel: (id: string) => void;
  testProvider: RenderProps["testProvider"];
  config: ConfigViewModel;
  updateConfig: RenderProps["updateConfig"];
  saveProviderSecret: RenderProps["saveProviderSecret"];
  deleteProviderSecret: RenderProps["deleteProviderSecret"];
  checks: Record<string, ProviderCheckState>;
  runProviderCheck: (providerId: string) => Promise<void>;
  providerDrafts: Record<string, ProviderDraft>;
  updateProviderDraft: (providerId: string, patch: Partial<ProviderDraft>) => void;
  installProviderDependency: RenderProps["installProviderDependency"];
  installModel: RenderProps["installModel"];
  modelInstallJobs: RenderProps["modelInstallJobs"];
}) {
  return (
    <section className="provider-section" ref={props.sectionRef}>
      <div>
        <h3>{props.title}</h3>
        <p className="caption no-margin">{props.description}</p>
      </div>
      {props.providers.map((provider) => {
        const compatibleModels = props.models.filter((model) => model.compatibleProviders?.includes(provider.id) || (provider.id === "api-openai-chat" && model.kind === "translation") || (provider.id === "api-openai-transcription" && model.id.startsWith("gpt-")));
        const active = props.activeProvider === provider.id;
        return (
          <ProviderCard
            key={provider.id}
            provider={provider}
            active={active}
            models={compatibleModels}
            activeModel={props.activeModel}
            onProvider={props.onProvider}
            onModel={props.onModel}
            onTest={() => void props.runProviderCheck(provider.id)}
            check={props.checks[provider.id]}
            config={props.config}
            updateConfig={props.updateConfig}
            saveProviderSecret={props.saveProviderSecret}
            deleteProviderSecret={props.deleteProviderSecret}
            draft={props.providerDrafts[provider.id] ?? providerDraftFromConfig(props.config, provider.id)}
            onDraft={(patch) => props.updateProviderDraft(provider.id, patch)}
            installProviderDependency={props.installProviderDependency}
            installModel={props.installModel}
            modelInstallJobs={props.modelInstallJobs}
          />
        );
      })}
    </section>
  );
}

function ProviderCard(props: {
  provider: ProviderStatus;
  active: boolean;
  models: ModelStatus[];
  activeModel: string;
  onProvider: (id: string) => void;
  onModel: (id: string) => void;
  onTest: () => void;
  check?: ProviderCheckState;
  config: ConfigViewModel;
  updateConfig: RenderProps["updateConfig"];
  saveProviderSecret: RenderProps["saveProviderSecret"];
  deleteProviderSecret: RenderProps["deleteProviderSecret"];
  draft: ProviderDraft;
  onDraft: (patch: Partial<ProviderDraft>) => void;
  installProviderDependency: RenderProps["installProviderDependency"];
  installModel: RenderProps["installModel"];
  modelInstallJobs: RenderProps["modelInstallJobs"];
}) {
  const t = useT();
  const { provider } = props;
  const [secretValue, setSecretValue] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [secretStatus, setSecretStatus] = useState<"idle" | "saving" | "saved" | "deleting" | "deleted" | "failed">("idle");
  const [dependencyInstalling, setDependencyInstalling] = useState(false);
  const [dependencyError, setDependencyError] = useState("");
  const modelValue = providerControlValue(props.activeModel, props.draft.model, props.models);
  const selectedModel = props.models.find((model) => model.id === modelValue);
  const installableModel = provider.requiresModel && provider.kind !== "api"
    ? selectedModel ?? props.models.find((model) => model.state === "missing" || model.state === "failed" || model.state === "installing") ?? props.models[0]
    : undefined;
  const installJob = installableModel ? props.modelInstallJobs[installableModel.id] : undefined;
  const modelInstalling = installJob ? installJob.status === "queued" || installJob.status === "running" || installJob.status === "canceling" : installableModel?.state === "installing";
  const modelInstallProgress = Math.max(0, Math.min(100, installJob?.progressPercent ?? installableModel?.progressPercent ?? 0));
  const modelInstallNeeded = Boolean(installableModel && (provider.state === "missing_model" || installableModel.state === "missing" || installableModel.state === "failed"));
  const deviceValue = props.active ? props.config.device : props.draft.device;
  const wordTimestamps = props.active ? props.config.wordTimestamps : props.draft.wordTimestamps;
  const sourceLanguage = props.active ? props.config.defaultLanguage : props.draft.sourceLanguage;
  const targetLanguage = props.active ? props.config.targetLanguage : props.draft.targetLanguage;
  const providerApiConfig = apiProviderConfig(props.config, provider.id);
  const openAIBaseUrl = props.active ? providerApiConfig.openAIBaseUrl ?? props.draft.openAIBaseUrl : props.draft.openAIBaseUrl;
  const openAIModel = props.active ? providerApiConfig.openAIModel ?? props.draft.openAIModel : props.draft.openAIModel;
  const languageOptions = provider.id === "local-nllb-ct2"
    ? [["en", t("English")], ["zh", t("Chinese")], ["ja", t("Japanese")], ["ko", t("Korean")]]
    : [["auto", t("Auto detect")], ["en", t("English")], ["zh", t("Chinese")], ["ja", t("Japanese")], ["ko", t("Korean")]];
  const updateModel = (model: string) => {
    props.onDraft({ model });
    if (props.active) props.onModel(model);
  };
  const updateDevice = (device: ConfigViewModel["device"]) => {
    props.onDraft({ device });
    if (props.active) void props.updateConfig({ device });
  };
  const updateWordTimestamps = (checked: boolean) => {
    props.onDraft({ wordTimestamps: checked });
    if (props.active) void props.updateConfig({ wordTimestamps: checked });
  };
  const updateSourceLanguage = (defaultLanguage: string) => {
    props.onDraft({ sourceLanguage: defaultLanguage });
    if (props.active) void props.updateConfig({ defaultLanguage });
  };
  const updateTargetLanguage = (targetLanguage: string) => {
    props.onDraft({ targetLanguage });
    if (props.active) void props.updateConfig({ targetLanguage });
  };
  const updateOpenAIBaseUrl = (openAIBaseUrl: string) => {
    props.onDraft({ openAIBaseUrl });
    void props.updateConfig({
      apiProviderConfigs: {
        [provider.id]: {
          ...apiProviderConfig(props.config, provider.id),
          openAIBaseUrl
        }
      }
    });
  };
  const updateOpenAIModel = (openAIModel: string) => {
    props.onDraft({ openAIModel });
    void props.updateConfig({
      apiProviderConfigs: {
        [provider.id]: {
          ...apiProviderConfig(props.config, provider.id),
          openAIModel
        }
      }
    });
  };
  const checking = props.check?.status === "checking";
  const liveCheckAvailable = provider.kind === "api" && (props.check?.status === "ok" || provider.checkMode === "live" && provider.state === "available");
  const providerAvailable = provider.kind === "api" ? liveCheckAvailable : provider.state === "available";
  const providerStateText = liveCheckAvailable
    ? t("Available")
    : provider.kind === "api" && (provider.state === "missing_api_key" || provider.state === "available")
      ? t("Needs connection check")
      : providerStateLabel(provider.state, t);
  const providerTone = providerAvailable ? "ok" : providerStateTone(provider);
  const secretConfigured = isProviderSecretConfigured(provider, props.config);
  const secretAlias = providerSecretAlias(provider, props.config);
  const saveSecret = async () => {
    const value = secretValue.trim();
    if (!value) {
      setSecretStatus("failed");
      return;
    }
    setSecretStatus("saving");
    try {
      await props.saveProviderSecret(provider.id, defaultSecretAlias(provider.id), value);
      setSecretValue("");
      setSecretStatus("saved");
    } catch {
      setSecretStatus("failed");
    }
  };
  const deleteSecret = async () => {
    if (!secretConfigured) {
      return;
    }
    setSecretStatus("deleting");
    try {
      await props.deleteProviderSecret(provider.id, secretAlias);
      setSecretValue("");
      setShowSecret(false);
      setSecretStatus("deleted");
    } catch {
      setSecretStatus("failed");
    }
  };
  const installDependency = async () => {
    setDependencyInstalling(true);
    setDependencyError("");
    try {
      await props.installProviderDependency(provider.id);
    } catch {
      setDependencyError("Dependency check failed");
    } finally {
      setDependencyInstalling(false);
    }
  };
  const canSetDefault = provider.enabled && providerAvailable;
  const defaultBlockReason = providerAvailable ? "" : providerDefaultBlockReason(provider, t);
  const selectAsDefault = () => {
    if (!canSetDefault) {
      return;
    }
    const patch: Partial<ConfigViewModel> = provider.capability === "stt"
      ? {
          asrProvider: provider.id,
          asrModel: modelValue || props.activeModel,
          device: props.draft.device,
          wordTimestamps: props.draft.wordTimestamps
        }
      : {
          translationProvider: provider.id,
          translationModel: modelValue || props.activeModel,
          defaultLanguage: provider.id === "local-nllb-ct2" && props.draft.sourceLanguage === "auto" ? "en" : props.draft.sourceLanguage,
          targetLanguage: props.draft.targetLanguage
        };
    if (provider.kind === "api") {
      patch.apiProviderConfigs = {
        [provider.id]: {
          ...apiProviderConfig(props.config, provider.id),
          openAIBaseUrl: props.draft.openAIBaseUrl,
          openAIModel: props.draft.openAIModel,
          apiKeyAlias: providerSecretAliasForId(provider.id, props.config)
        }
      };
    }
    void props.updateConfig(patch);
  };
  return (
    <article className={`provider-card provider-card-rich ${provider.requiresUploadConfirmation ? "warn-card-soft" : "ok-card"} ${props.active ? "selected-card" : ""}`}>
      <div className="provider-main">
        <div className="row gap-8 wrap">
          <strong>{providerDisplayName(provider, t)}</strong>
          <Chip tone={providerTone}>{providerStateText}</Chip>
          {props.active && <Chip tone="accent">{t("Current default")}</Chip>}
          <Chip>{providerKindLabel(provider.kind, t)}</Chip>
          {provider.requiresUploadConfirmation && <Chip tone="warn">{t("Upload confirmation")}</Chip>}
        </div>
        <span>{providerPrivacyNote(provider, t)}</span>
        <div className="job-meta">
          {provider.requiresModel && <Chip tone="muted">{t("Requires model")}</Chip>}
          {provider.requiresApiKey && <Chip tone="muted">{t("Requires API key")}</Chip>}
          {provider.supportsBatch && <Chip tone="muted">{t("Batch")}</Chip>}
          {provider.supportsWordTimestamps && <Chip tone="muted">{t("Word timestamps")}</Chip>}
          {(provider.supportedLanguages ?? []).slice(0, 5).map((lang) => <Chip key={lang} tone="muted">{lang}</Chip>)}
        </div>
        <div className={`provider-config ${provider.kind === "api" ? "api-provider-config" : ""}`}>
          {provider.requiresModel && provider.kind !== "api" && props.models.length > 0 && (
            <label>{t("Model")}<select value={modelValue} onChange={(event) => updateModel(event.currentTarget.value)}>
              {props.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select></label>
          )}
          {provider.capability === "stt" && provider.kind !== "api" && (
            <>
              <label>{t("Device")}<select value={deviceValue} onChange={(event) => updateDevice(event.currentTarget.value as ConfigViewModel["device"])}><option value="auto">{t("Auto")}</option><option value="cpu">CPU</option><option value="gpu">GPU</option></select></label>
              <label className="inline-check"><input type="checkbox" checked={wordTimestamps} onChange={(event) => updateWordTimestamps(event.currentTarget.checked)} /> {t("Word timestamps")}</label>
            </>
          )}
          {provider.capability === "translation" && provider.kind !== "api" && (
            <>
              <label>{t("Source language")}<select value={provider.id === "local-nllb-ct2" && sourceLanguage === "auto" ? "en" : sourceLanguage} onChange={(event) => updateSourceLanguage(event.currentTarget.value)}>
                {languageOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>
              <label>{t("Target language")}<select value={targetLanguage} onChange={(event) => updateTargetLanguage(event.currentTarget.value)}><option value="zh">{t("Simplified Chinese")}</option><option value="en">English</option><option value="ja">{t("Japanese")}</option><option value="ko">{t("Korean")}</option></select></label>
            </>
          )}
          {provider.kind === "api" && (
            <div className="api-provider-form">
              <div className="api-field">
                <span className="api-label">API Key</span>
                <div className="api-key-row">
                  <input
                    aria-label={t("Provider API key", { provider: providerDisplayName(provider, t) })}
                    className="mono"
                    type={showSecret ? "text" : "password"}
                    value={secretValue}
                    placeholder={providerSecretPlaceholder(provider, props.config, t)}
                    onChange={(event) => {
                      setSecretValue(event.currentTarget.value);
                      if (secretStatus !== "idle") setSecretStatus("idle");
                    }}
                  />
                  <button className="btn sm ghost" disabled={!secretValue} onClick={() => setShowSecret((shown) => !shown)} type="button">{showSecret ? t("Hide") : t("Show")}</button>
                </div>
              </div>
              <label>{t("Model")}<input value={openAIModel || defaultAPIModel(provider)} placeholder={defaultAPIModel(provider)} onChange={(event) => updateOpenAIModel(event.currentTarget.value)} /></label>
              <label>Base URL<input value={openAIBaseUrl} onChange={(event) => updateOpenAIBaseUrl(event.currentTarget.value)} /></label>
              <div className="api-form-footer">
                <span>{t("Credential status")}: {secretConfigured ? t("Saved to alias", { alias: secretAlias }) : t("Not configured")}</span>
                <button className="btn sm ghost" disabled={!secretValue.trim() || secretStatus === "saving"} onClick={() => void saveSecret()} type="button">
                  {secretStatus === "saving" ? t("Saving") : secretConfigured ? t("Replace key") : t("Save key")}
                </button>
                {secretConfigured && (
                  <button className="btn sm ghost" disabled={secretStatus === "deleting"} onClick={() => void deleteSecret()} type="button">
                    {secretStatus === "deleting" ? t("Deleting") : t("Delete key")}
                  </button>
                )}
                {secretStatus === "saved" && <Chip tone="ok">{t("Saved")}</Chip>}
                {secretStatus === "deleted" && <Chip tone="ok">{t("Deleted")}</Chip>}
                {secretStatus === "failed" && <Chip tone="warn">{t("Save failed")}</Chip>}
              </div>
              <p className="caption no-margin">{t("API proxy secret note")}</p>
            </div>
          )}
        </div>
      </div>
      <div className="row gap-8 wrap end">
        {!props.active && <button className="btn sm" disabled={!canSetDefault} title={defaultBlockReason} onClick={selectAsDefault}>{t("Set as default")}</button>}
        {provider.state === "missing_dependency" && (
          <button className="btn sm" disabled={dependencyInstalling} onClick={() => void installDependency()} type="button">
            {dependencyInstalling ? t("Installing dependency") : t(providerDependencyActionLabel(provider.id))}
          </button>
        )}
        {modelInstallNeeded && installableModel && (
          <button className="btn sm" disabled={modelInstalling} onClick={() => void props.installModel(installableModel.id)}>
            {modelInstalling ? t("Downloading") : installableModel.state === "failed" ? t("Retry download") : t("Install model first")}
          </button>
        )}
        {modelInstalling && <Chip tone="accent">{t("Downloading")} {modelInstallProgress}%</Chip>}
        {!props.active && !canSetDefault && <Chip tone="warn">{defaultBlockReason}</Chip>}
        <button className="btn sm ghost" disabled={checking} onClick={props.onTest}>{checking ? t("Checking") : t(providerCheckActionLabel(provider))}</button>
        {props.check && props.check.status !== "idle" && (
          <Chip tone={props.check.status === "ok" ? "ok" : props.check.status === "failed" ? "warn" : "accent"}>{t(props.check.message)}</Chip>
        )}
        {dependencyError && <Chip tone="warn">{t(dependencyError)}</Chip>}
      </div>
    </article>
  );
}

function providerDependencyActionLabel(providerId: string): string {
  if (providerId === "local-faster-whisper" || providerId === "local-nllb-ct2") {
    return "Recheck bundled runtime";
  }
  return "Install dependency first";
}

function providerCheckActionLabel(provider: ProviderStatus): string {
  if (provider.kind === "api") {
    return "Connection check";
  }
  if (provider.requiresModel) {
    return "Model check";
  }
  return "Static check";
}

function providerCheckPassedLabel(provider: ProviderStatus): string {
  return provider.requiresModel ? "Model check passed" : "Static check passed";
}

function providerControlValue(activeModel: string, draftModel: string, models: ModelStatus[]): string {
  if (draftModel && models.some((model) => model.id === draftModel)) {
    return draftModel;
  }
  if (models.some((model) => model.id === activeModel)) {
    return activeModel;
  }
  return models[0]?.id ?? "";
}

function apiProviderConfig(config: ConfigViewModel, providerId: string): NonNullable<ConfigViewModel["apiProviderConfigs"]>[string] {
  return config.apiProviderConfigs?.[providerId] ?? {};
}

function defaultSecretAlias(providerId: string): string {
  if (providerId === "api-openai-chat") {
    return "FAST_SUB_OPENAI_CHAT_API_KEY";
  }
  if (providerId === "api-openai-transcription") {
    return "FAST_SUB_OPENAI_TRANSCRIPTION_API_KEY";
  }
  return `FAST_SUB_${providerId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
}

function providerSecretAliasForId(providerId: string, config: ConfigViewModel): string {
  return apiProviderConfig(config, providerId).apiKeyAlias || defaultSecretAlias(providerId);
}

function isProviderSecretConfigured(provider: ProviderStatus, config: ConfigViewModel): boolean {
  const providerConfig = apiProviderConfig(config, provider.id);
  return (providerConfig.apiKeyStatus === "configured" && Boolean(providerConfig.apiKeyAlias)) || Boolean(provider.maskedCredential && provider.maskedCredential !== "未配置" && provider.maskedCredential !== "Not configured");
}

function providerSecretAlias(provider: ProviderStatus, config: ConfigViewModel): string {
  const providerConfig = apiProviderConfig(config, provider.id);
  if (providerConfig.apiKeyStatus === "configured" && providerConfig.apiKeyAlias) {
    return providerConfig.apiKeyAlias;
  }
  if (provider.maskedCredential && provider.maskedCredential !== "未配置" && provider.maskedCredential !== "Not configured") {
    return provider.maskedCredential;
  }
  return defaultSecretAlias(provider.id);
}

function providerSecretPlaceholder(provider: ProviderStatus, config: ConfigViewModel, t: (key: string) => string): string {
  return isProviderSecretConfigured(provider, config) ? t("Enter new API key placeholder") : "sk-...";
}

function defaultAPIModel(provider: ProviderStatus): string {
  return provider.capability === "stt" ? "gpt-4o-transcribe" : "gpt-4o-mini";
}

function providerDefaultBlockReason(provider: ProviderStatus, t: (key: string) => string): string {
  if (provider.kind === "api" && provider.checkMode !== "live") {
    return t("Run connection check first");
  }
  switch (provider.state) {
    case "missing_api_key": return provider.kind === "api" ? t("Run connection check first") : t("Configure key first");
    case "missing_model": return t("Install model first");
    case "missing_dependency": return t("Install dependency first");
    case "invalid_config": return t("Fix config first");
    case "disabled": return t("Provider disabled");
    case "not_implemented": return t("Unavailable");
    default: return provider.enabled ? "" : t("Provider disabled");
  }
}

export function SettingsDiagnostics({ environment, cleanupLocalData }: RenderProps) {
  const t = useT();
  const health = environment?.health ?? "checking";
  const logLines = (environment?.ffmpegInstallLogs ?? []).map((line) => redactSecretText(line)).slice(-12);
  const warnings = environment?.warnings ?? [];
  const [cleaning, setCleaning] = useState<LocalDataCleanupTarget | null>(null);
  const [cleanupMessage, setCleanupMessage] = useState<string>("");
  const runCleanup = async (target: LocalDataCleanupTarget) => {
    if (!window.confirm(t(cleanupConfirmKey(target)))) {
      return;
    }
    setCleaning(target);
    setCleanupMessage("");
    try {
      await cleanupLocalData(target);
      setCleanupMessage(t("Local data cleanup complete"));
    } catch {
      setCleanupMessage(t("Local data cleanup failed"));
    } finally {
      setCleaning(null);
    }
  };
  return (
    <div className="settings-list">
      <div className="between"><h2>{t("Diagnostics")}</h2><Chip tone={health === "ok" ? "ok" : health === "degraded" ? "warn" : "accent"}>{healthLabel(health, t)}</Chip></div>
      <section className="panel paper-muted">
        <h3>{t("Local service status")}</h3>
        <KV k={t("Status")} v={healthLabel(health, t)} />
        <KV k={t("Platform")} v={`${environment?.os ?? processPlatformFallback()} / ${environment?.arch ?? "unknown"}`} />
        <KV k={t("Daemon")} v={environment?.daemonReady ? t("Ready") : t("Checking")} />
        <KV k="FFmpeg" v={environment?.ffmpegReady ? t("Ready") : t("Needs repair")} />
        <KV k={t("Model storage directory")} v={environment?.modelDirectoryReady ? t("Ready") : t("Checking")} />
        <KV k={t("Local transcription")} v={environment?.localTranscriptionReady ? t("Ready") : t("Missing model")} />
        <KV k={t("Local translation")} v={environment?.localTranslationReady ? t("Ready") : t("Missing model")} />
        <KV k={t("Sensitive info")} v={t("Redacted")} />
      </section>
      <section className="panel dashed">
        <h3>{t("Diagnostics summary")}</h3>
        {(warnings.length ? warnings : [t("No warnings")]).map((warning) => <p key={warning} className="caption">{redactSecretText(warning)}</p>)}
        {environment?.error?.diagnostic && <KV k="diagnostic" v={redactSecretText(environment.error.diagnostic)} mono />}
      </section>
      <pre>{logLines.length ? logLines.join("\n") : t("No detailed logs")}</pre>
      <section className="panel paper-muted">
        <div className="between">
          <div>
            <h3>{t("Local data cleanup")}</h3>
            <p className="caption">{t("Local data cleanup note")}</p>
          </div>
        </div>
        <div className="row gap-8 wrap">
          <button className="btn" disabled={cleaning !== null} onClick={() => void runCleanup("jobs")} type="button">
            {cleaning === "jobs" ? t("Cleaning") : t("Clear task history")}
          </button>
          <button className="btn" disabled={cleaning !== null} onClick={() => void runCleanup("native-binaries")} type="button">
            {cleaning === "native-binaries" ? t("Cleaning") : t("Clear native dependencies")}
          </button>
          <button className="btn" disabled={cleaning !== null} onClick={() => void runCleanup("cache")} type="button">
            {cleaning === "cache" ? t("Cleaning") : t("Clear app cache")}
          </button>
        </div>
        {cleanupMessage && <p className="caption">{cleanupMessage}</p>}
      </section>
    </div>
  );
}

function cleanupConfirmKey(target: LocalDataCleanupTarget): string {
  if (target === "jobs") return "Confirm clear task history";
  if (target === "native-binaries") return "Confirm clear native dependencies";
  return "Confirm clear app cache";
}

function healthLabel(health: string, t: (key: string) => string): string {
  if (health === "ok") return t("Ready");
  if (health === "degraded") return t("Degraded");
  if (health === "disconnected") return t("Disconnected");
  return t("Checking");
}

function processPlatformFallback(): string {
  return typeof navigator === "undefined" ? "unknown" : navigator.platform || "unknown";
}

export function SettingsBenchmark() {
  const t = useT();
  return (
    <div className="settings-list">
      <div className="between"><h2>{t("Benchmark")}</h2><Chip>{t("Future scope")}</Chip></div>
      <section className="panel dashed">
        <h3>{t("Future scope")}</h3>
        <KV k={t("Transcription performance")} v="RTFx · elapsed" />
        <KV k={t("Transcription quality")} v="WER / CER · subtitle health" />
        <KV k={t("Translation quality")} v="BLEU · chrF · exact match" />
      </section>
    </div>
  );
}
