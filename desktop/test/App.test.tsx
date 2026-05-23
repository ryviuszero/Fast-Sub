import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../renderer/src/App";
import { I18nProvider } from "../renderer/src/app/i18n";
import { MainGenerating } from "../renderer/src/app/screens/main";
import { QueueDetail } from "../renderer/src/app/screens/queue";
import { SettingsDiagnostics } from "../renderer/src/app/screens/settings";
import { MockFastSubClient } from "../renderer/src/client/MockFastSubClient";
import { baseModels, baseProviders, createSeedJob, defaultConfig } from "../renderer/src/client/mockFixtures";
import type { ConfigViewModel, CreateJobRequest, EnvironmentStatus, JobDetail, JobEventHandlers, JobSummary, LocalDataCleanupTarget, ModelStatus, ProviderStatus, UiError } from "../shared/contracts/types";

beforeEach(() => {
  setNavigatorLanguage("zh-CN");
});

afterEach(() => {
  window.localStorage.clear();
  window.fastSubSystem = createDefaultSystemBridge();
  cleanup();
});

function createDefaultSystemBridge(): NonNullable<Window["fastSubSystem"]> {
  return {
    selectMediaFiles: async () => [],
    selectMediaFolder: async () => [],
    selectFolder: async () => null,
    selectSubtitleOutputPath: async () => null,
    getPathForFile: (file) => (file as File & { path?: string }).path ?? file.name,
    openPathMock: async () => true,
    openExternalURL: async () => true,
    getSecuritySnapshot: async () => ({
      contextIsolation: true,
      nodeIntegration: false,
      csp: true,
      exposesRawIpc: false
    })
  };
}

function setNavigatorLanguage(language: string) {
  Object.defineProperty(window.navigator, "language", {
    value: language,
    configurable: true
  });
}

async function chooseVideo(name = "a b.mp4") {
  await Promise.resolve();
  const input = screen.getByLabelText("选择视频文件");
  const file = new File(["mock"], name, { type: "video/mp4" });
  fireEvent.change(input, { target: { files: [file] } });
}

async function chooseFolder() {
  await Promise.resolve();
  const input = screen.getByLabelText("选择媒体文件夹");
  const files = [
    new File(["mock"], "folder-a.mp4", { type: "video/mp4" }),
    new File(["mock"], "folder-b.wav", { type: "audio/wav" })
  ];
  fireEvent.change(input, { target: { files } });
}

async function waitForLocalReady() {
  await screen.findByText("本地转写就绪");
  await screen.findByText("翻译就绪");
}

function dropFileOn(label: string, file: File) {
  const target = screen.getByText(label).closest("section") as HTMLElement;
  fireEvent.drop(target, { dataTransfer: { files: [file] } });
}

function chooseProviderDropdownOption(label: string, option: string | RegExp) {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

async function chooseProviderDropdownOptionAsync(label: string, option: string | RegExp) {
  fireEvent.click(screen.getByLabelText(label));
  const listbox = screen.getByRole("listbox");
  fireEvent.click(await within(listbox).findByRole("option", { name: option }));
}

function progressCardPercent(): number {
  const text = document.querySelector(".progress-card strong")?.textContent ?? "0%";
  return Number(text.replace("%", ""));
}

describe("Fast Sub renderer flow", () => {
  async function enterMainScreen() {
    const enterButton = await screen.findByRole("button", { name: "进入主界面" });
    await waitFor(() => expect(enterButton).toBeEnabled());
    fireEvent.click(enterButton);
    fireEvent.click(await screen.findByRole("button", { name: "进入主界面" }));
  }

  it("walks from setup into the main mock generation flow", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "环境检查" })).toBeInTheDocument();
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "添加视频" }));
    await chooseVideo();
    expect(await screen.findByText("a b.mp4")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    await waitFor(() => expect(screen.getByRole("heading", { name: "字幕生成完成" })).toBeInTheDocument());
    expect(document.body.textContent).not.toContain("mock-1");
    expect(document.body.textContent).not.toContain("SSE");
    expect(document.body.textContent).not.toContain("Authorization");
  });

  it("uses the system language for the default interface language", async () => {
    setNavigatorLanguage("en-US");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Environment check" })).toBeInTheDocument();
  });

  it("opens the help document in the system browser", async () => {
    const openExternalURL = vi.fn(async () => true);
    window.fastSubSystem = {
      selectMediaFiles: async () => [],
      selectMediaFolder: async () => [],
      selectFolder: async () => null,
      selectSubtitleOutputPath: async () => null,
      getPathForFile: (file) => (file as File & { path?: string }).path ?? file.name,
      openPathMock: async () => true,
      openExternalURL,
      getSecuritySnapshot: async () => ({
        contextIsolation: true,
        nodeIntegration: false,
        csp: true,
        exposesRawIpc: false
      })
    };
    render(<App />);
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "帮助" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Fast Sub 文档" }));
    expect(openExternalURL).toHaveBeenCalledWith("https://ryviuszero.github.io/Fast-Sub/");
  });

  it("automatically creates a burn-in job after transcription when burn-in is enabled", async () => {
    const requests: CreateJobRequest[] = [];
    class BurnInEnabledClient extends MockFastSubClient {
      async getConfig(): Promise<ConfigViewModel> {
        return { ...(await super.getConfig()), burnInVideo: true };
      }

      async createJob(request: CreateJobRequest): Promise<JobDetail> {
        requests.push(request);
        return super.createJob(request);
      }
    }
    render(<App client={new BurnInEnabledClient("setupReady")} />);
    await enterMainScreen();
    await waitForLocalReady();
    fireEvent.click(await screen.findByRole("button", { name: "添加视频" }));
    await chooseVideo("burn-me.mp4");
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);

    await waitFor(() => expect(requests.map((request) => request.type)).toEqual(["transcribe", "burn_in"]));
    expect(requests[1]?.inputPaths[0]).toBe("burn-me.mp4");
    expect(requests[1]?.inputPaths[1]).toMatch(/burn-me\.srt$/);
    expect(requests[1]?.outputType).toBe("burned_video");
    expect(await screen.findByRole("heading", { name: "字幕生成完成" })).toBeInTheDocument();
    expect(screen.getByText("burn-me.burned.mp4")).toBeInTheDocument();
  });

  it("skips the setup gate after onboarding and refreshes the main screen in the background", async () => {
    window.localStorage.setItem("fast-sub:onboarding-complete", "1");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "拖拽视频到这里" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "环境检查" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("本地转写就绪")).toBeInTheDocument());
  });

  it("keeps the main screen usable when the ASR model is not ready", async () => {
    class MissingASRClient extends MockFastSubClient {
      async listModels(): Promise<ModelStatus[]> {
        return (await super.listModels()).map((model) => model.kind === "asr" ? { ...model, state: "missing" } : model);
      }
    }
    window.localStorage.setItem("fast-sub:onboarding-complete", "1");
    render(<App client={new MissingASRClient("setupReady")} />);
    expect(await screen.findByRole("heading", { name: "拖拽视频到这里" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("本地转写未就绪")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "缺少 ASR 模型" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加视频" }));
    await chooseVideo();
    expect(await screen.findByText("a b.mp4")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    expect(await screen.findByRole("heading", { name: "还不能生成字幕" })).toBeInTheDocument();
    expect(screen.getByText("缺少默认 ASR 模型。下载完成后即可使用本地转写。")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("确认使用 API 服务");
  });

  it("shows task queue and settings entrances", async () => {
    render(<App />);
    fireEvent.click(await screen.findByLabelText("打开调试面板"));
    fireEvent.click(screen.getByRole("button", { name: "任务列表" }));
    expect(await screen.findByText("全部 5")).toBeInTheDocument();
    const queueTabs = document.querySelector(".tabs") as HTMLElement;
    fireEvent.click(within(queueTabs).getByRole("button", { name: "已完成 1" }));
    expect(screen.getByText("a b.mp4")).toBeInTheDocument();
    expect(screen.getByText("完成 今天 10:18")).toBeInTheDocument();
    expect(screen.getByText("自动识别")).toBeInTheDocument();
    expect(screen.queryByText(/输出 C:\\Users\\Example\\Videos/)).not.toBeInTheDocument();
    expect(screen.queryByText("sample-meeting.mp4")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("a b.mp4"));
    expect(screen.getByText("已选择 1 项")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "a b.mp4" })).not.toBeInTheDocument();
    fireEvent.doubleClick(screen.getByText("a b.mp4"));
    expect(await screen.findByRole("heading", { name: "a b.mp4" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "详情" }));
    expect(screen.getByText("语言")).toBeInTheDocument();
    expect(screen.getByText("自动识别")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回任务列表" }));
    fireEvent.click(within(document.querySelector(".tabs") as HTMLElement).getByRole("button", { name: "失败 1" }));
    expect(screen.getByText("raw-cam.mov")).toBeInTheDocument();
    expect(screen.queryByText("a b.mp4")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "通用设置" }));
    expect(screen.getByRole("heading", { name: "通用" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "诊断" }).at(-1) as HTMLElement);
    expect(screen.getByRole("heading", { name: "本地服务状态" })).toBeInTheDocument();
    expect(screen.getByText("已脱敏")).toBeInTheDocument();
    expect(screen.queryByText(/credential=/)).not.toBeInTheDocument();
    expect(screen.queryByText(/api_key=/)).not.toBeInTheDocument();
  });

  it("selects all filtered queue jobs including hidden rows", async () => {
    const deleted: string[] = [];
    const manyJobs = Array.from({ length: 45 }, (_, index) => createSeedJob({
      id: `done-${index}`,
      title: `CALLBOX_${index}.mp3`,
      status: "succeeded",
      statusLabel: "已完成",
      completedAt: `2026-05-10T17:${String(index).padStart(2, "0")}:00.000Z`
    }));
    class ManyJobsClient extends MockFastSubClient {
      async listJobs(): Promise<JobSummary[]> {
        return manyJobs.filter((job) => !deleted.includes(job.id));
      }

      async getJob(jobId: string): Promise<JobDetail> {
        return manyJobs.find((job) => job.id === jobId) ?? super.getJob(jobId);
      }

      async deleteJob(jobId: string): Promise<void> {
        deleted.push(jobId);
      }
    }
    render(<App client={new ManyJobsClient("setupReady")} />);
    await enterMainScreen();
    fireEvent.click(screen.getByRole("button", { name: /历史记录|查看进行中/ }));
    expect(await screen.findByText("全部 40 / 45")).toBeInTheDocument();
    expect(screen.getByText("仅显示最近 40 条任务，已隐藏更早的 5 条记录。")).toBeInTheDocument();
    fireEvent.click(screen.getByText("CALLBOX_44.mp3"));
    expect(screen.getByText("已选择 1 项")).toBeInTheDocument();
    fireEvent.click(screen.getByText("CALLBOX_43.mp3"), { ctrlKey: true });
    expect(screen.getByText("已选择 2 项")).toBeInTheDocument();
    expect(fireEvent.mouseDown(screen.getByText("CALLBOX_40.mp3").closest("article") as HTMLElement, { shiftKey: true })).toBe(false);
    fireEvent.click(screen.getByText("CALLBOX_40.mp3"), { ctrlKey: true, shiftKey: true });
    expect(screen.getByText("已选择 5 项")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "清除选择" }));
    fireEvent.click(screen.getByLabelText("全选所有项"));
    expect(screen.getByText("已选择 45 项")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除选中记录" }));
    await waitFor(() => expect(deleted).toHaveLength(45));
  });

  it("hides model install jobs from the transcription queue", async () => {
    const jobs: JobSummary[] = [
      createSeedJob({ id: "install-small", type: "model_install", title: "whisper-small 安装", status: "succeeded", statusLabel: "已完成", completedAt: "2026-05-10T17:12:00.000Z" }),
      createSeedJob({ id: "install-nllb", type: "model_install", title: "nllb 安装", status: "running", statusLabel: "正在下载", progressPercent: 33, stageLabel: "正在下载模型" }),
      createSeedJob({ id: "transcribe-1", type: "transcribe", title: "clip.mp4", status: "succeeded", statusLabel: "已完成", completedAt: "2026-05-10T17:13:00.000Z" })
    ];
    class QueueClient extends MockFastSubClient {
      async listJobs(): Promise<JobSummary[]> {
        return jobs;
      }
    }
    render(<App client={new QueueClient("setupReady")} />);
    await enterMainScreen();
    fireEvent.click(screen.getByRole("button", { name: /历史记录|查看进行中/ }));

    expect(await screen.findByText("全部 1")).toBeInTheDocument();
    expect(screen.getByText("clip.mp4")).toBeInTheDocument();
    expect(screen.queryByText("whisper-small 安装")).not.toBeInTheDocument();
    expect(screen.queryByText("nllb 安装")).not.toBeInTheDocument();
  });

  it("updates general settings options", async () => {
    render(<App />);
    await enterMainScreen();
    await waitForLocalReady();
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: "简体中文" }));
    expect(screen.getByRole("button", { name: "简体中文" })).toHaveClass("on");
    fireEvent.click(screen.getByRole("button", { name: "手绘字体" }));
    expect(document.querySelector(".prototype-window")).toHaveClass("font-sketch");
    fireEvent.click(screen.getByRole("button", { name: "双语字幕" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "双语字幕" })).toHaveClass("on"));
    fireEvent.click(screen.getByRole("button", { name: "VTT" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "VTT" })).toHaveClass("on"));
    expect(screen.getByRole("button", { name: "双语字幕" })).toHaveClass("on");
    fireEvent.change(screen.getByDisplayValue("简体中文"), { target: { value: "en" } });
    await waitFor(() => expect(screen.getByDisplayValue("英语")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "跳过" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "跳过" })).toHaveClass("on"));
    expect(screen.getByRole("button", { name: "双语字幕" })).toHaveClass("on");
    expect(screen.getByRole("button", { name: "VTT" })).toHaveClass("on");
    chooseProviderDropdownOption("默认转写 Provider", /whisper\.cpp/);
    await waitFor(() => expect(screen.getByLabelText("默认转写 Provider")).toHaveTextContent("whisper.cpp"));
    chooseProviderDropdownOption("默认翻译 Provider", /Bing/);
    await waitFor(() => expect(screen.getByLabelText("默认翻译 Provider")).toHaveTextContent("Bing"));
    fireEvent.click(screen.getByRole("button", { name: "GPU" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "GPU" })).toHaveClass("on"));
    const wordToggle = screen.getByRole("button", { name: "设置词级时间戳" });
    fireEvent.click(wordToggle);
    await waitFor(() => expect(wordToggle).toHaveAttribute("aria-pressed", "true"));
  });

  it("switches the main interface to English", async () => {
    render(<App />);
    await enterMainScreen();
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(await screen.findByRole("heading", { name: "General" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Window" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Generate subtitles" }));
    expect(await screen.findByRole("heading", { name: "Drop video here" })).toBeInTheDocument();
    expect(screen.getByText("Source language")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add video" })).toBeInTheDocument();
  });

  it("updates provider settings mock controls", async () => {
    render(<App />);
    await enterMainScreen();
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: /服务商/ }));
    expect(await screen.findByRole("heading", { name: "转写方式" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "翻译 Provider" })).toBeInTheDocument();
    expect(await screen.findByText("OpenAI 音频转写 API")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("可用").length).toBeGreaterThan(0));
    expect(screen.queryByText("missing_api_key")).not.toBeInTheDocument();
    const openAiCard = screen.getByText("OpenAI 音频转写 API").closest("article") as HTMLElement;
    expect(within(openAiCard).getByRole("button", { name: "设为默认" })).toBeDisabled();
    expect(within(openAiCard).getByText("先做连接检查")).toBeInTheDocument();
    fireEvent.change(within(openAiCard).getByLabelText("OpenAI 音频转写 API API Key"), { target: { value: "sk-test-secret" } });
    fireEvent.click(within(openAiCard).getByRole("button", { name: "保存密钥" }));
    await waitFor(() => expect(within(openAiCard).getByText(/已保存到 FAST_SUB_OPENAI_TRANSCRIPTION_API_KEY/)).toBeInTheDocument());
    expect(within(openAiCard).getByLabelText("OpenAI 音频转写 API API Key")).toHaveValue("");
    expect(document.body).not.toHaveTextContent("sk-test-secret");
    fireEvent.change(within(openAiCard).getByLabelText("OpenAI 音频转写 API API Key"), { target: { value: "sk-replacement-secret" } });
    fireEvent.click(within(openAiCard).getByRole("button", { name: "替换密钥" }));
    await waitFor(() => expect(within(openAiCard).getByText(/已保存到 FAST_SUB_OPENAI_TRANSCRIPTION_API_KEY/)).toBeInTheDocument());
    expect(within(openAiCard).getByLabelText("OpenAI 音频转写 API API Key")).toHaveValue("");
    expect(document.body).not.toHaveTextContent("sk-replacement-secret");
    fireEvent.click(within(openAiCard).getByRole("button", { name: "删除密钥" }));
    await waitFor(() => expect(within(openAiCard).getByText(/未配置/)).toBeInTheDocument());
    expect(within(openAiCard).queryByRole("button", { name: "删除密钥" })).not.toBeInTheDocument();
    expect(within(openAiCard).queryByText("快速填充提供方")).not.toBeInTheDocument();
    expect(within(openAiCard).getByRole("button", { name: "显示" })).toBeInTheDocument();
    expect(within(openAiCard).getByLabelText("模型")).toHaveValue("gpt-4o-transcribe");
    fireEvent.change(within(openAiCard).getByLabelText("模型"), { target: { value: "custom-transcribe-model" } });
    expect(within(openAiCard).getByLabelText("模型")).toHaveValue("custom-transcribe-model");
    expect(within(openAiCard).queryByText("NLLB-200 Distilled 600M CTranslate2 INT8")).not.toBeInTheDocument();
    const openAiTranslateCard = screen.getByText("OpenAI 兼容翻译 API").closest("article") as HTMLElement;
    expect(within(openAiTranslateCard).getByRole("button", { name: "设为默认" })).toBeDisabled();
    expect(within(openAiTranslateCard).getByText("先做连接检查")).toBeInTheDocument();
    expect(within(openAiTranslateCard).queryByText("快速填充提供方")).not.toBeInTheDocument();
    expect(within(openAiTranslateCard).getByLabelText("模型")).toHaveValue("gpt-4o-mini");
    expect(within(openAiTranslateCard).queryByText("NLLB-200 Distilled 600M CTranslate2 INT8")).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "检查模型" })[0]);
    await waitFor(() => expect(within(screen.getByText("本地 Faster Whisper").closest("article") as HTMLElement).getByText("模型检查通过")).toBeInTheDocument());
    fireEvent.click(within(openAiTranslateCard).getByRole("button", { name: "连接检查" }));
    await waitFor(() => expect(within(openAiTranslateCard).getByText("连接检查通过")).toBeInTheDocument());
    expect(within(openAiTranslateCard).getByRole("button", { name: "设为默认" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "刷新状态" }));
    await waitFor(() => expect(screen.getByText("已刷新")).toBeInTheDocument());
  });

  it("keeps provider card controls independent before selecting defaults", async () => {
    render(<App />);
    await enterMainScreen();
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: /服务商/ }));
    const fasterCard = (await screen.findByText("本地 Faster Whisper")).closest("article") as HTMLElement;
    const whisperCppCard = screen.getByText("本地 whisper.cpp").closest("article") as HTMLElement;
    const fasterWord = within(fasterCard).getByLabelText("词级时间戳") as HTMLInputElement;
    const whisperCppWord = within(whisperCppCard).getByLabelText("词级时间戳") as HTMLInputElement;
    fireEvent.click(fasterWord);
    await waitFor(() => expect(fasterWord).toBeChecked());
    expect(whisperCppWord).not.toBeChecked();
    fireEvent.change(within(fasterCard).getByLabelText("设备"), { target: { value: "gpu" } });
    await waitFor(() => expect(within(fasterCard).getByLabelText("设备")).toHaveValue("gpu"));
    expect(within(whisperCppCard).getByLabelText("设备")).toHaveValue("auto");
    fireEvent.click(within(whisperCppCard).getByRole("button", { name: "设为默认" }));
    await waitFor(() => expect(within(whisperCppCard).getByText("当前默认")).toBeInTheDocument());
    expect(within(whisperCppCard).getByLabelText("词级时间戳")).not.toBeChecked();
    expect(within(whisperCppCard).getByLabelText("设备")).toHaveValue("auto");
  });

  it("shows the fixed app menu after setup and routes window items", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "环境检查" })).toBeInTheDocument();
    expect(screen.queryByRole("banner", { name: "应用菜单" })).not.toBeInTheDocument();
    await enterMainScreen();

    expect(screen.getByRole("banner", { name: "应用菜单" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "前进" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "窗口" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "帮助" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "翻译SRT" }));
    expect(screen.getByText("翻译字幕 / 文本")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "字幕生成" }));
    expect(screen.getByRole("button", { name: "添加视频" })).toBeInTheDocument();
  });

  it("returns from queue detail back to the queue list", async () => {
    render(<App />);
    await enterMainScreen();
    fireEvent.click(screen.getByRole("button", { name: /历史记录|查看进行中/ }));
    fireEvent.doubleClick(await screen.findByText("sample-meeting.mp4"));
    expect(screen.getByRole("heading", { name: "sample-meeting.mp4" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "日志" }));
    expect(screen.getByText("任务：sample-meeting.mp4", { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "详情" }));
    expect(screen.getByText("Whisper Small")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回任务列表" }));
    expect(screen.getByText("全部 5")).toBeInTheDocument();
  });

  it("uses the app menu back button to return from queue detail to subtitle generation", async () => {
    render(<App />);
    await enterMainScreen();
    fireEvent.click(screen.getByRole("button", { name: /历史记录|查看进行中/ }));
    fireEvent.doubleClick(await screen.findByText("sample-meeting.mp4"));
    expect(screen.getByRole("heading", { name: "sample-meeting.mp4" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(await screen.findByRole("heading", { name: "拖拽视频到这里" })).toBeInTheDocument();
  });

  it("uses the actual job status when rendering a stale failed detail route", () => {
    const props = {
      activeJob: {
        id: "job-done",
        displayId: "D",
        type: "transcribe",
        status: "succeeded",
        statusLabel: "已完成",
        title: "done.mp4",
        currentFile: "done.mp4",
        progressPercent: 100,
        stageLabel: "已完成",
        createdAt: "2026-05-10T00:00:00Z",
        completedAt: "2026-05-10T00:01:00Z",
        inputPaths: ["F:\\game\\done.mp4"],
        outputDirectory: "F:\\game",
        providerName: "Fast Sub",
        modelName: "whisper-small",
        logs: []
      },
      setScreen: vi.fn(),
      retryJob: async () => undefined,
      deleteJob: async () => undefined,
      cancelJob: async () => undefined
    } as unknown as Parameters<typeof QueueDetail>[0];
    render(<QueueDetail {...props} failed />);
    expect(screen.getByText("已完成")).toBeInTheDocument();
    expect(screen.getByText("任务已完成，可以查看日志或配置。")).toBeInTheDocument();
    expect(screen.queryByText("任务失败")).not.toBeInTheDocument();
    expect(screen.queryByText("job_failed")).not.toBeInTheDocument();
  });

  it("adds media from a folder picker", async () => {
    window.fastSubSystem = {
      selectMediaFiles: async () => [],
      selectMediaFolder: async () => [
        "F:\\game\\others\\.DS_Store",
        "F:\\game\\others\\folder-a.mp4",
        "F:\\game\\others\\folder-a.srt",
        "F:\\game\\others\\folder-b.wav",
        "F:\\game\\others\\folder-b.vtt"
      ],
      selectFolder: async () => null,
      selectSubtitleOutputPath: async () => null,
      getPathForFile: (file) => (file as File & { path?: string }).path ?? file.name,
      openPathMock: async () => true,
      openExternalURL: async () => true,
      getSecuritySnapshot: async () => ({
        contextIsolation: true,
        nodeIntegration: false,
        csp: true,
        exposesRawIpc: false
      })
    };
    render(<App />);
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "添加文件夹" }));
    expect(await screen.findByText("folder-a.mp4")).toBeInTheDocument();
    expect(screen.getByText("folder-b.wav")).toBeInTheDocument();
    expect(screen.queryByText(".DS_Store")).not.toBeInTheDocument();
    expect(screen.queryByText("folder-a.srt")).not.toBeInTheDocument();
    expect(screen.queryByText("folder-b.vtt")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "已添加 2 个文件" })).toBeInTheDocument();
  });

  it("shows an import progress state and keeps large folder previews bounded", async () => {
    const selectedPaths = Array.from({ length: 80 }, (_, index) => `F:\\batch\\clip-${String(index).padStart(2, "0")}.mp4`);
    window.fastSubSystem = {
      selectMediaFiles: async () => [],
      selectMediaFolder: async () => selectedPaths,
      selectFolder: async () => null,
      selectSubtitleOutputPath: async () => null,
      getPathForFile: (file) => (file as File & { path?: string }).path ?? file.name,
      openPathMock: async () => true,
      openExternalURL: async () => true,
      getSecuritySnapshot: async () => ({
        contextIsolation: true,
        nodeIntegration: false,
        csp: true,
        exposesRawIpc: false
      })
    };
    render(<App />);
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "添加文件夹" }));
    expect(await screen.findByRole("heading", { name: "正在整理文件" })).toBeInTheDocument();
    expect(screen.getByText("已选择 80 个项目，正在筛选可用媒体文件…")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "已添加 80 个文件" })).toBeInTheDocument();
    expect(screen.getByText("clip-00.mp4")).toBeInTheDocument();
    expect(screen.queryByText("clip-79.mp4")).not.toBeInTheDocument();
    expect(screen.getByText("还有 40 个文件已加入任务，列表中暂不展开显示。")).toBeInTheDocument();
  });

  it("filters unsupported files from the browser folder picker fallback", async () => {
    const media = new File(["mock"], "clip.mp4", { type: "video/mp4" });
    const subtitle = new File(["mock"], "clip.srt", { type: "text/plain" });
    const systemFile = new File(["mock"], ".DS_Store", { type: "application/octet-stream" });
    render(<App />);
    await enterMainScreen();
    fireEvent.change(screen.getByLabelText("选择媒体文件夹"), { target: { files: [systemFile, subtitle, media] } });
    expect(await screen.findByText("clip.mp4")).toBeInTheDocument();
    expect(screen.queryByText("clip.srt")).not.toBeInTheDocument();
    expect(screen.queryByText(".DS_Store")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "已添加 1 个文件" })).toBeInTheDocument();
  });

  it("uses the preload allowlist for media and folder selection", async () => {
    const selectMediaFiles = vi.fn(async () => ["D:\\SampleMedia\\clip.mp4"]);
    const selectFolder = vi.fn(async () => "\\\\NAS\\share\\media");
    window.fastSubSystem = {
      selectMediaFiles,
      selectMediaFolder: async () => ["\\\\NAS\\share\\media\\clip.mp4"],
      selectFolder,
      selectSubtitleOutputPath: async () => null,
      getPathForFile: (file) => (file as File & { path?: string }).path ?? file.name,
      openPathMock: async () => true,
      openExternalURL: async () => true,
      getSecuritySnapshot: async () => ({
        contextIsolation: true,
        nodeIntegration: false,
        csp: true,
        exposesRawIpc: false
      })
    };
    render(<App />);
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "添加视频" }));
    expect(await screen.findByText("clip.mp4")).toBeInTheDocument();
    expect(selectMediaFiles).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(await screen.findByRole("button", { name: "添加文件夹" }));
    expect(await screen.findByText("clip.mp4")).toBeInTheDocument();
  });

  it("uses the selected media directory when output is set to source", async () => {
    const requests: CreateJobRequest[] = [];
    class CaptureClient extends MockFastSubClient {
      async createJob(request: CreateJobRequest): Promise<JobDetail> {
        requests.push(request);
        return super.createJob(request);
      }
    }
    window.fastSubSystem = {
      selectMediaFiles: async () => ["D:\\资料\\视频\\片段.mp4"],
      selectMediaFolder: async () => [],
      selectFolder: async () => null,
      selectSubtitleOutputPath: async () => null,
      getPathForFile: (file) => (file as File & { path?: string }).path ?? file.name,
      openPathMock: async () => true,
      openExternalURL: async () => true,
      getSecuritySnapshot: async () => ({
        contextIsolation: true,
        nodeIntegration: false,
        csp: true,
        exposesRawIpc: false
      })
    };
    render(<App client={new CaptureClient("jobSuccess")} />);
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "添加视频" }));
    expect(await screen.findByText("片段.mp4")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    await waitFor(() => expect(requests[0]?.outputDirectory).toBe("D:\\资料\\视频"));
  });

  it("does not send the mock output directory to real job requests", async () => {
    const requests: CreateJobRequest[] = [];
    class CaptureClient extends MockFastSubClient {
      async createJob(request: CreateJobRequest): Promise<JobDetail> {
        requests.push(request);
        return super.createJob(request);
      }
    }
    window.fastSubSystem = {
      selectMediaFiles: async () => ["F:\\game\\others\\input.mp4"],
      selectMediaFolder: async () => [],
      selectFolder: async () => null,
      selectSubtitleOutputPath: async () => null,
      getPathForFile: (file) => (file as File & { path?: string }).path ?? file.name,
      openPathMock: async () => true,
      openExternalURL: async () => true,
      getSecuritySnapshot: async () => ({
        contextIsolation: true,
        nodeIntegration: false,
        csp: true,
        exposesRawIpc: false
      })
    };
    render(<App client={new CaptureClient("jobSuccess")} />);
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "添加视频" }));
    expect(await screen.findByText("input.mp4")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    await waitFor(() => expect(requests[0]?.outputDirectory).toBe("F:\\game\\others"));
  });

  it("sends translation provider metadata for translated main-flow jobs", async () => {
    const requests: CreateJobRequest[] = [];
    class CaptureClient extends MockFastSubClient {
      async createJob(request: CreateJobRequest): Promise<JobDetail> {
        requests.push(request);
        return super.createJob(request);
      }
    }
    window.fastSubSystem = {
      selectMediaFiles: async () => ["F:\\game\\others\\input.mp4"],
      selectMediaFolder: async () => [],
      selectFolder: async () => null,
      selectSubtitleOutputPath: async () => null,
      getPathForFile: (file) => (file as File & { path?: string }).path ?? file.name,
      openPathMock: async () => true,
      openExternalURL: async () => true,
      getSecuritySnapshot: async () => ({
        contextIsolation: true,
        nodeIntegration: false,
        csp: true,
        exposesRawIpc: false
      })
    };
    render(<App client={new CaptureClient("jobSuccess")} />);
    await enterMainScreen();
    await screen.findByText("翻译就绪");
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: "翻译字幕" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "翻译字幕" })).toHaveClass("on"));
    fireEvent.click(screen.getByRole("menuitem", { name: "字幕生成" }));
    fireEvent.click(await screen.findByRole("button", { name: "添加视频" }));
    expect(await screen.findByText("input.mp4")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);

    await waitFor(() => expect(requests[0]?.outputType).toBe("translated_srt"));
    expect(requests[0]?.translationProviderId).toBe("local-nllb-ct2");
    expect(requests[0]?.translationModelId).toBe("nllb-200-distilled-600m-ct2-int8");
  });

  it("repairs stale incompatible ASR provider/model config before creating jobs", async () => {
    const requests: CreateJobRequest[] = [];
    class StaleASRConfigClient extends MockFastSubClient {
      private cfg: ConfigViewModel = {
        ...defaultConfig,
        asrProvider: "local-whisper-cpp",
        asrModel: "whispercpp-large-v3-turbo-q5_0"
      };
      private providerList: ProviderStatus[] = baseProviders.map((provider) => provider.id === "local-whisper-cpp" ? { ...provider, enabled: false, state: "missing_dependency" } : provider);
      private modelList: ModelStatus[] = baseModels.map((model) => {
        if (model.id === "whisper-small") return { ...model, state: "ready" };
        if (model.id === "whispercpp-large-v3-turbo-q5_0") return { ...model, state: "ready" };
        return model;
      });

      async getConfig(): Promise<ConfigViewModel> {
        return { ...this.cfg };
      }

      async updateConfig(patch: Partial<ConfigViewModel>): Promise<ConfigViewModel> {
        this.cfg = { ...this.cfg, ...patch };
        return { ...this.cfg };
      }

      async listProviders(): Promise<ProviderStatus[]> {
        return this.providerList.map((provider) => ({ ...provider }));
      }

      async listModels(): Promise<ModelStatus[]> {
        return this.modelList.map((model) => ({ ...model }));
      }

      async createJob(request: CreateJobRequest): Promise<JobDetail> {
        requests.push(request);
        return super.createJob(request);
      }
    }
    window.fastSubSystem = {
      selectMediaFiles: async () => ["F:\\game\\others\\input.mp4"],
      selectMediaFolder: async () => [],
      selectFolder: async () => null,
      selectSubtitleOutputPath: async () => null,
      getPathForFile: (file) => (file as File & { path?: string }).path ?? file.name,
      openPathMock: async () => true,
      openExternalURL: async () => true,
      getSecuritySnapshot: async () => ({
        contextIsolation: true,
        nodeIntegration: false,
        csp: true,
        exposesRawIpc: false
      })
    };
    render(<App client={new StaleASRConfigClient("jobSuccess")} />);
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "添加视频" }));
    expect(await screen.findByText("input.mp4")).toBeInTheDocument();
    fireEvent.click((await screen.findAllByRole("button", { name: "详细设置" })).at(0) as HTMLElement);
    const providerSelect = screen.getByLabelText("转写方式") as HTMLSelectElement;
    const optionValues = Array.from(providerSelect.options).map((option) => option.value);
    expect(optionValues).not.toContain("local-whisper-cpp");
    expect(optionValues).not.toContain("api-openai-transcription");
    expect(providerSelect.value).toBe("local-faster-whisper");
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);

    await waitFor(() => expect(requests[0]?.providerId).toBe("local-faster-whisper"));
    expect(requests[0]?.modelId).toBe("whisper-small");
  });

  it("installs a missing whisper.cpp provider dependency from the provider card", async () => {
    const installed: string[] = [];
    class MissingWhisperCPPDependencyClient extends MockFastSubClient {
      private providerList: ProviderStatus[] = baseProviders.map((provider) => provider.id === "local-whisper-cpp" ? { ...provider, enabled: false, state: "missing_dependency" } : provider);

      async listProviders(): Promise<ProviderStatus[]> {
        return this.providerList.map((provider) => ({ ...provider }));
      }

      async installProviderDependency(providerId: string): Promise<ProviderStatus> {
        installed.push(providerId);
        const next = this.providerList.find((provider) => provider.id === providerId);
        if (!next) {
          throw new Error("unknown provider");
        }
        const updated = { ...next, enabled: true, state: "available" as const };
        this.providerList = this.providerList.map((provider) => provider.id === providerId ? updated : provider);
        return updated;
      }
    }
    render(<App client={new MissingWhisperCPPDependencyClient("setupReady")} />);
    await enterMainScreen();
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: /服务商/ }));
    const card = (await screen.findByText("本地 whisper.cpp")).closest("article") as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "先安装依赖" }));

    await waitFor(() => expect(installed).toEqual(["local-whisper-cpp"]));
    await waitFor(() => expect(within(card).getByText("可用")).toBeInTheDocument());
  });

  it("creates one daemon job per media file in a folder batch", async () => {
    const requests: CreateJobRequest[] = [];
    class CaptureClient extends MockFastSubClient {
      async createJob(request: CreateJobRequest): Promise<JobDetail> {
        requests.push(request);
        return super.createJob(request);
      }

      subscribeJobEvents(_jobId: string, _handlers: JobEventHandlers): () => void {
        return () => undefined;
      }
    }
    window.fastSubSystem = {
      selectMediaFiles: async () => [],
      selectMediaFolder: async () => ["F:\\game\\others\\a.mp4", "F:\\game\\others\\b.wav", "F:\\game\\others\\c.mov"],
      selectFolder: async () => null,
      selectSubtitleOutputPath: async () => null,
      getPathForFile: (file) => (file as File & { path?: string }).path ?? file.name,
      openPathMock: async () => true,
      openExternalURL: async () => true,
      getSecuritySnapshot: async () => ({
        contextIsolation: true,
        nodeIntegration: false,
        csp: true,
        exposesRawIpc: false
      })
    };
    render(<App client={new CaptureClient("jobSuccess")} />);
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "添加文件夹" }));
    expect(await screen.findByText("a.mp4")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    await waitFor(() => expect(requests).toHaveLength(3));
    expect(requests.map((request) => request.inputPaths)).toEqual([["F:\\game\\others\\a.mp4"], ["F:\\game\\others\\b.wav"], ["F:\\game\\others\\c.mov"]]);
    expect(await screen.findByText("任务 1 / 3")).toBeInTheDocument();
    expect(screen.getByText("b.wav")).toBeInTheDocument();
    expect(screen.getByText("c.mov")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "后台运行" }));
    expect(await screen.findByText("正在生成 6")).toHaveClass("on");
    expect(screen.getByText("a.mp4")).toBeInTheDocument();
    expect(screen.getByText("b.wav")).toBeInTheDocument();
    expect(screen.getByText("c.mov")).toBeInTheDocument();
  });

  it("keeps a folder batch on the generating screen until every job succeeds", async () => {
    const handlers = new Map<string, JobEventHandlers>();
    const succeeded = new Set<string>();
    const resultFor = (name: string) => ({
      subtitlePath: `F:\\game\\others\\${name}.srt`,
      outputFolder: "F:\\game\\others",
      summary: "已生成字幕",
      durationLabel: "5 秒"
    });
    class BatchClient extends MockFastSubClient {
      async listJobs() {
        const jobs = await super.listJobs();
        return jobs.map((job) => succeeded.has(job.id) ? { ...job, status: "succeeded" as const, statusLabel: "已完成", progressPercent: 100, stageLabel: "已完成" } : job);
      }

      subscribeJobEvents(jobId: string, eventHandlers: JobEventHandlers): () => void {
        handlers.set(jobId, eventHandlers);
        return () => undefined;
      }
    }
    window.fastSubSystem = {
      selectMediaFiles: async () => [],
      selectMediaFolder: async () => ["F:\\game\\others\\a.mp4", "F:\\game\\others\\b.wav", "F:\\game\\others\\c.mov"],
      selectFolder: async () => null,
      selectSubtitleOutputPath: async () => null,
      getPathForFile: (file) => (file as File & { path?: string }).path ?? file.name,
      openPathMock: async () => true,
      openExternalURL: async () => true,
      getSecuritySnapshot: async () => ({
        contextIsolation: true,
        nodeIntegration: false,
        csp: true,
        exposesRawIpc: false
      })
    };
    render(<App client={new BatchClient("jobSuccess")} />);
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "添加文件夹" }));
    expect(await screen.findByText("a.mp4")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    expect(await screen.findByText("任务 1 / 3")).toBeInTheDocument();

    const firstJobId = Array.from(handlers.keys())[0];
    succeeded.add(firstJobId);
    await handlers.get(firstJobId)?.onEvent({ type: "succeeded", result: resultFor("a") });
    await waitFor(() => expect(screen.getByText("任务 2 / 3")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "字幕生成完成" })).not.toBeInTheDocument();

    const secondJobId = Array.from(handlers.keys())[1];
    succeeded.add(secondJobId);
    await handlers.get(secondJobId)?.onEvent({ type: "succeeded", result: resultFor("b") });
    await waitFor(() => expect(screen.getByText("任务 3 / 3")).toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "字幕生成完成" })).not.toBeInTheDocument();

    const thirdJobId = Array.from(handlers.keys())[2];
    succeeded.add(thirdJobId);
    await handlers.get(thirdJobId)?.onEvent({ type: "succeeded", result: resultFor("c") });
    expect(await screen.findByRole("heading", { name: "字幕生成完成" })).toBeInTheDocument();
    expect(screen.getByText("已完成 3 个文件")).toBeInTheDocument();
    expect(screen.getByText("a.srt")).toBeInTheDocument();
    expect(screen.getByText("b.srt")).toBeInTheDocument();
    expect(screen.getByText("c.srt")).toBeInTheDocument();
  });

  it("continues a folder batch when one job fails", async () => {
    const handlers = new Map<string, JobEventHandlers>();
    const failedError: UiError = {
      code: "worker_failed",
      title: "生成失败",
      message: "faster-whisper returned no segments.",
      action: "查看诊断并重试",
      recoveryActions: ["retry"],
      diagnostic: "worker_failed: faster-whisper returned no segments."
    };
    class BatchFailureClient extends MockFastSubClient {
      subscribeJobEvents(jobId: string, eventHandlers: JobEventHandlers): () => void {
        handlers.set(jobId, eventHandlers);
        return () => undefined;
      }
    }
    window.fastSubSystem = {
      selectMediaFiles: async () => [],
      selectMediaFolder: async () => ["F:\\game\\others\\a.mp4", "F:\\game\\others\\b.wav", "F:\\game\\others\\c.mov"],
      selectFolder: async () => null,
      selectSubtitleOutputPath: async () => null,
      getPathForFile: (file) => (file as File & { path?: string }).path ?? file.name,
      openPathMock: async () => true,
      openExternalURL: async () => true,
      getSecuritySnapshot: async () => ({
        contextIsolation: true,
        nodeIntegration: false,
        csp: true,
        exposesRawIpc: false
      })
    };
    render(<App client={new BatchFailureClient("jobSuccess")} />);
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "添加文件夹" }));
    expect(await screen.findByText("a.mp4")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    expect(await screen.findByText("任务 1 / 3")).toBeInTheDocument();

    const firstJobId = Array.from(handlers.keys())[0];
    await handlers.get(firstJobId)?.onEvent({ type: "failed", error: failedError });

    await waitFor(() => expect(screen.getByText("任务 2 / 3")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "正在生成字幕..." })).toBeInTheDocument();
    expect(screen.getByText("b.wav")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "生成失败" })).not.toBeInTheDocument();
  });

  it("retries only the selected failed job from a folder batch", async () => {
    const requests: CreateJobRequest[] = [];
    const failedError: UiError = {
      code: "worker_failed",
      title: "生成失败",
      message: "faster-whisper returned no segments.",
      action: "查看诊断并重试",
      recoveryActions: ["retry"],
      diagnostic: "worker_failed: faster-whisper returned no segments."
    };
    const failedJobs = [
      createSeedJob({
        id: "folder-failed-a",
        title: "folder-a.mp4",
        currentFile: "folder-a.mp4",
        inputPaths: ["F:\\batch\\folder-a.mp4"],
        outputDirectory: "F:\\batch",
        status: "failed",
        statusLabel: "已失败",
        progressPercent: 100,
        stageLabel: "已完成",
        error: failedError
      }),
      createSeedJob({
        id: "folder-failed-b",
        title: "folder-b.mp4",
        currentFile: "folder-b.mp4",
        inputPaths: ["F:\\batch\\folder-b.mp4"],
        outputDirectory: "F:\\batch",
        status: "failed",
        statusLabel: "已失败",
        progressPercent: 100,
        stageLabel: "已完成",
        error: failedError
      })
    ];
    class RetryClient extends MockFastSubClient {
      async listJobs(): Promise<JobSummary[]> {
        return failedJobs.map(({ logs: _logs, inputPaths: _inputPaths, result: _result, error: _error, estimatedRemaining: _estimatedRemaining, ...summary }) => ({ ...summary }));
      }

      async getJob(jobId: string): Promise<JobDetail> {
        const job = failedJobs.find((item) => item.id === jobId);
        if (!job) {
          return super.getJob(jobId);
        }
        return structuredClone(job);
      }

      async createJob(request: CreateJobRequest): Promise<JobDetail> {
        requests.push(request);
        return super.createJob(request);
      }
    }
    window.localStorage.setItem("fast-sub:onboarding-complete", "1");
    render(<App client={new RetryClient("jobSuccess")} />);
    expect(await screen.findByRole("heading", { name: "拖拽视频到这里" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /历史记录|查看进行中/ }));
    fireEvent.doubleClick(await screen.findByText("folder-b.mp4"));
    expect(await screen.findByRole("heading", { name: "folder-b.mp4" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重试任务" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0].inputPaths).toEqual(["F:\\batch\\folder-b.mp4"]);
  });

  it("does not jump back from the running queue when background jobs emit progress", async () => {
    const handlers = new Map<string, JobEventHandlers>();
    class BackgroundClient extends MockFastSubClient {
      subscribeJobEvents(jobId: string, eventHandlers: JobEventHandlers): () => void {
        handlers.set(jobId, eventHandlers);
        return () => undefined;
      }
    }
    window.fastSubSystem = {
      selectMediaFiles: async () => [],
      selectMediaFolder: async () => ["F:\\game\\others\\a.mp4", "F:\\game\\others\\b.wav"],
      selectFolder: async () => null,
      selectSubtitleOutputPath: async () => null,
      getPathForFile: (file) => (file as File & { path?: string }).path ?? file.name,
      openPathMock: async () => true,
      openExternalURL: async () => true,
      getSecuritySnapshot: async () => ({
        contextIsolation: true,
        nodeIntegration: false,
        csp: true,
        exposesRawIpc: false
      })
    };
    render(<App client={new BackgroundClient("jobSuccess")} />);
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "添加文件夹" }));
    expect(await screen.findByText("a.mp4")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    expect(await screen.findByText("任务 1 / 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "后台运行" }));
    expect(await screen.findByText("正在生成 5")).toHaveClass("on");

    const firstJobId = Array.from(handlers.keys())[0];
    await handlers.get(firstJobId)?.onEvent({ type: "progress", progress: { status: "running", progressPercent: 34, stageLabel: "正在转写音频", currentFile: "a.mp4" } });
    expect(screen.getByText("正在生成 5")).toHaveClass("on");
    expect(screen.queryByRole("heading", { name: "正在生成字幕..." })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: "字幕生成" }));
    expect(await screen.findByText("正在进行 5 个任务")).toBeInTheDocument();
    expect(screen.queryByText("无进行中的任务")).not.toBeInTheDocument();
  });

  it("keeps running task detail progress synchronized with generation events", async () => {
    const handlers = new Map<string, JobEventHandlers>();
    class DetailProgressClient extends MockFastSubClient {
      subscribeJobEvents(jobId: string, eventHandlers: JobEventHandlers): () => void {
        handlers.set(jobId, eventHandlers);
        return () => undefined;
      }
    }
    render(<App client={new DetailProgressClient("jobSuccess")} />);
    await enterMainScreen();
    await screen.findByText("本地转写就绪");
    fireEvent.click(screen.getByRole("button", { name: "添加视频" }));
    await chooseVideo("detail-progress.mp4");
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    expect(await screen.findByRole("heading", { name: "正在生成字幕..." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "后台运行" }));
    fireEvent.doubleClick(await screen.findByText("detail-progress.mp4"));
    expect(await screen.findByRole("heading", { name: "detail-progress.mp4" })).toBeInTheDocument();

    const jobId = Array.from(handlers.keys()).at(-1) as string;
    await act(async () => {
      await handlers.get(jobId)?.onEvent({ type: "progress", progress: { status: "running", progressPercent: 57, stageLabel: "正在转写音频", currentFile: "detail-progress.mp4", estimatedRemaining: "约 1 分钟" } });
    });

    expect(screen.getByRole("heading", { name: "detail-progress.mp4" })).toBeInTheDocument();
    await waitFor(() => expect(document.body.textContent).toContain("57%"));
    expect(screen.queryByRole("heading", { name: "正在生成字幕..." })).not.toBeInTheDocument();
  });

  it("keeps a background job visible when it fails after opening the running queue", async () => {
    window.fastSubSystem = {
      selectMediaFiles: async () => ["F:\\game\\others\\api-background.mp4"],
      selectMediaFolder: async () => [],
      selectFolder: async () => null,
      selectSubtitleOutputPath: async () => null,
      getPathForFile: (file) => (file as File & { path?: string }).path ?? file.name,
      openPathMock: async () => true,
      openExternalURL: async () => true,
      getSecuritySnapshot: async () => ({
        contextIsolation: true,
        nodeIntegration: false,
        csp: true,
        exposesRawIpc: false
      })
    };
    render(<App client={new MockFastSubClient("jobFailed")} />);
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "添加视频" }));
    expect(await screen.findByText("api-background.mp4")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    expect(await screen.findByRole("heading", { name: "正在生成字幕..." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "后台运行" }));
    await screen.findByRole("button", { name: /正在生成/ });

    await waitFor(() => expect(within(document.querySelector(".tabs") as HTMLElement).getByRole("button", { name: /失败/ })).toHaveClass("on"));
    expect(screen.getByText("api-background.mp4")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "正在生成字幕..." })).not.toBeInTheDocument();
  });

  it("does not show global mock queue items as upcoming jobs for a single file", async () => {
    window.fastSubSystem = {
      selectMediaFiles: async () => ["F:\\game\\others\\single.mp4"],
      selectMediaFolder: async () => [],
      selectFolder: async () => null,
      selectSubtitleOutputPath: async () => null,
      getPathForFile: (file) => (file as File & { path?: string }).path ?? file.name,
      openPathMock: async () => true,
      openExternalURL: async () => true,
      getSecuritySnapshot: async () => ({
        contextIsolation: true,
        nodeIntegration: false,
        csp: true,
        exposesRawIpc: false
      })
    };
    render(<App client={new MockFastSubClient("jobSuccess")} />);
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "添加视频" }));
    expect(await screen.findByText("single.mp4")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    expect(await screen.findByRole("heading", { name: "正在生成字幕..." })).toBeInTheDocument();
    expect(screen.queryByText("sample-lecture.mov")).not.toBeInTheDocument();
    expect(screen.queryByText("sample-podcast.wav")).not.toBeInTheDocument();
  });

  it("filters upcoming jobs to the current batch ids", () => {
    const props = {
      activeJob: { id: "job-a", displayId: "A", type: "transcribe", status: "running", statusLabel: "正在生成", title: "batch-a.mp4", currentFile: "batch-a.mp4", progressPercent: 12, stageLabel: "正在检查文件", createdAt: "now", inputPaths: ["F:\\game\\others\\batch-a.mp4"], outputDirectory: "F:\\game\\others", providerName: "Fast Sub", modelName: "whisper-small", logs: [] },
      activeBatchJobIds: ["job-a", "job-b", "job-c"],
      jobs: [
        { id: "job-a", displayId: "A", type: "transcribe", status: "running", statusLabel: "正在生成", title: "batch-a.mp4", currentFile: "batch-a.mp4", progressPercent: 12, stageLabel: "正在检查文件", createdAt: "now" },
        { id: "job-b", displayId: "B", type: "transcribe", status: "queued", statusLabel: "等待中", title: "batch-b.wav", currentFile: "batch-b.wav", progressPercent: 0, stageLabel: "等待中", createdAt: "now" },
        { id: "job-c", displayId: "C", type: "transcribe", status: "queued", statusLabel: "等待中", title: "batch-c.mov", currentFile: "batch-c.mov", progressPercent: 0, stageLabel: "等待中", createdAt: "now" },
        { id: "seed-b", displayId: "S", type: "transcribe", status: "queued", statusLabel: "等待中", title: "sample-lecture.mov", currentFile: "sample-lecture.mov", progressPercent: 0, stageLabel: "等待中", createdAt: "now" }
      ],
      cancelJob: async () => undefined,
      cancelAllJobs: async () => undefined
    } as unknown as Parameters<typeof MainGenerating>[0];
    render(<MainGenerating {...props} />);
    expect(screen.getByText("batch-b.wav")).toBeInTheDocument();
    expect(screen.getByText("batch-c.mov")).toBeInTheDocument();
    expect(screen.queryByText("sample-lecture.mov")).not.toBeInTheDocument();
  });

  it("smooths the generating progress while the daemon progress is unchanged", () => {
    vi.useFakeTimers();
    try {
      const props = {
        activeJob: { id: "job-smooth", displayId: "S", type: "transcribe", status: "running", statusLabel: "正在生成", title: "smooth.mp4", currentFile: "smooth.mp4", progressPercent: 0, stageLabel: "正在转写音频", createdAt: "now", inputPaths: ["F:\\game\\others\\smooth.mp4"], outputDirectory: "F:\\game\\others", providerName: "Fast Sub", modelName: "whisper-small", logs: [] },
        activeBatchJobIds: ["job-smooth"],
        jobs: [
          { id: "job-smooth", displayId: "S", type: "transcribe", status: "running", statusLabel: "正在生成", title: "smooth.mp4", currentFile: "smooth.mp4", progressPercent: 0, stageLabel: "正在转写音频", createdAt: "now" }
        ],
        cancelJob: async () => undefined,
        cancelAllJobs: async () => undefined,
        openRunningQueue: () => undefined
      } as unknown as Parameters<typeof MainGenerating>[0];
      render(<MainGenerating {...props} />);
      expect(progressCardPercent()).toBe(0);
      act(() => vi.advanceTimersByTime(2000));
      expect(progressCardPercent()).toBeGreaterThan(0);
      expect(progressCardPercent()).toBeLessThan(100);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes media from the selected file list", async () => {
    render(<App />);
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "添加文件夹" }));
    await chooseFolder();
    fireEvent.click((await screen.findAllByRole("button", { name: "移除" })).at(0) as HTMLElement);
    expect(screen.queryByText("folder-a.mp4")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "已添加 1 个文件" })).toBeInTheDocument();
  });

  it("blocks generation actions when the ASR model is missing", async () => {
    class MissingASRClient extends MockFastSubClient {
      async listModels(): Promise<ModelStatus[]> {
        return (await super.listModels()).map((model) => model.kind === "asr" ? { ...model, state: "missing" } : model);
      }
    }
    render(<App client={new MissingASRClient("setupReady")} />);
    const enterButton = await screen.findByRole("button", { name: "进入主界面" });
    await screen.findByText("默认 ASR 模型未准备");
    const workerRow = screen.getByText("本地 Worker").closest(".check-row") as HTMLElement;
    await waitFor(() => expect(within(workerRow).getByText("已就绪")).toBeInTheDocument());
    expect(enterButton).toBeEnabled();
    expect(screen.getByRole("button", { name: "下载默认模型" })).toBeInTheDocument();
    fireEvent.click(enterButton);
    expect(await screen.findByRole("heading", { name: "拖拽视频到这里" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "添加视频" }));
    await chooseVideo();
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    expect(await screen.findByRole("heading", { name: "还不能生成字幕" })).toBeInTheDocument();
  });

  it("shows immediate default model download feedback on the setup page", async () => {
    class SlowDefaultModelClient extends MockFastSubClient {
      async listModels(): Promise<ModelStatus[]> {
        return (await super.listModels()).map((model) => model.kind === "asr" ? { ...model, state: "missing" } : model);
      }

      async createModelInstallJob(modelId: string): Promise<JobDetail> {
        const job = await super.createModelInstallJob(modelId);
        return { ...job, status: "queued", statusLabel: "等待中", progressPercent: 0, stageLabel: "等待下载" };
      }
    }

    render(<App client={new SlowDefaultModelClient("setupReady")} />);
    await screen.findByText("默认 ASR 模型未准备");
    fireEvent.click(screen.getByRole("button", { name: "下载默认模型" }));
    expect(await screen.findByRole("button", { name: "正在下载" })).toBeDisabled();
    expect(screen.getByText(/正在下载 \d+%/)).toBeInTheDocument();
  });

  it("shows default model download feedback on the missing model page", async () => {
    class SlowDefaultModelClient extends MockFastSubClient {
      async listModels(): Promise<ModelStatus[]> {
        return (await super.listModels()).map((model) => model.kind === "asr" ? { ...model, state: "missing" } : model);
      }

      async createModelInstallJob(modelId: string): Promise<JobDetail> {
        const job = await super.createModelInstallJob(modelId);
        return { ...job, status: "queued", statusLabel: "等待中", progressPercent: 0, stageLabel: "等待下载" };
      }
    }

    render(<App client={new SlowDefaultModelClient("setupReady")} />);
    const enterButton = await screen.findByRole("button", { name: "进入主界面" });
    await screen.findByText("默认 ASR 模型未准备");
    fireEvent.click(enterButton);
    fireEvent.click(screen.getByRole("button", { name: "添加视频" }));
    await chooseVideo();
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    expect(await screen.findByRole("heading", { name: "还不能生成字幕" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下载默认模型" }));
    expect(await screen.findByRole("button", { name: "正在下载" })).toBeDisabled();
    expect(screen.getByRole("status", { name: /下载进度/ })).toHaveTextContent("%");
  });

  it("accepts media files dropped onto the main drop zone", async () => {
    render(<App />);
    await enterMainScreen();
    dropFileOn("拖拽视频到这里", new File(["drop"], "dropped clip.mp4", { type: "video/mp4" }));
    expect(await screen.findByText("dropped clip.mp4")).toBeInTheDocument();
  });

  it("uses Electron file paths for dropped media job output", async () => {
    const requests: CreateJobRequest[] = [];
    class CaptureClient extends MockFastSubClient {
      async createJob(request: CreateJobRequest): Promise<JobDetail> {
        requests.push(request);
        return super.createJob(request);
      }
    }
    window.fastSubSystem = {
      selectMediaFiles: async () => [],
      selectMediaFolder: async () => [],
      selectFolder: async () => null,
      selectSubtitleOutputPath: async () => null,
      getPathForFile: (file) => file.name === "input.mp4" ? "F:\\game\\others\\input.mp4" : file.name,
      openPathMock: async () => true,
      openExternalURL: async () => true,
      getSecuritySnapshot: async () => ({
        contextIsolation: true,
        nodeIntegration: false,
        csp: true,
        exposesRawIpc: false
      })
    };
    render(<App client={new CaptureClient("jobSuccess")} />);
    await enterMainScreen();
    await waitForLocalReady();
    dropFileOn("拖拽视频到这里", new File(["drop"], "input.mp4", { type: "video/mp4" }));
    expect(await screen.findByText("input.mp4")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    await waitFor(() => expect(requests[0]?.outputDirectory).toBe("F:\\game\\others"));
  });

  it("cancels the active job without later completing it", async () => {
    render(<App />);
    await enterMainScreen();
    await waitForLocalReady();
    fireEvent.click(await screen.findByRole("button", { name: "添加视频" }));
    await chooseVideo();
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    expect(await screen.findByRole("heading", { name: "正在生成字幕..." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消当前任务" }));
    expect(await screen.findByText("任务已取消，可以重新生成或返回队列。")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 950));
    expect(screen.queryByRole("heading", { name: "字幕生成完成" })).not.toBeInTheDocument();
  });

  it("deletes a failed queue job from the mock client", async () => {
    render(<App />);
    await enterMainScreen();
    fireEvent.click(screen.getByRole("button", { name: /历史记录|查看进行中/ }));
    fireEvent.doubleClick(await screen.findByText("raw-cam.mov"));
    expect(await screen.findByRole("heading", { name: "raw-cam.mov" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除记录" }));
    expect(await screen.findByText("失败 0")).toBeInTheDocument();
    expect(screen.queryByText("raw-cam.mov")).not.toBeInTheDocument();
  });

  it("resynchronizes the active job after an events_lost event", async () => {
    class EventsLostClient extends MockFastSubClient {
      getJob = vi.fn(super.getJob.bind(this));
      subscribeJobEvents(_jobId: string, handlers: JobEventHandlers): () => void {
        const timer = setTimeout(() => handlers.onEvent({ type: "events_lost" }), 20);
        return () => clearTimeout(timer);
      }
    }
    const client = new EventsLostClient("jobSuccess");
    render(<App client={client} />);
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "添加视频" }));
    await chooseVideo();
    await screen.findByText("a b.mp4");
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    await waitFor(() => expect(client.getJob).toHaveBeenCalled());
  });

  it("updates advanced generation options", async () => {
    render(<App />);
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "添加文件夹" }));
    await chooseFolder();
    fireEvent.click((await screen.findAllByRole("button", { name: "详细设置" })).at(0) as HTMLElement);
    expect(screen.queryByLabelText("ASR 模型")).not.toBeInTheDocument();
    expect(screen.getByLabelText("转写方式")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "翻译字幕" }));
    expect(screen.getByRole("button", { name: "翻译字幕" })).toHaveClass("on");
    fireEvent.click(screen.getByRole("button", { name: "覆盖" }));
    expect(screen.getByRole("button", { name: "覆盖" })).toHaveClass("on");
    const wordToggle = screen.getByRole("button", { name: "词级时间戳" });
    fireEvent.click(wordToggle);
    expect(wordToggle).toHaveAttribute("aria-pressed", "true");
  });

  it("opens the output folder from result cards", async () => {
    const openPathMock = vi.fn(async () => true);
    window.fastSubSystem = {
      selectMediaFiles: async () => [],
      selectMediaFolder: async () => [],
      selectFolder: async () => null,
      selectSubtitleOutputPath: async () => null,
      getPathForFile: (file) => (file as File & { path?: string }).path ?? file.name,
      openPathMock,
      openExternalURL: async () => true,
      getSecuritySnapshot: async () => ({
        contextIsolation: true,
        nodeIntegration: false,
        csp: true,
        exposesRawIpc: false
      })
    };
    render(<App />);
    await enterMainScreen();
    await waitForLocalReady();
    fireEvent.click(screen.getByRole("button", { name: "添加视频" }));
    await chooseVideo();
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    await waitFor(() => expect(screen.getByRole("heading", { name: "字幕生成完成" })).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "文件夹" }).at(0) as HTMLElement);
    expect(openPathMock).toHaveBeenCalledWith("C:\\Users\\Example\\Videos");
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });

  it("selects files in translate and burn-in tools", async () => {
    render(<App />);
    await enterMainScreen();
    await screen.findByText("翻译就绪");
    fireEvent.click(screen.getByRole("menuitem", { name: "翻译SRT" }));
    fireEvent.click(screen.getByRole("button", { name: "选择文件" }));
    fireEvent.change(screen.getByLabelText("选择字幕或文本文件"), { target: { files: [new File(["hello"], "demo.txt", { type: "text/plain" })] } });
    expect(screen.getByText("demo.txt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开始翻译" }));
    expect(await screen.findByRole("heading", { name: "字幕生成完成" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("打开调试面板"));
    fireEvent.click(screen.getByRole("button", { name: "任务列表" }));
    expect(screen.getByText("demo.translated.txt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "字幕烧录" }));
    fireEvent.change(screen.getByLabelText("选择烧录视频文件"), { target: { files: [new File(["v"], "clip.mov", { type: "video/quicktime" })] } });
    fireEvent.change(screen.getByLabelText("选择烧录字幕文件"), { target: { files: [new File(["s"], "clip.zh.srt", { type: "text/plain" })] } });
    expect(screen.getByText("clip.mov")).toBeInTheDocument();
    expect(screen.getByText("clip.zh.srt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开始烧录" }));
    expect(await screen.findByRole("heading", { name: "字幕生成完成" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "任务列表" }));
    expect(screen.getByText("clip.burned.mp4")).toBeInTheDocument();
  });

  it("blocks translate tool jobs when the translation environment is not ready", async () => {
    const scrolledSections: string[] = [];
    Element.prototype.scrollIntoView = vi.fn(function scrollIntoView(this: Element) {
      scrolledSections.push(this.textContent ?? "");
    });
    render(<App />);
    fireEvent.click(await screen.findByLabelText("打开调试面板"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "nllbInstallFailed" } });
    await enterMainScreen();
    fireEvent.click(screen.getByRole("menuitem", { name: "翻译SRT" }));

    expect(await screen.findByRole("heading", { name: "翻译环境未准备好" })).toBeInTheDocument();
    expect(screen.getByText(/当前默认翻译模型未准备好/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始翻译" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "配置翻译 Provider" }));
    expect(await screen.findByRole("heading", { name: "服务商" })).toBeInTheDocument();
    await waitFor(() => expect(scrolledSections.some((text) => text.includes("翻译 Provider"))).toBe(true));
  });

  it("blocks translated subtitle output selection until the translation model is configured", async () => {
    const scrolledSections: string[] = [];
    Element.prototype.scrollIntoView = vi.fn(function scrollIntoView(this: Element) {
      scrolledSections.push(this.textContent ?? "");
    });
    render(<App />);
    fireEvent.click(await screen.findByLabelText("打开调试面板"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "nllbInstallFailed" } });
    await enterMainScreen();
    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    fireEvent.click(screen.getByRole("button", { name: "双语字幕" }));

    expect(await screen.findByRole("status")).toHaveTextContent("当前翻译 Provider 或翻译模型未配置好");
    expect(screen.getByRole("button", { name: "原字幕" })).toHaveClass("on");
    expect(screen.getByRole("button", { name: "双语字幕" })).not.toHaveClass("on");
    fireEvent.click(screen.getByRole("button", { name: "配置翻译 Provider" }));
    expect(await screen.findByRole("heading", { name: "服务商" })).toBeInTheDocument();
    await waitFor(() => expect(scrolledSections.some((text) => text.includes("翻译 Provider"))).toBe(true));

    const openAiTranslateCard = screen.getByText("OpenAI 兼容翻译 API").closest("article") as HTMLElement;
    fireEvent.click(within(openAiTranslateCard).getByRole("button", { name: "连接检查" }));
    await waitFor(() => expect(within(openAiTranslateCard).getByText("连接检查通过")).toBeInTheDocument());
    fireEvent.click(within(openAiTranslateCard).getByRole("button", { name: "设为默认" }));
    await waitFor(() => expect(screen.queryByText("当前翻译 Provider 或翻译模型未配置好，请先完成翻译配置。")).not.toBeInTheDocument());
  });

  it("allows API translation provider after live check without requiring a local translation model", async () => {
    const requests: CreateJobRequest[] = [];
    class APITranslationReadyClient extends MockFastSubClient {
      async getConfig(): Promise<ConfigViewModel> {
        return {
          ...(await super.getConfig()),
          outputType: "bilingual_srt",
          translationProvider: "api-openai-chat",
          translationModel: "qwen/qwen3-4b-2507",
          apiProviderConfigs: {
            "api-openai-chat": {
              apiKeyAlias: "FAST_SUB_OPENAI_CHAT_API_KEY",
              apiKeyStatus: "configured",
              openAIBaseUrl: "http://127.0.0.1:1234/v1",
              openAIModel: "qwen/qwen3-4b-2507"
            }
          }
        };
      }

      async listProviders(): Promise<ProviderStatus[]> {
        return (await super.listProviders()).map((provider) => provider.id === "api-openai-chat" ? {
          ...provider,
          enabled: true,
          state: "available",
          checkMode: "live"
        } : provider);
      }

      async listModels(): Promise<ModelStatus[]> {
        return (await super.listModels()).map((model) => model.kind === "translation" ? { ...model, state: "missing" } : model);
      }

      async createJob(request: CreateJobRequest): Promise<JobDetail> {
        requests.push(request);
        return super.createJob(request);
      }
    }
    render(<App client={new APITranslationReadyClient("setupReady")} />);
    await enterMainScreen();
    await waitForLocalReady();
    fireEvent.click(await screen.findByRole("button", { name: "添加视频" }));
    await chooseVideo("api-translate.mp4");
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    expect(await screen.findByRole("heading", { name: "确认使用 API 服务" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认并继续" }));

    await waitFor(() => expect(requests[0]?.translationProviderId).toBe("api-openai-chat"));
    expect(document.body.textContent).not.toContain("当前翻译 Provider 或翻译模型未配置好");
  });

  it("runs the default API translation provider live check on startup", async () => {
    const checks: Array<{ providerId: string; mode: "static" | "live" }> = [];
    class AutoCheckedTranslationClient extends MockFastSubClient {
      async getConfig(): Promise<ConfigViewModel> {
        return {
          ...(await super.getConfig()),
          translationProvider: "api-openai-chat",
          translationModel: "qwen/qwen3-4b-2507",
          apiProviderConfigs: {
            "api-openai-chat": {
              apiKeyAlias: "FAST_SUB_OPENAI_CHAT_API_KEY",
              apiKeyStatus: "configured",
              openAIBaseUrl: "http://127.0.0.1:1234/v1",
              openAIModel: "qwen/qwen3-4b-2507"
            }
          }
        };
      }

      async testProvider(providerId: string, mode: "static" | "live"): Promise<ProviderStatus> {
        checks.push({ providerId, mode });
        return super.testProvider(providerId, mode);
      }
    }

    render(<App client={new AutoCheckedTranslationClient("setupReady")} />);
    await enterMainScreen();
    await waitFor(() => expect(checks).toEqual([{ providerId: "api-openai-chat", mode: "live" }]));

    fireEvent.click(await screen.findByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: /服务商/ }));
    const openAiTranslateCard = screen.getByText("OpenAI 兼容翻译 API").closest("article") as HTMLElement;
    expect(within(openAiTranslateCard).getByText("连接检查通过")).toBeInTheDocument();
    expect(checks).toEqual([{ providerId: "api-openai-chat", mode: "live" }]);
  });

  it("runs the API translation provider live check after it becomes the default", async () => {
    const checks: Array<{ providerId: string; mode: "static" | "live" }> = [];
    class AutoCheckedAfterDefaultClient extends MockFastSubClient {
      async testProvider(providerId: string, mode: "static" | "live"): Promise<ProviderStatus> {
        checks.push({ providerId, mode });
        return super.testProvider(providerId, mode);
      }
    }

    render(<App client={new AutoCheckedAfterDefaultClient("setupReady")} />);
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "设置" }));
    await chooseProviderDropdownOptionAsync("默认翻译 Provider", /OpenAI 兼容翻译 API/);
    await waitFor(() => expect(checks).toEqual([{ providerId: "api-openai-chat", mode: "live" }]));

    fireEvent.click(screen.getByRole("button", { name: /服务商/ }));
    const openAiTranslateCard = screen.getByText("OpenAI 兼容翻译 API").closest("article") as HTMLElement;
    expect(within(openAiTranslateCard).getByText("连接检查通过")).toBeInTheDocument();
  });

  it("blocks translated subtitle output selection when the selected translation provider is not configured", async () => {
    render(<App />);
    fireEvent.click(await screen.findByLabelText("打开调试面板"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "nllbInstallFailed" } });
    await enterMainScreen();
    fireEvent.click(screen.getByRole("button", { name: "设置" }));

    fireEvent.click(screen.getByRole("button", { name: "翻译字幕" }));

    expect(await screen.findByRole("status")).toHaveTextContent("当前翻译 Provider 或翻译模型未配置好");
    expect(screen.getByRole("button", { name: "原字幕" })).toHaveClass("on");
    expect(screen.getByRole("button", { name: "翻译字幕" })).not.toHaveClass("on");
  });

  it("shows the key default subtitle settings on the empty main screen", async () => {
    render(<App />);
    await enterMainScreen();
    expect(await screen.findByLabelText("原语言")).toHaveTextContent("自动识别");
    expect(screen.getByLabelText("目标语言")).toHaveTextContent("中文");
    expect(screen.getByLabelText("输出内容")).toHaveTextContent("原字幕");
    fireEvent.click(screen.getByLabelText("原语言"));
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "英语" }));
    await waitFor(() => expect(screen.getByLabelText("原语言")).toHaveTextContent("英语"));
    expect(screen.queryByRole("button", { name: "修改" })).not.toBeInTheDocument();
  });

  it("blocks invalid quick output choices on the empty main screen", async () => {
    render(<App />);
    fireEvent.click(await screen.findByLabelText("打开调试面板"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "nllbInstallFailed" } });
    await enterMainScreen();

    fireEvent.click(await screen.findByLabelText("输出内容"));
    fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "双语字幕" }));

    expect(await screen.findByRole("status")).toHaveTextContent("当前翻译 Provider 或翻译模型未配置好");
    expect(screen.getByLabelText("输出内容")).toHaveTextContent("原字幕");
  });

  it("does not start output conflict save-as when file selection is canceled", async () => {
    const selectSubtitleOutputPath = vi.fn(async () => null);
    window.fastSubSystem = {
      selectMediaFiles: async () => [],
      selectMediaFolder: async () => [],
      selectFolder: async () => null,
      selectSubtitleOutputPath,
      getPathForFile: (file) => (file as File & { path?: string }).path ?? file.name,
      openPathMock: async () => true,
      openExternalURL: async () => true,
      getSecuritySnapshot: async () => ({
        contextIsolation: true,
        nodeIntegration: false,
        csp: true,
        exposesRawIpc: false
      })
    };
    render(<App />);
    fireEvent.click(await screen.findByLabelText("打开调试面板"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "outputConflict" } });
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "添加视频" }));
    await chooseVideo();
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    expect(await screen.findByText("字幕文件已存在")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "另存为" }));
    await waitFor(() => expect(selectSubtitleOutputPath).toHaveBeenCalled());
    expect(screen.getByText("字幕文件已存在")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "正在生成字幕..." })).not.toBeInTheDocument();
  });

  it("uses save-as subtitle file path for output conflicts", async () => {
    const requests: CreateJobRequest[] = [];
    class CaptureClient extends MockFastSubClient {
      async createJob(request: CreateJobRequest): Promise<JobDetail> {
        requests.push(request);
        return super.createJob(request);
      }
    }
    window.fastSubSystem = {
      selectMediaFiles: async () => [],
      selectMediaFolder: async () => [],
      selectFolder: async () => null,
      selectSubtitleOutputPath: async () => "F:\\game\\others\\input-copy.srt",
      getPathForFile: (file) => (file as File & { path?: string }).path ?? file.name,
      openPathMock: async () => true,
      openExternalURL: async () => true,
      getSecuritySnapshot: async () => ({
        contextIsolation: true,
        nodeIntegration: false,
        csp: true,
        exposesRawIpc: false
      })
    };
    render(<App client={new CaptureClient("jobSuccess")} />);
    fireEvent.click(await screen.findByLabelText("打开调试面板"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "outputConflict" } });
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "添加视频" }));
    await chooseVideo("F:\\game\\others\\input.mp4");
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    expect(await screen.findByText("字幕文件已存在")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "另存为" }));
    await waitFor(() => expect(requests[0]?.outputPath).toBe("F:\\game\\others\\input-copy.srt"));
  });

  it("keeps unverified remote providers out of the output conflict flow", async () => {
    render(<App />);
    fireEvent.click(await screen.findByLabelText("打开调试面板"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "outputConflict" } });
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "添加视频" }));
    await chooseVideo();
    fireEvent.click((await screen.findAllByRole("button", { name: "详细设置" })).at(0) as HTMLElement);
    const providerSelect = screen.getByLabelText("转写方式") as HTMLSelectElement;
    expect(Array.from(providerSelect.options).map((option) => option.value)).not.toContain("api-openai-transcription");
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    expect(await screen.findByText("字幕文件已存在")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "覆盖" }));
    expect(await screen.findByRole("heading", { name: "正在生成字幕..." })).toBeInTheDocument();
    expect(screen.queryByText("确认使用 API 服务")).not.toBeInTheDocument();
  });

  it("does not expose unverified remote providers in the main ASR selector", async () => {
    render(<App />);
    fireEvent.click(await screen.findByLabelText("打开调试面板"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "remoteProviderConfirmRequired" } });
    const enterButton = await screen.findByRole("button", { name: "进入主界面" });
    await waitFor(() => expect(enterButton).toBeEnabled());
    fireEvent.click(enterButton);
    fireEvent.click(await screen.findByRole("button", { name: "进入主界面" }));
    fireEvent.click(screen.getByRole("button", { name: "添加视频" }));
    await chooseVideo();
    fireEvent.click((await screen.findAllByRole("button", { name: "详细设置" })).at(0) as HTMLElement);
    const providerSelect = screen.getByLabelText("转写方式") as HTMLSelectElement;
    expect(Array.from(providerSelect.options).map((option) => option.value)).not.toContain("api-openai-transcription");
    expect(providerSelect.value).toBe("local-faster-whisper");
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    expect(await screen.findByRole("heading", { name: "正在生成字幕..." })).toBeInTheDocument();
    expect(screen.queryByText("确认使用 API 服务")).not.toBeInTheDocument();
  });

  it("exposes model install progress and failed install scenarios in debug", async () => {
    render(<App />);
    fireEvent.click(await screen.findByLabelText("打开调试面板"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "modelInstalling" } });
    fireEvent.click(await screen.findByRole("button", { name: "模型管理" }));
    expect((await screen.findByLabelText("Whisper Small 下载进度")).textContent).toContain("63%");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "modelInstallFailed" } });
    await waitFor(() => expect(screen.getAllByRole("button", { name: "重试下载" }).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Whisper Small/)[0].closest("article")?.textContent).toContain("安装失败");
  });

  it("keeps model install progress inside the model management tab", async () => {
    class SlowInstallClient extends MockFastSubClient {
      async createModelInstallJob(modelId: string): Promise<JobDetail> {
        const job = await super.createModelInstallJob(modelId);
        return { ...job, status: "queued", statusLabel: "等待中", progressPercent: 0, stageLabel: "等待下载" };
      }

      subscribeJobEvents(_jobId: string, handlers: JobEventHandlers): () => void {
        const timer = setTimeout(() => {
          handlers.onEvent({ type: "progress", progress: { status: "running", progressPercent: 33, stageLabel: "正在下载模型", currentFile: "Whisper Large v3 Turbo" } });
        }, 0);
        return () => clearTimeout(timer);
      }
    }

    render(<App client={new SlowInstallClient("setupReady")} />);
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: /模型管理/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "下载" }).at(0) as HTMLElement);

    expect(await screen.findByRole("heading", { name: "模型管理" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "正在生成字幕..." })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/下载进度/).textContent).toContain("33%"));
  });

  it("installs a missing local translation model from the provider card", async () => {
    const installed: string[] = [];
    class MissingNLLBProviderClient extends MockFastSubClient {
      async listModels(): Promise<ModelStatus[]> {
        return (await super.listModels()).map((model) => model.id === "nllb-200-distilled-600m-ct2-int8" ? { ...model, state: "missing" } : model);
      }

      async listProviders(): Promise<ProviderStatus[]> {
        return (await super.listProviders()).map((provider) => provider.id === "local-nllb-ct2" ? { ...provider, state: "missing_model" } : provider);
      }

      async createModelInstallJob(modelId: string): Promise<JobDetail> {
        installed.push(modelId);
        return super.createModelInstallJob(modelId);
      }
    }

    render(<App client={new MissingNLLBProviderClient("setupReady")} />);
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: /服务商/ }));

    const nllbCard = (await screen.findByText("本地 NLLB 翻译")).closest("article") as HTMLElement;
    fireEvent.click(within(nllbCard).getByRole("button", { name: "先安装模型" }));

    await waitFor(() => expect(installed).toEqual(["nllb-200-distilled-600m-ct2-int8"]));
    expect(screen.queryByRole("heading", { name: "正在生成字幕..." })).not.toBeInTheDocument();
  });

  it("removes models from the model management tab", async () => {
    render(<App />);
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: /模型管理/ }));

    const whisperSmall = screen.getAllByText("Whisper Small")[0].closest("article") as HTMLElement;
    fireEvent.click(within(whisperSmall).getByRole("button", { name: "移除" }));

    await waitFor(() => expect(within(whisperSmall).getByText("未安装")).toBeInTheDocument());
    expect(within(whisperSmall).getByRole("button", { name: "下载" })).toBeInTheDocument();
  });

  it("clears local data from diagnostics with confirmation", async () => {
    const cleaned: LocalDataCleanupTarget[] = [];
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const environment: EnvironmentStatus = {
      health: "ok",
      os: "darwin",
      arch: "arm64",
      memory: "16 GB",
      disk: "240 GB",
      localTranscriptionReady: true,
      localTranslationReady: true,
      ffmpegReady: true,
      modelDirectoryReady: true,
      daemonReady: true,
      warnings: []
    };
    render(
      <I18nProvider language="zh">
        <SettingsDiagnostics
          {...({
            environment,
            cleanupLocalData: async (target: LocalDataCleanupTarget) => {
              cleaned.push(target);
            }
          } as Parameters<typeof SettingsDiagnostics>[0])}
        />
      </I18nProvider>
    );
    fireEvent.click(await screen.findByRole("button", { name: "清理任务历史" }));
    await waitFor(() => expect(cleaned).toEqual(["jobs"]));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("确认清理任务历史"));
    expect(await screen.findByText("清理完成，已刷新本机状态。")).toBeInTheDocument();
    confirm.mockRestore();
  });

  it("does not clear local data when diagnostics cleanup is canceled", async () => {
    const cleaned: LocalDataCleanupTarget[] = [];
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(
      <I18nProvider language="zh">
        <SettingsDiagnostics
          {...({
            environment: null,
            cleanupLocalData: async (target: LocalDataCleanupTarget) => {
              cleaned.push(target);
            }
          } as Parameters<typeof SettingsDiagnostics>[0])}
        />
      </I18nProvider>
    );
    fireEvent.click(await screen.findByRole("button", { name: "清理原生依赖" }));
    expect(cleaned).toEqual([]);
    confirm.mockRestore();
  });
});
