import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { JobLogEntry, JobSummary } from "../../../../shared/contracts/types";
import type { QueueFilter, RenderProps } from "../types";
import { Chip, Chrome, Divider, KV, Tabs } from "../components";
import { useRuntimeText, useT } from "../i18n";

const RECENT_HISTORY_LIMIT = 40;

export function QueueList({ jobs, queueInitialFilter, setScreen, openJob, cancelJobs, deleteJobs }: RenderProps) {
  const t = useT();
  const rt = useRuntimeText();
  const [queueFilter, setQueueFilter] = useState<QueueFilter>(queueInitialFilter);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setQueueFilter(queueInitialFilter);
  }, [queueInitialFilter]);
  const displayJobs = useMemo(() => recentQueueJobs(jobs, RECENT_HISTORY_LIMIT), [jobs]);
  const hiddenCount = Math.max(0, jobs.length - displayJobs.length);
  const runningJobs = useMemo(() => displayJobs.filter((job) => job.status === "running" || job.status === "canceling"), [displayJobs]);
  const queuedJobs = useMemo(() => displayJobs.filter((job) => job.status === "queued"), [displayJobs]);
  const activeJobs = useMemo(() => [...runningJobs, ...queuedJobs], [queuedJobs, runningJobs]);
  const completedJobs = useMemo(() => displayJobs.filter((job) => job.status === "succeeded"), [displayJobs]);
  const failedJobs = useMemo(() => displayJobs.filter((job) => job.status === "failed"), [displayJobs]);
  const totalCount = displayJobs.length;
  const showRunning = queueFilter === "all" || queueFilter === "running";
  const showDone = queueFilter === "all" || queueFilter === "done";
  const showFailed = queueFilter === "all" || queueFilter === "failed";
  const tabIndex = queueFilter === "all" ? 0 : queueFilter === "running" ? 1 : queueFilter === "done" ? 2 : 3;
  const visibleJobs = useMemo(() => [
    ...(showRunning ? activeJobs : []),
    ...(showDone ? completedJobs : []),
    ...(showFailed ? failedJobs : [])
  ], [activeJobs, completedJobs, failedJobs, showDone, showFailed, showRunning]);
  useEffect(() => {
    setSelectedIds((current) => new Set([...current].filter((id) => displayJobs.some((job) => job.id === id))));
  }, [displayJobs]);
  const selectedJobs = useMemo(() => visibleJobs.filter((job) => selectedIds.has(job.id)), [selectedIds, visibleJobs]);
  const selectedActive = selectedJobs.filter((job) => isActiveJobStatus(job.status));
  const selectedDeletable = selectedJobs.filter((job) => isTerminalJobStatus(job.status));
  const allVisibleSelected = visibleJobs.length > 0 && visibleJobs.every((job) => selectedIds.has(job.id));
  const toggleJob = (jobId: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(jobId);
      } else {
        next.delete(jobId);
      }
      return next;
    });
  };
  const toggleVisible = (checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const job of visibleJobs) {
        if (checked) {
          next.add(job.id);
        } else {
          next.delete(job.id);
        }
      }
      return next;
    });
  };
  const cancelSelected = async () => {
    await cancelJobs(selectedActive.map((job) => job.id));
    setSelectedIds(new Set());
  };
  const deleteSelected = async () => {
    await deleteJobs(selectedDeletable.map((job) => job.id));
    setSelectedIds(new Set());
  };
  const renderJobCard = (job: JobSummary, className: string, chip: ReactNode, extra?: ReactNode) => (
    <article className={className} key={job.id} onClick={() => void openJob(job.id, job.status === "failed" ? "queue-failed" : "queue-detail")}>
      <div className="job-card-select" onClick={(event) => event.stopPropagation()}>
        <input
          aria-label={t("Select job", { title: job.title })}
          checked={selectedIds.has(job.id)}
          type="checkbox"
          onChange={(event) => toggleJob(job.id, event.currentTarget.checked)}
        />
      </div>
      <div className="job-card-body">
        <div className="between"><div><strong>{job.title}</strong>{extra}</div>{chip}</div>
      </div>
    </article>
  );
  return (
    <div className="wf">
      <Chrome title={t("Task queue")} back onBack={() => setScreen("main-empty")} />
      <Tabs items={[`${t("All jobs")} ${totalCount}${hiddenCount ? ` / ${jobs.length}` : ""}`, `${t("Running jobs")} ${activeJobs.length}`, `${t("Completed jobs")} ${completedJobs.length}`, `${t("Failed jobs")} ${failedJobs.length}`]} active={tabIndex} onSelect={(index) => setQueueFilter(["all", "running", "done", "failed"][index] as QueueFilter)} />
      <main className="content-flow queue-flow">
        {hiddenCount > 0 && <p className="queue-note">{t("Recent jobs note", { shown: displayJobs.length, hidden: hiddenCount })}</p>}
        {visibleJobs.length > 0 && (
          <div className="queue-bulk-bar">
            <label className="inline-check">
              <input checked={allVisibleSelected} type="checkbox" onChange={(event) => toggleVisible(event.currentTarget.checked)} />
              {t("Select all visible")}
            </label>
            <span>{t("Selected jobs count", { count: selectedJobs.length })}</span>
            <button className="btn sm ghost" disabled={selectedJobs.length === 0} onClick={() => setSelectedIds(new Set())} type="button">{t("Clear selection")}</button>
            <button className="btn sm ghost" disabled={selectedActive.length === 0} onClick={() => void cancelSelected()} type="button">{t("Cancel selected running")}</button>
            <button className="btn sm ghost" disabled={selectedDeletable.length === 0} onClick={() => void deleteSelected()} type="button">{t("Delete selected records")}</button>
          </div>
        )}
        {showRunning && (
          <>
            {runningJobs.map((job) => (
              renderJobCard(job, "job-card running", <Chip tone="accent">{rt(job.statusLabel)}</Chip>, <><QueueMetaChips job={job} t={t} rt={rt} extra={[`${rt(job.stageLabel)} ${job.progressPercent}%`]} /><div className="progress accent"><i style={{ width: `${job.progressPercent}%` }} /></div></>)
            ))}
            {queuedJobs.map((job) => (
              renderJobCard(job, "job-card", <Chip>{rt(job.statusLabel)}</Chip>, <QueueMetaChips job={job} t={t} rt={rt} />)
            ))}
          </>
        )}
        {queueFilter === "all" && <Divider />}
        {showDone && completedJobs.map((job) => (
          renderJobCard(job, "job-card done", <Chip tone="ok">{rt(job.statusLabel)}</Chip>, <QueueMetaChips job={job} t={t} rt={rt} extra={[t("Completed at", { time: completedTimeLabel(job.completedAt || job.createdAt, t) })]} />)
        ))}
        {showFailed && failedJobs.map((job) => (
          renderJobCard(job, "job-card failed", <Chip tone="warn">{rt(job.statusLabel)}</Chip>, <QueueMetaChips job={job} t={t} rt={rt} extra={[rt(job.stageLabel)]} />)
        ))}
      </main>
    </div>
  );
}

export function QueueDetail({ activeJob, setScreen, failed, retryJob, deleteJob, cancelJob, getJobLogs, openMock }: RenderProps & { failed: boolean }) {
  const t = useT();
  const rt = useRuntimeText();
  const [detailTab, setDetailTab] = useState(0);
  const failedStatus = activeJob ? activeJob.status === "failed" : failed;
  const tabs = failedStatus ? [t("Issues"), t("Logs"), t("Config")] : [t("Progress"), t("Logs"), t("Details")];
  const canceled = activeJob?.status === "canceled";
  const canceling = activeJob?.status === "canceling";
  const succeeded = activeJob?.status === "succeeded";
  const error = activeJob?.error;
  const title = activeJob?.title ?? t("No task selected");
  const subtitle = activeJob ? `${succeeded ? activeJob.completedAt || activeJob.createdAt : activeJob.createdAt} · ${rt(activeJob.statusLabel)}` : t("Choose a task from the list");
  const progress = succeeded ? 100 : activeJob?.progressPercent ?? 0;
  const progressText = canceled
    ? t("Task canceled message")
    : canceling
      ? t("Canceling task")
      : succeeded
        ? t("Task completed message")
      : activeJob?.estimatedRemaining
        ? `${rt(activeJob.stageLabel)} · ${t("Estimated remaining", { time: activeJob.estimatedRemaining })}`
        : activeJob?.stageLabel ? rt(activeJob.stageLabel) : t("Waiting for daemon events");
  return (
    <div className="wf">
      <Chrome title={failedStatus ? t("Failed task detail") : t("Task detail")} back onBack={() => setScreen("queue-list")} />
      <header className="detail-head">
        <div><h2>{title}</h2><span>{subtitle}</span></div>
        <div className="row gap-8 mid">
          <button className="btn sm ghost" onClick={() => setScreen("queue-list")} type="button">{t("Back to task list")}</button>
          <Chip tone={failedStatus ? "warn" : succeeded ? "ok" : canceled ? "muted" : "accent"}>{failedStatus ? t("Failed") : succeeded ? t("Completed") : canceled ? t("Canceled") : canceling ? t("Canceling") : t("Running")}</Chip>
        </div>
      </header>
      <Tabs items={tabs} active={detailTab} onSelect={setDetailTab} />
      <main className="content-flow">
        {failedStatus ? (
          <>
            {detailTab === 0 && (
              <>
                <section className="panel warn-panel">
                  <h2>{error?.title ? rt(error.title) : t("Task failed")}</h2>
                  <p>{error?.message ? rt(error.message) : t("Task failed message")}</p>
                  <Divider />
                  <strong>{t("Suggested action")}</strong>
                  <p>{error?.action ? rt(error.action) : t("Check diagnostic logs")}</p>
                </section>
                <section className="panel">
                  <h3>{t("Structured error")}</h3>
                  <KV k="code" v={error?.code ?? "job_failed"} />
                  {error?.details ? Object.entries(error.details).map(([key, value]) => (
                    <KV k={key} v={String(value)} mono={key.includes("tail") || key.includes("stderr")} key={key} />
                  )) : <KV k="stage" v={activeJob?.stageLabel ? rt(activeJob.stageLabel) : "unknown"} />}
                  <KV k="diagnostic" v={error?.diagnostic ?? t("No diagnostic info")} mono />
                </section>
                <div className="row gap-8">
                  <button className="btn primary" onClick={() => void retryJob()}>{t("Retry task")}</button>
                  <button className="btn ghost" onClick={() => void deleteJob()}>{t("Delete record")}</button>
                </div>
              </>
            )}
            {detailTab === 1 && <LogPanel activeJob={activeJob} getJobLogs={getJobLogs} />}
            {detailTab === 2 && <ConfigPanel activeJob={activeJob} openMock={openMock} />}
          </>
        ) : (
          <>
            {detailTab === 0 && (
              <>
                <div className="progress-hero"><strong>{progress}%</strong><span>{progressText}</span></div>
                <div className="progress accent"><i style={{ width: `${progress}%` }} /></div>
                <div className="row gap-6 wrap"><Chip tone="ok">{t("Check file")} ✓</Chip><Chip tone="ok">{t("Analyze media")} ✓</Chip><Chip tone="ok">{t("Extract audio")} ✓</Chip><Chip tone={succeeded ? "ok" : canceled ? "muted" : "accent"}>{succeeded ? `${t("Transcription complete")} ✓` : canceled ? t("Canceled") : canceling ? t("Canceling") : `${t("Transcribing")} ●`}</Chip><Chip tone={succeeded ? "ok" : "muted"}>{succeeded ? `${t("Generate subtitles")} ✓` : t("Generate subtitles")}</Chip></div>
                <div className="row gap-8">
                  {canceled ? <button className="btn primary" onClick={() => void retryJob()}>{t("Regenerate")}</button> : !succeeded && <button className="btn ghost" onClick={() => void cancelJob()}>{t("Cancel task")}</button>}
                  {canceled && <button className="btn ghost" onClick={() => void deleteJob()}>{t("Delete record")}</button>}
                </div>
              </>
            )}
            {detailTab === 1 && <LogPanel activeJob={activeJob} getJobLogs={getJobLogs} />}
            {detailTab === 2 && <ConfigPanel activeJob={activeJob} openMock={openMock} />}
          </>
        )}
      </main>
    </div>
  );
}

export function LogPanel({ activeJob, getJobLogs }: Pick<RenderProps, "activeJob" | "getJobLogs">) {
  const t = useT();
  const rt = useRuntimeText();
  const [remoteLogs, setRemoteLogs] = useState<JobLogEntry[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!activeJob?.id) {
        setRemoteLogs(null);
        return;
      }
      try {
        const entries = await getJobLogs(activeJob.id);
        if (alive) {
          setRemoteLogs(entries);
          setLoadFailed(false);
        }
      } catch {
        if (alive) {
          setLoadFailed(true);
        }
      }
    };
    void load();
    const timer = isActiveJobStatus(activeJob?.status) ? window.setInterval(() => void load(), 2500) : null;
    return () => {
      alive = false;
      if (timer !== null) {
        window.clearInterval(timer);
      }
    };
  }, [activeJob?.id, activeJob?.status, getJobLogs]);
  const separator = t("Label separator");
  const entries = remoteLogs?.length ? remoteLogs : activeJob?.logs ?? [];
  const lines = entries.length
    ? entries.map((line) => `[${line.time}] ${line.level}: ${rt(line.message)}`)
    : [
      loadFailed ? t("Failed to load logs") : t("No detailed logs"),
      `${t("Task")}${separator}${activeJob?.title ?? t("No task selected")}`,
      `${t("Status")}${separator}${activeJob?.statusLabel ? rt(activeJob.statusLabel) : t("Unknown")}`,
      `${t("Stage")}${separator}${activeJob?.stageLabel ? rt(activeJob.stageLabel) : t("Unknown")}`
    ];
  return (
    <section className="panel">
      <h3>{t("Logs")}</h3>
      <pre>{lines.join("\n")}</pre>
    </section>
  );
}

function recentQueueJobs(jobs: JobSummary[], limit: number): JobSummary[] {
  const active = jobs.filter((job) => job.status === "running" || job.status === "queued" || job.status === "canceling");
  const activeIds = new Set(active.map((job) => job.id));
  const history = jobs
    .filter((job) => !activeIds.has(job.id))
    .slice()
    .sort((a, b) => jobTimeValue(b) - jobTimeValue(a));
  return [...active, ...history.slice(0, Math.max(0, limit - active.length))];
}

function jobTimeValue(job: JobSummary): number {
  const value = Date.parse(job.completedAt || job.createdAt);
  return Number.isFinite(value) ? value : 0;
}

function QueueMetaChips({ job, extra = [], t, rt }: { job: JobSummary; extra?: string[]; t: (key: string, values?: Record<string, string | number>) => string; rt: (text: string) => string }) {
  const modelName = queueModelChip(job);
  const items = [
    ...extra,
    job.language ? languageLabel(job.language, t) : "",
    job.providerName || "",
    modelName
  ].filter(Boolean);
  return (
    <div className="job-meta">
      {items.length > 0 ? items.map((item) => <Chip key={item}>{rt(item)}</Chip>) : <Chip>{t("Config not synced")}</Chip>}
    </div>
  );
}

function queueModelChip(job: JobSummary): string {
  const model = job.modelName ?? "";
  if (!model) {
    return "";
  }
  if (job.type !== "translate_srt" && !job.title.endsWith(".translated.srt") && !job.title.endsWith(".translated.txt")) {
    return model;
  }
  const provider = job.providerName ?? "";
  const nllbModel = model.toLowerCase().includes("nllb");
  if (nllbModel && !provider.includes("NLLB")) {
    return "";
  }
  return model;
}

function completedTimeLabel(value = "", t?: (key: string, values?: Record<string, string | number>) => string): string {
  if (!value) {
    return t ? t("Unknown") : "Unknown";
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

function languageLabel(language: string, t?: (key: string, values?: Record<string, string | number>) => string): string {
  const labels: Record<string, string> = {
    auto: t ? t("Auto detect") : "Auto detect",
    zh: t ? t("Chinese") : "Chinese",
    en: t ? t("English") : "English",
    ja: t ? t("Japanese") : "Japanese",
    ko: t ? t("Korean") : "Korean"
  };
  return labels[language] ?? language;
}

export function ConfigPanel({ activeJob, openMock }: Pick<RenderProps, "activeJob" | "openMock">) {
  const t = useT();
  const outputDirectory = activeJob?.outputDirectory || "";
  return (
    <section className="panel">
      <h3>{t("Config")}</h3>
      <div className="summary-grid">
        <span>{t("Task")}<strong>{activeJob?.type ?? "unknown"}</strong></span>
        <span>{t("Language")}<strong>{activeJob?.language ? languageLabel(activeJob.language, t) : activeJob?.result?.language ? languageLabel(activeJob.result.language, t) : t("Not synced")}</strong></span>
        <span>{t("Provider")}<strong>{activeJob?.providerName ?? "unknown"}</strong></span>
        <span>{t("Model")}<strong>{activeJob?.modelName ?? "unknown"}</strong></span>
        <span>{t("Output directory")}<strong>{outputDirectory ? <button className="inline-path-button" onClick={() => void openMock(outputDirectory)} type="button">{outputDirectory}</button> : t("Not set")}</strong></span>
      </div>
    </section>
  );
}

function isActiveJobStatus(status: JobSummary["status"] | undefined): boolean {
  return status === "running" || status === "queued" || status === "canceling";
}

function isTerminalJobStatus(status: JobSummary["status"] | undefined): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled" || status === "interrupted";
}
