// v2/main-queue.jsx — Main screen states + task queue

// Main: Empty / ready state (Drop-zone hero, variant D style)
function MainEmpty({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome right={<><span className="chip ok" style={{fontSize:10}}>本地转写就绪</span><span className="chip ok" style={{fontSize:10, marginLeft:4}}>翻译就绪</span></>}/>
      <div className="grow center col gap-12 pad-16">
        <div className="b-dash center col gap-8 pad-16" style={{width:'85%', minHeight:150, background:'var(--paper-2)'}}>
          <div style={{fontSize:28, opacity:.5}}>⬇</div>
          <div className="h0">拖拽视频到这里</div>
          <div className="t-sm">支持 .mp4 · .mov · .mkv · .wav · .m4a · .mp3</div>
          <div className="row gap-8">
            <div className="btn">添加视频</div>
            <div className="btn">添加文件夹</div>
          </div>
        </div>

        <div className="row between mid" style={{width:'85%'}}>
          <div className="row mid gap-6">
            <span className="t-sm">输出位置：</span>
            <span className="t" style={{fontWeight:700}}>与源视频相同目录</span>
            <span className="t-xs underline-wavy" style={{marginLeft:4}}>修改</span>
          </div>
          <div className="row mid gap-6">
            <span className="t-sm">格式：</span>
            <span className="t" style={{fontWeight:700}}>SRT</span>
          </div>
        </div>
      </div>
      <div className="row between mid pad-12 shrink-0" style={{borderTop:'1.2px solid var(--ink)', background:'var(--paper-2)'}}>
        <div className="t-xs" style={{color:'var(--ink-3)'}}>无进行中的任务</div>
        <div className="row gap-6">
          <div className="btn sm ghost">历史记录</div>
          <div className="btn sm ghost">设置</div>
        </div>
      </div>
    </div>
  );
}

// Main: Files added, ready to generate
function MainFiles({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome right={<span className="chip ok" style={{fontSize:10}}>就绪</span>}/>
      <div className="grow col pad-14 gap-10" style={{overflow:'auto'}}>
        <div className="row between mid">
          <div className="h1">已添加 3 个文件</div>
          <div className="btn sm ghost">+ 添加更多</div>
        </div>

        <div className="col gap-6">
          <div className="b pad-10 row between mid">
            <div className="col"><div className="t" style={{fontWeight:700}}>sample-meeting.mp4</div><div className="t-xs">1.2 GB · 45:12</div></div>
            <div className="btn sm ghost" style={{fontSize:10}}>移除</div>
          </div>
          <div className="b pad-10 row between mid">
            <div className="col"><div className="t" style={{fontWeight:700}}>sample-lecture.mov</div><div className="t-xs">680 MB · 32:05</div></div>
            <div className="btn sm ghost" style={{fontSize:10}}>移除</div>
          </div>
          <div className="b pad-10 row between mid">
            <div className="col"><div className="t" style={{fontWeight:700}}>sample-podcast.wav</div><div className="t-xs">120 MB · 28:40</div></div>
            <div className="btn sm ghost" style={{fontSize:10}}>移除</div>
          </div>
        </div>

        <div className="hr-dash"/>
        <div className="row between mid">
          <div className="col gap-2">
            <div className="t-sm">输出：SRT · 与源视频相同目录</div>
            <div className="t-xs">语言：自动识别 · 本地转写 (whisper-small)</div>
          </div>
          <div className="t-xs underline-wavy">详细设置</div>
        </div>
      </div>
      <div className="row between mid pad-14 shrink-0" style={{borderTop:'1.5px solid var(--ink)', background:'var(--paper-2)'}}>
        <div className="btn ghost">取消</div>
        <div className="btn primary" style={{padding:'10px 28px', fontSize:14}}>生成字幕</div>
      </div>
    </div>
  );
}

// Main: Generating in progress
function MainGenerating({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome right={<span className="chip accent" style={{fontSize:10}}>正在生成</span>}/>
      <div className="grow col pad-16 gap-10" style={{overflow:'auto'}}>
        <div className="col gap-4" style={{textAlign:'center', alignItems:'center'}}>
          <div className="spin" style={{width:28, height:28, borderWidth:2.5}}/>
          <div className="h0" style={{marginTop:6}}>正在生成字幕…</div>
          <div className="t-sm">sample-meeting.mp4</div>
        </div>

        <div className="b pad-14 col gap-6" style={{background:'var(--paper-2)'}}>
          <div className="row between mid">
            <span className="t" style={{fontWeight:700}}>62%</span>
            <span className="t-sm">预计还需 3 分钟</span>
          </div>
          <div className="bar accent"><i style={{width:'62%'}}/></div>
          <div className="t-xs" style={{textAlign:'center'}}>正在转写音频…</div>
        </div>

        <div className="col gap-4">
          <div className="h3">接下来</div>
          <div className="row mid gap-8">
            <StatusPill status="waiting"/>
            <span className="t-sm">sample-lecture.mov</span>
          </div>
          <div className="row mid gap-8">
            <StatusPill status="waiting"/>
            <span className="t-sm">sample-podcast.wav</span>
          </div>
        </div>

        <div className="row gap-8" style={{justifyContent:'center'}}>
          <div className="btn">取消当前任务</div>
          <div className="btn ghost">全部取消</div>
        </div>
      </div>
      <div className="row between mid pad-12 shrink-0" style={{borderTop:'1.2px solid var(--ink)', background:'var(--paper-2)'}}>
        <div className="t-xs">任务 1 / 3</div>
        <div className="btn sm ghost">后台运行</div>
      </div>
    </div>
  );
}

// Main: Completed
function MainDone2({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome right={<span className="chip ok" style={{fontSize:10}}>就绪</span>}/>
      <div className="grow col pad-16 gap-10" style={{overflow:'auto'}}>
        <div className="col gap-2" style={{textAlign:'center', alignItems:'center'}}>
          <div style={{width:40, height:40, borderRadius:'50%', border:'2px solid var(--ok)', background:'var(--ok-soft)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, color:'var(--ok)'}}>✓</div>
          <div className="h0" style={{marginTop:6}}>字幕生成完成</div>
          <div className="t-sm">已完成 3 个文件</div>
        </div>

        <div className="col gap-6">
          <div className="b pad-10 row between mid" style={{borderColor:'var(--ok)', background:'var(--ok-soft)'}}>
            <div className="col"><div className="t" style={{fontWeight:700}}>sample-meeting.srt</div><div className="t-xs">12:42 完成 · 耗时 4m32s</div></div>
            <div className="row gap-4"><div className="btn sm">打开字幕</div><div className="btn sm ghost">文件夹</div></div>
          </div>
          <div className="b pad-10 row between mid" style={{borderColor:'var(--ok)', background:'var(--ok-soft)'}}>
            <div className="col"><div className="t" style={{fontWeight:700}}>sample-lecture.srt</div><div className="t-xs">12:47 完成 · 耗时 3m15s</div></div>
            <div className="row gap-4"><div className="btn sm">打开字幕</div><div className="btn sm ghost">文件夹</div></div>
          </div>
          <div className="b pad-10 row between mid" style={{borderColor:'var(--warn)', background:'var(--warn-soft)'}}>
            <div className="col"><div className="t" style={{fontWeight:700}}>sample-podcast.wav</div><div className="t-xs">生成失败 · 音频轨无法提取</div></div>
            <div className="row gap-4"><div className="btn sm">重试</div><div className="btn sm ghost">详情</div></div>
          </div>
        </div>
      </div>
      <div className="row between mid pad-14 shrink-0" style={{borderTop:'1.5px solid var(--ink)', background:'var(--paper-2)'}}>
        <div className="btn ghost">查看全部历史</div>
        <div className="btn primary">继续添加 →</div>
      </div>
    </div>
  );
}

// Queue: Multiple jobs view (accessed from "历史记录")
function QueueList({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome title="任务队列" back={true}/>
      <div className="tabs px-12">
        <div className="on">全部 <span className="chip muted" style={{marginLeft:4}}>8</span></div>
        <div>正在生成 <span className="chip accent" style={{marginLeft:4}}>1</span></div>
        <div>已完成</div>
        <div>失败</div>
      </div>
      <div className="grow col pad-12 gap-6" style={{overflow:'auto'}}>
        <div className="job-card running">
          <div className="row between mid"><div className="col"><div className="t" style={{fontWeight:700}}>sample-meeting.mp4</div><div className="t-xs">正在转写 · whisper-small</div></div><StatusPill status="running"/></div>
          <div className="col gap-4" style={{marginTop:6}}><div className="bar accent"><i style={{width:'62%'}}/></div><div className="row between"><span className="t-xs">62%</span><span className="t-xs">~3 分钟</span></div></div>
        </div>

        <div className="job-card"><div className="row between mid"><div className="col"><div className="t" style={{fontWeight:700}}>sample-lecture.mov</div></div><StatusPill status="waiting"/></div></div>
        <div className="job-card"><div className="row between mid"><div className="col"><div className="t" style={{fontWeight:700}}>sample-podcast.wav</div></div><StatusPill status="waiting"/></div></div>

        <div className="hr-dash"/>

        <div className="job-card done"><div className="row between mid"><div className="col"><div className="t" style={{fontWeight:700}}>周会-0505.m4a</div><div className="t-xs">今天 10:30 完成</div></div><div className="row gap-6"><div className="btn sm">打开</div><StatusPill status="done"/></div></div></div>
        <div className="job-card done"><div className="row between mid"><div className="col"><div className="t" style={{fontWeight:700}}>培训视频.mp4</div><div className="t-xs">昨天 16:42 完成</div></div><div className="row gap-6"><div className="btn sm">打开</div><StatusPill status="done"/></div></div></div>

        <div className="job-card failed"><div className="row between mid"><div className="col"><div className="t" style={{fontWeight:700}}>raw-cam.mov</div><div className="t-xs">音频轨无法提取</div></div><div className="row gap-6"><div className="btn sm">重试</div><StatusPill status="failed"/></div></div></div>
        <div className="job-card" style={{opacity:.6}}><div className="row between mid"><div className="col"><div className="t" style={{fontWeight:700}}>old-call.mp3</div></div><StatusPill status="canceled"/></div></div>
      </div>
    </div>
  );
}

// Queue: Job detail expanded (tabs view, variant B style)
function QueueDetail({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome title="任务详情" back={true}/>
      <div className="row between mid pad-12" style={{borderBottom:'1.2px solid var(--ink)', background:'var(--paper-2)'}}>
        <div className="col">
          <div className="h1">sample-meeting.mp4</div>
          <div className="t-xs">开始于 12:42 · 已运行 2 分钟</div>
        </div>
        <div className="row gap-6">
          <StatusPill status="running"/>
          <div className="btn sm">取消</div>
        </div>
      </div>
      <div className="tabs px-12">
        <div className="on">进度</div>
        <div>日志</div>
        <div>详情</div>
      </div>
      <div className="grow pad-14 col gap-10" style={{overflow:'auto'}}>
        <div className="row gap-12 baseline">
          <div className="h0">62<span className="t-sm">%</span></div>
          <div className="col"><div className="t">正在转写音频</div><div className="t-xs">预计还需约 3 分钟</div></div>
        </div>
        <div className="bar accent"><i style={{width:'62%'}}/></div>
        <div className="row gap-4" style={{flexWrap:'wrap'}}>
          <div className="chip ok">检查文件 ✓</div>
          <div className="chip ok">分析媒体 ✓</div>
          <div className="chip ok">提取音频 ✓</div>
          <div className="chip accent">转写中 ●</div>
          <div className="chip muted">生成字幕</div>
        </div>
        <div className="hr-dash"/>
        <div className="col gap-4">
          <div className="t-sm" style={{fontWeight:700}}>配置</div>
          <div className="row gap-16">
            <div className="col"><div className="t-xs">语言</div><div className="t">自动 → 中文</div></div>
            <div className="col"><div className="t-xs">模型</div><div className="t">whisper-small</div></div>
            <div className="col"><div className="t-xs">设备</div><div className="t">GPU (Metal)</div></div>
            <div className="col"><div className="t-xs">输出</div><div className="t">SRT</div></div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.MainEmpty = MainEmpty;
window.MainFiles = MainFiles;
window.MainGenerating = MainGenerating;
window.MainDone2 = MainDone2;
window.QueueList = QueueList;
window.QueueDetail = QueueDetail;
