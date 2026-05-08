import type { DragEvent } from "react";
import type { ConfigViewModel } from "../../../../shared/contracts/types";
import type { RenderProps } from "../types";
import { CheckItem, Chip, Chrome, Divider, Footer, Segment, SettingsEntry, Toggle } from "../components";

export function MainEmpty({ setScreen, addFiles, addFolder, addDroppedFiles, chooseOutputDirectory, outputDirectoryLabel, asrReady, translationReady }: RenderProps) {
  const handleDropZoneClick = () => {
    if (asrReady) {
      void addFiles();
    }
  };
  const handleDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    if (asrReady && event.dataTransfer.files.length > 0) {
      addDroppedFiles(event.dataTransfer.files);
    }
  };
  return (
    <div className="wf">
      <Chrome right={<><Chip tone={asrReady ? "ok" : "warn"}>{asrReady ? "本地转写就绪" : "本地转写未就绪"}</Chip><Chip tone={translationReady ? "ok" : "warn"}>{translationReady ? "翻译就绪" : "翻译未就绪"}</Chip></>} />
      <main className="main-empty">
        {!asrReady && (
          <div className="blocking-note" role="status">
            <span>缺少默认 ASR 模型。请先在模型管理中下载后再添加媒体。</span>
            <button className="btn sm primary" onClick={() => setScreen("settings-models")} type="button">去下载模型</button>
          </div>
        )}
        <section
          className={`drop-zone ${asrReady ? "" : "locked"}`}
          aria-disabled={!asrReady}
          onClick={handleDropZoneClick}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <div className="drop-arrow">⬇</div>
          <h1>{asrReady ? "拖拽视频到这里" : "缺少 ASR 模型"}</h1>
          <p>{asrReady ? "支持 .mp4 · .mov · .mkv · .wav · .m4a · .mp3" : "安装默认模型后才能继续生成字幕。"}</p>
          <div className="row gap-8">
            <button className="btn" disabled={!asrReady} onClick={(event) => { event.stopPropagation(); void addFiles(); }}>添加视频</button>
            <button className="btn" disabled={!asrReady} onClick={(event) => { event.stopPropagation(); void addFolder(); }}>添加文件夹</button>
          </div>
        </section>
        <div className="output-row">
          <div><span className="subtle">输出位置：</span><strong>{outputDirectoryLabel}</strong> <button className="link-button" disabled={!asrReady} onClick={() => void chooseOutputDirectory()}>修改</button></div>
          <div><span className="subtle">格式：</span><strong>SRT</strong></div>
        </div>
      </main>
      <Footer onHistory={() => setScreen("queue-list")} onSettings={() => setScreen("settings-general")} />
    </div>
  );
}

export function MainFiles(props: RenderProps & { advanced: boolean }) {
  const files = props.files;
  const canGenerate = props.asrReady;
  const removeFile = (path: string) => {
    const nextFiles = files.filter((item) => item.path !== path);
    props.setFiles(nextFiles);
    if (nextFiles.length === 0) {
      props.setScreen("main-empty");
    }
  };
  return (
    <div className="wf">
      <Chrome right={<Chip tone={canGenerate ? "ok" : "warn"}>{canGenerate ? "就绪" : "未就绪"}</Chip>} />
      <main className="content-flow">
        <div className="between">
          <h2>已添加 {files.length} 个文件</h2>
          <button className="btn sm ghost" disabled={!canGenerate} onClick={() => void props.addFiles()}>+ 添加更多</button>
        </div>
        {!canGenerate && <div className="blocking-note" role="status">缺少默认 ASR 模型，当前不能继续生成字幕。</div>}
        {props.advanced && <AdvancedSettings {...props} />}
        <div className="file-list">
          {files.map((file) => (
            <article className="file-card" key={file.path}>
              <div><strong>{file.name}</strong><span>{file.size} · {file.duration}</span></div>
              <button className="btn sm ghost" onClick={() => removeFile(file.path)}>移除</button>
            </article>
          ))}
        </div>
        {!props.advanced && (
          <>
            <Divider />
            <div className="between">
              <div><p>输出：原字幕 SRT · 与源视频相同目录</p><span className="caption">语言：自动识别 · 本地转写 (whisper-small)</span></div>
              <button className="link-button" onClick={() => props.setScreen("main-advanced")}>详细设置</button>
            </div>
          </>
        )}
      </main>
      <div className="action-footer">
        <SettingsEntry onClick={() => props.setScreen("settings-general")} />
        <div className="row gap-8">
          <button className="btn ghost" onClick={() => props.setScreen("main-empty")}>取消</button>
          <button className="btn primary hero-action" disabled={!canGenerate} onClick={() => void props.startJob()}>生成字幕</button>
        </div>
      </div>
    </div>
  );
}

export function AdvancedSettings(props: RenderProps) {
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
  return (
    <section className="panel paper-muted compact-settings">
      <div className="between"><h2>详细设置</h2><button className="link-button" onClick={() => props.setScreen("main-files")}>收起</button></div>
      <div className="settings-grid">
        <label>字幕语言<select value={props.config.defaultLanguage} onChange={(event) => props.setConfig({ ...props.config, defaultLanguage: event.target.value })}><option value="auto">自动识别</option><option value="zh">中文</option><option value="en">英语</option></select></label>
        <label>ASR 模型<select value={props.config.asrModel} onChange={(event) => props.setConfig({ ...props.config, asrModel: event.target.value })}>{props.models.filter((model) => model.kind === "asr").map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
        <label>转写方式<select value={props.config.asrProvider} onChange={(event) => props.setConfig({ ...props.config, asrProvider: event.target.value })}>{props.providers.filter((provider) => provider.capability === "stt").map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
        <label>设备<select value={props.config.device} onChange={(event) => props.setConfig({ ...props.config, device: event.target.value as ConfigViewModel["device"] })}><option value="auto">自动</option><option value="cpu">CPU</option><option value="gpu">GPU</option></select></label>
      </div>
      <div className="between"><span>输出内容</span><Segment items={outputTypes.map((item) => item.label)} active={outputTypeIndex} onSelect={(index) => props.setConfig({ ...props.config, outputType: outputTypes[index].value })} /></div>
      <div className="between"><span>输出冲突</span><Segment items={conflictModes.map((item) => item.label)} active={conflictIndex} onSelect={(index) => props.setConfig({ ...props.config, outputConflict: conflictModes[index].value })} /></div>
      <div className="between"><span>词级时间戳</span><Toggle ariaLabel="词级时间戳" on={props.config.wordTimestamps} onClick={() => props.setConfig({ ...props.config, wordTimestamps: !props.config.wordTimestamps })} /></div>
      <div className="between"><span>保留临时文件</span><Toggle ariaLabel="保留临时文件" on={props.config.keepTempFiles} onClick={() => props.setConfig({ ...props.config, keepTempFiles: !props.config.keepTempFiles })} /></div>
    </section>
  );
}

export function MainMissing({ setScreen, installModel, translationReady }: RenderProps) {
  return (
    <div className="wf">
      <Chrome right={<><Chip tone="warn">本地转写未就绪</Chip><Chip tone={translationReady ? "ok" : "warn"}>{translationReady ? "翻译就绪" : "翻译未就绪"}</Chip></>} />
      <main className="main-empty">
        <section className="panel warn-panel missing-panel">
          <h1>还不能生成字幕</h1>
          <p>缺少默认 ASR 模型。下载完成后即可使用本地转写。</p>
          <CheckItem label="ASR 模型" detail="whisper-small 未安装" status="missing" />
          <CheckItem label="翻译模型" detail="可稍后下载" status="skip" />
          <div className="row gap-8">
            <button className="btn primary" onClick={() => void installModel("whisper-small")}>下载默认模型</button>
            <button className="btn ghost" onClick={() => setScreen("settings-models")}>打开模型管理</button>
          </div>
        </section>
      </main>
    </div>
  );
}

export function OutputConflict({ setScreen, startJob, updateConfig, chooseSubtitleOutputPath, activeJob }: RenderProps) {
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
      <Chrome back onBack={() => setScreen("main-files")} right={<Chip tone="warn">需要确认</Chip>} />
      <main className="dialog-stage">
        <section className="modal-card">
          <div className="between"><h2>字幕文件已存在</h2><span className="warn-symbol">!</span></div>
          <p>目标位置已有同名文件：</p>
          <div className="input mono">{outputPath || "字幕输出文件"}</div>
          <p className="caption">请选择如何处理。这个选择可以应用到本次批量任务。</p>
          <div className="row gap-8 wrap">
            <button className="btn primary" onClick={() => void resolveConflict("overwrite")}>覆盖</button>
            <button className="btn" onClick={() => void resolveConflict("skip")}>跳过</button>
            <button className="btn" onClick={() => void saveAs()}>另存为</button>
            <button className="btn ghost" onClick={() => setScreen("main-files")}>取消生成</button>
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

export function MainGenerating({ activeJob, jobs, activeBatchJobIds, cancelJob, cancelAllJobs }: RenderProps) {
  const percent = activeJob?.progressPercent ?? 0;
  const activeId = activeJob?.id;
  const batchIds = activeBatchJobIds.length > 0 ? activeBatchJobIds : activeId ? [activeId] : [];
  const batchJobs = jobs.filter((job) => batchIds.includes(job.id));
  const waitingJobs = batchJobs.filter((job) => job.id !== activeId && (job.status === "queued" || job.status === "running" || job.status === "canceling"));
  const activeIndex = activeId && batchIds.length > 0 ? Math.max(0, batchIds.indexOf(activeId)) : 0;
  const totalJobs = batchIds.length || batchJobs.length || 1;
  const remainingLabel = activeJob?.estimatedRemaining ? `预计还需 ${activeJob.estimatedRemaining}` : "等待进度更新";
  return (
    <div className="wf">
      <Chrome right={<Chip tone="accent">正在生成</Chip>} />
      <main className="content-flow center-flow">
        <span className="spin big" />
        <h1>正在生成字幕...</h1>
        <p className="subtle">{activeJob?.title ?? "等待任务同步"}</p>
        <section className="panel paper-muted progress-card">
          <div className="between"><strong>{percent}%</strong><span>{remainingLabel}</span></div>
          <div className="progress accent"><i style={{ width: `${percent}%` }} /></div>
          <p className="center-text caption">{activeJob?.stageLabel ?? "等待 daemon 任务事件..."}</p>
        </section>
        {waitingJobs.length > 0 && (
          <section className="next-list">
            <h3>接下来</h3>
            {waitingJobs.map((job) => <p key={job.id}><Chip>{job.statusLabel}</Chip> {job.title}</p>)}
          </section>
        )}
        <div className="center-actions">
          <button className="btn" onClick={() => void cancelJob()}>取消当前任务</button>
          <button className="btn ghost" onClick={() => void cancelAllJobs()}>全部取消</button>
        </div>
      </main>
      <div className="footer-line"><span>任务 {Math.min(activeIndex + 1, totalJobs)} / {totalJobs}</span><button className="btn sm ghost">后台运行</button></div>
    </div>
  );
}

export function MainDone({ activeJob, openMock, setScreen }: RenderProps) {
  const result = activeJob?.result;
  const outputPath = result?.subtitlePath ?? "";
  const outputFolder = result?.outputFolder || activeJob?.outputDirectory || outputPath.replace(/[\\/][^\\/]*$/, "");
  const outputName = outputPath.split(/[\\/]/).pop() || activeJob?.title || "字幕结果";
  const detail = result?.durationLabel || result?.summary || activeJob?.stageLabel || "任务已完成";
  const completedCount = result || activeJob ? 1 : 0;
  return (
    <div className="wf">
      <Chrome right={<Chip tone="ok">就绪</Chip>} />
      <main className="content-flow">
        <div className="center-stack">
          <div className="success-mark">✓</div>
          <h1>字幕生成完成</h1>
          <p className="subtle">已完成 {completedCount} 个文件</p>
        </div>
        <ResultCard name={outputName} detail={detail} ok onOpen={() => void openMock(outputPath)} onOpenFolder={() => void openMock(outputFolder)} />
      </main>
      <div className="action-footer">
        <SettingsEntry onClick={() => setScreen("settings-general")} />
        <div className="row gap-8">
          <button className="btn ghost" onClick={() => setScreen("queue-list")}>查看全部历史</button>
          <button className="btn primary" onClick={() => setScreen("main-empty")}>继续添加</button>
        </div>
      </div>
    </div>
  );
}

function ResultCard({ name, detail, ok, onOpen, onOpenFolder }: { name: string; detail: string; ok: boolean; onOpen: () => void; onOpenFolder: () => void }) {
  return (
    <article className={`result-card ${ok ? "ok-card" : "warn-card"}`}>
      <div><strong>{name}</strong><span>{detail}</span></div>
      <div className="row gap-6"><button className="btn sm" onClick={onOpen}>{ok ? "打开字幕" : "重试"}</button><button className="btn sm ghost" onClick={onOpenFolder}>文件夹</button></div>
    </article>
  );
}
