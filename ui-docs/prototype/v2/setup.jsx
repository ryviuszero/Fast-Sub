// v2/setup.jsx — First-run setup wizard (5 steps)

// Step 1: Environment detection
function SetupCheck({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome right={<span className="t-xs">首次启动</span>}/>
      <div className="grow col pad-16 gap-10" style={{overflow:'auto'}}>
        <div className="col gap-2">
          <div className="h0">环境检查</div>
          <div className="t-sm">正在检查本机运行环境，确保一切就绪…</div>
        </div>

        <div className="b pad-12 col" style={{background:'var(--paper-2)'}}>
          <CheckItem label="本机环境" detail="macOS 14.2 · arm64 · 16 GB 内存 · 52 GB 磁盘 · Apple M2 GPU" status="ready"/>
          <div className="hr-dash"/>
          <CheckItem label="FFmpeg / FFprobe" detail="用于提取音频轨" status="checking"/>
          <div className="hr-dash"/>
          <CheckItem label="Fast Sub 服务" status="pending"/>
          <div className="hr-dash"/>
          <CheckItem label="本地 Worker" status="pending"/>
          <div className="hr-dash"/>
          <CheckItem label="模型存储目录" status="pending"/>
          <div className="hr-dash"/>
          <CheckItem label="网络连接" detail="首次需要下载模型" status="pending"/>
        </div>

        <div className="bar accent"><i style={{width:'30%'}}/></div>
        <div className="t-xs" style={{textAlign:'center'}}>正在检查 2 / 6 …</div>
      </div>
    </div>
  );
}

// Step 2: Install missing dependencies
function SetupInstall({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome right={<span className="t-xs">首次启动 · 2/5</span>}/>
      <div className="grow col pad-16 gap-10" style={{overflow:'auto'}}>
        <div className="col gap-2">
          <div className="h0">安装缺失组件</div>
          <div className="t-sm">检测到以下组件需要安装或修复。</div>
        </div>

        <div className="b pad-12 col gap-8">
          <div className="row between mid">
            <div className="col">
              <div className="h2">FFmpeg</div>
              <div className="t-xs">用于从视频中提取音频。安装后 FFprobe 也将可用。</div>
            </div>
            <StatusPill status="installing"/>
          </div>
          <div className="bar accent"><i style={{width:'72%'}}/></div>
          <div className="t-xs">正在安装 FFmpeg 7.1 … 72%</div>
        </div>

        <div className="b pad-12 col gap-6" style={{opacity:.6}}>
          <div className="row between mid">
            <div className="col">
              <div className="h2">本地 Worker 环境</div>
              <div className="t-xs">用于运行本地语音识别和翻译。</div>
            </div>
            <StatusPill status="pending"/>
          </div>
          <div className="t-xs">等待 FFmpeg 安装完成…</div>
        </div>

        <div className="b pad-12 row between mid" style={{borderColor:'var(--ok)', background:'var(--ok-soft)'}}>
          <div className="col">
            <div className="h2">模型存储目录</div>
            <div className="mono-sm">~/.fastsub/models</div>
          </div>
          <StatusPill status="ready"/>
        </div>

        <div className="row gap-8" style={{marginTop:'auto'}}>
          <div className="btn ghost">查看诊断</div>
          <div className="grow"/>
          <div className="t-xs mid" style={{color:'var(--ink-3)'}}>安装中，请稍候…</div>
        </div>
      </div>
    </div>
  );
}

// Step 2b: Install diagnostics (clicked "查看诊断")
function SetupDiagPanel({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome title="安装诊断" right={<div className="btn sm ghost">返回安装</div>}/>
      <div className="grow col pad-16 gap-10" style={{overflow:'auto'}}>
        <div className="col gap-2">
          <div className="h1">当前问题</div>
          <div className="t-sm">以下是安装过程中遇到的问题和建议操作。</div>
        </div>

        {/* Problem 1: FFmpeg install failed */}
        <div className="b pad-12 col gap-8" style={{borderColor:'var(--warn)', background:'var(--warn-soft)'}}>
          <div className="row between mid">
            <div className="row mid gap-8">
              <span style={{fontSize:16, color:'var(--warn)'}}>!</span>
              <div className="h2">FFmpeg 安装失败</div>
            </div>
            <StatusPill status="install-fail"/>
          </div>
          <div className="t-sm">无法自动安装 FFmpeg。这通常是网络或权限问题。</div>
          <div className="hr-dash" style={{borderColor:'var(--warn)'}}/>
          <div className="col gap-6">
            <div className="t-sm" style={{fontWeight:700}}>可能原因</div>
            <div className="row mid gap-6"><span className="t-xs">·</span><span className="t-sm">网络连接中断或下载超时</span></div>
            <div className="row mid gap-6"><span className="t-xs">·</span><span className="t-sm">系统权限不足，无法写入安装目录</span></div>
            <div className="row mid gap-6"><span className="t-xs">·</span><span className="t-sm">磁盘空间不足（FFmpeg 需要约 120 MB）</span></div>
          </div>
          <div className="hr-dash" style={{borderColor:'var(--warn)'}}/>
          <div className="col gap-6">
            <div className="t-sm" style={{fontWeight:700}}>建议操作</div>
            <div className="row gap-6">
              <div className="btn sm primary">重试安装</div>
              <div className="btn sm">手动安装 FFmpeg</div>
              <div className="btn sm ghost">跳过（部分功能不可用）</div>
            </div>
          </div>
          <div className="b-dash pad-8 col gap-2" style={{background:'var(--paper)', borderColor:'var(--warn)'}}>
            <div className="t-xs" style={{fontWeight:700}}>手动安装说明</div>
            <div className="t-xs">macOS: 在终端执行 <span className="mono">brew install ffmpeg</span></div>
            <div className="t-xs">Windows: 从 ffmpeg.org 下载并添加到 PATH</div>
            <div className="t-xs">Linux: <span className="mono">sudo apt install ffmpeg</span> 或对应包管理器</div>
          </div>
        </div>

        {/* Problem 2: Worker blocked by FFmpeg */}
        <div className="b pad-12 col gap-6">
          <div className="row between mid">
            <div className="row mid gap-8">
              <span style={{fontSize:16, color:'var(--ink-3)'}}>○</span>
              <div className="h2">本地 Worker 环境</div>
            </div>
            <StatusPill status="pending"/>
          </div>
          <div className="t-sm">需要先完成 FFmpeg 安装。Worker 安装将在之后自动进行。</div>
        </div>

        {/* Items that are OK */}
        <div className="b pad-12 col gap-4" style={{borderColor:'var(--ok)', background:'var(--ok-soft)'}}>
          <div className="h3">已通过</div>
          <div className="row between mid"><span className="t-sm">本机环境</span><span style={{color:'var(--ok)', fontSize:12}}>✓</span></div>
          <div className="row between mid"><span className="t-sm">模型存储目录</span><span style={{color:'var(--ok)', fontSize:12}}>✓</span></div>
          <div className="row between mid"><span className="t-sm">网络连接</span><span style={{color:'var(--ok)', fontSize:12}}>✓</span></div>
        </div>

        <details>
          <summary className="t-xs" style={{cursor:'pointer'}}>▸ 查看错误日志（开发者）</summary>
          <div className="b pad-8 col" style={{background:'#1f1d1a', borderRadius:4, marginTop:6}}>
            <div className="log-line" style={{color:'#c8a088'}}>Error: EACCES permission denied /usr/local/bin/ffmpeg</div>
            <div className="log-line" style={{color:'#a8b8c8'}}>at install.sh:42 — cp failed</div>
            <div className="log-line" style={{color:'#a8b8c8'}}>suggestion: run with elevated privileges or change install path</div>
          </div>
        </details>
      </div>
    </div>
  );
}

window.SetupDiagPanel = SetupDiagPanel;

// Step 3: Download ASR model
function SetupASR({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome right={<span className="t-xs">首次启动 · 3/5</span>}/>
      <div className="grow col pad-16 gap-10" style={{overflow:'auto'}}>
        <div className="col gap-2">
          <div className="h0">下载语音识别模型</div>
          <div className="t-sm">首次需要下载一个 ASR 模型用于本地语音转文字。</div>
        </div>

        <div className="b pad-14 col gap-8" style={{borderColor:'var(--accent)', background:'var(--accent-soft)'}}>
          <div className="row between mid">
            <div className="col">
              <div className="h1">whisper-small</div>
              <div className="t-xs">推荐 · 速度与质量平衡</div>
            </div>
            <div className="col" style={{textAlign:'right'}}>
              <div className="t" style={{fontWeight:700}}>466 MB</div>
              <div className="t-xs">预计 2-5 分钟</div>
            </div>
          </div>
          <div className="bar accent"><i style={{width:'38%'}}/></div>
          <div className="row between t-xs">
            <span>正在下载 · 177 / 466 MB</span>
            <span>38% · 预计还需 3 分钟</span>
          </div>
        </div>

        <div className="col gap-4">
          <div className="t-sm" style={{fontWeight:700}}>其他可选模型</div>
          <div className="row gap-8">
            <div className="b-dash pad-8 col gap-2 grow">
              <div className="t" style={{fontWeight:700}}>tiny</div>
              <div className="t-xs">75 MB · 最快 · 质量一般</div>
            </div>
            <div className="b-dash pad-8 col gap-2 grow">
              <div className="t" style={{fontWeight:700}}>base</div>
              <div className="t-xs">142 MB · 较快</div>
            </div>
            <div className="b-dash pad-8 col gap-2 grow">
              <div className="t" style={{fontWeight:700}}>medium</div>
              <div className="t-xs">1.5 GB · 更高质量</div>
            </div>
          </div>
          <div className="t-xs">检测到 GPU 和充足磁盘空间。如需更高质量，可稍后在模型管理中下载 large-v3 (3.0 GB)。</div>
        </div>

        <div className="row gap-8" style={{marginTop:'auto'}}>
          <div className="btn ghost">跳过下载</div>
          <div className="grow"/>
          <div className="t-xs mid" style={{color:'var(--ink-3)'}}>下载中…</div>
        </div>
      </div>
    </div>
  );
}

// Step 4: Download translation model
function SetupTranslation({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome right={<span className="t-xs">首次启动 · 4/5</span>}/>
      <div className="grow col pad-16 gap-10" style={{overflow:'auto'}}>
        <div className="col gap-2">
          <div className="h0">下载翻译模型</div>
          <div className="t-sm">可选：下载本地翻译模型，用于将字幕翻译为其他语言。</div>
        </div>

        <div className="b pad-14 col gap-8">
          <div className="row between mid">
            <div className="col">
              <div className="h1">通用翻译模型</div>
              <div className="t-xs">支持中英互译及常见语言对</div>
            </div>
            <div className="col" style={{textAlign:'right'}}>
              <div className="t" style={{fontWeight:700}}>820 MB</div>
              <div className="t-xs">预计 4-8 分钟</div>
            </div>
          </div>
          <div className="row gap-8">
            <div className="btn primary">开始下载</div>
            <div className="btn ghost">暂时跳过</div>
          </div>
          <div className="t-xs" style={{color:'var(--ink-3)'}}>跳过后，主界面会提示"翻译未准备"。可随时在模型管理中下载。</div>
        </div>

        <div className="hr-dash"/>

        <div className="col gap-4">
          <div className="h3">已完成</div>
          <CheckItem label="FFmpeg" detail="7.1" status="ready"/>
          <CheckItem label="本地 Worker" status="ready"/>
          <CheckItem label="ASR 模型" detail="whisper-small · 466 MB" status="downloaded"/>
        </div>

        <div className="row gap-8" style={{marginTop:'auto'}}>
          <div className="grow"/>
          <div className="btn ghost">稍后再说 →</div>
        </div>
      </div>
    </div>
  );
}

// Step 5: Setup complete
function SetupDone({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome/>
      <div className="grow col pad-16 gap-12" style={{overflow:'auto'}}>
        <div className="col gap-2" style={{textAlign:'center', alignItems:'center'}}>
          <div style={{width:48, height:48, borderRadius:'50%', border:'2px solid var(--ok)', background:'var(--ok-soft)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, color:'var(--ok)'}}>✓</div>
          <div className="h0" style={{marginTop:8}}>准备就绪</div>
          <div className="t-sm">环境已配置完成，可以开始使用了。</div>
        </div>

        <div className="b pad-12 col" style={{background:'var(--paper-2)'}}>
          <div className="h3" style={{marginBottom:6}}>环境总结</div>
          <CheckItem label="本地转写" detail="whisper-small · GPU 加速" status="ready"/>
          <div className="hr-dash"/>
          <CheckItem label="本地翻译" detail="通用模型 · 中英互译" status="ready"/>
          <div className="hr-dash"/>
          <CheckItem label="FFmpeg" detail="7.1" status="ready"/>
          <div className="hr-dash"/>
          <CheckItem label="远程 API" status="not-configured"/>
        </div>

        <div className="b-dash pad-10 col gap-4" style={{background:'var(--paper-2)'}}>
          <div className="t-sm" style={{fontWeight:700}}>默认配置</div>
          <div className="row gap-12">
            <div className="col"><div className="t-xs">语言</div><div className="t">自动识别</div></div>
            <div className="col"><div className="t-xs">输出</div><div className="t">SRT</div></div>
            <div className="col"><div className="t-xs">位置</div><div className="t">与源文件相同</div></div>
            <div className="col"><div className="t-xs">设备</div><div className="t">自动 (GPU)</div></div>
          </div>
          <div className="t-xs">所有默认参数可在设置中修改。</div>
        </div>

        <div className="row gap-8" style={{justifyContent:'center'}}>
          <div className="btn ghost">更改设置</div>
          <div className="btn ghost">诊断详情</div>
          <div className="btn primary" style={{padding:'10px 24px'}}>进入主界面 →</div>
        </div>
      </div>
    </div>
  );
}

window.SetupCheck = SetupCheck;
window.SetupInstall = SetupInstall;
window.SetupASR = SetupASR;
window.SetupTranslation = SetupTranslation;
window.SetupDone = SetupDone;
