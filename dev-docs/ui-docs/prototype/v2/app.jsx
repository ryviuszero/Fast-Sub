// v2/app.jsx — Canvas assembly with all screens

const V2_DEFAULTS = /*EDITMODE-BEGIN*/{
  "fontStyle": "clean"
}/*EDITMODE-END*/;

const W = 580;
const H = 480;
const WW = 700;
const HH = 500;

function V2App() {
  const [t, setTweak] = useTweaks(V2_DEFAULTS);
  const c = t.fontStyle === 'clean';

  return (
    <>
      <DesignCanvas>
        {/* === SECTION 1: FIRST-RUN SETUP FLOW === */}
        <DCSection id="setup" title="① 首次启动 / 环境检查" subtitle="App 打开 → 检测环境 → 安装依赖 → 下载模型 → 写入默认参数 → 进入主界面">
          <DCArtboard id="s1" label="1. 环境检测" width={W} height={H}>
            <SetupCheck clean={c}/>
          </DCArtboard>
          <DCArtboard id="s2" label="2. 安装缺失组件" width={W} height={H}>
            <SetupInstall clean={c}/>
          </DCArtboard>
          <DCArtboard id="s2b" label="2b. 安装诊断 (查看诊断)" width={W} height={H}>
            <SetupDiagPanel clean={c}/>
          </DCArtboard>
          <DCArtboard id="s3" label="3. 下载 ASR 模型" width={W} height={H}>
            <SetupASR clean={c}/>
          </DCArtboard>
          <DCArtboard id="s4" label="4. 下载翻译模型" width={W} height={H}>
            <SetupTranslation clean={c}/>
          </DCArtboard>
          <DCArtboard id="s5" label="5. 设置完成" width={W} height={H}>
            <SetupDone clean={c}/>
          </DCArtboard>
          <DCArtboard id="s6" label="模型下载失败 / 离线" width={W} height={H}>
            <SetupModelDownloadFailed clean={c}/>
          </DCArtboard>
        </DCSection>

        {/* === SECTION 2: MAIN SCREEN STATES === */}
        <DCSection id="main" title="② 主界面 / 一键生成字幕" subtitle="拖拽视频 → 添加文件 → 点击生成 → 查看结果。不暴露 daemon / SSE / job ID 等技术细节。">
          <DCArtboard id="m1" label="空状态 · 拖拽区域" width={W} height={H}>
            <MainEmpty clean={c}/>
          </DCArtboard>
          <DCArtboard id="m2" label="已添加文件 · 准备生成" width={W} height={H}>
            <MainFiles clean={c}/>
          </DCArtboard>
          <DCArtboard id="m2b" label="详细设置展开" width={W} height={H}>
            <MainAdvancedSettings clean={c}/>
          </DCArtboard>
          <DCArtboard id="m2c" label="模型未准备" width={W} height={H}>
            <MainModelsMissing clean={c}/>
          </DCArtboard>
          <DCArtboard id="m2d" label="输出冲突 · 询问" width={W} height={H}>
            <OutputConflictDialog clean={c}/>
          </DCArtboard>
          <DCArtboard id="m3" label="生成中 · 进度" width={W} height={H}>
            <MainGenerating clean={c}/>
          </DCArtboard>
          <DCArtboard id="m4" label="已完成 · 结果" width={W} height={H}>
            <MainDone2 clean={c}/>
          </DCArtboard>
        </DCSection>

        {/* === SECTION 3: SECONDARY TOOLS === */}
        <DCSection id="tools" title="③ 子功能" subtitle="翻译已有 SRT 和字幕烧录是独立入口，不打扰拖拽视频的一键生成主流程。">
          <DCArtboard id="t1" label="翻译已有 SRT" width={WW} height={HH}>
            <ToolTranslateSRT clean={c}/>
          </DCArtboard>
          <DCArtboard id="t2" label="字幕烧录 Burn-in" width={WW} height={HH}>
            <ToolBurnIn clean={c}/>
          </DCArtboard>
        </DCSection>

        {/* === SECTION 4: TASK QUEUE === */}
        <DCSection id="queue" title="④ 任务进度 / 队列" subtitle="用户可见状态：等待中 · 正在生成 · 已完成 · 已失败 · 已取消。内部状态机仅存于诊断。">
          <DCArtboard id="q1" label="任务列表" width={W} height={HH}>
            <QueueList clean={c}/>
          </DCArtboard>
          <DCArtboard id="q2" label="任务详情 (进度/日志/配置)" width={WW} height={HH}>
            <QueueDetail clean={c}/>
          </DCArtboard>
          <DCArtboard id="q3" label="失败任务详情" width={WW} height={HH}>
            <QueueFailedDetail clean={c}/>
          </DCArtboard>
        </DCSection>

        {/* === SECTION 5: SETTINGS === */}
        <DCSection id="settings" title="⑤ 设置" subtitle="详细设置默认折叠，用户需要时展开。远程能力明确标识上传行为。">
          <DCArtboard id="st1" label="通用 · 默认参数" width={WW} height={HH}>
            <SettGeneral clean={c}/>
          </DCArtboard>
          <DCArtboard id="st2" label="模型管理" width={WW} height={HH}>
            <SettModels clean={c}/>
          </DCArtboard>
          <DCArtboard id="st2b" label="模型维护状态" width={WW} height={HH}>
            <SettModelMaintenance clean={c}/>
          </DCArtboard>
          <DCArtboard id="st3" label="API 服务" width={WW} height={HH}>
            <SettAPI clean={c}/>
          </DCArtboard>
          <DCArtboard id="st3b" label="API 上传前确认" width={WW} height={HH}>
            <SettAPIUploadConfirm clean={c}/>
          </DCArtboard>
          <DCArtboard id="st3c" label="Provider 管理" width={WW} height={HH}>
            <SettProviders clean={c}/>
          </DCArtboard>
          <DCArtboard id="st4" label="诊断 / 高级信息" width={WW} height={HH}>
            <SettDiag clean={c}/>
          </DCArtboard>
          <DCArtboard id="st4a" label="服务异常 · 一键修复" width={WW} height={HH}>
            <SettDaemonRecovery clean={c}/>
          </DCArtboard>
          <DCArtboard id="st4b" label="结构化诊断详情" width={WW} height={HH}>
            <SettDiagStructured clean={c}/>
          </DCArtboard>
          <DCArtboard id="st5" label="配置映射" width={WW} height={HH}>
            <SettConfigMapping clean={c}/>
          </DCArtboard>
          <DCArtboard id="st6" label="Benchmark 规划" width={WW} height={HH}>
            <SettBenchmarkPlan clean={c}/>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>

      <TweaksPanel>
        <TweakSection label="样式"/>
        <TweakRadio label="字体风格" value={t.fontStyle}
          options={[{value:'sketch', label:'手绘 Sketch'}, {value:'clean', label:'干净 Inter'}]}
          onChange={(v)=>setTweak('fontStyle', v)} />
        <TweakSection label="说明"/>
        <div style={{fontSize:10.5, color:'rgba(41,38,27,.6)', lineHeight:1.6}}>
          <div>共 30 个 artboard，覆盖完整用户流程：</div>
          <div style={{marginTop:4}}>① 首次启动 7 个状态</div>
          <div>② 主界面 7 个状态</div>
          <div>③ 子功能 2 个入口</div>
          <div>④ 任务队列 3 个视图</div>
          <div>⑤ 设置 11 个子页面/弹窗</div>
          <div style={{marginTop:6}}>用户可见文案全部面向普通用户，技术细节仅出现在「诊断」页。</div>
        </div>
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<V2App/>);
