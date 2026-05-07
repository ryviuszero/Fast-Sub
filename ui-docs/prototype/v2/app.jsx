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
        </DCSection>

        {/* === SECTION 2: MAIN SCREEN STATES === */}
        <DCSection id="main" title="② 主界面 / 一键生成字幕" subtitle="拖拽视频 → 添加文件 → 点击生成 → 查看结果。不暴露 daemon / SSE / job ID 等技术细节。">
          <DCArtboard id="m1" label="空状态 · 拖拽区域" width={W} height={H}>
            <MainEmpty clean={c}/>
          </DCArtboard>
          <DCArtboard id="m2" label="已添加文件 · 准备生成" width={W} height={H}>
            <MainFiles clean={c}/>
          </DCArtboard>
          <DCArtboard id="m3" label="生成中 · 进度" width={W} height={H}>
            <MainGenerating clean={c}/>
          </DCArtboard>
          <DCArtboard id="m4" label="已完成 · 结果" width={W} height={H}>
            <MainDone2 clean={c}/>
          </DCArtboard>
        </DCSection>

        {/* === SECTION 3: TASK QUEUE === */}
        <DCSection id="queue" title="③ 任务进度 / 队列" subtitle="用户可见状态：等待中 · 正在生成 · 已完成 · 已失败 · 已取消。内部状态机仅存于诊断。">
          <DCArtboard id="q1" label="任务列表" width={W} height={HH}>
            <QueueList clean={c}/>
          </DCArtboard>
          <DCArtboard id="q2" label="任务详情 (进度/日志/配置)" width={WW} height={HH}>
            <QueueDetail clean={c}/>
          </DCArtboard>
        </DCSection>

        {/* === SECTION 4: SETTINGS === */}
        <DCSection id="settings" title="④ 设置" subtitle="详细设置默认折叠，用户需要时展开。远程能力明确标识上传行为。">
          <DCArtboard id="st1" label="通用 · 默认参数" width={WW} height={HH}>
            <SettGeneral clean={c}/>
          </DCArtboard>
          <DCArtboard id="st2" label="模型管理" width={WW} height={HH}>
            <SettModels clean={c}/>
          </DCArtboard>
          <DCArtboard id="st3" label="API 服务" width={WW} height={HH}>
            <SettAPI clean={c}/>
          </DCArtboard>
          <DCArtboard id="st4" label="诊断 / 高级信息" width={WW} height={HH}>
            <SettDiag clean={c}/>
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
          <div>共 15 个 artboard，覆盖完整用户流程：</div>
          <div style={{marginTop:4}}>① 首次启动 5 步</div>
          <div>② 主界面 4 个状态</div>
          <div>③ 任务队列 2 个视图</div>
          <div>④ 设置 4 个子页面</div>
          <div style={{marginTop:6}}>用户可见文案全部面向普通用户，技术细节仅出现在「诊断」页。</div>
        </div>
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<V2App/>);
