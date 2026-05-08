import { useEffect, useState } from "react";
import type { ConfigViewModel, ModelStatus, ProviderState, ProviderStatus } from "../../../../shared/contracts/types";
import type { RenderProps, Screen, UiFontStyle, UiLanguage } from "../types";
import { Chip, Chrome, KV, Segment, SettingRow, Toggle } from "../components";

export function SettingsPage(props: RenderProps & { tab: "general" | "models" | "api" | "providers" | "diagnostics" | "benchmark" }) {
  return (
    <div className="wf">
      <Chrome title="设置" />
      <main className="settings-shell">
        <aside className="settings-nav">
          {[
            ["settings-general", "◎", "通用"],
            ["settings-models", "◇", "模型管理"],
            ["settings-providers", "◌", "Provider"],
            ["settings-diagnostics", "⚙", "诊断"],
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
  const uiLanguages: Array<{ label: string; value: UiLanguage }> = [
    { label: "跟随系统", value: "system" },
    { label: "简体中文", value: "zh" },
    { label: "English", value: "en" }
  ];
  const fontStyles: Array<{ label: string; value: UiFontStyle }> = [
    { label: "系统字体", value: "system" },
    { label: "手绘字体", value: "sketch" }
  ];
  const outputTypes: Array<{ label: string; value: ConfigViewModel["outputType"] }> = [
    { label: "原字幕", value: "original_srt" },
    { label: "翻译字幕", value: "translated_srt" },
    { label: "双语字幕", value: "bilingual_srt" },
    { label: "烧录视频", value: "burned_video" }
  ];
  const outputFormats: Array<{ label: string; value: ConfigViewModel["outputFormat"] }> = [
    { label: "SRT", value: "srt" },
    { label: "VTT", value: "vtt" },
    { label: "TXT", value: "txt" },
    { label: "JSON", value: "json" }
  ];
  const conflictModes: Array<{ label: string; value: ConfigViewModel["outputConflict"] }> = [
    { label: "询问", value: "ask" },
    { label: "覆盖", value: "overwrite" },
    { label: "跳过", value: "skip" }
  ];
  const outputTypeIndex = Math.max(0, outputTypes.findIndex((item) => item.value === props.config.outputType));
  const outputFormatIndex = Math.max(0, outputFormats.findIndex((item) => item.value === props.config.outputFormat));
  const conflictIndex = Math.max(0, conflictModes.findIndex((item) => item.value === props.config.outputConflict));
  const deviceIndex = props.config.device === "cpu" ? 1 : props.config.device === "gpu" ? 2 : 0;
  const uiLanguageIndex = Math.max(0, uiLanguages.findIndex((item) => item.value === props.uiLanguage));
  const fontStyleIndex = Math.max(0, fontStyles.findIndex((item) => item.value === props.uiFontStyle));
  const asrProviders = props.providers.filter((provider) => provider.capability === "stt");
  const translationProviders = props.providers.filter((provider) => provider.capability === "translation");
  return (
    <div className="settings-list">
      <h2>通用</h2>
      <h3>界面</h3>
      <SettingRow label="语言"><Segment items={uiLanguages.map((item) => item.label)} active={uiLanguageIndex} onSelect={(index) => props.setUiLanguage(uiLanguages[index].value)} /></SettingRow>
      <SettingRow label="字体"><Segment items={fontStyles.map((item) => item.label)} active={fontStyleIndex} onSelect={(index) => props.setUiFontStyle(fontStyles[index].value)} /></SettingRow>
      <h3>默认参数</h3>
      <SettingRow label="输出内容"><Segment items={outputTypes.map((item) => item.label)} active={outputTypeIndex} onSelect={(index) => void props.updateConfig({ outputType: outputTypes[index].value })} /></SettingRow>
      <SettingRow label="字幕语言"><select value={props.config.defaultLanguage} onChange={(event) => void props.updateConfig({ defaultLanguage: event.target.value })}><option value="auto">自动识别</option><option value="zh">中文</option></select></SettingRow>
      <SettingRow label="输出格式"><Segment items={outputFormats.map((item) => item.label)} active={outputFormatIndex} onSelect={(index) => void props.updateConfig({ outputFormat: outputFormats[index].value })} /></SettingRow>
      <SettingRow label="文件已存在时"><Segment items={conflictModes.map((item) => item.label)} active={conflictIndex} onSelect={(index) => void props.updateConfig({ outputConflict: conflictModes[index].value })} /></SettingRow>
      <h3>转写</h3>
      <SettingRow label="默认转写 Provider">
        <select aria-label="默认转写 Provider" value={props.config.asrProvider} onChange={(event) => void props.updateConfig({ asrProvider: event.currentTarget.value })}>
          {asrProviders.map((provider) => <option key={provider.id} value={provider.id}>{providerOptionLabel(provider)}</option>)}
        </select>
      </SettingRow>
      <SettingRow label="设备"><Segment items={["自动", "CPU", "GPU"]} active={deviceIndex} onSelect={(index) => void props.updateConfig({ device: (["auto", "cpu", "gpu"] as ConfigViewModel["device"][])[index] })} /></SettingRow>
      <SettingRow label="词级时间戳"><Toggle ariaLabel="设置词级时间戳" on={props.config.wordTimestamps} onClick={() => void props.updateConfig({ wordTimestamps: !props.config.wordTimestamps })} /></SettingRow>
      <h3>翻译</h3>
      <SettingRow label="默认翻译 Provider">
        <select aria-label="默认翻译 Provider" value={props.config.translationProvider} onChange={(event) => void props.updateConfig({ translationProvider: event.currentTarget.value })}>
          {translationProviders.map((provider) => <option key={provider.id} value={provider.id}>{providerOptionLabel(provider)}</option>)}
        </select>
      </SettingRow>
      <SettingRow label="目标语言"><select value={props.config.targetLanguage} onChange={(event) => void props.updateConfig({ targetLanguage: event.target.value })}><option value="zh">简体中文</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option></select></SettingRow>
    </div>
  );
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

function providerStateLabel(state: ProviderState): string {
  const labels: Record<ProviderState, string> = {
    available: "可用",
    missing_dependency: "缺少依赖",
    missing_model: "缺少模型",
    missing_api_key: "未配置密钥",
    invalid_config: "配置需检查",
    disabled: "已停用",
    not_implemented: "暂不可用"
  };
  return labels[state];
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

function providerOptionLabel(provider: ProviderStatus): string {
  const state = providerStateLabel(provider.state);
  const prefix = provider.kind === "local" ? "本地" : provider.kind === "api" ? "API" : provider.kind === "web" ? "网页" : "Native";
  return `${prefix} · ${provider.name}${provider.enabled && provider.state === "available" ? "" : ` (${state})`}`;
}

function providerKindLabel(kind: ProviderStatus["kind"]): string {
  switch (kind) {
    case "api": return "API";
    case "web": return "网页";
    case "native": return "Native";
    default: return "本地";
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

  useEffect(() => {
    setProviderViews(providers);
  }, [providers]);

  const refreshProviders = async () => {
    setRefreshLabel("检查中");
    const nextProviders = await Promise.all(providerViews.map((provider) => testProvider(provider.id, "static")));
    setProviderViews(nextProviders);
    setRefreshLabel("刷新完成");
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
      />
    </div>
  );
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
            onTest={() => void props.testProvider(provider.id, "static")}
            config={props.config}
            updateConfig={props.updateConfig}
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
  config: ConfigViewModel;
  updateConfig: RenderProps["updateConfig"];
}) {
  const { provider } = props;
  const languageOptions = provider.id === "local-nllb-ct2"
    ? [["en", "英语"], ["zh", "中文"], ["ja", "日语"], ["ko", "韩语"]]
    : [["auto", "自动识别"], ["en", "英语"], ["zh", "中文"], ["ja", "日语"], ["ko", "韩语"]];
  return (
    <article className={`provider-card provider-card-rich ${provider.requiresUploadConfirmation ? "warn-card-soft" : "ok-card"} ${props.active ? "selected-card" : ""}`}>
      <div className="provider-main">
        <div className="row gap-8 wrap">
          <strong>{provider.name}</strong>
          <Chip tone={providerStateTone(provider)}>{providerStateLabel(provider.state)}</Chip>
          {props.active && <Chip tone="accent">当前默认</Chip>}
          <Chip>{providerKindLabel(provider.kind)}</Chip>
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
        <div className="provider-config">
          {provider.requiresModel && props.models.length > 0 && (
            <label>模型<select value={props.activeModel} onChange={(event) => props.onModel(event.currentTarget.value)}>
              {props.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select></label>
          )}
          {provider.capability === "stt" && provider.id !== "api-openai-transcription" && (
            <>
              <label>设备<select value={props.config.device} onChange={(event) => void props.updateConfig({ device: event.currentTarget.value as ConfigViewModel["device"] })}><option value="auto">自动</option><option value="cpu">CPU</option><option value="gpu">GPU</option></select></label>
              <label className="inline-check"><input type="checkbox" checked={props.config.wordTimestamps} onChange={() => void props.updateConfig({ wordTimestamps: !props.config.wordTimestamps })} /> 词级时间戳</label>
            </>
          )}
          {provider.capability === "translation" && (
            <>
              <label>源语言<select value={provider.id === "local-nllb-ct2" && props.config.defaultLanguage === "auto" ? "en" : props.config.defaultLanguage} onChange={(event) => void props.updateConfig({ defaultLanguage: event.currentTarget.value })}>
                {languageOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>
              <label>目标语言<select value={props.config.targetLanguage} onChange={(event) => void props.updateConfig({ targetLanguage: event.currentTarget.value })}><option value="zh">简体中文</option><option value="en">English</option><option value="ja">日本語</option><option value="ko">한국어</option></select></label>
            </>
          )}
          {provider.kind === "api" && (
            <>
              <label>密钥<span className="input mono">{provider.maskedCredential || props.config.apiKeyAlias || "未配置"}</span></label>
              <label>Base URL<input value={props.config.openAIBaseUrl ?? ""} onChange={(event) => void props.updateConfig({ openAIBaseUrl: event.currentTarget.value })} /></label>
              <label>模型名<input value={props.config.openAIModel ?? ""} placeholder={provider.capability === "stt" ? "gpt-4o-transcribe" : "gpt-4o-mini"} onChange={(event) => void props.updateConfig({ openAIModel: event.currentTarget.value })} /></label>
            </>
          )}
        </div>
      </div>
      <div className="row gap-8 wrap end">
        {!props.active && <button className="btn sm" onClick={() => props.onProvider(provider.id)}>设为默认</button>}
        <button className="btn sm ghost" onClick={props.onTest}>静态检查</button>
      </div>
    </article>
  );
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
