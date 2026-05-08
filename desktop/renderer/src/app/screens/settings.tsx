import { useEffect, useState } from "react";
import type { ConfigViewModel, ProviderState, ProviderStatus } from "../../../../shared/contracts/types";
import type { RenderProps, Screen, UiLanguage } from "../types";
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
            ["settings-api", "◈", "API 服务"],
            ["settings-providers", "◌", "Provider"],
            ["settings-diagnostics", "⚙", "诊断"],
            ["settings-benchmark", "▣", "Benchmark"]
          ].map(([id, icon, label]) => <button key={id} className={props.screen === id ? "active" : ""} onClick={() => props.setScreen(id as Screen)}>{icon} {label}</button>)}
          <span className="caption version">v0.11 mock</span>
        </aside>
        <section className="settings-content">
          {props.tab === "general" && <SettingsGeneral {...props} />}
          {props.tab === "models" && <SettingsModels {...props} />}
          {props.tab === "api" && <SettingsApi />}
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
  const outputTypes: Array<{ label: string; value: ConfigViewModel["outputType"] }> = [
    { label: "原字幕", value: "original_srt" },
    { label: "翻译字幕", value: "translated_srt" },
    { label: "双语字幕", value: "bilingual_srt" },
    { label: "烧录视频", value: "burned_video" }
  ];
  const conflictModes: Array<{ label: string; value: ConfigViewModel["outputConflict"] }> = [
    { label: "询问", value: "ask" },
    { label: "覆盖", value: "overwrite" },
    { label: "跳过", value: "skip" }
  ];
  const outputTypeIndex = Math.max(0, outputTypes.findIndex((item) => item.value === props.config.outputType));
  const conflictIndex = Math.max(0, conflictModes.findIndex((item) => item.value === props.config.outputConflict));
  const transcriptionIndex = props.config.asrProvider === "api-openai-transcription" ? 1 : 0;
  const deviceIndex = props.config.device === "cpu" ? 1 : props.config.device === "gpu" ? 2 : 0;
  const uiLanguageIndex = Math.max(0, uiLanguages.findIndex((item) => item.value === props.uiLanguage));
  return (
    <div className="settings-list">
      <h2>通用</h2>
      <SettingRow label="语言"><Segment items={uiLanguages.map((item) => item.label)} active={uiLanguageIndex} onSelect={(index) => props.setUiLanguage(uiLanguages[index].value)} /></SettingRow>
      <h3>默认参数</h3>
      <SettingRow label="输出内容"><Segment items={outputTypes.map((item) => item.label)} active={outputTypeIndex} onSelect={(index) => void props.updateConfig({ outputType: outputTypes[index].value })} /></SettingRow>
      <SettingRow label="字幕语言"><select value={props.config.defaultLanguage} onChange={(event) => void props.updateConfig({ defaultLanguage: event.target.value })}><option value="auto">自动识别</option><option value="zh">中文</option></select></SettingRow>
      <SettingRow label="文件已存在时"><Segment items={conflictModes.map((item) => item.label)} active={conflictIndex} onSelect={(index) => void props.updateConfig({ outputConflict: conflictModes[index].value })} /></SettingRow>
      <h3>转写</h3>
      <SettingRow label="默认转写方式"><Segment items={["本地", "远程"]} active={transcriptionIndex} onSelect={(index) => void props.updateConfig({ asrProvider: index === 0 ? "local-faster-whisper" : "api-openai-transcription" })} /></SettingRow>
      <SettingRow label="设备"><Segment items={["自动", "CPU", "GPU"]} active={deviceIndex} onSelect={(index) => void props.updateConfig({ device: (["auto", "cpu", "gpu"] as ConfigViewModel["device"][])[index] })} /></SettingRow>
      <SettingRow label="词级时间戳"><Toggle ariaLabel="设置词级时间戳" on={props.config.wordTimestamps} onClick={() => void props.updateConfig({ wordTimestamps: !props.config.wordTimestamps })} /></SettingRow>
    </div>
  );
}

export function SettingsModels({ models, installModel }: RenderProps) {
  return (
    <div className="settings-list">
      <div className="between"><h2>模型管理</h2><span className="caption">存储路径：~/.fastsub/models</span></div>
      <h3>语音识别 (ASR)</h3>
      {models.filter((model) => model.kind === "asr").map((model) => (
        <article className={`model-card ${model.state === "ready" ? "ok-card" : "dashed"}`} key={model.id}>
          <div><strong>{model.name}</strong><span>{model.sizeLabel}{model.id === "whisper-small" ? " · 当前默认" : ""}</span></div>
          {model.state === "ready" && <Chip tone="ok">可用</Chip>}
          {model.state === "installing" && <Chip tone="accent">安装中 {model.progressPercent ?? 0}%</Chip>}
          {model.state === "failed" && <><Chip tone="warn">安装失败</Chip><button className="btn sm" onClick={() => void installModel(model.id)}>重试下载</button></>}
          {model.state === "missing" && <button className="btn sm" onClick={() => void installModel(model.id)}>下载</button>}
        </article>
      ))}
      <h3>翻译模型</h3>
      {models.filter((model) => model.kind === "translation").map((model) => (
        <article className={`model-card ${model.state === "ready" ? "ok-card" : "dashed"}`} key={model.id}>
          <div><strong>{model.name}</strong><span>{model.sizeLabel}</span></div>
          {model.state === "ready" && <Chip tone="ok">可用</Chip>}
          {model.state === "installing" && <Chip tone="accent">安装中 {model.progressPercent ?? 0}%</Chip>}
          {model.state === "failed" && <><Chip tone="warn">安装失败</Chip><button className="btn sm" onClick={() => void installModel(model.id)}>重试下载</button></>}
          {model.state === "missing" && <button className="btn sm" onClick={() => void installModel(model.id)}>下载</button>}
        </article>
      ))}
    </div>
  );
}

export function SettingsApi() {
  const [apiEnabled, setApiEnabled] = useState(false);
  const [confirmBeforeUpload, setConfirmBeforeUpload] = useState(true);
  const [checkStatus, setCheckStatus] = useState("尚未检查");
  return (
    <div className="settings-list">
      <h2>API 服务</h2>
      <section className="panel warn-panel">使用 API 服务时，音频或字幕文本可能会上传到对应服务商。本地模式不会上传文件。</section>
      <SettingRow label="启用 API 服务"><Toggle ariaLabel="启用 API 服务" on={apiEnabled} onClick={() => setApiEnabled((enabled) => !enabled)} /></SettingRow>
      <SettingRow label="OpenAI"><span className="input mono">sk-••••••••••••</span></SettingRow>
      <SettingRow label="服务地址（高级）"><span className="input mono">https://api.openai.com/v1</span></SettingRow>
      <SettingRow label="上传前确认"><Toggle ariaLabel="上传前确认" on={confirmBeforeUpload} onClick={() => setConfirmBeforeUpload((enabled) => !enabled)} /></SettingRow>
      <SettingRow label="连接测试">
        <div className="row gap-8">
          <button className="btn sm" onClick={() => setCheckStatus("静态检查通过")}>静态检查</button>
          <button className="btn sm ghost" onClick={() => setCheckStatus("Live 测试需要上传确认")}>Live 测试</button>
          <Chip tone={checkStatus === "尚未检查" ? "muted" : "accent"}>{checkStatus}</Chip>
        </div>
      </SettingRow>
    </div>
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

function providerStateTone(provider: ProviderStatus): "ok" | "accent" | "warn" | "muted" {
  if (provider.state === "available") {
    return "ok";
  }
  if (provider.requiresUploadConfirmation) {
    return "warn";
  }
  return "muted";
}

export function SettingsProviders({ providers, testProvider }: RenderProps) {
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
      <div className="between"><h2>Provider 管理</h2><div className="row gap-8"><Chip tone={refreshLabel === "刷新完成" ? "ok" : "muted"}>{refreshLabel}</Chip><button className="btn sm ghost" onClick={() => void refreshProviders()}>刷新状态</button></div></div>
      <p className="caption">测试默认只做静态检查，不联网、不上传。</p>
      {providerViews.map((provider) => (
        <article className={`provider-card ${provider.requiresUploadConfirmation ? "" : "ok-card"}`} key={provider.id}>
          <div><strong>{provider.name}</strong><span>{provider.privacyNote}</span></div>
          <Chip tone={providerStateTone(provider)}>{providerStateLabel(provider.state)}</Chip>
        </article>
      ))}
    </div>
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
