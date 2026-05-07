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
            <div className="t-sm">输出：原字幕 SRT · 与源视频相同目录</div>
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

// Main: Advanced settings expanded
function MainAdvancedSettings({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome right={<span className="chip ok" style={{fontSize:10}}>就绪</span>}/>
      <div className="grow col pad-14 gap-8" style={{overflow:'auto'}}>
        <div className="row between mid">
          <div className="h1">已添加 3 个文件</div>
          <div className="btn sm ghost">+ 添加更多</div>
        </div>

        <div className="b pad-10 col gap-6" style={{background:'var(--paper-2)'}}>
          <div className="row between mid">
            <div className="h2">详细设置</div>
            <div className="t-xs underline-wavy">收起</div>
          </div>
          <div className="row gap-8" style={{flexWrap:'wrap'}}>
            <div className="col gap-2" style={{width:150}}><div className="t-xs">字幕语言</div><div className="input" style={{padding:'4px 8px', fontSize:11}}>自动识别 ▾</div></div>
            <div className="col gap-2" style={{width:150}}><div className="t-xs">ASR 模型</div><div className="input" style={{padding:'4px 8px', fontSize:11}}>whisper-small ▾</div></div>
            <div className="col gap-2" style={{width:150}}><div className="t-xs">翻译模型</div><div className="input" style={{padding:'4px 8px', fontSize:11}}>通用翻译模型 ▾</div></div>
            <div className="col gap-2" style={{width:150}}><div className="t-xs">设备</div><div className="seg"><div className="on">自动</div><div>CPU</div><div>GPU</div></div></div>
          </div>
          <div className="hr-dash"/>
          <div className="row gap-8" style={{flexWrap:'wrap'}}>
            <div className="col gap-2"><div className="t-xs">输出内容</div><div className="seg"><div className="on">原字幕</div><div>翻译字幕</div><div>双语字幕</div><div>烧录视频</div></div></div>
          </div>
          <div className="row gap-8" style={{flexWrap:'wrap'}}>
            <div className="col gap-2"><div className="t-xs">生成模式</div><div className="seg"><div className="on">只转写</div><div>转写后翻译</div><div>只翻译 SRT</div></div></div>
            <div className="col gap-2"><div className="t-xs">转写方式</div><div className="seg"><div className="on">本地</div><div>远程</div></div></div>
            <div className="col gap-2"><div className="t-xs">翻译方式</div><div className="seg"><div className="on">本地</div><div>远程</div></div></div>
          </div>
          <div className="hr-dash"/>
          <div className="row between mid"><span className="t-sm">音频流</span><div className="input" style={{width:160, padding:'4px 8px', fontSize:11}}>自动选择 ▾</div></div>
          <div className="row between mid"><span className="t-sm">VAD</span><div className="seg"><div>关闭</div><div className="on">普通</div><div>强</div></div></div>
          <div className="row between mid"><span className="t-sm">速度/质量</span><div className="seg"><div>快速</div><div className="on">均衡</div><div>质量</div></div></div>
          <div className="hr-dash"/>
          <div className="row between mid"><span className="t-sm">输出冲突</span><div className="seg"><div className="on">询问</div><div>覆盖</div><div>跳过</div></div></div>
          <div className="row between mid"><span className="t-sm">词级时间戳</span><div className="tog"><i/></div></div>
          <div className="row between mid"><span className="t-sm">保留临时文件</span><div className="tog"><i/></div></div>
        </div>

        <div className="b pad-10 row between mid">
          <div className="col"><div className="t" style={{fontWeight:700}}>sample-meeting.mp4</div><div className="t-xs">输出：sample-meeting.srt</div></div>
          <div className="btn sm ghost">移除</div>
        </div>
        <div className="b pad-10 row between mid">
          <div className="col"><div className="t" style={{fontWeight:700}}>sample-lecture.mov</div><div className="t-xs">输出：sample-lecture.srt</div></div>
          <div className="btn sm ghost">移除</div>
        </div>
      </div>
      <div className="row between mid pad-14 shrink-0" style={{borderTop:'1.5px solid var(--ink)', background:'var(--paper-2)'}}>
        <div className="btn ghost">保存为默认</div>
        <div className="btn primary" style={{padding:'10px 28px', fontSize:14}}>生成字幕</div>
      </div>
    </div>
  );
}

// Main: local models missing
function MainModelsMissing({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome right={<><span className="chip warn" style={{fontSize:10}}>本地转写未准备</span><span className="chip muted" style={{fontSize:10, marginLeft:4}}>翻译未准备</span></>}/>
      <div className="grow center col gap-12 pad-16">
        <div className="b pad-14 col gap-8" style={{width:'86%', borderColor:'var(--warn)', background:'var(--warn-soft)'}}>
          <div className="h0">还不能生成字幕</div>
          <div className="t-sm">缺少默认 ASR 模型。下载完成后即可使用本地转写。</div>
          <CheckItem label="ASR 模型" detail="whisper-small 未安装" status="missing"/>
          <CheckItem label="翻译模型" detail="可稍后下载" status="skip"/>
          <div className="row gap-8">
            <div className="btn primary">下载默认模型</div>
            <div className="btn ghost">打开模型管理</div>
          </div>
        </div>
        <div className="b-dash center col gap-8 pad-16" style={{width:'86%', minHeight:110, background:'var(--paper-2)', opacity:.75}}>
          <div style={{fontSize:24, opacity:.45}}>⬇</div>
          <div className="t-sm">仍然可以先拖入视频，任务会等待模型准备完成。</div>
        </div>
      </div>
    </div>
  );
}

// Main: output conflict prompt
function OutputConflictDialog({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome right={<span className="chip warn" style={{fontSize:10}}>需要确认</span>}/>
      <div className="grow col pad-14 gap-10" style={{overflow:'auto'}}>
        <div className="h1">已添加 3 个文件</div>
        <div className="b pad-10 col gap-6" style={{opacity:.55}}>
          <div className="t">sample-meeting.mp4</div>
          <div className="t-xs">输出：sample-meeting.srt</div>
        </div>
        <div className="grow center">
          <div className="b pad-14 col gap-10" style={{width:360, background:'var(--paper)', boxShadow:'0 12px 24px rgba(31,29,26,.16)'}}>
            <div className="row between mid">
              <div className="h1">字幕文件已存在</div>
              <span style={{fontSize:16, color:'var(--warn)'}}>!</span>
            </div>
            <div className="t-sm">目标位置已有同名文件：</div>
            <div className="input mono" style={{fontSize:10, padding:'6px 8px'}}>sample-meeting.srt</div>
            <div className="t-xs">请选择如何处理。这个选择可以应用到本次批量任务。</div>
            <div className="row gap-6" style={{flexWrap:'wrap'}}>
              <div className="btn sm primary">覆盖</div>
              <div className="btn sm">跳过</div>
              <div className="btn sm">另存为</div>
              <div className="btn sm ghost">取消生成</div>
            </div>
            <div className="row mid gap-6"><span className="check"></span><span className="t-xs">应用到全部冲突文件</span></div>
          </div>
        </div>
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

// Secondary tool: translate existing SRT
function ToolTranslateSRT({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome title="翻译字幕"/>
      <div className="grow col pad-14 gap-10" style={{overflow:'auto'}}>
        <div className="row between mid">
          <div className="col">
            <div className="h1">翻译已有 SRT</div>
            <div className="t-xs">独立子功能：不影响一键生成主流程。</div>
          </div>
          <div className="btn sm ghost">返回主界面</div>
        </div>

        <div className="b-dash center col gap-8 pad-16" style={{background:'var(--paper-2)', minHeight:92}}>
          <div style={{fontSize:22, opacity:.5}}>SRT</div>
          <div className="h2">拖入 .srt 文件</div>
          <div className="row gap-8"><div className="btn">选择 SRT</div><div className="btn ghost">粘贴字幕文本</div></div>
        </div>

        <div className="b pad-12 col gap-8">
          <div className="h3">翻译设置</div>
          <div className="row gap-8" style={{flexWrap:'wrap'}}>
            <div className="col gap-2" style={{width:130}}><div className="t-xs">源语言</div><div className="input" style={{padding:'4px 8px', fontSize:11}}>自动识别 ▾</div></div>
            <div className="col gap-2" style={{width:130}}><div className="t-xs">目标语言</div><div className="input" style={{padding:'4px 8px', fontSize:11}}>简体中文 ▾</div></div>
            <div className="col gap-2"><div className="t-xs">输出模式</div><div className="seg"><div className="on">替换</div><div>双语</div></div></div>
            <div className="col gap-2"><div className="t-xs">双语顺序</div><div className="seg"><div className="on">原文在前</div><div>译文在前</div></div></div>
          </div>
          <div className="row between mid"><span className="t-sm">翻译方式</span><div className="seg"><div className="on">本地</div><div>网页</div><div>API</div></div></div>
          <div className="row between mid"><span className="t-sm">Provider</span><div className="input" style={{width:190, padding:'4px 8px', fontSize:11}}>local-nllb-ct2 ▾</div></div>
          <div className="row between mid"><span className="t-sm">断点续翻</span><div className="tog on"><i/></div></div>
        </div>

        <div className="b pad-10 col gap-6" style={{background:'var(--paper-2)'}}>
          <div className="row between mid"><span className="t">course-part-2.srt</span><span className="chip ok">120 cues</span></div>
          <div className="bar accent"><i style={{width:'42%'}}/></div>
          <div className="row between t-xs"><span>已翻译 50 / 120</span><span>失败行会保留原文并写 .errors.json</span></div>
        </div>
      </div>
      <div className="row between mid pad-14 shrink-0" style={{borderTop:'1.5px solid var(--ink)', background:'var(--paper-2)'}}>
        <div className="btn ghost">查看错误记录</div>
        <div className="btn primary">开始翻译</div>
      </div>
    </div>
  );
}

// Secondary tool: burn subtitles into video
function ToolBurnIn({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome title="字幕烧录"/>
      <div className="grow col pad-14 gap-10" style={{overflow:'auto'}}>
        <div className="row between mid">
          <div className="col">
            <div className="h1">烧录字幕到视频</div>
            <div className="t-xs">独立子功能：输出带硬字幕的视频文件。</div>
          </div>
          <div className="btn sm ghost">返回主界面</div>
        </div>

        <div className="row gap-10">
          <div className="b-dash center col gap-8 pad-12 grow" style={{background:'var(--paper-2)', minHeight:110}}>
            <div className="h2">选择视频</div>
            <div className="t-xs">meeting.mp4</div>
            <div className="btn sm">更换</div>
          </div>
          <div className="b-dash center col gap-8 pad-12 grow" style={{background:'var(--paper-2)', minHeight:110}}>
            <div className="h2">选择字幕</div>
            <div className="t-xs">meeting.zh.srt</div>
            <div className="btn sm">更换</div>
          </div>
        </div>

        <div className="b pad-12 col gap-8">
          <div className="h3">样式</div>
          <div className="row between mid"><span className="t-sm">字体</span><div className="input" style={{width:180, padding:'4px 8px', fontSize:11}}>自动 CJK 字体 ▾</div></div>
          <div className="row between mid"><span className="t-sm">字号</span><div className="seg"><div>小</div><div className="on">中</div><div>大</div></div></div>
          <div className="row between mid"><span className="t-sm">编码 preset</span><div className="seg"><div>快速</div><div className="on">均衡</div><div>质量</div></div></div>
          <div className="row between mid"><span className="t-sm">输出文件</span><div className="input mono" style={{width:210, padding:'4px 8px', fontSize:10}}>meeting.subtitled.mp4</div></div>
        </div>

        <div className="b pad-10 col gap-6" style={{background:'var(--paper-2)'}}>
          <div className="row between mid"><span className="t">正在烧录</span><span className="t">36%</span></div>
          <div className="bar accent"><i style={{width:'36%'}}/></div>
          <div className="t-xs">FFmpeg 正在重新编码视频。完成后可打开输出文件夹。</div>
        </div>
      </div>
      <div className="row between mid pad-14 shrink-0" style={{borderTop:'1.5px solid var(--ink)', background:'var(--paper-2)'}}>
        <div className="btn ghost">取消</div>
        <div className="btn primary">开始烧录</div>
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

// Queue: failed job detail
function QueueFailedDetail({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome title="失败任务详情" back={true}/>
      <div className="row between mid pad-12" style={{borderBottom:'1.2px solid var(--ink)', background:'var(--paper-2)'}}>
        <div className="col">
          <div className="h1">raw-cam.mov</div>
          <div className="t-xs">今天 12:58 · 生成失败</div>
        </div>
        <div className="row gap-6">
          <StatusPill status="failed"/>
          <div className="btn sm primary">重试</div>
        </div>
      </div>
      <div className="tabs px-12">
        <div className="on">问题</div>
        <div>日志</div>
        <div>配置</div>
      </div>
      <div className="grow pad-14 col gap-10" style={{overflow:'auto'}}>
        <div className="b pad-12 col gap-8" style={{borderColor:'var(--warn)', background:'var(--warn-soft)'}}>
          <div className="h2">音频轨无法提取</div>
          <div className="t-sm">Fast Sub 没有在这个视频里找到可用音频轨，或 FFmpeg 无法读取该轨道。</div>
          <div className="hr-dash" style={{borderColor:'var(--warn)'}}/>
          <div className="col gap-4">
            <div className="t-sm" style={{fontWeight:700}}>建议操作</div>
            <div className="row mid gap-6"><span className="t-xs">·</span><span className="t-sm">用播放器确认视频是否有声音</span></div>
            <div className="row mid gap-6"><span className="t-xs">·</span><span className="t-sm">尝试重新封装视频后再导入</span></div>
            <div className="row mid gap-6"><span className="t-xs">·</span><span className="t-sm">查看诊断日志确认 FFmpeg 错误</span></div>
          </div>
        </div>

        <div className="b pad-10 col gap-4">
          <div className="h3">结构化错误</div>
          <div className="row between"><span className="t-sm">code</span><span className="mono-sm">media_extract_failed</span></div>
          <div className="row between"><span className="t-sm">stage</span><span className="mono-sm">extracting_audio</span></div>
          <div className="row between"><span className="t-sm">retryable</span><span className="mono-sm">true</span></div>
        </div>

        <div className="row gap-8">
          <div className="btn sm primary">重试任务</div>
          <div className="btn sm ghost">移除记录</div>
          <div className="btn sm ghost">打开诊断</div>
        </div>
      </div>
    </div>
  );
}

window.MainEmpty = MainEmpty;
window.MainFiles = MainFiles;
window.MainAdvancedSettings = MainAdvancedSettings;
window.MainModelsMissing = MainModelsMissing;
window.OutputConflictDialog = OutputConflictDialog;
window.MainGenerating = MainGenerating;
window.MainDone2 = MainDone2;
window.QueueList = QueueList;
window.QueueDetail = QueueDetail;
window.QueueFailedDetail = QueueFailedDetail;
window.ToolTranslateSRT = ToolTranslateSRT;
window.ToolBurnIn = ToolBurnIn;
