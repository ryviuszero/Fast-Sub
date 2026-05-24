import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import type { ConfigViewModel, CreateJobRequest, EnvironmentStatus, FastSubClient, FFmpegPackageManager, JobDetail, JobEvent, JobStatus, JobSummary, LocalDataCleanupTarget, MockScenario, ModelStatus, ProviderStatus } from "../../../shared/contracts/types";
import { containsSecret } from "../../../shared/privacy/redaction";
import { defaultConfig, mockPaths } from "../client/mockFixtures";
import { AppMenu, DebugPanel, RemoteConfirmDialog } from "./components";
import { createClient, filterSupportedMediaPaths, makeFile, makeFilesFromList } from "./fixtures";
import { I18nProvider, useT } from "./i18n";
import { renderScreen } from "./renderScreen";
import type { MediaFile, QueueFilter, Screen, UiFontStyle, UiLanguage } from "./types";

const ONBOARDING_DONE_KEY = "fast-sub:onboarding-complete";
const FILE_IMPORT_FEEDBACK_DELAY_MS = 32;
const SYNC_MEDIA_IMPORT_LIMIT = 20;
const TRANSLATION_CONFIG_NOTICE = "Translation config not ready";

type PendingRemoteConfirmation = {
  provider?: ProviderStatus;
  files: MediaFile[];
  onConfirm: () => void;
};

export function App({ client: providedClient }: { client?: FastSubClient }) {
  const [scenario, setScenario] = useState<MockScenario>("setupReady");
  const client = useMemo(() => providedClient ?? createClient(scenario), [providedClient, scenario]);
  const [screen, setScreen] = useState<Screen>(() => onboardingComplete() ? "main-empty" : "setup-check");
  const [completionReturnScreen, setCompletionReturnScreen] = useState<Screen>("main-empty");
  const [providerSettingsFocus, setProviderSettingsFocus] = useState<ProviderStatus["capability"] | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [environment, setEnvironment] = useState<EnvironmentStatus | null>(null);
  const [models, setModels] = useState<ModelStatus[]>([]);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [config, setConfig] = useState<ConfigViewModel>(defaultConfig);
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>("system");
  const [uiFontStyle, setUiFontStyle] = useState<UiFontStyle>("system");
  const [queueInitialFilter, setQueueInitialFilter] = useState<QueueFilter>("all");
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [fileImportPending, setFileImportPending] = useState(false);
  const [fileImportCount, setFileImportCount] = useState<number | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [modelInstallJobs, setModelInstallJobs] = useState<Record<string, JobDetail>>({});
  const [activeBatchJobIds, setActiveBatchJobIds] = useState<string[]>([]);
  const [activeJob, setActiveJob] = useState<JobDetail | null>(null);
  const [completedBatchJobs, setCompletedBatchJobs] = useState<JobDetail[]>([]);
  const [outputDirectoryLabel, setOutputDirectoryLabel] = useState("Same folder as source");
  const [outputDirectoryPath, setOutputDirectoryPath] = useState(mockPaths.output);
  const [openNotice, setOpenNotice] = useState<{ message: string; tone: "ok" | "warn" } | null>(null);
  const [remoteConfirmRequest, setRemoteConfirmRequest] = useState<PendingRemoteConfirmation | null>(null);
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
  const autoTranslationProviderChecksRef = useRef<Set<string>>(new Set());
  const autoTranslationProviderChecksInFlightRef = useRef<Set<string>>(new Set());
  const reactMountedReportedRef = useRef(false);

  useEffect(() => {
    activeJobRef.current = activeJob;
  }, [activeJob]);

  useEffect(() => {
    if (reactMountedReportedRef.current) {
      return;
    }
    reactMountedReportedRef.current = true;
    window.fastSubSystem?.reportStartupTiming?.("react-mounted", {
      screen,
      performance_now_ms: Math.round(performance.now())
    });
  }, [screen]);

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

  const navigateFromScreen = useCallback((target: Screen) => {
    if ((screen === "setup-done" || screen === "setup-check") && target !== "setup-check" && target !== "setup-done") {
      markOnboardingComplete();
    }
    if (target !== "settings-providers") {
      setProviderSettingsFocus(null);
    }
    navigateScreen(target);
  }, [navigateScreen, screen]);

  const openProviderSettings = useCallback((focus?: ProviderStatus["capability"]) => {
    setProviderSettingsFocus(focus ?? null);
    navigateFromScreen("settings-providers");
  }, [navigateFromScreen]);

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

  const autoCheckDefaultTranslationProvider = useCallback(async (cfg: ConfigViewModel, providerList: ProviderStatus[]) => {
    const provider = providerList.find((item) => item.id === cfg.translationProvider && item.capability === "translation");
    if (!shouldAutoCheckTranslationProvider(provider)) {
      return;
    }
    const checkKey = translationProviderCheckKey(cfg, provider.id);
    if (autoTranslationProviderChecksRef.current.has(checkKey) || autoTranslationProviderChecksInFlightRef.current.has(checkKey)) {
      return;
    }
    autoTranslationProviderChecksInFlightRef.current.add(checkKey);
    try {
      const checked = await client.testProvider(provider.id, "live");
      setProviders((current) => current.map((item) => item.id === checked.id ? checked : item));
    } catch {
      // Startup checks must not block the main UI. Manual provider check still exposes the failure.
    } finally {
      autoTranslationProviderChecksInFlightRef.current.delete(checkKey);
      autoTranslationProviderChecksRef.current.add(checkKey);
    }
  }, [client]);

  const loadBaseData = useCallback(async () => {
    const started = performance.now();
    window.fastSubSystem?.reportStartupTiming?.("base-data-start", {
      performance_now_ms: Math.round(started)
    });
    const [envResult, cfgResult, modelsResult, jobsResult] = await Promise.allSettled([
      client.getEnvironmentStatus(),
      client.getConfig(),
      client.listModels(),
      client.listJobs()
    ]);
    const fallbackEnv: EnvironmentStatus = {
      health: "disconnected" as const,
      os: "Windows",
      arch: "x64",
      memory: "Unknown",
      disk: "Unknown",
      localTranscriptionReady: false,
      localTranslationReady: false,
      ffmpegReady: false,
      ffmpegInstalling: false,
      ffmpegInstallProgressPercent: 0,
      ffmpegInstallLogs: [],
      modelDirectoryReady: false,
      daemonReady: false,
      warnings: ["Fast Sub service unavailable"],
      error: {
        code: "daemon_disconnected",
        title: "Fast Sub service unavailable",
        message: "Repair service or check fast-sub-go startup.",
        action: "Open diagnostics",
        recoveryActions: ["repair_daemon", "open_diagnostics"],
        diagnostic: "daemon startup failed"
      }
    };
    const env = envResult.status === "fulfilled" ? envResult.value : fallbackEnv;
    const cfg = cfgResult.status === "fulfilled" ? cfgResult.value : defaultConfig;
    const modelList = modelsResult.status === "fulfilled" ? modelsResult.value : [];
    const jobList = jobsResult.status === "fulfilled" ? jobsResult.value : [];
    setEnvironment(env);
    setConfig(cfg);
    setModels(modelList);
    setJobs(jobList);
    window.fastSubSystem?.reportStartupTiming?.("base-data-core-ready", {
      duration_ms: Math.round(performance.now() - started),
      env: envResult.status,
      config: cfgResult.status,
      models: modelsResult.status,
      jobs: jobsResult.status,
      model_count: modelList.length,
      job_count: jobList.length
    });
    void client.listProviders().then((providerList) => {
      setProviders(providerList);
      window.fastSubSystem?.reportStartupTiming?.("base-data-providers-ready", {
        duration_ms: Math.round(performance.now() - started),
        provider_count: providerList.length
      });
      void autoCheckDefaultTranslationProvider(cfg, providerList);
    }).catch(() => undefined);
  }, [autoCheckDefaultTranslationProvider, client]);

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

  useEffect(() => {
    if (screen !== "setup-check" || !environment?.ffmpegInstalling) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadBaseData();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [environment?.ffmpegInstalling, loadBaseData, screen]);

  useEffect(() => {
    void autoCheckDefaultTranslationProvider(config, providers);
  }, [autoCheckDefaultTranslationProvider, config, providers]);

  const refreshJobs = useCallback(async () => {
    setJobs(await client.listJobs());
  }, [client]);

  const queueMediaImport = useCallback((inputCount: number | null, buildFiles: () => MediaFile[], reset?: () => void) => {
    if (inputCount !== null && inputCount <= SYNC_MEDIA_IMPORT_LIMIT) {
      const pickedFiles = buildFiles();
      if (pickedFiles.length > 0) {
        setFiles(pickedFiles);
        setScreen("main-files");
      }
      reset?.();
      return;
    }
    setFileImportPending(true);
    setFileImportCount(inputCount);
    setFiles([]);
    setScreen("main-files");
    window.setTimeout(() => {
      try {
        const pickedFiles = buildFiles();
        setFiles(pickedFiles);
        if (pickedFiles.length === 0) {
          setScreen("main-empty");
        }
      } finally {
        setFileImportPending(false);
        setFileImportCount(null);
        reset?.();
      }
    }, FILE_IMPORT_FEEDBACK_DELAY_MS);
  }, []);

  const updateFromEvent = useCallback(async (event: JobEvent) => {
    const createBurnInJobFromTranscribe = async (sourceJob: JobDetail): Promise<JobDetail | null> => {
      if (!config.burnInVideo || sourceJob.type !== "transcribe") {
        return null;
      }
      const videoPath = sourceJob.inputPaths[0] || sourceJob.currentFile;
      const subtitlePath = sourceJob.result?.subtitlePath ?? "";
      if (!videoPath || !subtitlePath) {
        return null;
      }
      const request: CreateJobRequest = {
        type: "burn_in",
        inputPaths: [videoPath, subtitlePath],
        outputDirectory: sourceJob.outputDirectory || effectiveOutputDirectory([videoPath], config, outputDirectoryPath),
        outputType: "burned_video",
        outputFormat: config.outputFormat,
        outputConflict: config.outputConflict,
        language: sourceJob.language || config.defaultLanguage,
        targetLanguage: config.targetLanguage,
        providerId: config.asrProvider,
        modelId: config.asrModel,
        remoteUploadConfirmed: false
      };
      const burnJob = repairJobPathFromRequest(await client.createJob(request), request);
      activeBatchJobIdsRef.current = [...activeBatchJobIdsRef.current, burnJob.id];
      setActiveBatchJobIds(activeBatchJobIdsRef.current);
      setJobs((currentJobs) => mergeCreatedJobs(currentJobs, [burnJob]));
      return burnJob;
    };

    const continueBatchAfterTerminal = async (terminalJob: JobDetail): Promise<boolean> => {
      const batchIds = activeBatchJobIdsRef.current;
      if (batchIds.length <= 1) {
        return false;
      }
      const nextJobs = mergeJobSummaries(await client.listJobs(), [terminalJob]);
      setJobs(nextJobs);
      const batchJobs = nextJobs.filter((job) => batchIds.includes(job.id));
      const nextJob = batchJobs.find((job) => job.status === "running" || job.status === "queued" || job.status === "canceling");
      if (nextJob) {
        const detail = await client.getJob(nextJob.id);
        activeJobRef.current = detail;
        setActiveJob(detail);
        if (!backgroundQueueOpenRef.current) {
          setScreen("main-generating");
        }
        unsubscribeRef.current = client.subscribeJobEvents(detail.id, { onEvent: updateFromEvent });
        return true;
      }
      if (batchJobs.length === batchIds.length && batchJobs.every((job) => isTerminalJobStatus(job.status))) {
        if (!backgroundQueueOpenRef.current) {
          setScreen("queue-failed");
        } else {
          setQueueInitialFilter(batchJobs.some((job) => job.status === "failed") ? "failed" : "done");
        }
        return true;
      }
      if (!backgroundQueueOpenRef.current && screen === "main-generating") {
        setScreen("main-generating");
      }
      return true;
    };

    if (event.type === "snapshot" && event.job) {
      const snapshot = event.job;
      const merged = mergeJobSnapshot(activeJobRef.current, snapshot);
      activeJobRef.current = merged;
      setActiveJob(merged);
      setJobs((currentJobs) => mergeJobSummaries(currentJobs, [merged]));
      if (!backgroundQueueOpenRef.current && screen === "main-generating") {
        setScreen("main-generating");
      }
    }
    if (event.type === "progress" && event.progress) {
      const updated = activeJobRef.current ? { ...activeJobRef.current, ...event.progress, statusLabel: "Running" } : null;
      if (updated) {
        activeJobRef.current = updated;
        setActiveJob(updated);
        setJobs((currentJobs) => mergeJobSummaries(currentJobs, [updated]));
      }
      if (!backgroundQueueOpenRef.current && screen === "main-generating") {
        setScreen("main-generating");
      }
    }
    if (event.type === "log_tail" && event.logs) {
      setActiveJob((job) => job ? { ...job, logs: event.logs ?? job.logs } : job);
    }
    if (event.type === "succeeded" && event.result) {
      const completedJob = activeJobRef.current ? { ...activeJobRef.current, status: "succeeded" as const, statusLabel: "Completed", progressPercent: 100, stageLabel: "Completed", result: event.result } : null;
      if (completedJob) {
        activeJobRef.current = completedJob;
        const nextCompletedJobs = mergeJobDetails(completedBatchJobsRef.current, [completedJob]);
        completedBatchJobsRef.current = nextCompletedJobs;
        setCompletedBatchJobs(nextCompletedJobs);
        setActiveJob(completedJob);
      }
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      const burnJob = completedJob ? await createBurnInJobFromTranscribe(completedJob) : null;
      if (burnJob) {
        activeJobRef.current = burnJob;
        setActiveJob(burnJob);
        if (burnJob.status === "succeeded") {
          const nextCompletedJobs = mergeJobDetails(completedBatchJobsRef.current, [burnJob]);
          completedBatchJobsRef.current = nextCompletedJobs;
          setCompletedBatchJobs(nextCompletedJobs);
        } else if (burnJob.status === "failed") {
          if (!backgroundQueueOpenRef.current) {
            setScreen("queue-failed");
          } else {
            setQueueInitialFilter("failed");
          }
          await refreshJobs();
          return;
        } else {
          if (!backgroundQueueOpenRef.current) {
            setScreen("main-generating");
          }
          unsubscribeRef.current = client.subscribeJobEvents(burnJob.id, { onEvent: updateFromEvent });
          await refreshJobs();
          return;
        }
      }
      const batchIds = activeBatchJobIdsRef.current;
      if (batchIds.length <= 1) {
        if (!backgroundQueueOpenRef.current) {
          setScreen("main-done");
        } else {
          setQueueInitialFilter("done");
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
        const completedDetails = await loadBatchJobDetails(client, batchIds, completedJob);
        completedBatchJobsRef.current = completedDetails;
        setCompletedBatchJobs(completedDetails);
        if (completedDetails[0]) {
          activeJobRef.current = completedDetails[0];
          setActiveJob(completedDetails[0]);
        }
        if (!backgroundQueueOpenRef.current) {
          setScreen("main-done");
        } else {
          setQueueInitialFilter("done");
        }
        return;
      }
      if (!nextJob && batchJobs.length === batchIds.length && batchJobs.every((job) => isTerminalJobStatus(job.status))) {
        if (!backgroundQueueOpenRef.current) {
          setScreen("queue-failed");
        } else {
          setQueueInitialFilter(batchJobs.some((job) => job.status === "failed") ? "failed" : "done");
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
      const failedJob = activeJobRef.current ? { ...activeJobRef.current, status: "failed" as const, statusLabel: "Failed", error, stageLabel: error.title } : null;
      if (failedJob) {
        activeJobRef.current = failedJob;
        setActiveJob(failedJob);
      } else {
        setActiveJob((job) => job ? { ...job, status: "failed", statusLabel: "Failed", error, stageLabel: error.title } : job);
      }
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      if (failedJob && await continueBatchAfterTerminal(failedJob)) {
        await refreshJobs();
        return;
      }
      if (!backgroundQueueOpenRef.current) {
        setScreen(error.code === "output_exists" && config.outputConflict === "ask" ? "main-conflict" : "queue-failed");
      } else {
        setQueueInitialFilter("failed");
      }
    }
    if (event.type === "canceled") {
      const canceledJob = activeJobRef.current ? { ...activeJobRef.current, status: "canceled" as const, statusLabel: "Canceled", stageLabel: "Canceled" } : null;
      if (canceledJob) {
        activeJobRef.current = canceledJob;
        setActiveJob(canceledJob);
      } else {
        setActiveJob((job) => job ? { ...job, status: "canceled", statusLabel: "Canceled", stageLabel: "Canceled" } : job);
      }
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      if (canceledJob && await continueBatchAfterTerminal(canceledJob)) {
        await refreshJobs();
        return;
      }
      if (!backgroundQueueOpenRef.current) {
        setScreen("queue-detail");
      } else {
        setQueueInitialFilter("failed");
      }
    }
    if (event.type === "events_lost") {
      const jobId = activeJobRef.current?.id;
      if (jobId) {
        setActiveJob(await client.getJob(jobId));
      }
    }
    await refreshJobs();
  }, [client, config, outputDirectoryPath, refreshJobs, screen]);

  const updateModelInstallFromEvent = useCallback(async (modelId: string, event: JobEvent) => {
    if (event.type === "snapshot" && event.job) {
      const snapshot = event.job;
      setModelInstallJobs((current) => ({ ...current, [modelId]: snapshot }));
      return;
    }
    if (event.type === "progress" && event.progress) {
      setModelInstallJobs((current) => {
        const existing = current[modelId];
        return existing ? { ...current, [modelId]: { ...existing, ...event.progress, statusLabel: "Downloading" } } : current;
      });
      setModels((current) => current.map((model) => model.id === modelId ? { ...model, state: "installing", progressPercent: event.progress?.progressPercent ?? model.progressPercent } : model));
      return;
    }
    if (event.type === "log_tail" && event.logs) {
      const logs = event.logs;
      setModelInstallJobs((current) => {
        const existing = current[modelId];
        return existing ? { ...current, [modelId]: { ...existing, logs: [...existing.logs, ...logs].slice(-20) } } : current;
      });
      return;
    }
    if (event.type === "succeeded") {
      setModelInstallJobs((current) => {
        const existing = current[modelId];
        return existing ? { ...current, [modelId]: { ...existing, status: "succeeded", statusLabel: "Completed", progressPercent: 100, stageLabel: "Model is ready", result: event.result } } : current;
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
        return existing ? { ...current, [modelId]: { ...existing, status: "failed", statusLabel: "Failed", stageLabel: event.error?.title ?? "Download failed", error: event.error } } : current;
      });
      setModels((current) => current.map((model) => model.id === modelId ? { ...model, state: "failed", diagnostic: event.error?.diagnostic ?? event.error?.message } : model));
      modelInstallUnsubscribeRef.current.get(modelId)?.();
      modelInstallUnsubscribeRef.current.delete(modelId);
      return;
    }
    if (event.type === "canceled") {
      setModelInstallJobs((current) => {
        const existing = current[modelId];
        return existing ? { ...current, [modelId]: { ...existing, status: "canceled", statusLabel: "Canceled", stageLabel: "Canceled" } } : current;
      });
      modelInstallUnsubscribeRef.current.get(modelId)?.();
      modelInstallUnsubscribeRef.current.delete(modelId);
    }
  }, [loadBaseData]);

  const addFiles = async () => {
    const picked = await window.fastSubSystem?.selectMediaFiles();
    if (picked && picked.length > 0) {
      const paths = picked.slice();
      queueMediaImport(paths.length, () => filterSupportedMediaPaths(paths).map((path, index) => makeFile(path, index)));
      return;
    }
    mediaInputRef.current?.click();
  };

  const addBrowserFiles = (selected: FileList | null) => {
    if (!selected || selected.length === 0) {
      return;
    }
    const selectedFiles = Array.from(selected);
    queueMediaImport(selectedFiles.length, () => makeFilesFromArray(selectedFiles), () => {
      if (mediaInputRef.current) {
        mediaInputRef.current.value = "";
      }
    });
  };

  const addFolder = async () => {
    const picked = await window.fastSubSystem?.selectMediaFolder({
      includeSubfolders: config.folderScanIncludeSubfolders,
      maxFiles: config.folderScanMaxFiles
    });
    if (picked && picked.length > 0) {
      const paths = picked.slice();
      const maxFiles = config.folderScanMaxFiles;
      queueMediaImport(paths.length, () => filterSupportedMediaPaths(paths, maxFiles).map((path, index) => makeFile(path, index)));
      return;
    }
    folderInputRef.current?.click();
  };

  const addBrowserFolder = (selected: FileList | null) => {
    if (!selected || selected.length === 0) {
      return;
    }
    const selectedFiles = Array.from(selected);
    const maxFiles = config.folderScanMaxFiles;
    const includeSubfolders = config.folderScanIncludeSubfolders;
    queueMediaImport(selectedFiles.length, () => makeFilesFromArray(selectedFiles, maxFiles, {
      includeSubfolders
    }), () => {
      if (folderInputRef.current) {
        folderInputRef.current.value = "";
      }
    });
  };

  const chooseOutputDirectory = async () => {
    const folder = await window.fastSubSystem?.selectFolder();
    if (folder) {
      setOutputDirectoryLabel(folder.split(/[\\/]/).filter(Boolean).at(-1) ?? "Custom output folder");
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
    const folderName = first.webkitRelativePath.split("/").at(0) || "Custom output folder";
    setOutputDirectoryLabel(folderName);
    setOutputDirectoryPath(`mock-output://${folderName}`);
    if (outputInputRef.current) {
      outputInputRef.current.value = "";
    }
  };

  const resolvedASRSelection = resolveReadyProviderModel("stt", config.asrProvider, config.asrModel, providers, models);
  const asrReady = Boolean(resolvedASRSelection);
  const translationReady = translationProviderReady(config, providers, models);

  const requestRemoteConfirmation = (provider: ProviderStatus | undefined, inputPaths: string[], onConfirm: () => void) => {
    setRemoteConfirmRequest({
      provider,
      files: inputPaths.map((path, index) => makeFile(path, index)),
      onConfirm
    });
  };

  const startJob = async (options: { conflictResolved?: boolean; inputPaths?: string[]; outputConflict?: ConfigViewModel["outputConflict"]; outputPath?: string; remoteUploadConfirmed?: boolean } = {}) => {
    const conflictResolved = options.conflictResolved ?? false;
    const outputConflict = options.outputConflict ?? config.outputConflict;
    let asrSelection = resolveReadyProviderModel("stt", config.asrProvider, config.asrModel, providers, models);
    if (!asrSelection) {
      setScreen("main-missing");
      return;
    }
    if (asrSelection.providerId !== config.asrProvider || asrSelection.modelId !== config.asrModel) {
      const repairedSelection = asrSelection;
      try {
        const updated = await client.updateConfig({ asrProvider: repairedSelection.providerId, asrModel: repairedSelection.modelId });
        setConfig(updated);
        asrSelection = { providerId: updated.asrProvider, modelId: updated.asrModel };
      } catch {
        setConfig((current) => ({ ...current, asrProvider: repairedSelection.providerId, asrModel: repairedSelection.modelId }));
      }
    }
    if (outputTypeNeedsTranslation(config.outputType) && !translationOutputReady(config, providers, translationReady)) {
      setOpenNotice({ message: TRANSLATION_CONFIG_NOTICE, tone: "warn" });
      openProviderSettings("translation");
      return;
    }
    if (scenario === "outputConflict" && outputConflict === "ask" && !conflictResolved) {
      setScreen("main-conflict");
      return;
    }
    const inputPaths = options.inputPaths?.length ? options.inputPaths : files.map((file) => file.path);
    if (inputPaths.length === 0) {
      setScreen("main-empty");
      return;
    }
    const asrRemoteProvider = providers.find((provider) => provider.id === asrSelection.providerId && provider.requiresUploadConfirmation);
    const translationRemoteProvider = outputTypeNeedsTranslation(config.outputType)
      ? providers.find((provider) => provider.id === config.translationProvider && provider.requiresUploadConfirmation)
      : undefined;
    const confirmedRemoteUpload = options.remoteUploadConfirmed === true;
    if ((asrRemoteProvider || translationRemoteProvider) && !confirmedRemoteUpload) {
      requestRemoteConfirmation(asrRemoteProvider ?? translationRemoteProvider, inputPaths, () => {
        void startJob({ ...options, inputPaths, remoteUploadConfirmed: true });
      });
      return;
    }
    const remoteUploadConfirmed = Boolean(asrRemoteProvider) ? confirmedRemoteUpload : false;
    const translationUploadConfirmed = Boolean(translationRemoteProvider) ? confirmedRemoteUpload : false;
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
        providerId: asrSelection.providerId,
        modelId: asrSelection.modelId,
        translationProviderId: outputTypeNeedsTranslation(config.outputType) ? config.translationProvider : undefined,
        translationModelId: outputTypeNeedsTranslation(config.outputType) ? translationModelForRequest(config) : undefined,
        translationUploadConfirmed: outputTypeNeedsTranslation(config.outputType) ? translationUploadConfirmed : false,
        remoteUploadConfirmed
      };
      createdJobs.push(repairJobPathFromRequest(await client.createJob(request), request));
    }
    const job = createdJobs[0];
    if (!job) {
      return;
    }
    const batchJobIds = createdJobs.map((createdJob) => createdJob.id);
    backgroundQueueOpenRef.current = false;
    setCompletionReturnScreen("main-empty");
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

  const startToolJob = async (type: "translate_srt" | "burn_in", inputPaths: string[], options: { remoteUploadConfirmed?: boolean } = {}) => {
    const translationRemoteProvider = type === "translate_srt"
      ? providers.find((provider) => provider.id === config.translationProvider && provider.requiresUploadConfirmation)
      : undefined;
    const confirmedRemoteUpload = options.remoteUploadConfirmed === true;
    if (translationRemoteProvider && !confirmedRemoteUpload) {
      requestRemoteConfirmation(translationRemoteProvider, inputPaths, () => {
        void startToolJob(type, inputPaths, { remoteUploadConfirmed: true });
      });
      return null;
    }
    const request: CreateJobRequest = {
      type,
      inputPaths,
      outputDirectory: effectiveOutputDirectory(inputPaths, config, outputDirectoryPath),
      outputType: type === "burn_in" ? "burned_video" : "translated_srt",
      outputFormat: config.outputFormat,
      outputConflict: config.outputConflict,
      language: config.defaultLanguage,
      targetLanguage: config.targetLanguage,
      providerId: type === "burn_in" ? config.asrProvider : config.translationProvider,
      modelId: type === "burn_in" ? config.asrModel : translationModelForRequest(config),
      translationUploadConfirmed: Boolean(translationRemoteProvider) ? confirmedRemoteUpload : false,
      remoteUploadConfirmed: type === "translate_srt" && Boolean(translationRemoteProvider) ? confirmedRemoteUpload : false
    };
    setCompletionReturnScreen(type === "burn_in" ? "tool-burn-in" : "tool-translate");
    const job = repairJobPathFromRequest(await client.createJob(request), request);
    backgroundQueueOpenRef.current = false;
    activeBatchJobIdsRef.current = [job.id];
    completedBatchJobsRef.current = job.status === "succeeded" ? [job] : [];
    setActiveBatchJobIds([job.id]);
    setCompletedBatchJobs(job.status === "succeeded" ? [job] : []);
    setJobs((currentJobs) => mergeCreatedJobs(currentJobs, [job]));
    activeJobRef.current = job;
    setActiveJob(job);
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    if (job.status === "succeeded") {
      setScreen("main-done");
    } else if (job.status === "failed") {
      setScreen("queue-failed");
    } else {
      setScreen("main-generating");
      unsubscribeRef.current = client.subscribeJobEvents(job.id, { onEvent: updateFromEvent });
    }
    await refreshJobs();
    return job;
  };

  const addDroppedFiles = (selected: FileList) => {
    if (selected.length === 0) {
      return;
    }
    const selectedFiles = Array.from(selected);
    queueMediaImport(selectedFiles.length, () => makeFilesFromArray(selectedFiles));
  };

  const retryJob = async () => {
    const retryInputPaths = activeJob?.inputPaths?.length ? activeJob.inputPaths.slice(0, 1) : files.slice(0, 1).map((file) => file.path);
    if (retryInputPaths.length > 0) {
      setFiles(retryInputPaths.map((path, index) => makeFile(path, index)));
    }
    await startJob({ conflictResolved: true, inputPaths: retryInputPaths });
  };

  const deleteActiveJob = async () => {
    if (activeJob) {
      await client.deleteJob(activeJob.id);
      setActiveJob(null);
      await refreshJobs();
    }
    setScreen("queue-list");
  };

  const deleteJobs = async (jobIds: string[]) => {
    const ids = [...new Set(jobIds)];
    if (ids.length === 0) {
      return;
    }
    await Promise.allSettled(ids.map((id) => client.deleteJob(id)));
    if (activeJob && ids.includes(activeJob.id)) {
      setActiveJob(null);
    }
    await refreshJobs();
  };

  const openJob = async (jobId: string, target: Screen) => {
    backgroundQueueOpenRef.current = false;
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
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
    const detail = await client.getJob(jobId);
    activeJobRef.current = detail;
    setActiveJob(detail);
    if (isActiveJobStatus(detail.status)) {
      unsubscribeRef.current = client.subscribeJobEvents(detail.id, { onEvent: updateFromEvent });
    }
  };

  const getJobLogs = async (jobId: string) => {
    return client.getJobLogs(jobId);
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

  const cancelJobs = async (jobIds: string[]) => {
    const ids = [...new Set(jobIds)];
    if (ids.length === 0) {
      return;
    }
    await Promise.allSettled(ids.map((id) => client.cancelJob(id)));
    if (activeJob && ids.includes(activeJob.id)) {
      setActiveJob(await client.getJob(activeJob.id).catch(() => activeJob));
    }
    await refreshJobs();
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
    setOpenNotice(opened ? null : { message: "Cannot open path", tone: "warn" });
  };

  useEffect(() => {
    if (openNotice?.message === TRANSLATION_CONFIG_NOTICE && translationOutputReady(config, providers, translationReady)) {
      setOpenNotice(null);
    }
  }, [config, openNotice?.message, providers, translationReady]);

  return (
    <I18nProvider language={uiLanguage}>
      <AppContent
        scenario={scenario}
        setScenario={setScenario}
        debugOpen={debugOpen}
        setDebugOpen={setDebugOpen}
        screen={screen}
        setScreen={setScreen}
        backStackLength={backStackRef.current.length}
        canGoForward={forwardStackRef.current.length > 0}
        goBack={goBack}
        goForward={goForward}
        navigateScreen={navigateScreen}
        uiFontStyle={uiFontStyle}
        mediaInputRef={mediaInputRef}
        folderInputRef={folderInputRef}
        outputInputRef={outputInputRef}
        addBrowserFiles={addBrowserFiles}
        addBrowserFolder={addBrowserFolder}
        updateOutputDirectory={updateOutputDirectory}
        providedClient={providedClient}
        openNotice={openNotice}
        setOpenNotice={setOpenNotice}
      >
        {remoteConfirmRequest && (
          <RemoteConfirmDialog
            provider={remoteConfirmRequest.provider}
            files={remoteConfirmRequest.files}
            onCancel={() => setRemoteConfirmRequest(null)}
            onConfirm={() => {
              const pending = remoteConfirmRequest;
              setRemoteConfirmRequest(null);
              pending.onConfirm();
            }}
          />
        )}
        {renderScreen({
          screen,
          setScreen: navigateFromScreen,
          completionReturnScreen,
          providerSettingsFocus,
          openProviderSettings,
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
          fileImportPending,
          fileImportCount,
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
          getJobLogs,
          openRunningQueue,
          startJob,
          startToolJob,
          retryJob,
          openMock,
          cancelJob: cancelActiveJob,
          cancelJobs,
          cancelAllJobs,
          deleteJob: deleteActiveJob,
          deleteJobs,
          cleanupLocalData: async (target: LocalDataCleanupTarget) => {
            await client.cleanupLocalData(target);
            await loadBaseData();
          },
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
              return;
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
          installFFmpegWithPackageManager: async (manager: FFmpegPackageManager) => {
            setEnvironment((current) => current ? {
              ...current,
              ffmpegInstalling: true,
              ffmpegInstallProgressPercent: 5,
              ffmpegInstallLogs: [`Installing FFmpeg with ${manager}.`]
            } : current);
            setEnvironment(await client.installFFmpegWithPackageManager(manager));
            setScreen("setup-check");
          },
          installProviderDependency: async (id) => {
            const installed = await client.installProviderDependency(id);
            setProviders((current) => current.map((provider) => provider.id === id ? installed : provider));
            await loadBaseData();
          },
          testProvider: async (id, mode) => {
            const checked = await client.testProvider(id, mode);
            setProviders((current) => current.map((provider) => provider.id === id ? checked : provider));
            return checked;
          },
          updateConfig: async (patch) => {
            const normalizedPatch = normalizeConfigPatch(patch, config, providers, models);
            setConfig((current) => ({ ...current, ...normalizedPatch }));
            try {
              const updated = await client.updateConfig(normalizedPatch);
              setConfig(updated);
            } catch (error) {
              setConfig(await client.getConfig().catch(() => defaultConfig));
              throw error;
            }
          },
          saveProviderSecret: async (providerId, alias, rawSecret) => {
            setConfig(await client.saveProviderSecret(providerId, alias, rawSecret));
            setProviders(await client.listProviders());
          },
          deleteProviderSecret: async (providerId, alias) => {
            setConfig(await client.deleteProviderSecret(providerId, alias));
            setProviders(await client.listProviders());
          }
        })}
      </AppContent>
    </I18nProvider>
  );
}

function onboardingComplete(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_DONE_KEY) === "1";
  } catch {
    return false;
  }
}

function markOnboardingComplete(): void {
  try {
    window.localStorage.setItem(ONBOARDING_DONE_KEY, "1");
  } catch {
    // Local storage can be disabled in hardened webviews; onboarding simply stays non-persistent.
  }
}

function makeFilesFromArray(
  selected: File[],
  limit = Number.POSITIVE_INFINITY,
  options: { includeSubfolders?: boolean } = {}
): MediaFile[] {
  const fileList = { length: selected.length, item: (index: number) => selected[index] ?? null } as FileList;
  selected.forEach((file, index) => {
    (fileList as unknown as Record<number, File>)[index] = file;
  });
  return makeFilesFromList(fileList, limit, options);
}

function AppContent(props: {
  children: ReactNode;
  scenario: MockScenario;
  setScenario: (scenario: MockScenario) => void;
  debugOpen: boolean;
  setDebugOpen: (updater: (open: boolean) => boolean) => void;
  screen: Screen;
  setScreen: (screen: Screen) => void;
  backStackLength: number;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
  navigateScreen: (screen: Screen) => void;
  uiFontStyle: UiFontStyle;
  mediaInputRef: RefObject<HTMLInputElement | null>;
  folderInputRef: RefObject<HTMLInputElement | null>;
  outputInputRef: RefObject<HTMLInputElement | null>;
  addBrowserFiles: (selected: FileList | null) => void;
  addBrowserFolder: (selected: FileList | null) => void;
  updateOutputDirectory: (selected: FileList | null) => void;
  providedClient?: FastSubClient;
  openNotice: { message: string; tone: "ok" | "warn" } | null;
  setOpenNotice: (notice: { message: string; tone: "ok" | "warn" } | null) => void;
}) {
  const t = useT();
  const appMenuBackTarget = resolveAppMenuBackTarget(props.screen);
  const canGoBack = Boolean(appMenuBackTarget) || props.backStackLength > 0;
  const handleBack = () => {
    if (appMenuBackTarget) {
      props.navigateScreen(appMenuBackTarget);
      return;
    }
    props.goBack();
  };
  return (
    <div className="app-stage">
    <div className={`prototype-window font-${props.uiFontStyle}`}>
        <input
          ref={props.mediaInputRef}
          aria-label={t("Choose video files")}
          className="native-file-picker"
          type="file"
          accept=".mp4,.mov,.mkv,.wav,.m4a,.mp3,video/*,audio/*"
          multiple
          onChange={(event) => props.addBrowserFiles(event.currentTarget.files)}
        />
        <input
          ref={props.folderInputRef}
          aria-label={t("Choose media folder")}
          className="native-file-picker"
          type="file"
          accept=".mp4,.mov,.mkv,.wav,.m4a,.mp3,video/*,audio/*"
          multiple
          // @ts-expect-error webkitdirectory is supported by Chromium/Electron but missing from React's input props.
          webkitdirectory=""
          onChange={(event) => props.addBrowserFolder(event.currentTarget.files)}
        />
        <input
          ref={props.outputInputRef}
          aria-label={t("Choose output folder")}
          className="native-file-picker"
          type="file"
          multiple
          // @ts-expect-error webkitdirectory is supported by Chromium/Electron but missing from React's input props.
          webkitdirectory=""
          onChange={(event) => props.updateOutputDirectory(event.currentTarget.files)}
        />
        {props.screen !== "setup-check" && props.screen !== "setup-done" && (
          <AppMenu
            canGoBack={canGoBack}
            canGoForward={props.canGoForward}
            onBack={handleBack}
            onForward={props.goForward}
            onNavigate={props.navigateScreen}
          />
        )}
        {props.children}
      </div>

      <button className="debug-peek" aria-label={t("Open debug panel")} title={t("Debug panel Ctrl+D")} onClick={() => props.setDebugOpen((open) => !open)} />
      {props.debugOpen && (
        <DebugPanel
          screen={props.screen}
          setScreen={props.setScreen}
          scenario={props.scenario}
          setScenario={props.setScenario}
          disabledScenario={Boolean(props.providedClient)}
        />
      )}
        {props.openNotice && (
          <div className={`open-notice ${props.openNotice.tone}`} role="status">
            <span>{t(props.openNotice.message)}</span>
            <button aria-label={t("Dismiss notice")} onClick={() => props.setOpenNotice(null)} type="button">×</button>
          </div>
        )}
      </div>
  );
}

function resolveAppMenuBackTarget(screen: Screen): Screen | null {
  if (screen === "queue-detail" || screen === "queue-failed") {
    return "main-empty";
  }
  return null;
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

function outputTypeNeedsTranslation(outputType: ConfigViewModel["outputType"]): boolean {
  return outputType === "translated_srt" || outputType === "bilingual_srt";
}

function translationModelForRequest(config: ConfigViewModel): string {
  if (config.translationProvider === "local-nllb-ct2") {
    return config.translationModel;
  }
  if (config.translationProvider === "api-openai-chat") {
    return apiProviderModel(config, "api-openai-chat");
  }
  return "";
}

function apiProviderModel(config: ConfigViewModel, providerId: string): string {
  return config.apiProviderConfigs?.[providerId]?.openAIModel || config.openAIModel || "";
}

function apiProviderBaseUrl(config: ConfigViewModel, providerId: string): string {
  return config.apiProviderConfigs?.[providerId]?.openAIBaseUrl || config.openAIBaseUrl || "";
}

function apiProviderKeyAlias(config: ConfigViewModel, providerId: string): string {
  return config.apiProviderConfigs?.[providerId]?.apiKeyAlias || "";
}

function apiProviderKeyStatus(config: ConfigViewModel, providerId: string): string {
  return config.apiProviderConfigs?.[providerId]?.apiKeyStatus || "";
}

function shouldAutoCheckTranslationProvider(provider: ProviderStatus | undefined): provider is ProviderStatus {
  return Boolean(
    provider
    && provider.enabled
    && provider.capability === "translation"
    && provider.kind === "api"
    && provider.checkMode !== "live"
    && (provider.state === "available" || provider.state === "missing_api_key" || provider.state === "invalid_config")
  );
}

function translationProviderCheckKey(config: ConfigViewModel, providerId: string): string {
  return [
    providerId,
    apiProviderBaseUrl(config, providerId),
    apiProviderModel(config, providerId),
    apiProviderKeyAlias(config, providerId),
    apiProviderKeyStatus(config, providerId)
  ].join("|");
}

function normalizeConfigPatch(patch: Partial<ConfigViewModel>, current: ConfigViewModel, providers: ProviderStatus[], models: ModelStatus[]): Partial<ConfigViewModel> {
  const next = { ...current, ...patch };
  const normalized = { ...patch };
  if (patch.asrProvider !== undefined && patch.asrModel === undefined) {
    const selection = resolveReadyProviderModel("stt", next.asrProvider, next.asrModel, providers, models);
    if (selection?.providerId === next.asrProvider) {
      normalized.asrModel = selection.modelId;
    }
  }
  if (patch.asrModel !== undefined && !modelCompatibleWithProvider(patch.asrModel, next.asrProvider, "asr", models)) {
    const selection = resolveReadyProviderModel("stt", next.asrProvider, next.asrModel, providers, models);
    if (selection) {
      normalized.asrProvider = selection.providerId;
      normalized.asrModel = selection.modelId;
    }
  }
  if (patch.translationProvider !== undefined && patch.translationModel === undefined) {
    const selection = resolveReadyProviderModel("translation", next.translationProvider, next.translationModel, providers, models);
    if (selection?.providerId === next.translationProvider) {
      normalized.translationModel = selection.modelId;
    }
  }
  if (patch.translationModel !== undefined && !modelCompatibleWithProvider(patch.translationModel, next.translationProvider, "translation", models)) {
    const selection = resolveReadyProviderModel("translation", next.translationProvider, next.translationModel, providers, models);
    if (selection) {
      normalized.translationProvider = selection.providerId;
      normalized.translationModel = selection.modelId;
    }
  }
  return normalized;
}

function resolveReadyProviderModel(capability: ProviderStatus["capability"], providerId: string, modelId: string, providers: ProviderStatus[], models: ModelStatus[]): { providerId: string; modelId: string } | null {
  const kind = capability === "translation" ? "translation" : "asr";
  const preferredProviders = [
    providerId,
    capability === "stt" ? "local-faster-whisper" : "local-nllb-ct2",
    ...providers
      .filter((provider) => provider.capability === capability && provider.kind !== "api" && provider.kind !== "web")
      .map((provider) => provider.id)
  ];
  for (const id of uniqueStrings(preferredProviders)) {
    const provider = providers.find((item) => item.id === id && item.capability === capability);
    if (!provider || !providerCanRun(provider)) {
      continue;
    }
    if ((provider.kind === "api" || provider.kind === "web") && id !== providerId) {
      continue;
    }
    if (provider.kind === "api" || provider.kind === "web" || !provider.requiresModel) {
      return { providerId: id, modelId };
    }
    const model = selectReadyCompatibleModel(id, kind, modelId, models);
    if (model) {
      return { providerId: id, modelId: model.id };
    }
  }
  return null;
}

function selectReadyCompatibleModel(providerId: string, kind: ModelStatus["kind"], preferredModelId: string, models: ModelStatus[]): ModelStatus | null {
  const preferredModel = models.find((model) => model.id === preferredModelId && model.kind === kind);
  if (preferredModel && modelCompatible(preferredModel, providerId)) {
    return preferredModel.state === "ready" ? preferredModel : null;
  }
  const compatible = models.filter((model) => model.kind === kind && model.state === "ready" && modelCompatible(model, providerId));
  return compatible.find((model) => model.id === preferredModelId)
    ?? compatible.find((model) => model.requiredForMainFlow)
    ?? compatible.find((model) => model.defaultFor?.includes(providerId))
    ?? compatible[0]
    ?? null;
}

function modelCompatibleWithProvider(modelId: string, providerId: string, kind: ModelStatus["kind"], models: ModelStatus[]): boolean {
  const model = models.find((item) => item.id === modelId && item.kind === kind);
  return Boolean(model && modelCompatible(model, providerId));
}

function modelCompatible(model: ModelStatus, providerId: string): boolean {
  return !model.compatibleProviders || model.compatibleProviders.length === 0 || model.compatibleProviders.includes(providerId);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function translationOutputReady(config: ConfigViewModel, providers: ProviderStatus[], translationReady: boolean): boolean {
  return translationReady && translationProviderRunnable(config, providers);
}

function translationProviderReady(config: ConfigViewModel, providers: ProviderStatus[], models: ModelStatus[]): boolean {
  const provider = providers.find((item) => item.id === config.translationProvider && item.capability === "translation");
  if (!provider || !providerCanRun(provider)) {
    return false;
  }
  if (provider.kind === "api" || provider.kind === "web" || !provider.requiresModel) {
    return true;
  }
  return Boolean(selectReadyCompatibleModel(provider.id, "translation", config.translationModel, models));
}

function translationProviderRunnable(config: ConfigViewModel, providers: ProviderStatus[]): boolean {
  const provider = providers.find((item) => item.id === config.translationProvider && item.capability === "translation");
  return Boolean(provider && providerCanRun(provider));
}

function providerCanRun(provider: ProviderStatus): boolean {
  if (!provider.enabled || provider.state !== "available") {
    return false;
  }
  return provider.kind !== "api" || provider.checkMode === "live";
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

function repairJobPathFromRequest(job: JobDetail, request: CreateJobRequest): JobDetail {
  const inputPath = request.inputPaths[0] ?? "";
  if (!inputPath || hasReplacementChar(fileName(inputPath))) {
    return job;
  }
  const hasCorruptInput = job.inputPaths.some((path) => hasReplacementChar(fileName(path))) || hasReplacementChar(fileName(job.currentFile)) || hasReplacementChar(fileName(job.title));
  const outputDirectory = job.outputDirectory && !hasReplacementChar(job.outputDirectory) ? job.outputDirectory : request.outputDirectory;
  const repaired: JobDetail = {
    ...job,
    inputPaths: hasCorruptInput || job.inputPaths.length === 0 ? request.inputPaths : job.inputPaths,
    currentFile: hasCorruptInput || !job.currentFile ? inputPath : job.currentFile,
    title: hasReplacementChar(fileName(job.title)) || !job.title ? titleFromRequest(request) : job.title,
    outputDirectory
  };
  if (job.result?.subtitlePath && hasReplacementChar(fileName(job.result.subtitlePath))) {
    const subtitlePath = outputPathFromRequest(request);
    repaired.result = {
      ...job.result,
      subtitlePath,
      outputFolder: sourceDirectory(subtitlePath) ?? job.result.outputFolder
    };
  }
  return repaired;
}

function titleFromRequest(request: CreateJobRequest): string {
  const inputName = fileName(request.inputPaths[0] ?? "") || "subtitle";
  if (request.type === "burn_in") {
    return inputName.replace(/\.[^.\\/]+$/, ".burned.mp4");
  }
  if (request.type === "translate_srt") {
    return inputName.replace(/\.[^.\\/]+$/i, isPlainTextTranslationInput(inputName) ? ".translated.txt" : ".translated.srt");
  }
  return inputName;
}

function outputPathFromRequest(request: CreateJobRequest): string {
  if (request.outputPath) {
    return request.outputPath;
  }
  const first = request.inputPaths[0] ?? "output";
  const stem = fileName(first).replace(/\.[^.\\/]+$/, "") || "output";
  const directory = request.outputDirectory || sourceDirectory(first) || "";
  const sep = directory.includes("/") && !directory.includes("\\") ? "/" : "\\";
  if (request.type === "burn_in") {
    return directory ? `${directory}${sep}${stem}.burned.mp4` : `${stem}.burned.mp4`;
  }
  if (request.type === "translate_srt") {
    const extension = isPlainTextTranslationInput(first) ? "txt" : request.outputFormat;
    return directory ? `${directory}${sep}${stem}.translated.${extension}` : `${stem}.translated.${extension}`;
  }
  return directory ? `${directory}${sep}${stem}.${request.outputFormat}` : `${stem}.${request.outputFormat}`;
}

function hasReplacementChar(value: string): boolean {
  return value.includes("\uFFFD");
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || "";
}

function isPlainTextTranslationInput(path: string): boolean {
  return [".txt", ".text", ".md", ".markdown"].some((extension) => path.toLowerCase().endsWith(extension));
}

function mergeJobSnapshot(current: JobDetail | null, snapshot: JobDetail): JobDetail {
  const normalizedSnapshot = normalizeTerminalProgress(snapshot);
  if (!current) {
    return normalizedSnapshot;
  }
  return {
    ...current,
    status: normalizedSnapshot.status,
    statusLabel: normalizedSnapshot.statusLabel,
    progressPercent: normalizedSnapshot.progressPercent || current.progressPercent,
    stageLabel: normalizedSnapshot.stageLabel || current.stageLabel,
    currentFile: normalizedSnapshot.currentFile || current.currentFile,
    createdAt: normalizedSnapshot.createdAt || current.createdAt,
    logs: normalizedSnapshot.logs.length ? normalizedSnapshot.logs : current.logs
  };
}

function mergeCreatedJobs(currentJobs: JobSummary[], createdJobs: JobDetail[]): JobSummary[] {
  return mergeJobSummaries(currentJobs, createdJobs);
}

function mergeJobSummaries(currentJobs: JobSummary[], details: JobDetail[]): JobSummary[] {
  const next = new Map(currentJobs.map((job) => [job.id, job]));
  for (const job of details) {
    const normalizedJob = normalizeTerminalProgress(job);
    const { logs: _logs, inputPaths: _inputPaths, result: _result, error: _error, estimatedRemaining: _estimatedRemaining, ...summary } = normalizedJob;
    next.set(job.id, summary);
  }
  return Array.from(next.values());
}

function mergeJobDetails(currentJobs: JobDetail[], details: JobDetail[]): JobDetail[] {
  const next = new Map(currentJobs.map((job) => [job.id, job]));
  for (const job of details) {
    next.set(job.id, normalizeTerminalProgress(job));
  }
  return Array.from(next.values());
}

function normalizeTerminalProgress<T extends JobSummary>(job: T): T {
  return job.status === "succeeded" ? { ...job, progressPercent: 100 } : job;
}

function isTerminalJobStatus(status: JobStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "canceled" || status === "interrupted";
}

function isActiveJobStatus(status: JobStatus): boolean {
  return status === "queued" || status === "running" || status === "canceling";
}

async function loadBatchJobDetails(client: FastSubClient, batchIds: string[], latestJob: JobDetail | null): Promise<JobDetail[]> {
  const latestById = latestJob ? new Map([[latestJob.id, latestJob]]) : new Map<string, JobDetail>();
  const details = await Promise.all(batchIds.map(async (id) => {
    const latest = latestById.get(id);
    if (latest) {
      return latest;
    }
    try {
      return await client.getJob(id);
    } catch {
      return null;
    }
  }));
  return details.filter((job): job is JobDetail => Boolean(job));
}
