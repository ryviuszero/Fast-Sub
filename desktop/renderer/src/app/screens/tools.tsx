import { useRef, useState, type DragEvent } from "react";
import type { RenderProps } from "../types";
import { Chrome, KV, Segment, SettingRow, SettingsEntry } from "../components";

export function ToolTranslate({ setScreen, startToolJob }: RenderProps) {
  const srtInputRef = useRef<HTMLInputElement | null>(null);
  const [srtName, setSrtName] = useState("尚未选择 SRT");
  const [translateStatus, setTranslateStatus] = useState<"idle" | "done" | "failed">("idle");
  const pickSrt = (files: FileList | null) => {
    const file = files?.[0];
    if (file) {
      setSrtName(file.name);
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
    if (srtName === "尚未选择 SRT") {
      setTranslateStatus("failed");
      return;
    }
    await startToolJob("translate_srt", [`mock-input://${srtName}`]);
    setTranslateStatus("done");
  };
  return (
    <div className="wf">
      <Chrome title="翻译字幕" back onBack={() => setScreen("main-empty")} />
      <main className="content-flow">
        <div><h2>翻译已有 SRT</h2><span className="caption">独立子功能：不影响一键生成主流程。</span></div>
        <input ref={srtInputRef} aria-label="选择 SRT 文件" className="native-file-picker" type="file" accept=".srt,text/plain" onChange={(event) => pickSrt(event.currentTarget.files)} />
        <section className="drop-zone small" onClick={() => srtInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={dropSrt}><h2>拖入 .srt 文件</h2><span>{srtName}</span><div className="row gap-8"><button className="btn" onClick={(event) => { event.stopPropagation(); srtInputRef.current?.click(); }}>选择 SRT</button><button className="btn ghost" onClick={(event) => event.stopPropagation()}>粘贴字幕文本</button></div></section>
        <section className="panel"><h3>翻译设置</h3><SettingRow label="源语言"><select><option>自动识别</option></select></SettingRow><SettingRow label="目标语言"><select><option>简体中文</option></select></SettingRow><SettingRow label="翻译方式"><Segment items={["本地", "网页", "API"]} active={0} /></SettingRow></section>
        {translateStatus === "done" && (
          <section className="panel ok-card">
            <h2>翻译完成</h2>
            <KV k="输出文件" v={srtName.replace(/\.srt$/i, ".zh.srt")} />
            <KV k="模式" v="本地 mock 翻译" />
          </section>
        )}
        {translateStatus === "failed" && <section className="panel warn-panel"><h2>翻译失败</h2><p>请先选择一个 SRT 文件。</p></section>}
      </main>
      <div className="action-footer"><SettingsEntry onClick={() => setScreen("settings-general")} /><div className="row gap-8"><button className="btn ghost" onClick={() => setTranslateStatus("failed")}>查看错误记录</button><button className="btn primary" onClick={() => void startTranslate()}>开始翻译</button></div></div>
    </div>
  );
}

export function ToolBurnIn({ setScreen, startToolJob }: RenderProps) {
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const subtitleInputRef = useRef<HTMLInputElement | null>(null);
  const [videoName, setVideoName] = useState("尚未选择视频");
  const [subtitleName, setSubtitleName] = useState("尚未选择字幕");
  const [burnStatus, setBurnStatus] = useState<"idle" | "done" | "failed">("idle");
  const pickVideo = (files: FileList | null) => {
    const file = files?.[0];
    if (file) {
      setVideoName(file.name);
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
      setBurnStatus("idle");
    }
    if (subtitleInputRef.current) {
      subtitleInputRef.current.value = "";
    }
  };
  const canBurn = videoName !== "尚未选择视频" && subtitleName !== "尚未选择字幕";
  const startBurnIn = async () => {
    if (!canBurn) {
      setBurnStatus("failed");
      return;
    }
    await startToolJob("burn_in", [`mock-input://${videoName}`, `mock-input://${subtitleName}`]);
    setBurnStatus("done");
  };
  return (
    <div className="wf">
      <Chrome title="字幕烧录" back onBack={() => setScreen("main-empty")} />
      <main className="content-flow">
        <div><h2>烧录字幕到视频</h2><span className="caption">独立子功能：输出带硬字幕的视频文件。</span></div>
        <input ref={videoInputRef} aria-label="选择烧录视频文件" className="native-file-picker" type="file" accept=".mp4,.mov,.mkv,video/*" onChange={(event) => pickVideo(event.currentTarget.files)} />
        <input ref={subtitleInputRef} aria-label="选择烧录字幕文件" className="native-file-picker" type="file" accept=".srt,.ass,.vtt,text/plain" onChange={(event) => pickSubtitle(event.currentTarget.files)} />
        <div className="two-col"><section className="drop-zone small" onClick={() => videoInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); pickVideo(event.dataTransfer.files); }}><h2>选择视频</h2><span>{videoName}</span></section><section className="drop-zone small" onClick={() => subtitleInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); pickSubtitle(event.dataTransfer.files); }}><h2>选择字幕</h2><span>{subtitleName}</span></section></div>
        <section className="panel"><SettingRow label="字号"><Segment items={["小", "中", "大"]} active={1} /></SettingRow><SettingRow label="编码 preset"><Segment items={["快速", "均衡", "质量"]} active={1} /></SettingRow></section>
        {burnStatus === "done" && (
          <section className="panel ok-card">
            <h2>烧录完成</h2>
            <KV k="输出文件" v={videoName.replace(/\.[^.]+$/, ".burned.mp4")} />
            <KV k="字幕" v={subtitleName} />
          </section>
        )}
        {burnStatus === "failed" && <section className="panel warn-panel"><h2>烧录失败</h2><p>请先选择视频和字幕文件。</p></section>}
      </main>
      <div className="action-footer"><SettingsEntry onClick={() => setScreen("settings-general")} /><div className="row gap-8"><button className="btn ghost" onClick={() => setScreen("main-empty")}>取消</button><button className="btn primary" onClick={() => void startBurnIn()}>开始烧录</button></div></div>
    </div>
  );
}
