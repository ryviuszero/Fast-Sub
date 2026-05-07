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
              <div className="btn sm">测试所有 API 连接</div>
              <span className="t-xs">上次测试：未执行</span>
            </div>
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

window.SettGeneral = SettGeneral;
window.SettModels = SettModels;
window.SettAPI = SettAPI;
window.SettDiag = SettDiag;
