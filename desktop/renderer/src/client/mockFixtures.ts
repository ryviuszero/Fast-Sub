import type { ConfigViewModel, EnvironmentStatus, JobDetail, JobLogEntry, ModelStatus, ProviderStatus, UiError } from "../../../shared/contracts/types";

export const mockPaths = {
  spaced: "C:\\Users\\Example\\Videos\\a b.mp4",
  chinese: "D:\\资料\\视频\\片段.mp4",
  unc: "\\\\NAS\\share\\media\\clip.mp4",
  output: "C:\\Users\\Example\\Videos"
};

export const defaultConfig: ConfigViewModel = {
  defaultLanguage: "auto",
  targetLanguage: "zh",
  outputLocation: "source",
  outputConflict: "ask",
  outputFormat: "srt",
  device: "auto",
  outputType: "original_srt",
  burnInVideo: false,
  asrProvider: "local-faster-whisper",
  translationProvider: "local-nllb-ct2",
  asrModel: "whisper-small",
  translationModel: "nllb-200-distilled-600m-ct2-int8",
  keepTempFiles: false,
  wordTimestamps: false,
  folderScanIncludeSubfolders: false,
  folderScanMaxFiles: 100,
  apiKeyAlias: "FAST_SUB_OPENAI_API_KEY",
  openAIBaseUrl: "https://api.openai.com/v1",
  openAIModel: "",
  openAIUploadFormat: "wav",
  apiKeyStatus: "missing"
};

export const disconnectedError: UiError = {
  code: "daemon_disconnected",
  title: "本地服务暂时不可用",
  message: "字幕服务没有响应。请尝试一键修复后重新检查。",
  action: "尝试一键修复并重新同步",
  recoveryActions: ["repair_daemon", "open_diagnostics"],
  diagnostic: "daemon token=[REDACTED]; Authorization=[REDACTED]"
};

export const baseEnvironment: EnvironmentStatus = {
  health: "ok",
  os: "Windows",
  arch: "x64",
  memory: "16 GB 可用",
  disk: "240 GB 可用",
  localTranscriptionReady: true,
  localTranslationReady: true,
  ffmpegReady: true,
  ffmpegInstalling: false,
  ffmpegInstallProgressPercent: 100,
  ffmpegInstallLogs: [],
  nativeDependencies: {
    ffmpegPair: {
      ready: true,
      source: "app-private",
      displayPath: "app-private FFmpeg",
      ffmpegVersion: "ffmpeg version mock",
      ffprobeVersion: "ffprobe version mock",
      progressPercent: 100,
      logs: []
    },
    aria2: {
      ready: false,
      source: "missing",
      displayPath: "HTTPS fallback",
      lastError: "aria2 unavailable; using HTTPS fallback."
    }
  },
  modelDirectoryReady: true,
  daemonReady: true,
  warnings: []
};

export const baseModels: ModelStatus[] = [
  { id: "whisper-base", name: "Whisper Base", kind: "asr", state: "ready", sizeLabel: "约 141 MB", backend: "faster-whisper", compatibleProviders: ["local-faster-whisper"], defaultFor: ["local-faster-whisper"], requiredForMainFlow: false },
  { id: "whisper-small", name: "Whisper Small", kind: "asr", state: "ready", sizeLabel: "约 464 MB", backend: "faster-whisper", compatibleProviders: ["local-faster-whisper"], requiredForMainFlow: true },
  { id: "whisper-large-v3-turbo", name: "Whisper Large v3 Turbo", kind: "asr", state: "missing", sizeLabel: "约 1547 MB", backend: "faster-whisper", compatibleProviders: ["local-faster-whisper"], requiredForMainFlow: false },
  { id: "whispercpp-base", name: "Whisper Base GGML for whisper.cpp", kind: "asr", state: "ready", sizeLabel: "约 141 MB", backend: "whisper.cpp", compatibleProviders: ["local-whisper-cpp"], defaultFor: ["local-whisper-cpp"], requiredForMainFlow: false },
  { id: "whispercpp-small", name: "Whisper Small GGML for whisper.cpp", kind: "asr", state: "missing", sizeLabel: "约 465 MB", backend: "whisper.cpp", compatibleProviders: ["local-whisper-cpp"], requiredForMainFlow: false },
  { id: "nllb-200-distilled-600m-ct2-int8", name: "NLLB-200 Distilled 600M CTranslate2 INT8", kind: "translation", state: "ready", sizeLabel: "约 601 MB", backend: "nllb-ct2", compatibleProviders: ["local-nllb-ct2"], defaultFor: ["local-nllb-ct2"], requiredForMainFlow: false }
];

export const baseProviders: ProviderStatus[] = [
  { id: "local-faster-whisper", name: "本地 Faster Whisper", kind: "local", capability: "stt", state: "available", enabled: true, privacyNote: "本地处理音频，不上传。", requiresUploadConfirmation: false, requiresModel: true, supportsBatch: true, supportsWordTimestamps: true, supportedLanguages: ["auto", "en", "zh", "ja", "ko"], capabilities: ["transcribe", "srt", "word_timestamps"], compatibleModelTypes: ["asr"] },
  { id: "local-whisper-cpp", name: "本地 whisper.cpp", kind: "native", capability: "stt", state: "available", enabled: true, privacyNote: "Native 本地转写，不上传音频。", requiresUploadConfirmation: false, requiresModel: true, supportsBatch: false, supportsWordTimestamps: false, supportedLanguages: ["auto", "en", "zh", "ja", "ko"], capabilities: ["transcribe", "native_binary"], compatibleModelTypes: ["asr"] },
  { id: "api-openai-transcription", name: "OpenAI 音频转写 API", kind: "api", capability: "stt", state: "available", checkMode: "static", enabled: true, privacyNote: "会上传音频，可能产生费用。", requiresUploadConfirmation: true, requiresApiKey: false, requiresModel: true, supportsBatch: false, supportsWordTimestamps: false, supportedLanguages: ["auto", "en", "zh", "ja", "ko"], capabilities: ["transcribe", "remote_api"], compatibleModelTypes: ["api"], maskedCredential: "未配置" },
  { id: "local-nllb-ct2", name: "本地 NLLB 翻译", kind: "local", capability: "translation", state: "available", enabled: true, privacyNote: "本地处理字幕文本。", requiresUploadConfirmation: false, requiresModel: true, supportsBatch: true, supportedLanguages: ["en", "zh", "ja", "ko"], capabilities: ["translate_srt", "offline"], compatibleModelTypes: ["translation"] },
  { id: "web-bing", name: "Bing 网页翻译", kind: "web", capability: "translation", state: "available", enabled: true, privacyNote: "会把字幕文本发送到第三方网页翻译服务；无 API Key，但属于 best-effort experimental provider。", requiresUploadConfirmation: true, supportsBatch: true, supportedLanguages: ["auto", "en", "zh", "ja", "ko"], capabilities: ["translate_srt", "web", "experimental"] },
  { id: "web-google", name: "Google 网页翻译", kind: "web", capability: "translation", state: "available", enabled: true, privacyNote: "会把字幕文本发送到第三方网页翻译服务；无 API Key，但属于 best-effort experimental provider。", requiresUploadConfirmation: true, supportsBatch: true, supportedLanguages: ["auto", "en", "zh", "ja", "ko"], capabilities: ["translate_srt", "web", "experimental"] },
  { id: "api-openai-chat", name: "OpenAI 兼容翻译 API", kind: "api", capability: "translation", state: "available", checkMode: "static", enabled: true, privacyNote: "会上传字幕文本，可能产生费用。", requiresUploadConfirmation: true, requiresApiKey: false, supportsBatch: true, supportedLanguages: ["auto", "en", "zh", "ja", "ko"], capabilities: ["translate_srt", "remote_api"], maskedCredential: "未配置" }
];

export const redactedLogs: JobLogEntry[] = [
  { time: "10:11:02", level: "info", message: "检查媒体文件 C:\\Users\\Example\\Videos\\a b.mp4" },
  { time: "10:11:05", level: "info", message: "Authorization: [REDACTED]" },
  { time: "10:11:09", level: "warning", message: "远程 provider 未启用，保持本地路径。" }
];

export function createSeedJob(overrides: Partial<JobDetail> = {}): JobDetail {
  return {
    id: `mock-${Date.now().toString(36)}`,
    displayId: "任务",
    type: "transcribe",
    status: "queued",
    statusLabel: "等待中",
    title: "a b.mp4",
    currentFile: mockPaths.spaced,
    progressPercent: 0,
    stageLabel: "等待开始",
    createdAt: "刚刚",
    language: "自动识别",
    inputPaths: [mockPaths.spaced],
    outputDirectory: mockPaths.output,
    providerName: "本地 Faster Whisper",
    modelName: "Whisper Small",
    logs: redactedLogs,
    ...overrides
  };
}
