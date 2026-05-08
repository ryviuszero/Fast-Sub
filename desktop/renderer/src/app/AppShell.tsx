import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConfigViewModel, CreateJobRequest, EnvironmentStatus, FastSubClient, JobDetail, JobEvent, JobSummary, MockScenario, ModelStatus, ProviderStatus } from "../../../shared/contracts/types";
import { containsSecret } from "../../../shared/privacy/redaction";
import { defaultConfig, mockPaths } from "../client/mockFixtures";
import { AppMenu, DebugPanel, RemoteConfirmDialog } from "./components";
import { createClient, makeFile, makeFilesFromList, seedFiles } from "./fixtures";
import { renderScreen } from "./renderScreen";
import type { MediaFile, Screen, UiLanguage } from "./types";

export function App({ client: providedClient }: { client?: FastSubClient }) {
  const [scenario, setScenario] = useState<MockScenario>("setupReady");
  const client = useMemo(() => providedClient ?? createClient(scenario), [providedClient, scenario]);
  const [screen, setScreen] = useState<Screen>("setup-check");
  const [debugOpen, setDebugOpen] = useState(false);
  const [environment, setEnvironment] = useState<EnvironmentStatus | null>(null);
  const [models, setModels] = useState<ModelStatus[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [config, setConfig] = useState<ConfigViewModel>(defaultConfig);
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>("system");
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [activeJob, setActiveJob] = useState<JobDetail | null>(null);
  const [remoteConfirmOpen, setRemoteConfirmOpen] = useState(false);
  const [outputDirectoryLabel, setOutputDirectoryLabel] = useState("与源视频相同目录");
  const [outputDirectoryPath, setOutputDirectoryPath] = useState(mockPaths.output);
  const [openNotice, setOpenNotice] = useState<{ message: string; tone: "ok" | "warn" } | null>(null);
  const backStackRef = useRef<Screen[]>([]);
  const forwardStackRef = useRef<Screen[]>([]);
  const mediaInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const outputInputRef = useRef<HTMLInputElement | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const activeJobRef = useRef<JobDetail | null>(null);

  useEffect(() => {
    activeJobRef.current = activeJob;
  }, [activeJob]);

  const navigateScreen = useCallback((target: Screen) => {
    setScreen((current) => {
      if (current === target) {
        return current;
      }
      backStackRef.current = [...backStackRef.current, current].slice(-20);
      forwardStackRef.current = [];
      return target;
    });
  }, []);

  const goBack = useCallback(() => {
    const previous = backStackRef.current.at(-1);
    if (!previous) {
      return;
    }
    backStackRef.current = backStackRef.current.slice(0, -1);
    forwardStackRef.current = [screen, ...forwardStackRef.current].slice(0, 20);
    setScreen(previous);
  }, [screen]);

  const goForward = useCallback(() => {
    const next = forwardStackRef.current[0];
    if (!next) {
      return;
    }
    forwardStackRef.current = forwardStackRef.current.slice(1);
    backStackRef.current = [...backStackRef.current, screen].slice(-20);
    setScreen(next);
  }, [screen]);

  const loadBaseData = useCallback(async () => {
    const [env, cfg, modelList, providerList, jobList] = await Promise.all([
      client.getEnvironmentStatus(),
      client.getConfig(),
      client.listModels(),
      client.listProviders(),
      client.listJobs()
    ]);
    setEnvironment(env);
    setConfig(cfg);
    setModels(modelList);
    setProviders(providerList);
    setJobs(jobList);
    const defaultAsrReady = modelList.some((model) => model.id === cfg.asrModel && model.kind === "asr" && model.state === "ready");
    if (scenario === "missingAsr" && !defaultAsrReady) {
      setScreen("main-missing");
    }
  }, [client, scenario]);

  useEffect(() => {
    void loadBaseData();
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        setDebugOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      unsubscribeRef.current?.();
    };
  }, [loadBaseData]);

  const refreshJobs = useCallback(async () => {
    setJobs(await client.listJobs());
  }, [client]);

  const updateFromEvent = useCallback(async (event: JobEvent) => {
    if (event.type === "snapshot" && event.job) {
      setActiveJob(event.job);
      setScreen("main-generating");
    }
    if (event.type === "progress" && event.progress) {
      setActiveJob((job) => job ? { ...job, ...event.progress, statusLabel: "正在生成" } : job);
      setScreen("main-generating");
    }
    if (event.type === "log_tail" && event.logs) {
      setActiveJob((job) => job ? { ...job, logs: event.logs ?? job.logs } : job);
    }
    if (event.type === "succeeded" && event.result) {
      setActiveJob((job) => job ? { ...job, status: "succeeded", statusLabel: "已完成", progressPercent: 100, stageLabel: "已完成", result: event.result } : job);
      setScreen("main-done");
      unsubscribeRef.current?.();
    }
    if (event.type === "failed" && event.error) {
      const error = event.error;
      setActiveJob((job) => job ? { ...job, status: "failed", statusLabel: "已失败", error, stageLabel: error.title } : job);
      setScreen("queue-failed");
      unsubscribeRef.current?.();
    }
    if (event.type === "canceled") {
      setActiveJob((job) => job ? { ...job, status: "canceled", statusLabel: "已取消", stageLabel: "已取消" } : job);
      setScreen("queue-detail");
      unsubscribeRef.current?.();
    }
    if (event.type === "events_lost") {
      const jobId = activeJobRef.current?.id;
      if (jobId) {
        setActiveJob(await client.getJob(jobId));
      }
    }
    await refreshJobs();
  }, [client, refreshJobs]);

  const addFiles = async () => {
    const picked = await window.fastSubSystem?.selectMediaFiles();
    if (picked && picked.length > 0) {
      setFiles(picked.map((path, index) => makeFile(path, index)));
      setScreen("main-files");
      return;
    }
    mediaInputRef.current?.click();
  };

  const addBrowserFiles = (selected: FileList | null) => {
    if (!selected || selected.length === 0) {
      return;
    }
    const pickedFiles = makeFilesFromList(selected);
    setFiles(pickedFiles);
    setScreen("main-files");
    if (mediaInputRef.current) {
      mediaInputRef.current.value = "";
    }
  };

  const addFolder = async () => {
    const folder = await window.fastSubSystem?.selectFolder();
    if (folder) {
      setFiles(seedFiles.map((file, index) => makeFile(`${folder}\\${file.name}`, index)));
      setScreen("main-files");
      return;
    }
    folderInputRef.current?.click();
  };

  const addBrowserFolder = (selected: FileList | null) => {
    if (!selected || selected.length === 0) {
      return;
    }
    const pickedFiles = makeFilesFromList(selected, 8);
    setFiles(pickedFiles);
    setScreen("main-files");
    if (folderInputRef.current) {
      folderInputRef.current.value = "";
    }
  };

  const chooseOutputDirectory = async () => {
    const folder = await window.fastSubSystem?.selectFolder();
    if (folder) {
      setOutputDirectoryLabel(folder.split(/[\\/]/).filter(Boolean).at(-1) ?? "自定义输出目录");
      setOutputDirectoryPath(folder);
      return true;
    }
    outputInputRef.current?.click();
    return false;
  };

  const updateOutputDirectory = (selected: FileList | null) => {
    if (!selected || selected.length === 0) {
      return;
    }
    const first = selected[0];
    const folderName = first.webkitRelativePath.split("/").at(0) || "自定义输出目录";
    setOutputDirectoryLabel(folderName);
    setOutputDirectoryPath(`mock-output://${folderName}`);
    if (outputInputRef.current) {
      outputInputRef.current.value = "";
    }
  };

  const asrReady = models.some((model) => model.id === config.asrModel && model.kind === "asr" && model.state === "ready");
  const translationReady = models.some((model) => model.id === config.translationModel && model.kind === "translation" && model.state === "ready");

  const startJob = async (options: { conflictResolved?: boolean; remoteUploadConfirmed?: boolean } = {}) => {
    const conflictResolved = options.conflictResolved ?? false;
    const remoteUploadConfirmed = options.remoteUploadConfirmed ?? false;
    if (!asrReady) {
      setScreen("main-missing");
      return;
    }
    if (scenario === "outputConflict" && !conflictResolved) {
      setScreen("main-conflict");
      return;
    }
    const remoteProvider = providers.find((provider) => provider.id === config.asrProvider && provider.requiresUploadConfirmation);
    if ((remoteProvider || scenario === "remoteProviderConfirmRequired") && !remoteUploadConfirmed) {
      setRemoteConfirmOpen(true);
      return;
    }
    const request: CreateJobRequest = {
      type: "transcribe",
      inputPaths: (files.length ? files : seedFiles).map((file) => file.path),
      outputDirectory: outputDirectoryPath,
      outputType: config.outputType,
      language: config.defaultLanguage,
      providerId: config.asrProvider,
      modelId: config.asrModel,
      remoteUploadConfirmed
    };
    const job = await client.createJob(request);
    activeJobRef.current = job;
    setActiveJob(job);
    setScreen("main-generating");
    unsubscribeRef.current?.();
    unsubscribeRef.current = client.subscribeJobEvents(job.id, { onEvent: updateFromEvent });
    await refreshJobs();
  };

  const startToolJob = async (type: "translate_srt" | "burn_in", inputPaths: string[]) => {
    const job = await client.createJob({
      type,
      inputPaths,
      outputDirectory: outputDirectoryPath,
      outputType: type === "burn_in" ? "burned_video" : "translated_srt",
      language: config.defaultLanguage,
      providerId: type === "burn_in" ? config.asrProvider : config.translationProvider,
      modelId: type === "burn_in" ? config.asrModel : config.translationModel,
      remoteUploadConfirmed: true
    });
    activeJobRef.current = job;
    setActiveJob(job);
    await refreshJobs();
    return job;
  };

  const addDroppedFiles = (selected: FileList) => {
    const pickedFiles = makeFilesFromList(selected);
    if (pickedFiles.length === 0) {
      return;
    }
    setFiles(pickedFiles);
    setScreen("main-files");
  };

  const retryJob = async () => {
    const retryFiles = activeJob?.inputPaths?.length ? activeJob.inputPaths.map((path, index) => makeFile(path, index)) : files;
    if (retryFiles.length > 0) {
      setFiles(retryFiles);
    }
    await startJob({ conflictResolved: true, remoteUploadConfirmed: true });
  };

  const deleteActiveJob = async () => {
    if (activeJob) {
      await client.deleteJob(activeJob.id);
      setActiveJob(null);
      await refreshJobs();
    }
    setScreen("queue-list");
  };

  const openJob = async (jobId: string, target: Screen) => {
    const summary = jobs.find((job) => job.id === jobId);
    if (summary) {
      setActiveJob({
        ...summary,
        currentFile: summary.title,
        inputPaths: [],
        outputDirectory: outputDirectoryPath,
        providerName: "Fast Sub",
        modelName: config.asrModel,
        logs: []
      });
    }
    navigateScreen(target);
    setActiveJob(await client.getJob(jobId));
  };

  const cancelActiveJob = async () => {
    if (!activeJob) {
      return;
    }
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setActiveJob(await client.cancelJob(activeJob.id));
    setScreen("queue-detail");
    await refreshJobs();
    setTimeout(() => {
      void (async () => {
        const updated = await client.getJob(activeJob.id);
        setActiveJob(updated);
        await refreshJobs();
      })();
    }, 860);
  };

  const cancelAllJobs = async () => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setActiveJob(null);
    setJobs(await client.cancelAllJobs());
    setScreen("queue-list");
  };

  const openMock = async (path: string) => {
    const opened = await window.fastSubSystem?.openPathMock(path);
    setOpenNotice(opened ? { message: `已模拟打开：${path}`, tone: "ok" } : { message: "无法打开该路径", tone: "warn" });
  };

  return (
    <div className="app-stage">
      <div className="prototype-window">
        <input
          ref={mediaInputRef}
          aria-label="选择视频文件"
          className="native-file-picker"
          type="file"
          accept=".mp4,.mov,.mkv,.wav,.m4a,.mp3,video/*,audio/*"
          multiple
          onChange={(event) => addBrowserFiles(event.currentTarget.files)}
        />
        <input
          ref={folderInputRef}
          aria-label="选择媒体文件夹"
          className="native-file-picker"
          type="file"
          multiple
          // @ts-expect-error webkitdirectory is supported by Chromium/Electron but missing from React's input props.
          webkitdirectory=""
          onChange={(event) => addBrowserFolder(event.currentTarget.files)}
        />
        <input
          ref={outputInputRef}
          aria-label="选择输出目录"
          className="native-file-picker"
          type="file"
          multiple
          // @ts-expect-error webkitdirectory is supported by Chromium/Electron but missing from React's input props.
          webkitdirectory=""
          onChange={(event) => updateOutputDirectory(event.currentTarget.files)}
        />
        {screen !== "setup-check" && screen !== "setup-done" && (
          <AppMenu
            canGoBack={backStackRef.current.length > 0}
            canGoForward={forwardStackRef.current.length > 0}
            onBack={goBack}
            onForward={goForward}
            onNavigate={navigateScreen}
          />
        )}
        {renderScreen({
          screen,
          setScreen: navigateScreen,
          environment,
          models,
          providers,
          config,
          setConfig,
          uiLanguage,
          setUiLanguage,
          files,
          setFiles,
          outputDirectoryLabel,
          asrReady,
          translationReady,
          jobs,
          activeJob,
          addFiles,
          addFolder,
          addDroppedFiles,
          chooseOutputDirectory,
          openJob,
          startJob,
          startToolJob,
          retryJob,
          openMock,
          cancelJob: cancelActiveJob,
          cancelAllJobs,
          deleteJob: deleteActiveJob,
          installModel: async (id) => {
            await client.installModel(id);
            await loadBaseData();
          },
          repairDaemon: async () => {
            setEnvironment(await client.repairDaemon());
            setScreen("setup-check");
          },
          testProvider: (id, mode) => client.testProvider(id, mode),
          updateConfig: async (patch) => setConfig(await client.updateConfig(patch))
        })}
      </div>

      <button className="debug-peek" aria-label="打开调试面板" title="调试面板 Ctrl+D" onClick={() => setDebugOpen((open) => !open)} />
      {debugOpen && (
        <DebugPanel
          screen={screen}
          setScreen={setScreen}
          scenario={scenario}
          setScenario={setScenario}
          disabledScenario={Boolean(providedClient)}
        />
      )}
        {remoteConfirmOpen && (
          <RemoteConfirmDialog
          provider={providers.find((item) => item.id === config.asrProvider)}
          files={files.length ? files : seedFiles}
          onCancel={() => setRemoteConfirmOpen(false)}
          onConfirm={() => {
            setRemoteConfirmOpen(false);
            void startJob({ conflictResolved: true, remoteUploadConfirmed: true });
          }}
          />
        )}
        {openNotice && (
          <div className={`open-notice ${openNotice.tone}`} role="status">
            <span>{openNotice.message}</span>
            <button aria-label="关闭打开提示" onClick={() => setOpenNotice(null)} type="button">×</button>
          </div>
        )}
      </div>
  );
}

export function renderHasSecret(text: string): boolean {
  return containsSecret(text);
}
