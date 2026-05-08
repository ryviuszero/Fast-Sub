import type { ConfigViewModel, EnvironmentStatus, JobDetail, JobLogEntry, ModelStatus, ProviderStatus, UiError } from "../../../shared/contracts/types";

export const mockPaths = {
  spaced: "C:\\Users\\Example\\Videos\\a b.mp4",
  chinese: "D:\\资料\\视频\\片段.mp4",
  unc: "\\\\NAS\\data\\others\\资料\\clip.mp4",
  output: "C:\\Users\\Example\\Videos"
};

export const defaultConfig: ConfigViewModel = {
  defaultLanguage: "auto",
  outputLocation: "source",
  outputConflict: "ask",
  device: "auto",
  outputType: "original_srt",
  asrProvider: "local-faster-whisper",
  translationProvider: "local-nllb-ct2",
  asrModel: "whisper-small",
  translationModel: "nllb-ct2-base",
  keepTempFiles: false,
  wordTimestamps: false,
  apiKeyAlias: "openai-default (sk-****1234)"
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
  modelDirectoryReady: true,
  daemonReady: true,
  warnings: []
};

export const baseModels: ModelStatus[] = [
  { id: "whisper-small", name: "Whisper Small", kind: "asr", state: "ready", sizeLabel: "约 466 MB", requiredForMainFlow: true },
  { id: "nllb-ct2-base", name: "NLLB CTranslate2", kind: "translation", state: "ready", sizeLabel: "约 1.2 GB", requiredForMainFlow: false },
  { id: "whisper-cpp-base", name: "whisper.cpp Base", kind: "asr", state: "missing", sizeLabel: "约 142 MB", requiredForMainFlow: false }
];

export const baseProviders: ProviderStatus[] = [
  { id: "local-faster-whisper", name: "本地 Faster Whisper", kind: "local", capability: "stt", state: "available", enabled: true, privacyNote: "本地处理音频，不上传。", requiresUploadConfirmation: false },
  { id: "local-nllb-ct2", name: "本地 NLLB 翻译", kind: "local", capability: "translation", state: "available", enabled: true, privacyNote: "本地处理字幕文本。", requiresUploadConfirmation: false },
  { id: "api-openai-transcription", name: "OpenAI 音频转写 API", kind: "api", capability: "stt", state: "missing_api_key", enabled: false, privacyNote: "会上传音频，可能产生费用。", requiresUploadConfirmation: true, maskedCredential: "未配置" },
  { id: "web-bing", name: "Bing 网页翻译", kind: "web", capability: "translation", state: "disabled", enabled: false, privacyNote: "会把字幕文本发送到第三方网页翻译服务。", requiresUploadConfirmation: true }
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
    inputPaths: [mockPaths.spaced],
    outputDirectory: mockPaths.output,
    providerName: "本地 Faster Whisper",
    modelName: "Whisper Small",
    logs: redactedLogs,
    ...overrides
  };
}
