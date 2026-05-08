import { useState } from "react";
import type { RenderProps } from "../types";
import { Chip, Chrome, Divider, KV, Tabs } from "../components";

type QueueFilter = "all" | "running" | "done" | "failed";

export function QueueList({ jobs, setScreen, openJob }: RenderProps) {
  const [queueFilter, setQueueFilter] = useState<QueueFilter>("all");
  const runningJobs = jobs.filter((job) => job.status === "running" || job.status === "canceling");
  const queuedJobs = jobs.filter((job) => job.status === "queued");
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
      <Tabs items={[`全部 ${totalCount}`, `正在生成 ${runningJobs.length}`, `已完成 ${completedJobs.length}`, `失败 ${failedJobs.length}`]} active={tabIndex} onSelect={(index) => setQueueFilter(["all", "running", "done", "failed"][index] as QueueFilter)} />
      <main className="content-flow queue-flow">
        {showRunning && (
          <>
            {runningJobs.map((job) => (
              <article className="job-card running" key={job.id} onClick={() => void openJob(job.id, "queue-detail")}>
                <div className="between"><div><strong>{job.title}</strong><span>{job.stageLabel} · {job.progressPercent}%</span></div><Chip tone="accent">{job.statusLabel}</Chip></div>
                <div className="progress accent"><i style={{ width: `${job.progressPercent}%` }} /></div>
              </article>
            ))}
            {queueFilter === "all" && queuedJobs.map((job) => (
              <article className="job-card" key={job.id} onClick={() => void openJob(job.id, "queue-detail")}>
                <div className="between"><strong>{job.title}</strong><Chip>{job.statusLabel}</Chip></div>
              </article>
            ))}
          </>
        )}
        {queueFilter === "all" && <Divider />}
        {showDone && completedJobs.map((job) => <article className="job-card done" key={job.id}><div className="between"><strong>{job.title}</strong><Chip tone="ok">{job.statusLabel}</Chip></div></article>)}
        {showFailed && failedJobs.map((job) => (
          <article className="job-card failed" key={job.id} onClick={() => void openJob(job.id, "queue-failed")}>
            <div className="between"><div><strong>{job.title}</strong><span>{job.stageLabel}</span></div><Chip tone="warn">{job.statusLabel}</Chip></div>
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
  return (
    <div className="wf">
      <Chrome title={failed ? "失败任务详情" : "任务详情"} back onBack={() => setScreen("queue-list")} />
      <header className="detail-head">
        <div><h2>{activeJob?.title ?? (failed ? "raw-cam.mov" : "sample-meeting.mp4")}</h2><span>{failed ? "今天 12:58 · 生成失败" : "开始于 12:42 · 已运行 2 分钟"}</span></div>
        <Chip tone={failed ? "warn" : canceled ? "muted" : "accent"}>{failed ? "已失败" : canceled ? "已取消" : canceling ? "正在取消" : "正在生成"}</Chip>
      </header>
      <Tabs items={tabs} active={detailTab} onSelect={setDetailTab} />
      <main className="content-flow">
        {failed ? (
          <>
            {detailTab === 0 && (
              <>
                <section className="panel warn-panel">
                  <h2>音频轨无法提取</h2>
                  <p>Fast Sub 没有在这个视频里找到可用音频轨，或 FFmpeg 无法读取该轨道。</p>
                  <Divider />
                  <strong>建议操作</strong>
                  <p>确认视频有声音；尝试重新封装视频；查看诊断日志确认错误。</p>
                </section>
                <section className="panel">
                  <h3>结构化错误</h3>
                  <KV k="code" v="media_extract_failed" />
                  <KV k="stage" v="extracting_audio" />
                  <KV k="retryable" v="true" />
                </section>
                <div className="row gap-8">
                  <button className="btn primary" onClick={() => void retryJob()}>重试任务</button>
                  <button className="btn ghost" onClick={() => void deleteJob()}>删除记录</button>
                </div>
              </>
            )}
            {detailTab === 1 && <LogPanel />}
            {detailTab === 2 && <ConfigPanel />}
          </>
        ) : (
          <>
            {detailTab === 0 && (
              <>
                <div className="progress-hero"><strong>{activeJob?.progressPercent ?? 62}%</strong><span>{canceled ? "任务已取消，可以重新生成或返回队列。" : canceling ? "正在取消任务..." : "正在转写音频 · 预计还需约 3 分钟"}</span></div>
                <div className="progress accent"><i style={{ width: `${activeJob?.progressPercent ?? 62}%` }} /></div>
                <div className="row gap-6 wrap"><Chip tone="ok">检查文件 ✓</Chip><Chip tone="ok">分析媒体 ✓</Chip><Chip tone="ok">提取音频 ✓</Chip><Chip tone={canceled ? "muted" : "accent"}>{canceled ? "已取消" : canceling ? "正在取消" : "转写中 ●"}</Chip><Chip>生成字幕</Chip></div>
                <div className="row gap-8">
                  {canceled ? <button className="btn primary" onClick={() => void retryJob()}>重新生成</button> : <button className="btn ghost" onClick={() => void cancelJob()}>取消任务</button>}
                  {canceled && <button className="btn ghost" onClick={() => void deleteJob()}>删除记录</button>}
                </div>
              </>
            )}
            {detailTab === 1 && <LogPanel />}
            {detailTab === 2 && <ConfigPanel />}
          </>
        )}
      </main>
    </div>
  );
}

export function LogPanel() {
  return (
    <section className="panel">
      <h3>日志</h3>
      <pre>[12:42:01] media loaded: meeting.mp4
[12:42:08] audio extracted
[12:42:16] transcription started
[12:44:10] token=[REDACTED]</pre>
    </section>
  );
}

export function ConfigPanel() {
  return (
    <section className="panel">
      <h3>配置</h3>
      <div className="summary-grid"><span>语言<strong>自动 → 中文</strong></span><span>模型<strong>whisper-small</strong></span><span>设备<strong>GPU</strong></span><span>输出<strong>SRT</strong></span></div>
    </section>
  );
}
