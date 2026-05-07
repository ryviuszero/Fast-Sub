// v2/settings.jsx — Settings sub-pages (sidebar variant B style)

// General settings
function SettGeneral({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome title="设置"/>
      <div className="grow row" style={{overflow:'hidden'}}>
        <SidebarSettings active="general"/>
        <div className="col grow pad-14 gap-10" style={{overflow:'auto'}}>
          <div className="h1">通用</div>

          <div className="col gap-6">
            <div className="h3">界面</div>
            <div className="row between mid"><span className="t">语言</span><div className="seg"><div className="on">跟随系统</div><div>简体中文</div><div>English</div></div></div>
          </div>

          <div className="col gap-6">
            <div className="h3">默认参数</div>
            <div className="row between mid"><span className="t">输出内容</span><div className="seg"><div className="on">原字幕</div><div>翻译字幕</div><div>双语字幕</div><div>烧录视频</div></div></div>
            <div className="row between mid"><span className="t">字幕语言</span><div className="input" style={{width:180, padding:'4px 8px', fontSize:11}}>自动识别 ▾</div></div>
            <div className="row between mid"><span className="t">输出格式</span><div className="seg"><div className="on">SRT</div><div>VTT</div><div>TXT</div><div>JSON</div></div></div>
            <div className="row between mid"><span className="t">输出位置</span><div className="input mono" style={{width:200, padding:'4px 8px', fontSize:10}}>与源视频相同 ▾</div></div>
            <div className="row between mid"><span className="t">文件已存在时</span><div className="seg"><div className="on">询问</div><div>覆盖</div><div>跳过</div></div></div>
          </div>

          <div className="col gap-6">
            <div className="h3">转写</div>
            <div className="row between mid"><span className="t">默认转写方式</span><div className="seg"><div className="on">本地</div><div>远程</div></div></div>
            <div className="row between mid"><span className="t">ASR 模型</span><div className="input" style={{width:180, padding:'4px 8px', fontSize:11}}>whisper-small ▾</div></div>
            <div className="row between mid"><span className="t">设备</span><div className="seg"><div className="on">自动</div><div>CPU</div><div>GPU</div></div></div>
            <div className="row between mid"><span className="t">词级时间戳</span><div className="tog"><i/></div></div>
          </div>

          <div className="col gap-6">
            <div className="h3">翻译</div>
            <div className="row between mid"><span className="t">默认翻译方式</span><div className="seg"><div className="on">本地</div><div>远程</div></div></div>
            <div className="row between mid"><span className="t">翻译模型</span><div className="input" style={{width:180, padding:'4px 8px', fontSize:11}}>通用翻译模型 ▾</div></div>
            <div className="row between mid"><span className="t">完成后自动</span><div className="seg"><div>不操作</div><div className="on">显示文件</div><div>打开</div></div></div>
          </div>

          <div className="col gap-6">
            <div className="h3">高级</div>
            <div className="row between mid"><span className="t">保留临时文件</span><div className="tog"><i/></div></div>
            <div className="row between mid"><span className="t">同时运行任务数</span><div className="seg"><div className="on">1</div><div>2</div><div>4</div></div></div>
          </div>

          <div className="col gap-6">
            <div className="h3">配置来源</div>
            <div className="row between mid"><span className="t">当前设置</span><div className="chip ok">已同步到配置文件</div></div>
            <div className="row between mid"><span className="t">配置文件</span><div className="mono-sm">fast-sub-go.toml · 自动同步</div></div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Model management
function SettModels({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome title="设置"/>
      <div className="grow row" style={{overflow:'hidden'}}>
        <SidebarSettings active="models"/>
        <div className="col grow pad-14 gap-10" style={{overflow:'auto'}}>
          <div className="row between mid">
            <div className="h1">模型管理</div>
            <div className="t-xs">存储路径：<span className="mono">~/.fastsub/models</span> · 5.0 GB <span className="underline-wavy" style={{marginLeft:4}}>修改</span></div>
          </div>

          <div className="col gap-6">
            <div className="h3">语音识别 (ASR)</div>
            <div className="b pad-10 row between mid" style={{borderColor:'var(--accent)', background:'var(--accent-soft)'}}>
              <div className="col"><div className="t" style={{fontWeight:700}}>whisper-small</div><div className="t-xs">466 MB · 当前默认</div></div>
              <div className="row gap-6"><div className="chip ok">可用</div><div className="btn sm ghost">验证</div></div>
            </div>
            <div className="b pad-10 row between mid">
              <div className="col"><div className="t" style={{fontWeight:700}}>whisper-tiny</div><div className="t-xs">75 MB</div></div>
              <div className="row gap-6"><div className="chip ok">可用</div><div className="btn sm ghost">删除</div></div>
            </div>
            <div className="b-dash pad-10 row between mid">
              <div className="col"><div className="t" style={{fontWeight:700}}>whisper-medium</div><div className="t-xs">1.5 GB · 更高质量</div></div>
              <div className="btn sm">下载</div>
            </div>
            <div className="b-dash pad-10 row between mid">
              <div className="col"><div className="t" style={{fontWeight:700}}>whisper-large-v3</div><div className="t-xs">3.0 GB · 最高质量</div></div>
              <div className="btn sm">下载</div>
            </div>
          </div>

          <div className="col gap-6">
            <div className="h3">翻译模型</div>
            <div className="b pad-10 row between mid" style={{borderColor:'var(--accent)', background:'var(--accent-soft)'}}>
              <div className="col"><div className="t" style={{fontWeight:700}}>通用翻译模型</div><div className="t-xs">820 MB · 中英互译 · 当前默认</div></div>
              <div className="row gap-6"><div className="chip ok">可用</div><div className="btn sm ghost">验证</div></div>
            </div>
            <div className="b-dash pad-10 row between mid" style={{opacity:.6}}>
              <div className="col"><div className="t">更多翻译模型即将推出</div></div>
            </div>
          </div>

          <div className="hr-dash"/>
          <div className="row gap-8">
            <div className="btn sm ghost">清理临时文件 (120 MB)</div>
            <div className="btn sm ghost">打开模型目录</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Model maintenance states
function SettModelMaintenance({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome title="设置"/>
      <div className="grow row" style={{overflow:'hidden'}}>
        <SidebarSettings active="models"/>
        <div className="col grow pad-14 gap-10" style={{overflow:'auto'}}>
          <div className="row between mid">
            <div className="h1">模型维护</div>
            <div className="chip warn" style={{fontSize:10}}>需要处理</div>
          </div>

          <div className="b pad-10 col gap-6" style={{borderColor:'var(--warn)', background:'var(--warn-soft)'}}>
            <div className="row between mid">
              <div className="col"><div className="t" style={{fontWeight:700}}>whisper-medium</div><div className="t-xs">安装未完成</div></div>
              <StatusPill status="install-fail"/>
            </div>
            <div className="t-sm">模型没有装好。细节已写入日志，用户只需要重新安装。</div>
            <div className="row gap-6">
              <div className="btn sm primary">一键重新安装</div>
              <div className="btn sm ghost">查看日志</div>
            </div>
          </div>

          <div className="b pad-10 col gap-6">
            <div className="row between mid">
              <div className="col"><div className="t" style={{fontWeight:700}}>删除确认</div><div className="t-xs">whisper-tiny · 75 MB</div></div>
              <div className="chip muted">未使用</div>
            </div>
            <div className="t-sm">删除后，如果之后选择该模型，需要重新下载。</div>
            <div className="row gap-6">
              <div className="btn sm ghost" style={{color:'var(--warn)'}}>确认删除</div>
              <div className="btn sm">取消</div>
            </div>
          </div>

          <div className="b-dash pad-10 col gap-6" style={{background:'var(--paper-2)'}}>
            <div className="h3">存储空间</div>
            <div className="row between"><span className="t-sm">已安装模型</span><span className="t">5.0 GB</span></div>
            <div className="row between"><span className="t-sm">可清理缓存</span><span className="t">620 MB</span></div>
            <div className="row between"><span className="t-sm">模型目录</span><span className="mono-sm">~/.fastsub/models</span></div>
            <div className="row gap-6">
              <div className="btn sm">清理未使用模型</div>
              <div className="btn sm ghost">更换目录</div>
              <div className="btn sm ghost">重建索引</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// API Services
function SettAPI({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome title="设置"/>
      <div className="grow row" style={{overflow:'hidden'}}>
        <SidebarSettings active="api"/>
        <div className="col grow pad-14 gap-10" style={{overflow:'auto'}}>
          <div className="h1">API 服务</div>
          <div className="t-sm">配置需要联网的转写 / 翻译服务。</div>

          <div className="b-dash pad-10 t-xs" style={{background:'var(--warn-soft)', borderColor:'var(--warn)', lineHeight:1.6}}>
            使用 API 服务时，音频或字幕文本可能会上传到对应服务商。本地模式不会上传文件。
          </div>

          <div className="col gap-6">
            <div className="h3">总开关</div>
            <div className="row between mid"><span className="t">启用 API 服务</span><div className="tog"><i/></div></div>
            <div className="t-xs">关闭时，所有 API 选项不可见，仅使用本地模型。</div>
          </div>

          <div className="col gap-6">
            <div className="h3">API Keys</div>
            <div className="row between mid">
              <div className="col"><div className="t">OpenAI</div><div className="t-xs">用于 whisper-1 转写</div></div>
              <div className="row gap-6">
                <div className="input mono" style={{width:160, padding:'4px 8px', fontSize:10}}>sk-••••••••••••</div>
                <div className="btn sm ghost">测试</div>
              </div>
            </div>
            <div className="hr-dash"/>
            <div className="row between mid">
              <div className="col"><div className="t">其他 Provider</div><div className="t-xs">可选 · 未配置</div></div>
              <div className="row gap-6">
                <div className="input" style={{width:160, padding:'4px 8px', fontSize:10}}><span style={{color:'var(--ink-3)'}}>未设置</span></div>
                <div className="btn sm ghost">添加</div>
              </div>
            </div>
          </div>

          <div className="col gap-6">
            <div className="h3">OpenAI-compatible 配置</div>
            <div className="row between mid"><span className="t">API key 来源</span><div className="input mono" style={{width:180, padding:'4px 8px', fontSize:10}}>OPENAI_API_KEY ▾</div></div>
            <div className="row between mid"><span className="t">Base URL</span><div className="input mono" style={{width:220, padding:'4px 8px', fontSize:10}}>https://api.openai.com/v1</div></div>
            <div className="row between mid"><span className="t">上传格式</span><div className="seg"><div className="on">auto</div><div>m4a</div><div>mp3</div><div>wav</div></div></div>
            <div className="row between mid"><span className="t">词级时间戳</span><div className="seg"><div className="on">自动</div><div>开启</div><div>关闭</div></div></div>
            <div className="t-xs">模型必须显式选择；API key 只保存环境变量名，不保存原始 key。</div>
          </div>

          <div className="col gap-6">
            <div className="h3">默认 API 服务</div>
            <div className="row between mid"><span className="t">API 转写服务</span><div className="input" style={{width:180, padding:'4px 8px', fontSize:11}}>api-openai-transcription ▾</div></div>
            <div className="row between mid"><span className="t">API 翻译服务</span><div className="input" style={{width:180, padding:'4px 8px', fontSize:11}}>未配置 ▾</div></div>
          </div>

          <div className="col gap-6">
            <div className="h3">安全</div>
            <div className="row between mid"><span className="t">上传前确认</span><div className="tog on"><i/></div></div>
            <div className="t-xs">每次使用 API 服务前弹窗确认，避免意外上传。</div>
            <div className="hr-dash"/>
            <div className="row between mid"><span className="t">费用 / 用量提示</span><div className="tog on"><i/></div></div>
            <div className="t-xs">使用付费 API 前提醒可能产生费用。</div>
          </div>

          <div className="hr-dash"/>
          <div className="col gap-6">
            <div className="h3">连接测试</div>
            <div className="row gap-8 mid">
              <div className="btn sm">静态检查</div>
              <div className="btn sm ghost">Live 测试</div>
              <span className="t-xs">上次测试：未执行</span>
            </div>
            <div className="t-xs">静态检查不联网；Live 测试会联网但不上传用户媒体。</div>
          </div>

          <div className="hr-dash"/>
          <div className="row gap-8">
            <div className="btn sm ghost" style={{color:'var(--warn)'}}>清除所有已保存凭据</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// API upload confirmation
function SettAPIUploadConfirm({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome title="API 服务"/>
      <div className="grow center pad-16">
        <div className="b pad-16 col gap-10" style={{width:430, background:'var(--paper)', boxShadow:'0 12px 24px rgba(31,29,26,.16)'}}>
          <div className="row between mid">
            <div className="h1">确认使用 API 服务</div>
            <span style={{fontSize:16, color:'var(--warn)'}}>!</span>
          </div>
          <div className="b-dash pad-10 t-sm" style={{background:'var(--warn-soft)', borderColor:'var(--warn)', lineHeight:1.6}}>
            这次任务会把音频上传到 OpenAI API 进行转写。本地模式不会上传文件。
          </div>
          <div className="col gap-6">
            <div className="row between"><span className="t-sm">上传内容</span><span className="t">sample-meeting.mp4 的音频</span></div>
            <div className="row between"><span className="t-sm">服务商</span><span className="t">OpenAI</span></div>
            <div className="row between"><span className="t-sm">API key</span><span className="mono-sm">sk-••••••••••••</span></div>
            <div className="row between"><span className="t-sm">费用提示</span><span className="t">可能产生 API 费用</span></div>
          </div>
          <div className="row mid gap-6"><span className="check on">✓</span><span className="t-xs">本次任务完成前不再提醒</span></div>
          <div className="row gap-8" style={{justifyContent:'flex-end'}}>
            <div className="btn ghost">取消</div>
            <div className="btn primary">确认并继续</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Provider management
function SettProviders({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome title="设置"/>
      <div className="grow row" style={{overflow:'hidden'}}>
        <SidebarSettings active="providers"/>
        <div className="col grow pad-14 gap-8" style={{overflow:'auto'}}>
          <div className="row between mid">
            <div className="h1">Provider 管理</div>
            <div className="btn sm ghost">刷新状态</div>
          </div>
          <div className="t-xs">这里展示可用性和隐私边界。测试默认只做静态检查，不联网、不上传。</div>

          <div className="col gap-6">
            <div className="h3">语音转写 STT</div>
            <div className="b pad-10 col gap-4" style={{borderColor:'var(--ok)', background:'var(--ok-soft)'}}>
              <div className="row between mid"><div className="col"><div className="t" style={{fontWeight:700}}>local-faster-whisper</div><div className="t-xs">本地 · 离线 · 支持批量 · 支持词级时间戳</div></div><StatusPill status="ready"/></div>
              <div className="row between"><span className="t-xs">隐私</span><span className="t-xs">音频留在本机</span></div>
            </div>
            <div className="b pad-10 col gap-4">
              <div className="row between mid"><div className="col"><div className="t" style={{fontWeight:700}}>local-whisper-cpp</div><div className="t-xs">本地 native · 需要 binary 和模型</div></div><span className="chip warn">missing_model</span></div>
              <div className="row gap-6"><div className="btn sm">安装模型</div><div className="btn sm ghost">静态检查</div></div>
            </div>
            <div className="b pad-10 col gap-4">
              <div className="row between mid"><div className="col"><div className="t" style={{fontWeight:700}}>api-openai-transcription</div><div className="t-xs">API · 需要显式模型和 API key</div></div><span className="chip warn">missing_api_key</span></div>
              <div className="row between"><span className="t-xs">隐私</span><span className="t-xs">会上传音频</span></div>
            </div>
          </div>

          <div className="col gap-6">
            <div className="h3">字幕翻译</div>
            <div className="b pad-10 row between mid" style={{borderColor:'var(--ok)', background:'var(--ok-soft)'}}>
              <div className="col"><div className="t" style={{fontWeight:700}}>local-nllb-ct2</div><div className="t-xs">本地 · 中英互译 · 需要翻译模型</div></div>
              <StatusPill status="ready"/>
            </div>
            <div className="b pad-10 row between mid">
              <div className="col"><div className="t" style={{fontWeight:700}}>web-bing / web-google</div><div className="t-xs">网页翻译 · 会发送字幕文本 · 可能限流</div></div>
              <span className="chip muted">disabled</span>
            </div>
            <div className="b pad-10 row between mid">
              <div className="col"><div className="t" style={{fontWeight:700}}>api-openai-chat</div><div className="t-xs">API 翻译 · 需要 key 和显式 model</div></div>
              <span className="chip warn">missing_api_key</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Diagnostics
function SettDiag({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome title="设置"/>
      <div className="grow row" style={{overflow:'hidden'}}>
        <SidebarSettings active="diag"/>
        <div className="col grow pad-14 gap-8" style={{overflow:'auto'}}>
          <div className="row between mid">
            <div className="h1">诊断</div>
            <div className="chip accent" style={{fontSize:10}}>开发者信息</div>
          </div>
          <div className="t-xs">此页面仅用于排障。普通使用不需要关注这些内容。</div>

          <div className="b pad-10 col gap-4" style={{background:'var(--paper-2)'}}>
            <div className="h3">daemon 状态</div>
            <div className="row between"><span className="t-sm">状态</span><span className="chip ok" style={{fontSize:9}}>运行中</span></div>
            <div className="row between"><span className="t-sm">base_url</span><span className="mono-sm">http://127.0.0.1:49231</span></div>
            <div className="row between"><span className="t-sm">token</span><span className="mono-sm">•••••••••••• (已脱敏)</span></div>
            <div className="row between"><span className="t-sm">PID</span><span className="mono-sm">12345</span></div>
            <div className="row between"><span className="t-sm">schema_version</span><span className="mono-sm">1</span></div>
          </div>

          <div className="b pad-10 col gap-4">
            <div className="h3">Provider 状态</div>
            <div className="row between"><span className="t-sm">local-faster-whisper</span><span className="chip ok" style={{fontSize:9}}>available</span></div>
            <div className="row between"><span className="t-sm">local-whisper-cpp</span><span className="chip" style={{fontSize:9, borderColor:'var(--warn)', color:'var(--warn)'}}>missing_model</span></div>
            <div className="row between"><span className="t-sm">api-openai</span><span className="chip" style={{fontSize:9, borderColor:'var(--warn)', color:'var(--warn)'}}>missing_api_key</span></div>
          </div>

          <div className="b pad-10 col gap-4">
            <div className="row between mid"><div className="h3">最近日志</div><div className="btn sm ghost">刷新</div></div>
            <div style={{background:'#1f1d1a', borderRadius:4, padding:6, maxHeight:100, overflow:'auto'}}>
              <div className="log-line" style={{color:'#8ca88c'}}>[12:43:01] health ok</div>
              <div className="log-line" style={{color:'#a8b8c8'}}>[12:43:04] job_a4f29c progress=62 stage=transcribing</div>
              <div className="log-line" style={{color:'#a8b8c8'}}>[12:43:07] sse event id=14</div>
              <div className="log-line" style={{color:'#a8b8c8'}}>[12:43:10] heartbeat</div>
            </div>
          </div>

          <div className="row gap-6">
            <div className="btn sm ghost">复制诊断信息</div>
            <div className="btn sm ghost">重启 daemon</div>
            <div className="btn sm ghost">导出日志</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Daemon recovery: user-facing simple action
function SettDaemonRecovery({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome title="服务修复"/>
      <div className="grow center pad-16">
        <div className="b pad-16 col gap-10" style={{width:430, borderColor:'var(--warn)', background:'var(--warn-soft)'}}>
          <div className="h1">Fast Sub 服务暂时不可用</div>
          <div className="t-sm">不用处理技术细节。点击下面的按钮，App 会自动重启本地服务并恢复任务状态。</div>
          <div className="b pad-10 col gap-4" style={{background:'var(--paper)'}}>
            <div className="row between"><span className="t-sm">当前状态</span><span className="chip warn">连接中断</span></div>
            <div className="row between"><span className="t-sm">正在运行任务</span><span className="t-sm">会尝试重新同步</span></div>
          </div>
          <div className="row gap-8" style={{justifyContent:'flex-end'}}>
            <div className="btn ghost">稍后再试</div>
            <div className="btn primary">一键修复</div>
          </div>
          <details>
            <summary className="t-xs" style={{cursor:'pointer'}}>查看技术日志</summary>
            <div style={{background:'#1f1d1a', borderRadius:4, padding:6, marginTop:6}}>
              <div className="log-line" style={{color:'#a8b8c8'}}>[12:50:02] daemon disconnected</div>
              <div className="log-line" style={{color:'#a8b8c8'}}>[12:50:03] events_lost -> REST resync required</div>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}

// Structured diagnostics detail
function SettDiagStructured({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome title="诊断详情"/>
      <div className="grow row" style={{overflow:'hidden'}}>
        <SidebarSettings active="diag"/>
        <div className="col grow pad-14 gap-8" style={{overflow:'auto'}}>
          <div className="row between mid">
            <div className="h1">结构化诊断</div>
            <div className="btn sm ghost">导出脱敏诊断包</div>
          </div>

          <div className="b pad-10 col gap-4">
            <div className="h3">当前 Job</div>
            <div className="row between"><span className="t-sm">job_id</span><span className="mono-sm">job_a4f29c</span></div>
            <div className="row between"><span className="t-sm">status</span><span className="mono-sm">running</span></div>
            <div className="row between"><span className="t-sm">stage</span><span className="mono-sm">transcribing</span></div>
            <div className="row between"><span className="t-sm">progress</span><span className="mono-sm">62%</span></div>
          </div>

          <div className="b pad-10 col gap-4">
            <div className="h3">Model verify</div>
            <div className="row between"><span className="t-sm">whisper-small</span><span className="chip ok" style={{fontSize:9}}>verified</span></div>
            <div className="row between"><span className="t-sm">translation-general</span><span className="chip ok" style={{fontSize:9}}>verified</span></div>
            <div className="row between"><span className="t-sm">whisper-medium</span><span className="chip warn" style={{fontSize:9}}>checksum_failed</span></div>
          </div>

          <div className="b pad-10 col gap-4">
            <div className="h3">最近 SSE events</div>
            <div className="row between"><span className="mono-sm">id=12 progress</span><span className="mono-sm">transcribing 55%</span></div>
            <div className="row between"><span className="mono-sm">id=13 progress</span><span className="mono-sm">transcribing 62%</span></div>
            <div className="row between"><span className="mono-sm">id=14 heartbeat</span><span className="mono-sm">ok</span></div>
          </div>

          <div className="b pad-10 col gap-4" style={{borderColor:'var(--warn)', background:'var(--warn-soft)'}}>
            <div className="h3">Structured error example</div>
            <div className="row between"><span className="t-sm">code</span><span className="mono-sm">media_extract_failed</span></div>
            <div className="row between"><span className="t-sm">message</span><span className="t-sm">音频轨无法提取</span></div>
            <div className="row between"><span className="t-sm">action_hint</span><span className="t-sm">检查源视频音频轨</span></div>
          </div>

          <div className="t-xs">token、API key、Authorization header、signed URL credential 已脱敏。</div>
        </div>
      </div>
    </div>
  );
}

// Config mapping
function SettConfigMapping({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome title="设置"/>
      <div className="grow row" style={{overflow:'hidden'}}>
        <SidebarSettings active="general"/>
        <div className="col grow pad-14 gap-10" style={{overflow:'auto'}}>
          <div className="h1">配置映射</div>
          <div className="t-sm">用户在设置页修改配置；底层同步写入 Fast Sub 配置文件，敏感值仅保存引用。</div>

          <div className="b pad-10 col gap-6">
            <div className="h3">默认生成</div>
            <div className="row between"><span className="t-sm">输出内容</span><span className="mono-sm">settings.default_output_kind = source_subtitle</span></div>
            <div className="row between"><span className="t-sm">输出位置</span><span className="mono-sm">paths.output = beside_source</span></div>
            <div className="row between"><span className="t-sm">冲突策略</span><span className="mono-sm">output.conflict = ask</span></div>
          </div>

          <div className="b pad-10 col gap-6">
            <div className="h3">模型与 Provider</div>
            <div className="row between"><span className="t-sm">ASR 模型</span><span className="mono-sm">models.asr_default = whisper-small</span></div>
            <div className="row between"><span className="t-sm">翻译模型</span><span className="mono-sm">models.translate_default = nllb...</span></div>
            <div className="row between"><span className="t-sm">API key</span><span className="mono-sm">api_key_env = OPENAI_API_KEY</span></div>
          </div>

          <div className="row gap-8">
            <div className="btn sm ghost">导入配置</div>
            <div className="btn sm ghost">导出配置</div>
            <div className="btn sm ghost" style={{color:'var(--warn)'}}>恢复默认</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Benchmark planning placeholder
function SettBenchmarkPlan({clean}) {
  return (
    <div className={"wf "+(clean?"clean":"")}>
      <V2Chrome title="设置"/>
      <div className="grow row" style={{overflow:'hidden'}}>
        <SidebarSettings active="benchmark"/>
        <div className="col grow pad-14 gap-10" style={{overflow:'auto'}}>
          <div className="row between mid">
            <div className="h1">Benchmark</div>
            <span className="chip muted">第一版暂不实现</span>
          </div>
          <div className="t-sm">先保留规划入口，后续用于本机性能、转写质量和翻译质量评估。</div>

          <div className="b-dash pad-12 col gap-6" style={{background:'var(--paper-2)'}}>
            <div className="h3">后续可能包含</div>
            <div className="row between"><span className="t-sm">转写性能</span><span className="t-xs">RTFx · elapsed · worker elapsed</span></div>
            <div className="row between"><span className="t-sm">转写质量</span><span className="t-xs">WER / CER · 字幕健康度</span></div>
            <div className="row between"><span className="t-sm">翻译质量</span><span className="t-xs">BLEU · chrF · exact match</span></div>
            <div className="row between"><span className="t-sm">报告</span><span className="t-xs">JSON / Markdown · 不含本机敏感路径</span></div>
          </div>

          <div className="b pad-10 col gap-4">
            <div className="h3">当前建议</div>
            <div className="t-sm">第一版桌面 UI 不放 Benchmark 主入口。需要时从诊断/高级页面进入，避免普通用户被测试指标打扰。</div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.SettGeneral = SettGeneral;
window.SettModels = SettModels;
window.SettModelMaintenance = SettModelMaintenance;
window.SettAPI = SettAPI;
window.SettAPIUploadConfirm = SettAPIUploadConfirm;
window.SettProviders = SettProviders;
window.SettDiag = SettDiag;
window.SettDaemonRecovery = SettDaemonRecovery;
window.SettDiagStructured = SettDiagStructured;
window.SettConfigMapping = SettConfigMapping;
window.SettBenchmarkPlan = SettBenchmarkPlan;
