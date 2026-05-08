import { useState } from "react";
import type { JobSummary } from "../../../../shared/contracts/types";
import type { QueueFilter, RenderProps } from "../types";
import { Chip, Chrome, Divider, KV, Tabs } from "../components";

export function QueueList({ jobs, queueInitialFilter, setScreen, openJob }: RenderProps) {
  const [queueFilter, setQueueFilter] = useState<QueueFilter>(queueInitialFilter);
  const runningJobs = jobs.filter((job) => job.status === "running" || job.status === "canceling");
  const queuedJobs = jobs.filter((job) => job.status === "queued");
  const activeJobs = [...runningJobs, ...queuedJobs];
  const completedJobs = jobs.filter((job) => job.status === "succeeded");
  const failedJobs = jobs.filter((job) => job.status === "failed");
  const totalCount = jobs.length;
  const showRunning = queueFilter === "all" || queueFilter === "running";
  const showDone = queueFilter === "all" || queueFilter === "done";
  const showFailed = queueFilter === "all" || queueFilter === "failed";
  const tabIndex = queueFilter === "all" ? 0 : queueFilter === "running" ? 1 : queueFilter === "done" ? 2 : 3;
  return (
    <div className="wf">
      <Chrome title="任务队列" back onBack={() => setScreen("main-empty")} />
      <Tabs items={[`全部 ${totalCount}`, `正在生成 ${activeJobs.length}`, `已完成 ${completedJobs.length}`, `失败 ${failedJobs.length}`]} active={tabIndex} onSelect={(index) => setQueueFilter(["all", "running", "done", "failed"][index] as QueueFilter)} />
      <main className="content-flow queue-flow">
        {showRunning && (
          <>
            {runningJobs.map((job) => (
              <article className="job-card running" key={job.id} onClick={() => void openJob(job.id, "queue-detail")}>
                <div className="between"><div><strong>{job.title}</strong><QueueMetaChips job={job} extra={[`${job.stageLabel} ${job.progressPercent}%`]} /></div><Chip tone="accent">{job.statusLabel}</Chip></div>
                <div className="progress accent"><i style={{ width: `${job.progressPercent}%` }} /></div>
              </article>
            ))}
            {queuedJobs.map((job) => (
              <article className="job-card" key={job.id} onClick={() => void openJob(job.id, "queue-detail")}>
                <div className="between"><div><strong>{job.title}</strong><QueueMetaChips job={job} /></div><Chip>{job.statusLabel}</Chip></div>
              </article>
            ))}
          </>
        )}
        {queueFilter === "all" && <Divider />}
        {showDone && completedJobs.map((job) => (
          <article className="job-card done" key={job.id} onClick={() => void openJob(job.id, "queue-detail")}>
            <div className="between"><div><strong>{job.title}</strong><QueueMetaChips job={job} extra={[`完成 ${completedTimeLabel(job.completedAt || job.createdAt)}`]} /></div><Chip tone="ok">{job.statusLabel}</Chip></div>
          </article>
        ))}
        {showFailed && failedJobs.map((job) => (
          <article className="job-card failed" key={job.id} onClick={() => void openJob(job.id, "queue-failed")}>
            <div className="between"><div><strong>{job.title}</strong><QueueMetaChips job={job} extra={[job.stageLabel]} /></div><Chip tone="warn">{job.statusLabel}</Chip></div>
          </article>
        ))}
      </main>
    </div>
  );
}

export function QueueDetail({ activeJob, setScreen, failed, retryJob, deleteJob, cancelJob }: RenderProps & { failed: boolean }) {
  const [detailTab, setDetailTab] = useState(0);
  const tabs = failed ? ["问题", "日志", "配置"] : ["进度", "日志", "详情"];
  const canceled = activeJob?.status === "canceled";
  const canceling = activeJob?.status === "canceling";
  const succeeded = activeJob?.status === "succeeded";
  const error = activeJob?.error;
  const title = activeJob?.title ?? "未选择任务";
  const subtitle = activeJob ? `${succeeded ? activeJob.completedAt || activeJob.createdAt : activeJob.createdAt} · ${activeJob.statusLabel}` : "请从任务列表选择一条记录";
  const progress = activeJob?.progressPercent ?? 0;
  const progressText = canceled
    ? "任务已取消，可以重新生成或返回队列。"
    : canceling
      ? "正在取消任务..."
      : succeeded
        ? "任务已完成，可以查看日志或配置。"
      : activeJob?.estimatedRemaining
        ? `${activeJob.stageLabel} · 预计还需 ${activeJob.estimatedRemaining}`
        : activeJob?.stageLabel ?? "等待 daemon 任务事件...";
  return (
    <div className="wf">
      <Chrome title={failed ? "失败任务详情" : "任务详情"} back onBack={() => setScreen("queue-list")} />
      <header className="detail-head">
        <div><h2>{title}</h2><span>{subtitle}</span></div>
        <Chip tone={failed ? "warn" : succeeded ? "ok" : canceled ? "muted" : "accent"}>{failed ? "已失败" : succeeded ? "已完成" : canceled ? "已取消" : canceling ? "正在取消" : "正在生成"}</Chip>
      </header>
      <Tabs items={tabs} active={detailTab} onSelect={setDetailTab} />
      <main className="content-flow">
        {failed ? (
          <>
            {detailTab === 0 && (
              <>
                <section className="panel warn-panel">
                  <h2>{error?.title ?? "任务失败"}</h2>
                  <p>{error?.message ?? "任务没有完成，请查看日志和配置后重试。"}</p>
                  <Divider />
                  <strong>建议操作</strong>
                  <p>{error?.action ?? "查看诊断日志确认错误。"}</p>
                </section>
                <section className="panel">
                  <h3>结构化错误</h3>
                  <KV k="code" v={error?.code ?? "job_failed"} />
                  {error?.details ? Object.entries(error.details).map(([key, value]) => (
                    <KV k={key} v={String(value)} mono={key.includes("tail") || key.includes("stderr")} key={key} />
                  )) : <KV k="stage" v={activeJob?.stageLabel ?? "unknown"} />}
                  <KV k="diagnostic" v={error?.diagnostic ?? "未提供诊断信息"} mono />
                </section>
                <div className="row gap-8">
                  <button className="btn primary" onClick={() => void retryJob()}>重试任务</button>
                  <button className="btn ghost" onClick={() => void deleteJob()}>删除记录</button>
                </div>
              </>
            )}
            {detailTab === 1 && <LogPanel activeJob={activeJob} />}
            {detailTab === 2 && <ConfigPanel activeJob={activeJob} />}
          </>
        ) : (
          <>
            {detailTab === 0 && (
              <>
                <div className="progress-hero"><strong>{progress}%</strong><span>{progressText}</span></div>
                <div className="progress accent"><i style={{ width: `${progress}%` }} /></div>
                <div className="row gap-6 wrap"><Chip tone="ok">检查文件 ✓</Chip><Chip tone="ok">分析媒体 ✓</Chip><Chip tone="ok">提取音频 ✓</Chip><Chip tone={succeeded ? "ok" : canceled ? "muted" : "accent"}>{succeeded ? "转写完成 ✓" : canceled ? "已取消" : canceling ? "正在取消" : "转写中 ●"}</Chip><Chip tone={succeeded ? "ok" : "muted"}>{succeeded ? "生成字幕 ✓" : "生成字幕"}</Chip></div>
                <div className="row gap-8">
                  {canceled ? <button className="btn primary" onClick={() => void retryJob()}>重新生成</button> : !succeeded && <button className="btn ghost" onClick={() => void cancelJob()}>取消任务</button>}
                  {canceled && <button className="btn ghost" onClick={() => void deleteJob()}>删除记录</button>}
                </div>
              </>
            )}
            {detailTab === 1 && <LogPanel activeJob={activeJob} />}
            {detailTab === 2 && <ConfigPanel activeJob={activeJob} />}
          </>
        )}
      </main>
    </div>
  );
}

export function LogPanel({ activeJob }: Pick<RenderProps, "activeJob">) {
  const lines = activeJob?.logs.length ? activeJob.logs.map((line) => `[${line.time}] ${line.level}: ${line.message}`) : [`任务：${activeJob?.title ?? "未选择任务"}`, `状态：${activeJob?.statusLabel ?? "未知"}`, `阶段：${activeJob?.stageLabel ?? "未知"}`];
  return (
    <section className="panel">
      <h3>日志</h3>
      <pre>{lines.join("\n")}</pre>
    </section>
  );
}

function QueueMetaChips({ job, extra = [] }: { job: JobSummary; extra?: string[] }) {
  const items = [
    ...extra,
    job.language ? languageLabel(job.language) : "",
    job.providerName || "",
    job.modelName || ""
  ].filter(Boolean);
  return (
    <div className="job-meta">
      {items.length > 0 ? items.map((item) => <Chip key={item}>{item}</Chip>) : <Chip>配置未同步</Chip>}
    </div>
  );
}

function completedTimeLabel(value = ""): string {
  if (!value) {
    return "未知";
  }
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) {
    const yyyy = String(date.getFullYear());
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const mi = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  }
  return value.replace("T", " ").replace(/(\.\d+)?Z$/, "").slice(0, 19);
}

function languageLabel(language: string): string {
  const labels: Record<string, string> = {
    auto: "自动识别",
    zh: "中文",
    en: "英语",
    ja: "日语",
    ko: "韩语"
  };
  return labels[language] ?? language;
}

export function ConfigPanel({ activeJob }: Pick<RenderProps, "activeJob">) {
  return (
    <section className="panel">
      <h3>配置</h3>
      <div className="summary-grid">
        <span>任务<strong>{activeJob?.type ?? "unknown"}</strong></span>
        <span>语言<strong>{activeJob?.language ? languageLabel(activeJob.language) : activeJob?.result?.language ? languageLabel(activeJob.result.language) : "未同步"}</strong></span>
        <span>Provider<strong>{activeJob?.providerName ?? "unknown"}</strong></span>
        <span>模型<strong>{activeJob?.modelName ?? "unknown"}</strong></span>
        <span>输出目录<strong>{activeJob?.outputDirectory || "未设置"}</strong></span>
      </div>
    </section>
  );
}
