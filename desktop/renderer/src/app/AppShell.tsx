import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConfigViewModel, CreateJobRequest, EnvironmentStatus, FastSubClient, JobDetail, JobEvent, JobSummary, MockScenario, ModelStatus, ProviderStatus } from "../../../shared/contracts/types";
import { containsSecret } from "../../../shared/privacy/redaction";
import { defaultConfig, mockPaths } from "../client/mockFixtures";
import { AppMenu, DebugPanel, RemoteConfirmDialog } from "./components";
import { createClient, makeFile, makeFilesFromList } from "./fixtures";
import { renderScreen } from "./renderScreen";
import type { MediaFile, QueueFilter, Screen, UiFontStyle, UiLanguage } from "./types";

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
  const [uiFontStyle, setUiFontStyle] = useState<UiFontStyle>("system");
  const [queueInitialFilter, setQueueInitialFilter] = useState<QueueFilter>("all");
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [modelInstallJobs, setModelInstallJobs] = useState<Record<string, JobDetail>>({});
  const [activeBatchJobIds, setActiveBatchJobIds] = useState<string[]>([]);
  const [activeJob, setActiveJob] = useState<JobDetail | null>(null);
  const [completedBatchJobs, setCompletedBatchJobs] = useState<JobDetail[]>([]);
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
  const modelInstallUnsubscribeRef = useRef<Map<string, () => void>>(new Map());
  const activeJobRef = useRef<JobDetail | null>(null);
  const activeBatchJobIdsRef = useRef<string[]>([]);
  const completedBatchJobsRef = useRef<JobDetail[]>([]);
  const backgroundQueueOpenRef = useRef(false);

  useEffect(() => {
    activeJobRef.current = activeJob;
  }, [activeJob]);

  useEffect(() => {
    activeBatchJobIdsRef.current = activeBatchJobIds;
  }, [activeBatchJobIds]);

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
    const [envResult, cfgResult, modelsResult, providersResult, jobsResult] = await Promise.allSettled([
      client.getEnvironmentStatus(),
      client.getConfig(),
      client.listModels(),
      client.listProviders(),
      client.listJobs()
    ]);
    const fallbackEnv: EnvironmentStatus = {
      health: "disconnected" as const,
      os: "Windows",
      arch: "x64",
      memory: "未知",
      disk: "未知",
      localTranscriptionReady: false,
      localTranslationReady: false,
      ffmpegReady: false,
      modelDirectoryReady: false,
      daemonReady: false,
      warnings: ["本地服务暂时不可用"],
      error: {
        code: "daemon_disconnected",
        title: "本地服务暂时不可用",
        message: "请尝试一键修复，或检查 fast-sub-go 是否可启动。",
        action: "打开诊断",
        recoveryActions: ["repair_daemon", "open_diagnostics"],
        diagnostic: "daemon startup failed"
      }
    };
    const env = envResult.status === "fulfilled" ? envResult.value : fallbackEnv;
    const cfg = cfgResult.status === "fulfilled" ? cfgResult.value : defaultConfig;
    const modelList = modelsResult.status === "fulfilled" ? modelsResult.value : [];
    const providerList = providersResult.status === "fulfilled" ? providersResult.value : [];
    const jobList = jobsResult.status === "fulfilled" ? jobsResult.value : [];
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
      for (const unsubscribe of modelInstallUnsubscribeRef.current.values()) {
        unsubscribe();
      }
      modelInstallUnsubscribeRef.current.clear();
    };
  }, [loadBaseData]);

  const refreshJobs = useCallback(async () => {
    setJobs(await client.listJobs());
  }, [client]);

  const updateFromEvent = useCallback(async (event: JobEvent) => {
    if (event.type === "snapshot" && event.job) {
      const snapshot = event.job;
      setActiveJob((job) => mergeJobSnapshot(job, snapshot));
      if (!backgroundQueueOpenRef.current) {
        setScreen("main-generating");
      }
    }
    if (event.type === "progress" && event.progress) {
      setActiveJob((job) => job ? { ...job, ...event.progress, statusLabel: "正在生成" } : job);
      if (!backgroundQueueOpenRef.current) {
        setScreen("main-generating");
      }
    }
    if (event.type === "log_tail" && event.logs) {
      setActiveJob((job) => job ? { ...job, logs: event.logs ?? job.logs } : job);
    }
    if (event.type === "succeeded" && event.result) {
      const completedJob = activeJobRef.current ? { ...activeJobRef.current, status: "succeeded" as const, statusLabel: "已完成", progressPercent: 100, stageLabel: "已完成", result: event.result } : null;
      if (completedJob) {
        activeJobRef.current = completedJob;
        const nextCompletedJobs = mergeJobDetails(completedBatchJobsRef.current, [completedJob]);
        completedBatchJobsRef.current = nextCompletedJobs;
        setCompletedBatchJobs(nextCompletedJobs);
        setActiveJob(completedJob);
      }
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      const batchIds = activeBatchJobIdsRef.current;
      if (batchIds.length <= 1) {
        if (!backgroundQueueOpenRef.current) {
          setScreen("main-done");
        }
        await refreshJobs();
        return;
      }
      const nextJobs = mergeJobSummaries(await client.listJobs(), completedJob ? [completedJob] : []);
      setJobs(nextJobs);
      const batchJobs = nextJobs.filter((job) => batchIds.includes(job.id));
      const completedIds = new Set(completedBatchJobsRef.current.map((job) => job.id));
      const nextJob = batchJobs.find((job) => job.status === "running" || job.status === "queued" || job.status === "canceling");
      if (batchIds.every((id) => completedIds.has(id)) || (!nextJob && batchJobs.length === batchIds.length && batchJobs.every((job) => job.status === "succeeded"))) {
        if (!backgroundQueueOpenRef.current) {
          setScreen("main-done");
        }
        return;
      }
      if (nextJob) {
        const detail = await client.getJob(nextJob.id);
        activeJobRef.current = detail;
        setActiveJob(detail);
        if (!backgroundQueueOpenRef.current) {
          setScreen("main-generating");
        }
        unsubscribeRef.current = client.subscribeJobEvents(detail.id, { onEvent: updateFromEvent });
        return;
      }
      if (!backgroundQueueOpenRef.current) {
        setScreen("main-generating");
      }
      return;
    }
    if (event.type === "failed" && event.error) {
      const error = event.error;
      setActiveJob((job) => job ? { ...job, status: "failed", statusLabel: "已失败", error, stageLabel: error.title } : job);
      if (!backgroundQueueOpenRef.current) {
        setScreen(error.code === "output_exists" && config.outputConflict === "ask" ? "main-conflict" : "queue-failed");
      }
      unsubscribeRef.current?.();
    }
    if (event.type === "canceled") {
      setActiveJob((job) => job ? { ...job, status: "canceled", statusLabel: "已取消", stageLabel: "已取消" } : job);
      if (!backgroundQueueOpenRef.current) {
        setScreen("queue-detail");
      }
      unsubscribeRef.current?.();
    }
    if (event.type === "events_lost") {
      const jobId = activeJobRef.current?.id;
      if (jobId) {
        setActiveJob(await client.getJob(jobId));
      }
    }
    await refreshJobs();
  }, [client, config.outputConflict, refreshJobs]);

  const updateModelInstallFromEvent = useCallback(async (modelId: string, event: JobEvent) => {
    if (event.type === "snapshot" && event.job) {
      const snapshot = event.job;
      setModelInstallJobs((current) => ({ ...current, [modelId]: snapshot }));
      return;
    }
    if (event.type === "progress" && event.progress) {
      setModelInstallJobs((current) => {
        const existing = current[modelId];
        return existing ? { ...current, [modelId]: { ...existing, ...event.progress, statusLabel: "下载中" } } : current;
      });
      setModels((current) => current.map((model) => model.id === modelId ? { ...model, state: "installing", progressPercent: event.progress?.progressPercent ?? model.progressPercent } : model));
      return;
    }
    if (event.type === "succeeded") {
      setModelInstallJobs((current) => {
        const existing = current[modelId];
        return existing ? { ...current, [modelId]: { ...existing, status: "succeeded", statusLabel: "已完成", progressPercent: 100, stageLabel: "模型已可用", result: event.result } } : current;
      });
      setModels((current) => current.map((model) => model.id === modelId ? { ...model, state: "ready", progressPercent: 100, diagnostic: undefined } : model));
      modelInstallUnsubscribeRef.current.get(modelId)?.();
      modelInstallUnsubscribeRef.current.delete(modelId);
      await loadBaseData();
      return;
    }
    if (event.type === "failed" && event.error) {
      setModelInstallJobs((current) => {
        const existing = current[modelId];
        return existing ? { ...current, [modelId]: { ...existing, status: "failed", statusLabel: "已失败", stageLabel: event.error?.title ?? "下载失败", error: event.error } } : current;
      });
      setModels((current) => current.map((model) => model.id === modelId ? { ...model, state: "failed", diagnostic: event.error?.diagnostic ?? event.error?.message } : model));
      modelInstallUnsubscribeRef.current.get(modelId)?.();
      modelInstallUnsubscribeRef.current.delete(modelId);
      return;
    }
    if (event.type === "canceled") {
      setModelInstallJobs((current) => {
        const existing = current[modelId];
        return existing ? { ...current, [modelId]: { ...existing, status: "canceled", statusLabel: "已取消", stageLabel: "已取消" } } : current;
      });
      modelInstallUnsubscribeRef.current.get(modelId)?.();
      modelInstallUnsubscribeRef.current.delete(modelId);
    }
  }, [loadBaseData]);

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
    const picked = await window.fastSubSystem?.selectMediaFolder();
    if (picked && picked.length > 0) {
      setFiles(picked.map((path, index) => makeFile(path, index)));
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

  const chooseSubtitleOutputPath = async (defaultPath: string) => {
    return await window.fastSubSystem?.selectSubtitleOutputPath(defaultPath) ?? null;
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
  const translationReady = environment?.localTranslationReady !== false && models.some((model) => model.id === config.translationModel && model.kind === "translation" && model.state === "ready");

  const startJob = async (options: { conflictResolved?: boolean; outputConflict?: ConfigViewModel["outputConflict"]; outputPath?: string; remoteUploadConfirmed?: boolean } = {}) => {
    const conflictResolved = options.conflictResolved ?? false;
    const outputConflict = options.outputConflict ?? config.outputConflict;
    const remoteUploadConfirmed = options.remoteUploadConfirmed ?? false;
    if (!asrReady) {
      setScreen("main-missing");
      return;
    }
    if (scenario === "outputConflict" && outputConflict === "ask" && !conflictResolved) {
      setScreen("main-conflict");
      return;
    }
    const remoteProvider = providers.find((provider) => provider.id === config.asrProvider && provider.requiresUploadConfirmation);
    if ((remoteProvider || scenario === "remoteProviderConfirmRequired") && !remoteUploadConfirmed) {
      setRemoteConfirmOpen(true);
      return;
    }
    if (files.length === 0) {
      setScreen("main-empty");
      return;
    }
    const inputPaths = files.map((file) => file.path);
    const batchPaths = options.outputPath ? inputPaths.slice(0, 1) : inputPaths;
    const createdJobs: JobDetail[] = [];
    for (const path of batchPaths) {
      const request: CreateJobRequest = {
        type: "transcribe",
        inputPaths: [path],
        outputDirectory: effectiveOutputDirectory([path], config, outputDirectoryPath),
        outputPath: options.outputPath,
        outputType: config.outputType,
        outputFormat: config.outputFormat,
        outputConflict,
        language: config.defaultLanguage,
        targetLanguage: config.targetLanguage,
        providerId: config.asrProvider,
        modelId: config.asrModel,
        remoteUploadConfirmed
      };
      createdJobs.push(await client.createJob(request));
    }
    const job = createdJobs[0];
    if (!job) {
      return;
    }
    const batchJobIds = createdJobs.map((createdJob) => createdJob.id);
    backgroundQueueOpenRef.current = false;
    activeBatchJobIdsRef.current = batchJobIds;
    completedBatchJobsRef.current = [];
    setCompletedBatchJobs([]);
    setActiveBatchJobIds(batchJobIds);
    setJobs((currentJobs) => mergeCreatedJobs(currentJobs, createdJobs));
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
      outputDirectory: effectiveOutputDirectory(inputPaths, config, outputDirectoryPath),
      outputType: type === "burn_in" ? "burned_video" : "translated_srt",
      outputFormat: config.outputFormat,
      outputConflict: config.outputConflict,
      language: config.defaultLanguage,
      targetLanguage: config.targetLanguage,
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
    backgroundQueueOpenRef.current = false;
    const summary = jobs.find((job) => job.id === jobId);
    if (summary) {
      setActiveJob({
        ...summary,
        currentFile: summary.title,
        inputPaths: [],
        outputDirectory: summary.outputDirectory || outputDirectoryPath,
        providerName: summary.providerName || "Fast Sub",
        modelName: summary.modelName || config.asrModel,
        logs: []
      });
    }
    navigateScreen(target);
    setActiveJob(await client.getJob(jobId));
  };

  const openRunningQueue = () => {
    backgroundQueueOpenRef.current = true;
    setQueueInitialFilter("running");
    navigateScreen("queue-list");
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
    setActiveBatchJobIds([]);
    setJobs(await client.cancelAllJobs());
    setScreen("queue-list");
  };

  const openMock = async (path: string) => {
    const opened = await window.fastSubSystem?.openPathMock(path);
    setOpenNotice(opened ? null : { message: "无法打开该路径", tone: "warn" });
  };

  return (
    <div className="app-stage">
    <div className={`prototype-window font-${uiFontStyle}`}>
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
          uiFontStyle,
          setUiFontStyle,
          files,
          setFiles,
          outputDirectoryLabel,
          asrReady,
          translationReady,
          jobs,
          modelInstallJobs,
          queueInitialFilter,
          activeBatchJobIds,
          activeJob,
          completedBatchJobs,
          addFiles,
          addFolder,
          addDroppedFiles,
          chooseOutputDirectory,
          chooseSubtitleOutputPath,
          openJob,
          openRunningQueue,
          startJob,
          startToolJob,
          retryJob,
          openMock,
          cancelJob: cancelActiveJob,
          cancelAllJobs,
          deleteJob: deleteActiveJob,
          installModel: async (id) => {
            const job = await client.createModelInstallJob(id);
            setModelInstallJobs((current) => ({ ...current, [id]: job }));
            setModels((current) => current.map((model) => model.id === id ? {
              ...model,
              state: job.status === "failed" ? "failed" : job.status === "succeeded" ? "ready" : "installing",
              installJobId: job.id,
              progressPercent: job.progressPercent
            } : model));
            modelInstallUnsubscribeRef.current.get(id)?.();
            if (job.status === "queued" || job.status === "running" || job.status === "canceling") {
              const unsubscribe = client.subscribeJobEvents(job.id, { onEvent: (event) => void updateModelInstallFromEvent(id, event) });
              modelInstallUnsubscribeRef.current.set(id, unsubscribe);
            }
            await loadBaseData();
          },
          removeModel: async (id) => {
            modelInstallUnsubscribeRef.current.get(id)?.();
            modelInstallUnsubscribeRef.current.delete(id);
            setModelInstallJobs((current) => {
              const { [id]: _removed, ...rest } = current;
              return rest;
            });
            const removed = await client.removeModel(id);
            setModels((current) => current.map((model) => model.id === id ? removed : model));
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
          files={files}
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

function effectiveOutputDirectory(inputPaths: string[], config: ConfigViewModel, selectedOutputDirectory: string): string {
  const source = sourceDirectory(inputPaths[0] ?? "");
  if (config.outputLocation !== "source" && selectedOutputDirectory !== mockPaths.output && !selectedOutputDirectory.startsWith("mock-output://")) {
    return selectedOutputDirectory;
  }
  return source ?? selectedOutputDirectory;
}

function sourceDirectory(path: string): string | null {
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  if (index <= 0) {
    return null;
  }
  if (index === 2 && /^[A-Za-z]:[\\/]/.test(path)) {
    return path.slice(0, 3);
  }
  return path.slice(0, index);
}

function mergeJobSnapshot(current: JobDetail | null, snapshot: JobDetail): JobDetail {
  if (!current) {
    return snapshot;
  }
  return {
    ...current,
    status: snapshot.status,
    statusLabel: snapshot.statusLabel,
    progressPercent: snapshot.progressPercent || current.progressPercent,
    stageLabel: snapshot.stageLabel || current.stageLabel,
    currentFile: snapshot.currentFile || current.currentFile,
    createdAt: snapshot.createdAt || current.createdAt,
    logs: snapshot.logs.length ? snapshot.logs : current.logs
  };
}

function mergeCreatedJobs(currentJobs: JobSummary[], createdJobs: JobDetail[]): JobSummary[] {
  return mergeJobSummaries(currentJobs, createdJobs);
}

function mergeJobSummaries(currentJobs: JobSummary[], details: JobDetail[]): JobSummary[] {
  const next = new Map(currentJobs.map((job) => [job.id, job]));
  for (const job of details) {
    const { logs: _logs, inputPaths: _inputPaths, result: _result, error: _error, estimatedRemaining: _estimatedRemaining, ...summary } = job;
    next.set(job.id, summary);
  }
  return Array.from(next.values());
}

function mergeJobDetails(currentJobs: JobDetail[], details: JobDetail[]): JobDetail[] {
  const next = new Map(currentJobs.map((job) => [job.id, job]));
  for (const job of details) {
    next.set(job.id, job);
  }
  return Array.from(next.values());
}
