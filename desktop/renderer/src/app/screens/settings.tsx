import { useEffect, useState } from "react";
import type { ConfigViewModel, ModelStatus, ProviderState, ProviderStatus } from "../../../../shared/contracts/types";
import type { RenderProps, Screen, UiFontStyle, UiLanguage } from "../types";
import { Chip, Chrome, KV, Segment, SettingRow, Toggle } from "../components";
import { useT } from "../i18n";

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
            ["settings-providers", "◌", "Provider"],
            ["settings-diagnostics", "⚙", t("Diagnostics")],
            ["settings-benchmark", "▣", "Benchmark"]
          ].map(([id, icon, label]) => <button key={id} className={props.screen === id ? "active" : ""} onClick={() => props.setScreen(id as Screen)}>{icon} {label}</button>)}
          <span className="caption version">v0.11 mock</span>
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
        <select aria-label={t("Default transcription Provider")} value={props.config.asrProvider} onChange={(event) => void props.updateConfig({ asrProvider: event.currentTarget.value })}>
          {asrProviders.map((provider) => <option disabled={!provider.enabled || provider.state !== "available"} key={provider.id} value={provider.id}>{providerOptionLabel(provider, t)}</option>)}
        </select>
      </SettingRow>
      <SettingRow label={t("Device")}><Segment items={[t("Auto"), "CPU", "GPU"]} active={deviceIndex} onSelect={(index) => void props.updateConfig({ device: (["auto", "cpu", "gpu"] as ConfigViewModel["device"][])[index] })} /></SettingRow>
      <SettingRow label={t("Word timestamps")}><Toggle ariaLabel={t("Set word timestamps")} on={props.config.wordTimestamps} onClick={() => void props.updateConfig({ wordTimestamps: !props.config.wordTimestamps })} /></SettingRow>
      <h3>{t("Translation")}</h3>
      <SettingRow label={t("Default translation Provider")}>
        <select aria-label={t("Default translation Provider")} value={props.config.translationProvider} onChange={(event) => void props.updateConfig({ translationProvider: event.currentTarget.value })}>
          {translationProviders.map((provider) => <option disabled={!provider.enabled || provider.state !== "available"} key={provider.id} value={provider.id}>{providerOptionLabel(provider, t)}</option>)}
        </select>
      </SettingRow>
      <SettingRow label={t("Target language")}><select value={props.config.targetLanguage} onChange={(event) => void props.updateConfig({ targetLanguage: event.target.value })}><option value="zh">{t("Simplified Chinese")}</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option></select></SettingRow>
      <h3>{t("Defaults")}</h3>
      <SettingRow label={t("Output content")}><Segment items={outputTypes.map((item) => item.label)} active={outputTypeIndex} onSelect={(index) => selectOutputType(outputTypes[index].value)} /></SettingRow>
      {translationOutputWarning && (
        <div className="blocking-note" role="status">
          <span>{t("Translation output not ready")}</span>
          <button className="btn sm primary" onClick={() => props.setScreen("settings-providers")} type="button">{t("Configure translation Provider")}</button>
        </div>
      )}
      <SettingRow label={t("Subtitle language")}><select value={props.config.defaultLanguage} onChange={(event) => void props.updateConfig({ defaultLanguage: event.target.value })}><option value="auto">{t("Auto detect")}</option><option value="zh">{t("Chinese")}</option><option value="en">{t("English")}</option><option value="ja">{t("Japanese")}</option><option value="ko">{t("Korean")}</option></select></SettingRow>
      <SettingRow label={t("Output format")}><Segment items={outputFormats.map((item) => item.label)} active={outputFormatIndex} onSelect={(index) => void props.updateConfig({ outputFormat: outputFormats[index].value })} /></SettingRow>
      <SettingRow label={t("Burn-in video")}><Toggle ariaLabel={t("Burn-in video")} on={props.config.burnInVideo} onClick={() => void props.updateConfig({ burnInVideo: !props.config.burnInVideo })} /></SettingRow>
      <SettingRow label={t("When file exists")}><Segment items={conflictModes.map((item) => item.label)} active={conflictIndex} onSelect={(index) => void props.updateConfig({ outputConflict: conflictModes[index].value })} /></SettingRow>
    </div>
  );
}

function outputTypeNeedsTranslation(outputType: ConfigViewModel["outputType"]): boolean {
  return outputType === "translated_srt" || outputType === "bilingual_srt";
}

function translationOutputReady(config: ConfigViewModel, providers: ProviderStatus[], translationReady: boolean): boolean {
  const provider = providers.find((item) => item.id === config.translationProvider);
  return translationReady && Boolean(provider?.enabled && provider.state === "available");
}

export function SettingsModels({ models, modelInstallJobs, installModel, removeModel, config, updateConfig }: RenderProps) {
  const asrModels = models.filter((model) => model.kind === "asr");
  const translationModels = models.filter((model) => model.kind === "translation");
  return (
    <div className="settings-list">
      <div className="between"><h2>模型管理</h2><span className="caption">存储路径：~/.fastsub/models</span></div>
      <p className="caption">模型只负责下载和默认选择；Provider 页面负责具体转写/翻译服务配置。</p>
      <h3>转写模型</h3>
      {asrModels.map((model) => (
        <ModelCard key={model.id} model={model} installJob={modelInstallJobs[model.id]} isDefault={config.asrModel === model.id || Boolean(model.defaultFor?.includes(config.asrProvider))} onInstall={() => void installModel(model.id)} onRemove={() => void removeModel(model.id)} onDefault={() => void updateConfig({ asrModel: model.id })} />
      ))}
      <h3>翻译模型</h3>
      {translationModels.map((model) => (
        <ModelCard key={model.id} model={model} installJob={modelInstallJobs[model.id]} isDefault={config.translationModel === model.id || Boolean(model.defaultFor?.includes(config.translationProvider))} onInstall={() => void installModel(model.id)} onRemove={() => void removeModel(model.id)} onDefault={() => void updateConfig({ translationModel: model.id })} />
      ))}
    </div>
  );
}

function ModelCard({ model, installJob, isDefault, onInstall, onRemove, onDefault }: { model: ModelStatus; installJob?: RenderProps["activeJob"]; isDefault: boolean; onInstall: () => void; onRemove: () => void; onDefault: () => void }) {
  const taskLabel = model.kind === "translation" ? "翻译" : "转写";
  const installing = installJob?.status === "queued" || installJob?.status === "running" || installJob?.status === "canceling" || model.state === "installing";
  const failed = installJob?.status === "failed" || model.state === "failed";
  const ready = installJob?.status === "succeeded" || model.state === "ready";
  const missing = !installing && !failed && !ready;
  const progress = Math.max(0, Math.min(100, installJob?.progressPercent ?? model.progressPercent ?? 0));
  const stageLabel = modelInstallStageLabel(installJob);
  return (
    <article className={`model-card model-card-rich ${ready ? "ok-card" : "dashed"}`}>
      <div className="model-main">
        <div className="row gap-8 wrap">
          <strong>{model.name}</strong>
          {isDefault && <Chip tone="accent">当前默认</Chip>}
          <Chip>{taskLabel}</Chip>
          {model.backend && <Chip tone="muted">{model.backend}</Chip>}
        </div>
        <span>{model.sizeLabel} · 兼容 {formatProviders(model.compatibleProviders)}</span>
        <p className="caption no-margin">{model.recommendation ?? modelRecommendation(model)}</p>
        {installing && (
          <div className="model-install-progress" role="status" aria-label={`${model.name} 下载进度`}>
            <div className="between">
              <strong>{progress}%</strong>
              <span>{stageLabel}</span>
            </div>
            <div className="bar sm"><span style={{ width: `${progress}%` }} /></div>
          </div>
        )}
        {failed && installJob?.error && <p className="caption warn-text no-margin">{installJob.error.message}</p>}
      </div>
      <div className="row gap-8 wrap end">
        {ready && <Chip tone="ok">可用</Chip>}
        {installing && <Chip tone="accent">下载中 {progress}%</Chip>}
        {failed && <Chip tone="warn">安装失败</Chip>}
        {missing && <Chip tone="muted">未安装</Chip>}
        {ready && !isDefault && <button className="btn sm ghost" onClick={onDefault}>设为默认</button>}
        {failed && <button className="btn sm" onClick={onInstall}>重试下载</button>}
        {missing && <button className="btn sm" onClick={onInstall}>下载</button>}
        {!missing && <button className="btn sm ghost" onClick={onRemove}>移除</button>}
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

function modelInstallStageLabel(job: RenderProps["activeJob"] | undefined): string {
  if (!job || job.status === "queued") {
    return "等待下载";
  }
  if (job.status === "canceling") {
    return "正在取消下载";
  }
  if (job.status === "canceled") {
    return "已取消下载";
  }
  if (job.status === "failed") {
    return "模型下载失败";
  }
  if (job.status === "succeeded") {
    return "模型已可用";
  }
  const stage = job.stageLabel;
  if (stage.includes("校验") || stage.includes("验证") || stage.includes("verify")) {
    return "正在校验模型";
  }
  if (stage.includes("解压") || stage.includes("准备")) {
    return "正在准备模型";
  }
  return "正在下载模型";
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
  const state = providerStateLabel(provider.state, t);
  const prefix = provider.kind === "local" ? t("Local") : provider.kind === "api" ? "API" : provider.kind === "web" ? t("Web") : "Native";
  return `${prefix} · ${provider.name}${provider.enabled && provider.state === "available" ? "" : ` (${state})`}`;
}

function providerKindLabel(kind: ProviderStatus["kind"], t: (key: string) => string = (key) => key): string {
  switch (kind) {
    case "api": return "API";
    case "web": return t("Web");
    case "native": return "Native";
    default: return t("Local");
  }
}

function formatProviders(values: string[] | undefined): string {
  if (!values || values.length === 0) {
    return "兼容 Provider";
  }
  return values.map((value) => providerNameFromId(value)).join("、");
}

function providerNameFromId(id: string): string {
  const labels: Record<string, string> = {
    "local-faster-whisper": "Faster Whisper",
    "local-whisper-cpp": "whisper.cpp",
    "api-openai-transcription": "OpenAI 转写",
    "local-nllb-ct2": "NLLB 本地翻译",
    "web-bing": "Bing 网页翻译",
    "web-google": "Google 网页翻译",
    "api-openai-chat": "OpenAI 兼容翻译"
  };
  return labels[id] ?? id;
}

function modelRecommendation(model: ModelStatus): string {
  if (model.id === "whisper-base") return "快速预览、低内存机器和短音频。";
  if (model.id === "whisper-small") return "默认推荐，速度和准确率比较均衡。";
  if (model.id.includes("large-v3-turbo")) return "更高准确率，适合长音频和更好的硬件。";
  if (model.backend === "whisper.cpp") return "Native 本地路径，适合轻依赖和 CPU 场景。";
  if (model.kind === "translation") return "本地离线翻译，适合隐私优先的字幕文本。";
  return "可用于兼容 Provider 的本地任务。";
}

export function SettingsProviders(props: RenderProps) {
  const { providers, models, config, updateConfig, testProvider } = props;
  const [providerViews, setProviderViews] = useState(providers);
  const [refreshLabel, setRefreshLabel] = useState("未刷新");
  const [providerDrafts, setProviderDrafts] = useState<Record<string, ProviderDraft>>(() => providerDraftsFromConfig(providers, config));
  const [providerChecks, setProviderChecks] = useState<Record<string, ProviderCheckState>>({});

  useEffect(() => {
    setProviderViews(providers);
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
    setRefreshLabel("检查中");
    const nextProviders = await Promise.all(providerViews.map((provider) => testProvider(provider.id, "static")));
    setProviderViews(nextProviders);
    setProviderChecks(Object.fromEntries(nextProviders.map((provider) => [provider.id, {
      status: provider.state === "available" ? "ok" : "failed",
      message: provider.state === "available" ? "静态检查通过" : providerStateLabel(provider.state)
    } satisfies ProviderCheckState])));
    setRefreshLabel("刷新完成");
  };

  const runProviderCheck = async (providerId: string) => {
    setProviderChecks((current) => ({ ...current, [providerId]: { status: "checking", message: "正在检查" } }));
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
        message: checked.state === "available" ? (mode === "live" ? "连接检查通过" : "静态检查通过") : providerStateLabel(checked.state)
      } }));
    } catch {
      setProviderChecks((current) => ({ ...current, [providerId]: { status: "failed", message: "检查失败" } }));
    }
  };

  return (
    <div className="settings-list">
      <div className="between"><h2>Provider</h2><div className="row gap-8"><Chip tone={refreshLabel === "刷新完成" ? "ok" : "muted"}>{refreshLabel}</Chip><button className="btn sm ghost" onClick={() => void refreshProviders()}>刷新状态</button></div></div>
      <p className="caption">Provider 按任务组织。静态检查不联网、不上传；网页/API Provider 执行任务前仍会要求确认。</p>
      <ProviderSection
        title="转写 Provider"
        description="选择音频转字幕的默认服务。本地路径不会上传音频，API 路径会上传音频。"
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
        checks={providerChecks}
        runProviderCheck={runProviderCheck}
        providerDrafts={providerDrafts}
        updateProviderDraft={updateProviderDraft}
      />
      <ProviderSection
        title="翻译 Provider"
        description="选择字幕文本翻译服务。本地 NLLB 不上传文本，网页/API Provider 会上传字幕文本。"
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
        checks={providerChecks}
        runProviderCheck={runProviderCheck}
        providerDrafts={providerDrafts}
        updateProviderDraft={updateProviderDraft}
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
  checks: Record<string, ProviderCheckState>;
  runProviderCheck: (providerId: string) => Promise<void>;
  providerDrafts: Record<string, ProviderDraft>;
  updateProviderDraft: (providerId: string, patch: Partial<ProviderDraft>) => void;
}) {
  return (
    <section className="provider-section">
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
            draft={props.providerDrafts[provider.id] ?? providerDraftFromConfig(props.config, provider.id)}
            onDraft={(patch) => props.updateProviderDraft(provider.id, patch)}
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
  draft: ProviderDraft;
  onDraft: (patch: Partial<ProviderDraft>) => void;
}) {
  const t = useT();
  const { provider } = props;
  const [secretValue, setSecretValue] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [secretStatus, setSecretStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const modelValue = providerControlValue(props.activeModel, props.draft.model, props.models);
  const deviceValue = props.active ? props.config.device : props.draft.device;
  const wordTimestamps = props.active ? props.config.wordTimestamps : props.draft.wordTimestamps;
  const sourceLanguage = props.active ? props.config.defaultLanguage : props.draft.sourceLanguage;
  const targetLanguage = props.active ? props.config.targetLanguage : props.draft.targetLanguage;
  const providerApiConfig = apiProviderConfig(props.config, provider.id);
  const openAIBaseUrl = props.active ? providerApiConfig.openAIBaseUrl ?? props.draft.openAIBaseUrl : props.draft.openAIBaseUrl;
  const openAIModel = props.active ? providerApiConfig.openAIModel ?? props.draft.openAIModel : props.draft.openAIModel;
  const languageOptions = provider.id === "local-nllb-ct2"
    ? [["en", "英语"], ["zh", "中文"], ["ja", "日语"], ["ko", "韩语"]]
    : [["auto", "自动识别"], ["en", "英语"], ["zh", "中文"], ["ja", "日语"], ["ko", "韩语"]];
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
  const canSetDefault = provider.enabled && provider.state === "available";
  const defaultBlockReason = providerDefaultBlockReason(provider);
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
          <strong>{provider.name}</strong>
          <Chip tone={providerStateTone(provider)}>{providerStateLabel(provider.state, t)}</Chip>
          {props.active && <Chip tone="accent">当前默认</Chip>}
          <Chip>{providerKindLabel(provider.kind, t)}</Chip>
          {provider.requiresUploadConfirmation && <Chip tone="warn">上传确认</Chip>}
        </div>
        <span>{provider.privacyNote}</span>
        <div className="job-meta">
          {provider.requiresModel && <Chip tone="muted">需要模型</Chip>}
          {provider.requiresApiKey && <Chip tone="muted">需要 API Key</Chip>}
          {provider.supportsBatch && <Chip tone="muted">批量</Chip>}
          {provider.supportsWordTimestamps && <Chip tone="muted">词级时间戳</Chip>}
          {(provider.supportedLanguages ?? []).slice(0, 5).map((lang) => <Chip key={lang} tone="muted">{lang}</Chip>)}
        </div>
        <div className={`provider-config ${provider.kind === "api" ? "api-provider-config" : ""}`}>
          {provider.requiresModel && provider.kind !== "api" && props.models.length > 0 && (
            <label>模型<select value={modelValue} onChange={(event) => updateModel(event.currentTarget.value)}>
              {props.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select></label>
          )}
          {provider.capability === "stt" && provider.kind !== "api" && (
            <>
              <label>设备<select value={deviceValue} onChange={(event) => updateDevice(event.currentTarget.value as ConfigViewModel["device"])}><option value="auto">自动</option><option value="cpu">CPU</option><option value="gpu">GPU</option></select></label>
              <label className="inline-check"><input type="checkbox" checked={wordTimestamps} onChange={(event) => updateWordTimestamps(event.currentTarget.checked)} /> 词级时间戳</label>
            </>
          )}
          {provider.capability === "translation" && provider.kind !== "api" && (
            <>
              <label>源语言<select value={provider.id === "local-nllb-ct2" && sourceLanguage === "auto" ? "en" : sourceLanguage} onChange={(event) => updateSourceLanguage(event.currentTarget.value)}>
                {languageOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>
              <label>目标语言<select value={targetLanguage} onChange={(event) => updateTargetLanguage(event.currentTarget.value)}><option value="zh">简体中文</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option></select></label>
            </>
          )}
          {provider.kind === "api" && (
            <div className="api-provider-form">
              <div className="api-field">
                <span className="api-label">API Key</span>
                <div className="api-key-row">
                  <input
                    aria-label={`${provider.name} API Key`}
                    className="mono"
                    type={showSecret ? "text" : "password"}
                    value={secretValue}
                    placeholder={providerSecretPlaceholder(provider, props.config)}
                    onChange={(event) => {
                      setSecretValue(event.currentTarget.value);
                      if (secretStatus !== "idle") setSecretStatus("idle");
                    }}
                  />
                  <button className="btn sm ghost" disabled={!secretValue} onClick={() => setShowSecret((shown) => !shown)} type="button">{showSecret ? "隐藏" : "显示"}</button>
                </div>
              </div>
              <label>模型<input value={openAIModel || defaultAPIModel(provider)} placeholder={defaultAPIModel(provider)} onChange={(event) => updateOpenAIModel(event.currentTarget.value)} /></label>
              <label>Base URL<input value={openAIBaseUrl} onChange={(event) => updateOpenAIBaseUrl(event.currentTarget.value)} /></label>
              <div className="api-form-footer">
                <span>凭据：{secretConfigured ? `已保存到 ${secretAlias}` : "未配置"}</span>
                <button className="btn sm ghost" disabled={!secretValue.trim() || secretStatus === "saving"} onClick={() => void saveSecret()} type="button">
                  {secretStatus === "saving" ? "保存中" : secretConfigured ? "替换密钥" : "保存密钥"}
                </button>
                {secretStatus === "saved" && <Chip tone="ok">已保存</Chip>}
                {secretStatus === "failed" && <Chip tone="warn">保存失败</Chip>}
              </div>
              <p className="caption no-margin">请求会通过本机 daemon 代理发送到你设置的 Base URL。Key 保存在系统安全存储中，不写入配置文件。</p>
            </div>
          )}
        </div>
      </div>
      <div className="row gap-8 wrap end">
        {!props.active && <button className="btn sm" disabled={!canSetDefault} title={defaultBlockReason} onClick={selectAsDefault}>设为默认</button>}
        {!props.active && !canSetDefault && <Chip tone="warn">{defaultBlockReason}</Chip>}
        <button className="btn sm ghost" disabled={checking} onClick={props.onTest}>{checking ? "检查中" : provider.kind === "api" ? "连接检查" : "静态检查"}</button>
        {props.check && props.check.status !== "idle" && (
          <Chip tone={props.check.status === "ok" ? "ok" : props.check.status === "failed" ? "warn" : "accent"}>{props.check.message}</Chip>
        )}
      </div>
    </article>
  );
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
  return (providerConfig.apiKeyStatus === "configured" && Boolean(providerConfig.apiKeyAlias)) || Boolean(provider.maskedCredential && provider.maskedCredential !== "未配置");
}

function providerSecretAlias(provider: ProviderStatus, config: ConfigViewModel): string {
  const providerConfig = apiProviderConfig(config, provider.id);
  if (providerConfig.apiKeyStatus === "configured" && providerConfig.apiKeyAlias) {
    return providerConfig.apiKeyAlias;
  }
  if (provider.maskedCredential && provider.maskedCredential !== "未配置") {
    return provider.maskedCredential;
  }
  return defaultSecretAlias(provider.id);
}

function providerSecretPlaceholder(provider: ProviderStatus, config: ConfigViewModel): string {
  return isProviderSecretConfigured(provider, config) ? "输入新的 API Key 以替换已保存密钥" : "sk-...";
}

function defaultAPIModel(provider: ProviderStatus): string {
  return provider.capability === "stt" ? "gpt-4o-transcribe" : "gpt-4o-mini";
}

function providerDefaultBlockReason(provider: ProviderStatus): string {
  switch (provider.state) {
    case "missing_api_key": return "先配置密钥";
    case "missing_model": return "先安装模型";
    case "missing_dependency": return "先安装依赖";
    case "invalid_config": return "先修复配置";
    case "disabled": return "Provider 已停用";
    case "not_implemented": return "暂不可用";
    default: return provider.enabled ? "" : "Provider 已停用";
  }
}

export function SettingsDiagnostics({ environment }: RenderProps) {
  return (
    <div className="settings-list">
      <div className="between"><h2>诊断</h2><Chip tone="accent">示例信息</Chip></div>
      <section className="panel paper-muted">
        <h3>本地服务状态</h3>
        <KV k="状态" v={environment?.health === "ok" ? "正常" : "需要检查"} />
        <KV k="最近检查" v="mock health ok" />
        <KV k="敏感信息" v="已脱敏" />
      </section>
      <pre>{`[12:43:01] local service ready\n[12:43:04] subtitle progress=62\ncredential=[REDACTED]\napi_key=[REDACTED]`}</pre>
    </div>
  );
}

export function SettingsBenchmark() {
  return (
    <div className="settings-list">
      <div className="between"><h2>Benchmark</h2><Chip>第一版暂不实现</Chip></div>
      <section className="panel dashed">
        <h3>后续可能包含</h3>
        <KV k="转写性能" v="RTFx · elapsed" />
        <KV k="转写质量" v="WER / CER · 字幕健康度" />
        <KV k="翻译质量" v="BLEU · chrF · exact match" />
      </section>
    </div>
  );
}
