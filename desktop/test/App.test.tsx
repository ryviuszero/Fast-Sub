import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../renderer/src/App";
import { MainGenerating } from "../renderer/src/app/screens/main";
import { MockFastSubClient } from "../renderer/src/client/MockFastSubClient";
import type { CreateJobRequest, JobDetail, JobEventHandlers } from "../shared/contracts/types";

afterEach(() => cleanup());

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

async function chooseOutputFolder() {
  await Promise.resolve();
  const input = screen.getByLabelText("选择输出目录");
  const file = new File(["mock"], "placeholder.txt", { type: "text/plain" });
  Object.defineProperty(file, "webkitRelativePath", { value: "Subtitles/placeholder.txt" });
  fireEvent.change(input, { target: { files: [file] } });
}

function dropFileOn(label: string, file: File) {
  const target = screen.getByText(label).closest("section") as HTMLElement;
  fireEvent.drop(target, { dataTransfer: { files: [file] } });
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

  it("shows task queue and settings entrances", async () => {
    render(<App />);
    fireEvent.click(await screen.findByLabelText("打开调试面板"));
    fireEvent.click(screen.getByRole("button", { name: "任务列表" }));
    expect(await screen.findByText("全部 5")).toBeInTheDocument();
    const queueTabs = document.querySelector(".tabs") as HTMLElement;
    fireEvent.click(within(queueTabs).getByRole("button", { name: "已完成 1" }));
    expect(screen.getByText("a b.mp4")).toBeInTheDocument();
    expect(screen.queryByText("sample-meeting.mp4")).not.toBeInTheDocument();
    fireEvent.click(within(queueTabs).getByRole("button", { name: "失败 1" }));
    expect(screen.getByText("raw-cam.mov")).toBeInTheDocument();
    expect(screen.queryByText("a b.mp4")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "通用设置" }));
    expect(screen.getByRole("heading", { name: "通用" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "诊断" }).at(-1) as HTMLElement);
    expect(screen.getByText(/credential=\[REDACTED\]/)).toBeInTheDocument();
  });

  it("updates general settings options", async () => {
    render(<App />);
    await enterMainScreen();
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: "简体中文" }));
    expect(screen.getByRole("button", { name: "简体中文" })).toHaveClass("on");
    fireEvent.click(screen.getByRole("button", { name: "双语字幕" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "双语字幕" })).toHaveClass("on"));
    fireEvent.click(screen.getByRole("button", { name: "跳过" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "跳过" })).toHaveClass("on"));
    fireEvent.click(screen.getByRole("button", { name: "远程" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "远程" })).toHaveClass("on"));
    fireEvent.click(screen.getByRole("button", { name: "GPU" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "GPU" })).toHaveClass("on"));
    const wordToggle = screen.getByRole("button", { name: "设置词级时间戳" });
    fireEvent.click(wordToggle);
    await waitFor(() => expect(wordToggle).toHaveAttribute("aria-pressed", "true"));
  });

  it("updates API and provider settings mock controls", async () => {
    render(<App />);
    await enterMainScreen();
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("button", { name: /API 服务/ }));
    const apiToggle = screen.getByRole("button", { name: "启用 API 服务" });
    fireEvent.click(apiToggle);
    expect(apiToggle).toHaveAttribute("aria-pressed", "true");
    const uploadToggle = screen.getByRole("button", { name: "上传前确认" });
    fireEvent.click(uploadToggle);
    expect(uploadToggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "静态检查" }));
    expect(screen.getByText("静态检查通过")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Provider/ }));
    expect(screen.getByText("未配置密钥")).toBeInTheDocument();
    expect(screen.queryByText("missing_api_key")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "刷新状态" }));
    await waitFor(() => expect(screen.getByText("刷新完成")).toBeInTheDocument());
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
    expect(screen.getByText("翻译已有 SRT")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "字幕生成" }));
    expect(screen.getByRole("button", { name: "添加视频" })).toBeInTheDocument();
  });

  it("returns from queue detail back to the queue list", async () => {
    render(<App />);
    await enterMainScreen();
    fireEvent.click(screen.getByText("历史记录"));
    fireEvent.click(screen.getByText("sample-meeting.mp4"));
    expect(screen.getByRole("heading", { name: "sample-meeting.mp4" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "日志" }));
    expect(screen.getByText("任务：sample-meeting.mp4", { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "详情" }));
    expect(screen.getByText("whisper-small")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByText("全部 5")).toBeInTheDocument();
  });

  it("adds media from a folder picker", async () => {
    window.fastSubSystem = {
      selectMediaFiles: async () => [],
      selectMediaFolder: async () => ["F:\\game\\others\\folder-a.mp4", "F:\\game\\others\\folder-b.wav"],
      selectFolder: async () => null,
      selectSubtitleOutputPath: async () => null,
      getPathForFile: (file) => (file as File & { path?: string }).path ?? file.name,
      openPathMock: async () => true,
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
  });

  it("uses the preload allowlist for media and folder selection", async () => {
    const selectMediaFiles = vi.fn(async () => ["D:\\资料\\视频\\片段.mp4"]);
    const selectFolder = vi.fn(async () => "\\\\NAS\\data\\others\\资料");
    window.fastSubSystem = {
      selectMediaFiles,
      selectMediaFolder: async () => ["\\\\NAS\\data\\others\\资料\\片段.mp4"],
      selectFolder,
      selectSubtitleOutputPath: async () => null,
      getPathForFile: (file) => (file as File & { path?: string }).path ?? file.name,
      openPathMock: async () => true,
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
    expect(await screen.findByText("片段.mp4")).toBeInTheDocument();
    expect(selectMediaFiles).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    fireEvent.click(await screen.findByRole("button", { name: "添加文件夹" }));
    expect(await screen.findByText("片段.mp4")).toBeInTheDocument();
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

  it("creates one daemon job per media file in a folder batch", async () => {
    const requests: CreateJobRequest[] = [];
    class CaptureClient extends MockFastSubClient {
      async createJob(request: CreateJobRequest): Promise<JobDetail> {
        requests.push(request);
        return super.createJob(request);
      }
    }
    window.fastSubSystem = {
      selectMediaFiles: async () => [],
      selectMediaFolder: async () => ["F:\\game\\others\\a.mp4", "F:\\game\\others\\b.wav", "F:\\game\\others\\c.mov"],
      selectFolder: async () => null,
      selectSubtitleOutputPath: async () => null,
      getPathForFile: (file) => (file as File & { path?: string }).path ?? file.name,
      openPathMock: async () => true,
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
  });

  it("does not show global mock queue items as upcoming jobs for a single file", async () => {
    window.fastSubSystem = {
      selectMediaFiles: async () => ["F:\\game\\others\\single.mp4"],
      selectMediaFolder: async () => [],
      selectFolder: async () => null,
      selectSubtitleOutputPath: async () => null,
      getPathForFile: (file) => (file as File & { path?: string }).path ?? file.name,
      openPathMock: async () => true,
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
    render(<App />);
    fireEvent.click(await screen.findByLabelText("打开调试面板"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "missingAsr" } });
    await screen.findByText("缺少默认 ASR 模型。下载完成后即可使用本地转写。");

    fireEvent.click(screen.getByRole("button", { name: "空状态" }));
    expect(await screen.findByText("本地转写未就绪")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加视频" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "添加文件夹" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "修改" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "已添加文件" }));
    expect(await screen.findByText("缺少默认 ASR 模型，当前不能继续生成字幕。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ 添加更多" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "生成字幕" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "空状态" }));
    fireEvent.click(screen.getByRole("button", { name: "去下载模型" }));
    expect(screen.getByRole("heading", { name: "模型管理" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "下载" }).at(0) as HTMLElement);
    await waitFor(() => expect(screen.getByText("可用")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "空状态" }));
    expect(await screen.findByText("本地转写就绪")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加视频" })).toBeEnabled();
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
      getSecuritySnapshot: async () => ({
        contextIsolation: true,
        nodeIntegration: false,
        csp: true,
        exposesRawIpc: false
      })
    };
    render(<App client={new CaptureClient("jobSuccess")} />);
    await enterMainScreen();
    dropFileOn("拖拽视频到这里", new File(["drop"], "input.mp4", { type: "video/mp4" }));
    expect(await screen.findByText("input.mp4")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    await waitFor(() => expect(requests[0]?.outputDirectory).toBe("F:\\game\\others"));
  });

  it("cancels the active job without later completing it", async () => {
    render(<App />);
    await enterMainScreen();
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
    fireEvent.click(screen.getByText("历史记录"));
    fireEvent.click(screen.getByText("raw-cam.mov"));
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
      getSecuritySnapshot: async () => ({
        contextIsolation: true,
        nodeIntegration: false,
        csp: true,
        exposesRawIpc: false
      })
    };
    render(<App />);
    await enterMainScreen();
    fireEvent.click(screen.getByRole("button", { name: "添加视频" }));
    await chooseVideo();
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    await waitFor(() => expect(screen.getByRole("heading", { name: "字幕生成完成" })).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "文件夹" }).at(0) as HTMLElement);
    expect(openPathMock).toHaveBeenCalledWith("C:\\Users\\Example\\Videos");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已模拟打开：C:\\Users\\Example\\Videos"));
  });

  it("selects files in translate and burn-in tools", async () => {
    render(<App />);
    await enterMainScreen();
    fireEvent.click(screen.getByRole("menuitem", { name: "翻译SRT" }));
    fireEvent.click(screen.getByRole("button", { name: "选择 SRT" }));
    fireEvent.change(screen.getByLabelText("选择 SRT 文件"), { target: { files: [new File(["1"], "demo.srt", { type: "text/plain" })] } });
    expect(screen.getByText("demo.srt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开始翻译" }));
    expect(await screen.findByRole("heading", { name: "翻译完成" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("打开调试面板"));
    fireEvent.click(screen.getByRole("button", { name: "任务列表" }));
    expect(screen.getByText("demo.zh.srt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "字幕烧录" }));
    fireEvent.change(screen.getByLabelText("选择烧录视频文件"), { target: { files: [new File(["v"], "clip.mov", { type: "video/quicktime" })] } });
    fireEvent.change(screen.getByLabelText("选择烧录字幕文件"), { target: { files: [new File(["s"], "clip.zh.srt", { type: "text/plain" })] } });
    expect(screen.getByText("clip.mov")).toBeInTheDocument();
    expect(screen.getByText("clip.zh.srt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开始烧录" }));
    expect(await screen.findByRole("heading", { name: "烧录完成" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "任务列表" }));
    expect(screen.getByText("clip.burned.mp4")).toBeInTheDocument();
  });

  it("lets users choose a custom output directory", async () => {
    render(<App />);
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "修改" }));
    await chooseOutputFolder();
    expect(await screen.findByText("Subtitles")).toBeInTheDocument();
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

  it("still requires remote upload confirmation after resolving an output conflict", async () => {
    render(<App />);
    fireEvent.click(await screen.findByLabelText("打开调试面板"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "outputConflict" } });
    await enterMainScreen();
    fireEvent.click(await screen.findByRole("button", { name: "添加视频" }));
    await chooseVideo();
    fireEvent.click((await screen.findAllByRole("button", { name: "详细设置" })).at(0) as HTMLElement);
    fireEvent.change(screen.getByLabelText("转写方式"), { target: { value: "api-openai-transcription" } });
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    expect(await screen.findByText("字幕文件已存在")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "覆盖" }));
    expect(await screen.findByText("确认使用 API 服务")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "正在生成字幕..." })).not.toBeInTheDocument();
  });

  it("shows remote provider upload confirmation before creating a job", async () => {
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
    fireEvent.change(providerSelect, { target: { value: "api-openai-transcription" } });
    await waitFor(() => expect(providerSelect.value).toBe("api-openai-transcription"));
    fireEvent.click(screen.getAllByRole("button", { name: "生成字幕" }).at(-1) as HTMLElement);
    expect(await screen.findByText("确认使用 API 服务")).toBeInTheDocument();
    expect(screen.getByText("确认并继续")).toBeInTheDocument();
  });

  it("exposes model install progress and failed install scenarios in debug", async () => {
    render(<App />);
    fireEvent.click(await screen.findByLabelText("打开调试面板"));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "modelInstalling" } });
    fireEvent.click(await screen.findByRole("button", { name: "模型管理" }));
    expect(await screen.findByText(/安装中 63%/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "modelInstallFailed" } });
    await waitFor(() => expect(screen.getAllByRole("button", { name: "重试下载" }).length).toBeGreaterThan(0));
    expect(screen.getByText(/Whisper Small/).closest("article")?.textContent).toContain("安装失败");
  });
});
