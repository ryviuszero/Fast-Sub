// v2/shared.jsx — Chrome bar, status helpers, shared primitives

function V2Chrome({title='Fast Sub', left, right, back}) {
  return (
    <div className="chrome">
      <div className="dot"/><div className="dot"/><div className="dot"/>
      {back && <div className="btn sm ghost" style={{marginLeft:6, padding:'2px 6px'}}>← 返回</div>}
      <div className="title">{title}</div>
      {left && <div style={{marginLeft:8}}>{left}</div>}
      <div className="spacer"/>
      {right}
    </div>
  );
}

function StatusPill({status}) {
  const map = {
    'waiting':  {cls:'muted',  label:'等待中'},
    'running':  {cls:'accent', label:'正在生成'},
    'done':     {cls:'ok',     label:'已完成'},
    'failed':   {cls:'warn',   label:'已失败'},
    'canceled': {cls:'muted',  label:'已取消'},
    'ready':    {cls:'ok',     label:'已就绪'},
    'missing':  {cls:'warn',   label:'缺失'},
    'installing':{cls:'accent',label:'正在安装'},
    'install-fail':{cls:'warn',label:'安装失败'},
    'skip':     {cls:'muted',  label:'可跳过'},
    'checking': {cls:'accent', label:'检查中'},
    'pending':  {cls:'muted',  label:'待检查'},
    'downloading':{cls:'accent',label:'下载中'},
    'downloaded':{cls:'ok',    label:'已安装'},
    'not-configured':{cls:'muted',label:'未配置'},
  };
  const m = map[status] || {cls:'', label:status};
  return <span className={"chip "+m.cls}>{m.label}</span>;
}

function CheckItem({label, detail, status='ready', children}) {
  const icon = status==='ready' ? '✓' : status==='missing' ? '!' : status==='installing' || status==='checking' || status==='downloading' ? null : status==='skip' ? '−' : status==='pending' ? '○' : '✓';
  const spinning = status==='installing' || status==='checking' || status==='downloading';
  return (
    <div className="row between mid" style={{padding:'5px 0'}}>
      <div className="row mid gap-8">
        {spinning ? <div className="spin" style={{width:13, height:13, borderWidth:1.2}}/> : <span style={{width:13, textAlign:'center', fontSize:12, color: status==='ready'||status==='downloaded' ? 'var(--ok)' : status==='missing'||status==='install-fail' ? 'var(--warn)' : 'var(--ink-3)'}}>{icon}</span>}
        <div className="col">
          <span className="t">{label}</span>
          {detail && <span className="t-xs">{detail}</span>}
        </div>
      </div>
      <div className="row mid gap-6">
        {children}
        <StatusPill status={status}/>
      </div>
    </div>
  );
}

function SidebarSettings({active='general'}) {
  const items = [
    {id:'general', icon:'◎', label:'通用'},
    {id:'models',  icon:'◇', label:'模型管理'},
    {id:'api', icon:'◈', label:'API 服务'},
    {id:'providers', icon:'◌', label:'Provider'},
    {id:'diag',    icon:'⚙', label:'诊断'},
    {id:'benchmark', icon:'▣', label:'Benchmark'},
  ];
  return (
    <div className="col shrink-0 pad-10 gap-2" style={{width:130, borderRight:'1.2px solid var(--ink)', background:'var(--paper-2)'}}>
      {items.map(it=>(
        <div key={it.id} className={"nav-item"+(active===it.id?' active':'')}>
          <span>{it.icon}</span><span>{it.label}</span>
        </div>
      ))}
      <div className="grow"/>
      <div className="t-xs" style={{padding:'4px 8px'}}>v0.1.0</div>
    </div>
  );
}

window.V2Chrome = V2Chrome;
window.StatusPill = StatusPill;
window.CheckItem = CheckItem;
window.SidebarSettings = SidebarSettings;
