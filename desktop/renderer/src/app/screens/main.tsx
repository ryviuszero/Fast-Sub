import { useEffect, useState } from "react";
import type { DragEvent } from "react";
import type { ConfigViewModel, JobDetail, JobStatus, ProviderStatus } from "../../../../shared/contracts/types";
import type { RenderProps } from "../types";
import { CheckItem, Chip, Chrome, Divider, Footer, Segment, SettingsEntry, Toggle } from "../components";
import { useRuntimeText, useT } from "../i18n";

const MAX_VISIBLE_SELECTED_FILES = 40;

type QuickSelectOption<T extends string> = {
  label: string;
  value: T;
};

function outputFormatLabel(format: ConfigViewModel["outputFormat"]): string {
  return format.toUpperCase();
}

function outputTypeLabel(type: ConfigViewModel["outputType"], t: (key: string) => string): string {
  const labels: Record<ConfigViewModel["outputType"], string> = {
    original_srt: "Original subtitles",
    translated_srt: "Translated subtitles",
    bilingual_srt: "Bilingual subtitles",
    burned_video: "Burn-in video"
  };
  return t(labels[type]);
}

export function MainEmpty({ setScreen, openProviderSettings, addFiles, addFolder, addDroppedFiles, asrReady, translationReady, config, providers, jobs, activeJob, updateConfig }: RenderProps) {
  const t = useT();
  const [translationOutputWarning, setTranslationOutputWarning] = useState(false);
  const [openQuickSelect, setOpenQuickSelect] = useState<"source" | "target" | "output" | null>(null);
  const languageOptions: Array<QuickSelectOption<string>> = [
    { label: t("Auto detect"), value: "auto" },
    { label: t("Chinese"), value: "zh" },
    { label: t("English"), value: "en" },
    { label: t("Japanese"), value: "ja" },
    { label: t("Korean"), value: "ko" }
  ];
  const targetLanguageOptions = languageOptions.filter((item) => item.value !== "auto");
  const outputTypes: Array<{ label: string; value: ConfigViewModel["outputType"] }> = [
    { label: t("Original subtitles"), value: "original_srt" },
    { label: t("Translated subtitles"), value: "translated_srt" },
    { label: t("Bilingual subtitles"), value: "bilingual_srt" }
  ];
  const canUseTranslationOutput = translationOutputReady(config, providers, translationReady);
  const handleDropZoneClick = () => {
    void addFiles();
  };
  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (event.dataTransfer.files.length > 0) {
      addDroppedFiles(event.dataTransfer.files);
    }
  };
  const selectOutputType = (outputType: ConfigViewModel["outputType"]) => {
    if (outputTypeNeedsTranslation(outputType) && !canUseTranslationOutput) {
      setTranslationOutputWarning(true);
      return;
    }
    setTranslationOutputWarning(false);
    void updateConfig({ outputType });
  };
  return (
    <div className="wf">
      <Chrome right={<><Chip tone={asrReady ? "ok" : "warn"}>{asrReady ? t("Local transcription ready") : t("Local transcription not ready")}</Chip><Chip tone={translationReady ? "ok" : "warn"}>{translationReady ? t("Translation ready") : t("Translation not ready")}</Chip></>} />
      <main className="main-empty">
        <section
          className="drop-zone"
          onClick={handleDropZoneClick}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <div className="drop-arrow">⬇</div>
          <h1>{t("Drop video here")}</h1>
          <p>{t("Supported media extensions")}</p>
          <div className="row gap-8">
            <button className="btn" onClick={(event) => { event.stopPropagation(); void addFiles(); }}>{t("Add video")}</button>
            <button className="btn" onClick={(event) => { event.stopPropagation(); void addFolder(); }}>{t("Add folder")}</button>
          </div>
        </section>
        <div className="output-row">
          <QuickSelect label={t("Source language")} open={openQuickSelect === "source"} options={languageOptions} value={config.defaultLanguage} onOpen={() => setOpenQuickSelect("source")} onClose={() => setOpenQuickSelect(null)} onChange={(defaultLanguage) => void updateConfig({ defaultLanguage })} />
          <QuickSelect label={t("Target language")} open={openQuickSelect === "target"} options={targetLanguageOptions} value={config.targetLanguage} onOpen={() => setOpenQuickSelect("target")} onClose={() => setOpenQuickSelect(null)} onChange={(targetLanguage) => void updateConfig({ targetLanguage })} />
          <QuickSelect label={t("Output content")} open={openQuickSelect === "output"} options={outputTypes} value={config.outputType === "burned_video" ? "original_srt" : config.outputType} onOpen={() => setOpenQuickSelect("output")} onClose={() => setOpenQuickSelect(null)} onChange={selectOutputType} />
        </div>
        {translationOutputWarning && (
          <div className="blocking-note" role="status">
            <span>{t("Translation output not ready")}</span>
            <button className="btn sm primary" onClick={() => openProviderSettings("translation")} type="button">{t("Configure translation Provider")}</button>
          </div>
        )}
      </main>
      <Footer activeJob={activeJob} jobs={jobs} onHistory={() => setScreen("queue-list")} onSettings={() => setScreen("settings-general")} />
    </div>
  );
}

function QuickSelect<T extends string>(props: {
  label: string;
  open: boolean;
  options: Array<QuickSelectOption<T>>;
  value: T;
  onOpen: () => void;
  onClose: () => void;
  onChange: (value: T) => void;
}) {
  const selected = props.options.find((item) => item.value === props.value) ?? props.options[0];
  return (
    <div className="quick-setting" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        props.onClose();
      }
    }}>
      <span className="subtle">{props.label}</span>
      <button aria-expanded={props.open} aria-haspopup="listbox" aria-label={props.label} className="quick-select-button" onClick={() => props.open ? props.onClose() : props.onOpen()} type="button">
        <span>{selected?.label ?? props.value}</span>
        <span aria-hidden="true">›</span>
      </button>
      {props.open && (
        <div className="quick-select-menu" role="listbox">
          {props.options.map((item) => (
            <button
              aria-selected={item.value === props.value}
              className={item.value === props.value ? "selected" : ""}
              key={item.value}
              onClick={() => {
                props.onChange(item.value);
                props.onClose();
              }}
              role="option"
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MainFiles(props: RenderProps & { advanced: boolean }) {
  const t = useT();
  const files = props.files;
  const visibleFiles = files.slice(0, MAX_VISIBLE_SELECTED_FILES);
  const hiddenFileCount = Math.max(0, files.length - visibleFiles.length);
  const localReady = props.asrReady;
  const removeFile = (path: string) => {
    const nextFiles = files.filter((item) => item.path !== path);
    props.setFiles(nextFiles);
    if (nextFiles.length === 0) {
      props.setScreen("main-empty");
    }
  };
  return (
    <div className="wf">
      <Chrome right={<Chip tone={localReady ? "ok" : "warn"}>{localReady ? t("Ready") : t("Not ready")}</Chip>} />
      <main className="content-flow">
        <div className="between">
          <h2>{props.fileImportPending ? t("Preparing selected files") : t("Files added", { count: files.length })}</h2>
          <button className="btn sm ghost" disabled={props.fileImportPending} onClick={() => void props.addFiles()}>{t("+ Add more")}</button>
        </div>
        {props.advanced && <AdvancedSettings {...props} />}
        {props.fileImportPending && (
          <section aria-live="polite" className="panel file-import-loading" role="status">
            <span className="spin" />
            <div>
              <strong>{t("Preparing media files")}</strong>
              <span>{props.fileImportCount ? t("Preparing selected count", { count: props.fileImportCount }) : t("Please wait while files are scanned")}</span>
            </div>
          </section>
        )}
        <div className="file-list">
          {visibleFiles.map((file) => (
            <article className="file-card" key={file.path}>
              <div><strong>{file.name}</strong><span>{file.size} · {file.duration}</span></div>
              <button className="btn sm ghost" onClick={() => removeFile(file.path)}>{t("Remove")}</button>
            </article>
          ))}
          {hiddenFileCount > 0 && (
            <div className="file-list-more">{t("More files hidden", { count: hiddenFileCount })}</div>
          )}
        </div>
        {!props.advanced && (
          <>
            <Divider />
            <div className="between">
              <div><p>{t("Output prefix")}{outputTypeLabel(props.config.outputType, t)} {outputFormatLabel(props.config.outputFormat)}{props.config.burnInVideo ? ` · ${t("Burn-in video")}` : ""} · {t("Same folder as source")}</p><span className="caption">{t("Default main summary")}</span></div>
              <button className="link-button" onClick={() => props.setScreen("main-advanced")}>{t("Detailed settings")}</button>
            </div>
          </>
        )}
      </main>
      <div className="action-footer">
        <SettingsEntry onClick={() => props.setScreen("settings-general")} />
        <div className="row gap-8">
          <button className="btn ghost" onClick={() => props.setScreen("main-empty")}>{t("Cancel")}</button>
          <button className="btn primary hero-action" disabled={props.fileImportPending || files.length === 0} onClick={() => void props.startJob()}>{t("Start subtitle generation")}</button>
        </div>
      </div>
    </div>
  );
}

export function AdvancedSettings(props: RenderProps) {
  const t = useT();
  const [translationOutputWarning, setTranslationOutputWarning] = useState(false);
  const outputTypes: Array<{ label: string; value: ConfigViewModel["outputType"] }> = [
    { label: t("Original subtitles"), value: "original_srt" },
    { label: t("Translated subtitles"), value: "translated_srt" },
    { label: t("Bilingual subtitles"), value: "bilingual_srt" }
  ];
  const conflictModes: Array<{ label: string; value: ConfigViewModel["outputConflict"] }> = [
    { label: t("Ask"), value: "ask" },
    { label: t("Overwrite"), value: "overwrite" },
    { label: t("Skip"), value: "skip" }
  ];
  const outputFormats: Array<{ label: string; value: ConfigViewModel["outputFormat"] }> = [
    { label: "SRT", value: "srt" },
    { label: "VTT", value: "vtt" },
    { label: "TXT", value: "txt" },
    { label: "JSON", value: "json" }
  ];
  const outputTypeIndex = Math.max(0, outputTypes.findIndex((item) => item.value === props.config.outputType));
  const outputFormatIndex = Math.max(0, outputFormats.findIndex((item) => item.value === props.config.outputFormat));
  const conflictIndex = Math.max(0, conflictModes.findIndex((item) => item.value === props.config.outputConflict));
  const canUseTranslationOutput = translationOutputReady(props.config, props.providers, props.translationReady);
  const availableASRProviders = availableProviderOptions(props.providers, "stt");
  const selectedASRProvider = availableASRProviders.some((provider) => provider.id === props.config.asrProvider)
    ? props.config.asrProvider
    : availableASRProviders[0]?.id ?? "";
  const selectOutputType = (outputType: ConfigViewModel["outputType"]) => {
    if (outputTypeNeedsTranslation(outputType) && !canUseTranslationOutput) {
      setTranslationOutputWarning(true);
      return;
    }
    setTranslationOutputWarning(false);
    void props.updateConfig({ outputType });
  };
  return (
    <section className="panel paper-muted compact-settings">
      <div className="between"><h2>{t("Detailed settings")}</h2><button className="link-button" onClick={() => props.setScreen("main-files")}>{t("Collapse")}</button></div>
      <div className="settings-grid">
        <label>{t("Subtitle language")}<select value={props.config.defaultLanguage} onChange={(event) => void props.updateConfig({ defaultLanguage: event.target.value })}><option value="auto">{t("Auto detect")}</option><option value="zh">{t("Chinese")}</option><option value="en">{t("English")}</option><option value="ja">{t("Japanese")}</option><option value="ko">{t("Korean")}</option></select></label>
        <label>{t("Target language")}<select value={props.config.targetLanguage} onChange={(event) => void props.updateConfig({ targetLanguage: event.target.value })}><option value="zh">{t("Simplified Chinese")}</option><option value="en">{t("English")}</option><option value="ja">{t("Japanese")}</option><option value="ko">{t("Korean")}</option></select></label>
        <label>{t("Transcription Provider")}<select disabled={availableASRProviders.length === 0} value={selectedASRProvider} onChange={(event) => void props.updateConfig({ asrProvider: event.target.value })}>{availableASRProviders.length > 0 ? availableASRProviders.map((provider) => <option key={provider.id} value={provider.id}>{providerDisplayName(provider.id, provider.name, t)}</option>) : <option value="">{t("No available Provider")}</option>}</select></label>
        <label>{t("Device")}<select value={props.config.device} onChange={(event) => void props.updateConfig({ device: event.target.value as ConfigViewModel["device"] })}><option value="auto">{t("Auto")}</option><option value="cpu">CPU</option><option value="gpu">GPU</option></select></label>
      </div>
      <div className="between"><span>{t("Output content")}</span><Segment items={outputTypes.map((item) => item.label)} active={outputTypeIndex} onSelect={(index) => selectOutputType(outputTypes[index].value)} /></div>
      {translationOutputWarning && (
        <div className="blocking-note" role="status">
          <span>{t("Translation output not ready")}</span>
          <button className="btn sm primary" onClick={() => props.openProviderSettings("translation")} type="button">{t("Configure translation Provider")}</button>
        </div>
      )}
      <div className="between"><span>{t("Output format")}</span><Segment items={outputFormats.map((item) => item.label)} active={outputFormatIndex} onSelect={(index) => void props.updateConfig({ outputFormat: outputFormats[index].value })} /></div>
      <div className="between"><span>{t("Burn-in video")}</span><Toggle ariaLabel={t("Burn-in video")} on={props.config.burnInVideo} onClick={() => void props.updateConfig({ burnInVideo: !props.config.burnInVideo })} /></div>
      <div className="between"><span>{t("Output conflict")}</span><Segment items={conflictModes.map((item) => item.label)} active={conflictIndex} onSelect={(index) => void props.updateConfig({ outputConflict: conflictModes[index].value })} /></div>
      <div className="between"><span>{t("Word timestamps")}</span><Toggle ariaLabel={t("Word timestamps")} on={props.config.wordTimestamps} onClick={() => void props.updateConfig({ wordTimestamps: !props.config.wordTimestamps })} /></div>
      <div className="between"><span>{t("Keep temporary files")}</span><Toggle ariaLabel={t("Keep temporary files")} on={props.config.keepTempFiles} onClick={() => void props.updateConfig({ keepTempFiles: !props.config.keepTempFiles })} /></div>
    </section>
  );
}

function outputTypeNeedsTranslation(outputType: ConfigViewModel["outputType"]): boolean {
  return outputType === "translated_srt" || outputType === "bilingual_srt";
}

function providerDisplayName(providerId: string, fallback: string, t: (key: string) => string): string {
  const labels: Record<string, string> = {
    "local-faster-whisper": "Local Faster Whisper",
    "local-whisper-cpp": "Local whisper.cpp",
    "api-openai-transcription": "OpenAI Transcription API",
    "local-nllb-ct2": "Local NLLB Translation",
    "web-bing": "Bing Web Translation",
    "web-google": "Google Web Translation",
    "api-openai-chat": "OpenAI-compatible Translation API"
  };
  return t(labels[providerId] ?? fallback);
}

export function availableProviderOptions(providers: ProviderStatus[], capability: ProviderStatus["capability"]): ProviderStatus[] {
  return providers.filter((provider) => provider.capability === capability && providerCanRun(provider));
}

function translationOutputReady(config: ConfigViewModel, providers: RenderProps["providers"], translationReady: boolean): boolean {
  const provider = providers.find((item) => item.id === config.translationProvider);
  return translationReady && Boolean(provider && providerCanRun(provider));
}

function providerCanRun(provider: ProviderStatus): boolean {
  if (!provider.enabled || provider.state !== "available") {
    return false;
  }
  return provider.kind !== "api" || provider.checkMode === "live";
}

export function MainMissing({ setScreen, installModel, translationReady, models, modelInstallJobs }: RenderProps) {
  const t = useT();
  const asr = models.find((model) => model.id === "whisper-small");
  const installJob = modelInstallJobs["whisper-small"];
  const installing = asr?.state === "installing" || installJob?.status === "queued" || installJob?.status === "running" || installJob?.status === "canceling";
  const progress = Math.max(0, Math.min(100, installJob?.progressPercent ?? asr?.progressPercent ?? 0));
  const stageLabel = modelDownloadStageLabel(installJob, t);
  return (
    <div className="wf">
      <Chrome right={<><Chip tone="warn">{t("Local transcription not ready")}</Chip><Chip tone={translationReady ? "ok" : "warn"}>{translationReady ? t("Translation ready") : t("Translation not ready")}</Chip></>} />
      <main className="main-empty">
        <section className="panel warn-panel missing-panel">
          <h1>{t("Cannot generate subtitles yet")}</h1>
          <p>{t("Default ASR model missing")}</p>
          <CheckItem label={t("ASR model")} detail={t("whisper-small is not installed")} status="missing" />
          <CheckItem label={t("Translation model")} detail={t("Can be downloaded later")} status="skip" />
          {installing && (
            <div className="model-install-progress" role="status" aria-label={t("Model download progress", { name: asr?.name ?? "whisper-small" })}>
              <div className="between">
                <strong>{progress}%</strong>
                <span>{stageLabel}</span>
              </div>
              <div className="bar sm"><span style={{ width: `${Math.max(8, progress)}%` }} /></div>
            </div>
          )}
          <div className="row gap-8">
            <button className="btn primary" disabled={installing} onClick={() => void installModel("whisper-small")}>{installing ? t("Downloading") : t("Download default model")}</button>
            <button className="btn ghost" onClick={() => setScreen("settings-models")}>{t("Open Models")}</button>
          </div>
        </section>
      </main>
    </div>
  );
}

function modelDownloadStageLabel(job: RenderProps["activeJob"] | undefined, t: (key: string) => string): string {
  if (!job || job.status === "queued") {
    return t("Waiting to download");
  }
  if (job.status === "canceling") {
    return t("Canceling download");
  }
  if (job.status === "failed") {
    return t("Model download failed");
  }
  if (job.status === "succeeded") {
    return t("Model is ready");
  }
  const stage = job.stageLabel;
  if (stage.includes("校验") || stage.includes("验证") || stage.includes("检查") || stage.includes("verify")) {
    return t("Verifying model");
  }
  if (stage.includes("准备") || stage.includes("收尾") || stage.includes("final")) {
    return t("Preparing model");
  }
  return t("Downloading model");
}

export function OutputConflict({ setScreen, startJob, updateConfig, chooseSubtitleOutputPath, activeJob }: RenderProps) {
  const t = useT();
  const outputPath = conflictOutputPath(activeJob);
  const resolveConflict = async (mode: ConfigViewModel["outputConflict"]) => {
    await updateConfig({ outputConflict: mode });
    if (mode === "skip") {
      setScreen("main-empty");
      return;
    }
    await startJob({ conflictResolved: true, outputConflict: mode });
  };
  const saveAs = async () => {
    const selected = await chooseSubtitleOutputPath(outputPath || "subtitle.srt");
    if (selected) {
      await startJob({ conflictResolved: true, outputPath: selected });
    }
  };
  return (
    <div className="wf">
      <Chrome back onBack={() => setScreen("main-files")} right={<Chip tone="warn">{t("Confirmation required")}</Chip>} />
      <main className="dialog-stage">
        <section className="modal-card">
          <div className="between"><h2>{t("Subtitle file already exists")}</h2><span className="warn-symbol">!</span></div>
          <p>{t("Output conflict path intro")}</p>
          <div className="input mono">{outputPath || t("Subtitle output file")}</div>
          <p className="caption">{t("Output conflict choice hint")}</p>
          <div className="row gap-8 wrap">
            <button className="btn primary" onClick={() => void resolveConflict("overwrite")}>{t("Overwrite")}</button>
            <button className="btn" onClick={() => void resolveConflict("skip")}>{t("Skip")}</button>
            <button className="btn" onClick={() => void saveAs()}>{t("Save as")}</button>
            <button className="btn ghost" onClick={() => setScreen("main-files")}>{t("Cancel generation")}</button>
          </div>
        </section>
      </main>
    </div>
  );
}

function conflictOutputPath(activeJob: RenderProps["activeJob"]): string {
  const detailPath = activeJob?.error?.details?.output_path;
  if (typeof detailPath === "string" && detailPath) {
    return detailPath;
  }
  const resultPath = activeJob?.result?.subtitlePath;
  if (resultPath) {
    return resultPath;
  }
  if (activeJob?.outputDirectory && activeJob.inputPaths[0]) {
    const base = activeJob.inputPaths[0].split(/[\\/]/).pop() || activeJob.title;
    return `${activeJob.outputDirectory}\\${base.replace(/\.[^.]+$/, ".srt")}`;
  }
  return "";
}

export function MainGenerating({ activeJob, jobs, activeBatchJobIds, cancelJob, cancelAllJobs, openRunningQueue }: RenderProps) {
  const t = useT();
  const rt = useRuntimeText();
  const percent = useSmoothProgress(activeJob?.id ?? "", activeJob?.progressPercent ?? 0, activeJob?.status ?? "queued");
  const copy = generatingCopy(activeJob, t);
  const activeId = activeJob?.id;
  const batchIds = activeBatchJobIds.length > 0 ? activeBatchJobIds : activeId ? [activeId] : [];
  const batchJobs = jobs.filter((job) => batchIds.includes(job.id));
  const waitingJobs = batchJobs.filter((job) => job.id !== activeId && (job.status === "queued" || job.status === "running" || job.status === "canceling"));
  const visibleWaitingJobs = waitingJobs.slice(0, 8);
  const hiddenWaitingJobs = Math.max(0, waitingJobs.length - visibleWaitingJobs.length);
  const activeIndex = activeId && batchIds.length > 0 ? Math.max(0, batchIds.indexOf(activeId)) : 0;
  const totalJobs = batchIds.length || batchJobs.length || 1;
  const remainingLabel = activeJob?.estimatedRemaining ? t("Estimated remaining", { time: activeJob.estimatedRemaining }) : t("Waiting for progress");
  return (
    <div className="wf">
      <Chrome right={<Chip tone="accent">{copy.badge}</Chip>} />
      <main className="content-flow center-flow generating-flow">
        <section className="generating-hero">
          <span className="spin big" />
          <h1>{copy.title}</h1>
          <p className="subtle">{activeJob?.title ?? t("Waiting for task sync")}</p>
          <section className="panel paper-muted progress-card">
            <div className="between"><strong>{percent}%</strong><span>{remainingLabel}</span></div>
            <div className="progress accent"><i style={{ width: `${percent}%` }} /></div>
            <p className="center-text caption">{stageCopy(activeJob, copy.stage, rt)}</p>
          </section>
        </section>
        {waitingJobs.length > 0 && (
          <section className="next-list">
            <h3>{t("Next")}</h3>
            {visibleWaitingJobs.map((job) => <p key={job.id}><Chip>{job.statusLabel}</Chip> {job.title}</p>)}
            {hiddenWaitingJobs > 0 && <p className="caption">{t("More waiting jobs hidden", { count: hiddenWaitingJobs })}</p>}
          </section>
        )}
        <div className="center-actions">
          <button className="btn" onClick={() => void cancelJob()}>{t("Cancel current task")}</button>
          <button className="btn ghost" onClick={() => void cancelAllJobs()}>{t("Cancel all")}</button>
        </div>
      </main>
      <div className="footer-line"><span>{t("Task progress count", { current: Math.min(activeIndex + 1, totalJobs), total: totalJobs })}</span><button className="btn sm ghost" onClick={openRunningQueue}>{t("Run in background")}</button></div>
    </div>
  );
}

function generatingCopy(job: JobDetail | null, t: (key: string) => string): { badge: string; title: string; stage: string } {
  switch (job?.type) {
    case "burn_in":
      return { badge: t("Burning"), title: t("Burning subtitles title"), stage: t("Burning subtitles stage") };
    case "translate_srt":
      return { badge: t("Translating"), title: t("Translating subtitles title"), stage: t("Translating subtitles stage") };
    case "model_install":
      return { badge: t("Downloading"), title: t("Downloading model title"), stage: t("Preparing model") };
    default:
      return { badge: t("Generating"), title: t("Generating subtitles title"), stage: t("Generating subtitles stage") };
  }
}

function stageCopy(job: JobDetail | null, fallback: string, rt: (text: string) => string): string {
  if (!job?.stageLabel || job.stageLabel === "正在生成字幕") {
    return fallback;
  }
  return rt(job.stageLabel);
}

function useSmoothProgress(jobId: string, actualPercent: number, status: JobStatus): number {
  const safeActual = clampProgress(actualPercent);
  const [displayPercent, setDisplayPercent] = useState(safeActual);

  useEffect(() => {
    setDisplayPercent(status === "succeeded" ? 100 : Math.min(safeActual, 97));
  }, [jobId]);

  useEffect(() => {
    if (status === "succeeded") {
      setDisplayPercent(100);
      return;
    }
    if (status === "failed" || status === "canceled" || status === "interrupted") {
      setDisplayPercent((current) => Math.min(current, 99));
      return;
    }
    const timer = window.setInterval(() => {
      setDisplayPercent((current) => {
        const cap = status === "queued" ? Math.max(8, Math.min(18, safeActual + 8)) : 97;
        if (current >= cap) {
          return current;
        }
        const target = Math.min(safeActual, cap);
        if (current < target) {
          const catchUp = Math.max(0.8, (target - current) * 0.35);
          return Math.min(cap, target, current + catchUp);
        }
        const drift = current > safeActual ? 0.05 : 0.16;
        return Math.min(cap, current + drift);
      });
    }, 250);
    return () => window.clearInterval(timer);
  }, [safeActual, status]);

  return Math.round(displayPercent);
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

export function MainDone({ activeJob, completedBatchJobs, openMock, setScreen }: RenderProps) {
  const t = useT();
  const rt = useRuntimeText();
  const completedJobs = completedBatchJobs.length > 0 ? completedBatchJobs : activeJob ? [activeJob] : [];
  return (
    <div className="wf">
      <Chrome right={<Chip tone="ok">{t("Ready")}</Chip>} />
      <main className="content-flow">
        <div className="center-stack">
          <div className="success-mark">✓</div>
          <h1>{t("Subtitles complete")}</h1>
          <p className="subtle">{t("Files completed", { count: completedJobs.length })}</p>
        </div>
        {completedJobs.map((job) => {
          const result = job.result;
          const outputPath = subtitleOutputPath(job);
          const outputFolder = directoryName(outputPath) || result?.outputFolder || job.outputDirectory;
          const outputName = baseName(outputPath) || job.title || t("Subtitle result");
          const detail = result?.durationLabel || result?.summary || rt(job.stageLabel) || t("Task completed");
          return <ResultCard key={job.id} name={outputName} detail={detail} ok onOpen={() => void openMock(outputPath)} onOpenFolder={() => void openMock(outputFolder)} />;
        })}
      </main>
      <div className="action-footer">
        <SettingsEntry onClick={() => setScreen("settings-general")} />
        <div className="row gap-8">
          <button className="btn ghost" onClick={() => setScreen("queue-list")}>{t("View all history")}</button>
          <button className="btn primary" onClick={() => setScreen("main-empty")}>{t("Add more")}</button>
        </div>
      </div>
    </div>
  );
}

function subtitleOutputPath(job: RenderProps["activeJob"]): string {
  if (!job) {
    return "";
  }
  const path = job.result?.subtitlePath ?? "";
  const repairedPath = repairCorruptSubtitlePath(path, job);
  if (repairedPath !== path) {
    return repairedPath;
  }
  if (isSubtitlePath(path) || job.type === "burn_in" || job.type === "model_install") {
    return path;
  }
  const input = job.inputPaths[0] || job.currentFile || job.title;
  const base = input.split(/[\\/]/).pop() || job.title || "subtitle";
  const stem = base.replace(/\.[^.]+$/, "");
  const directory = job.outputDirectory || path.replace(/[\\/][^\\/]*$/, "");
  if (!directory) {
    return `${stem}.srt`;
  }
  const sep = directory.includes("/") && !directory.includes("\\") ? "/" : "\\";
  return `${directory}${sep}${stem}.srt`;
}

function repairCorruptSubtitlePath(path: string, job: RenderProps["activeJob"]): string {
  if (!job || !path || !hasReplacementChar(baseName(path))) {
    return path;
  }
  const input = job.inputPaths[0] || job.currentFile || job.title;
  if (!input || hasReplacementChar(baseName(input))) {
    return path;
  }
  const directory = job.outputDirectory || directoryName(path) || directoryName(input);
  if (!directory) {
    return path;
  }
  const stem = baseName(input).replace(/\.[^.\\/]+$/, "");
  const ext = extensionName(path) || (job.type === "burn_in" ? ".mp4" : ".srt");
  const suffix = job.type === "burn_in" ? ".burned" : job.type === "translate_srt" ? ".translated" : "";
  const sep = directory.includes("/") && !directory.includes("\\") ? "/" : "\\";
  return `${directory}${sep}${stem}${suffix}${ext}`;
}

function isSubtitlePath(path: string): boolean {
  return /\.(srt|ass|vtt)$/i.test(path);
}

function hasReplacementChar(value: string): boolean {
  return value.includes("\uFFFD");
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || "";
}

function directoryName(path: string): string {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  if (index <= 0) {
    return "";
  }
  if (index === 2 && /^[A-Za-z]:[\\/]/.test(path)) {
    return path.slice(0, 3);
  }
  return path.slice(0, index);
}

function extensionName(path: string): string {
  const name = baseName(path);
  const match = /\.[^.\\/]+$/.exec(name);
  return match?.[0] ?? "";
}

function ResultCard({ name, detail, ok, onOpen, onOpenFolder }: { name: string; detail: string; ok: boolean; onOpen: () => void; onOpenFolder: () => void }) {
  const t = useT();
  return (
    <article className={`result-card ${ok ? "ok-card" : "warn-card"}`}>
      <div><strong>{name}</strong><span>{detail}</span></div>
      <div className="row gap-6"><button className="btn sm" onClick={onOpen}>{ok ? t("Open subtitle") : t("Retry")}</button><button className="btn sm ghost" onClick={onOpenFolder}>{t("Folder")}</button></div>
    </article>
  );
}
