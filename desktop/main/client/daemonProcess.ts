import { app } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { redactSecretText } from "../../shared/privacy/redaction";
import { daemonTransportLog } from "./transportLog";
import { uiError } from "./uiError";

export type DaemonSession = {
  sessionId: string;
  baseUrl: string;
  token: string;
  pid: number;
  owned: boolean;
};

type ReadyJson = {
  schema_version: number;
  ready: boolean;
  base_url: string;
  token: string;
  pid: number;
};

type DaemonCommand = {
  command: string;
  argsPrefix: string[];
  cwd?: string;
  label: string;
};

function isReadyJson(value: unknown): value is ReadyJson {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.schema_version === 1 && record.ready === true && typeof record.base_url === "string" && typeof record.token === "string" && typeof record.pid === "number";
}

export class DaemonProcessManager {
  private child: ChildProcess | null = null;
  private session: DaemonSession | null = null;

  async ensureStarted(): Promise<DaemonSession> {
    if (this.session) {
      return this.session;
    }
    const attached = this.attachedSession();
    if (attached) {
      daemonTransportLog("daemon.attach", { baseUrl: attached.baseUrl, owned: attached.owned });
      this.session = attached;
      return attached;
    }
    return this.startOwnedDaemon();
  }

  async repair(): Promise<DaemonSession> {
    await this.stop();
    this.session = null;
    return this.ensureStarted();
  }

  async stop(): Promise<void> {
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
    this.child = null;
    this.session = null;
  }

  private attachedSession(): DaemonSession | null {
    const baseUrl = process.env.FAST_SUB_DAEMON_BASE_URL;
    const token = process.env.FAST_SUB_DAEMON_TOKEN ?? "dev-token";
    if (!baseUrl) {
      return null;
    }
    return { sessionId: randomUUID(), baseUrl, token, pid: process.pid, owned: false };
  }

  private startOwnedDaemon(): Promise<DaemonSession> {
    const daemon = resolveDaemonCommand();
    if (!daemon) {
      throw uiError("daemon_runtime_missing", "本地服务未找到", "没有找到 fast-sub-go，也无法定位开发环境 Go 入口。请先构建 Go daemon，或设置 FAST_SUB_GO 指向 fast-sub-go 可执行文件。", "打开诊断");
    }
    const args = [...daemon.argsPrefix, "serve", "--host", "127.0.0.1", "--port", "0", "--json-ready", "--max-running-jobs", "1"];
    daemonTransportLog("daemon.spawn", { command: daemon.label, cwd: daemon.cwd ?? process.cwd(), args: ["serve", "--host", "127.0.0.1", "--port", "0", "--json-ready", "--max-running-jobs", "1"] });
    const child = spawn(daemon.command, args, {
      cwd: daemon.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: scrubbedEnv()
    });
    this.child = child;
    const stderrTail: string[] = [];
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderrTail.push(redactSecretText(chunk));
      if (stderrTail.length > 20) {
        stderrTail.shift();
      }
    });
    return new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        reject(uiError("daemon_ready_timeout", "本地服务启动超时", stderrTail.join("\n") || "fast-sub-go 没有及时输出 ready JSON。"));
        child.kill();
      }, 15000);
      if (!child.stdout) {
        reject(uiError("daemon_ready_invalid", "本地服务握手无效", "fast-sub-go stdout 不可用。"));
        return;
      }
      const rl = createInterface({ input: child.stdout });
      child.once("exit", (code) => {
        if (!this.session) {
          clearTimeout(timeout);
          reject(uiError("daemon_exited_early", "本地服务提前退出", `${daemon.label} exited with code ${code}. ${stderrTail.join("\n")}`));
        }
      });
      rl.once("line", (line) => {
        clearTimeout(timeout);
        try {
          const parsed = JSON.parse(line) as unknown;
          if (!isReadyJson(parsed)) {
            reject(uiError("daemon_ready_invalid", "本地服务握手无效", "ready JSON schema 不符合预期。"));
            child.kill();
            return;
          }
          const session: DaemonSession = {
            sessionId: randomUUID(),
            baseUrl: parsed.base_url,
            token: parsed.token,
            pid: parsed.pid,
            owned: true
          };
          this.session = session;
          daemonTransportLog("daemon.ready", { baseUrl: session.baseUrl, pid: session.pid, owned: session.owned });
          resolvePromise(session);
        } catch (error) {
          reject(uiError("daemon_ready_invalid", "本地服务握手无效", error instanceof Error ? error.message : String(error)));
          child.kill();
        }
      });
    });
  }
}

function resolveDaemonCommand(): DaemonCommand | null {
  const explicit = process.env.FAST_SUB_GO;
  if (explicit && existsSync(explicit)) {
    return { command: explicit, argsPrefix: [], label: explicit };
  }
  const repoRoot = resolve(process.cwd(), "..");
  const candidates = [
    join(process.cwd(), "fast-sub-go.exe"),
    join(process.cwd(), "fast-sub-go"),
    join(repoRoot, "fast-sub-go.exe"),
    join(repoRoot, "fast-sub-go"),
    join(app.getAppPath(), "..", "fast-sub-go.exe"),
    join(app.getAppPath(), "..", "fast-sub-go"),
    resolve(app.getAppPath(), "..", "..", "fast-sub-go.exe")
  ];
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (executable) {
    return { command: executable, argsPrefix: [], label: executable };
  }
  const devMain = join(repoRoot, "cmd", "fast-sub-go");
  if (!app.isPackaged && existsSync(devMain)) {
    return { command: "go", argsPrefix: ["run", "./cmd/fast-sub-go"], cwd: repoRoot, label: "go run ./cmd/fast-sub-go" };
  }
  return null;
}

function scrubbedEnv(): NodeJS.ProcessEnv {
  const keep = ["PATH", "Path", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOMEDRIVE", "HOMEPATH", "FAST_SUB_HOME", "FAST_SUB_CONFIG", "FAST_SUB_GO_CONFIG", "GOCACHE", "GOMODCACHE", "GOPATH"];
  const env: NodeJS.ProcessEnv = {};
  for (const key of keep) {
    if (process.env[key]) {
      env[key] = process.env[key];
    }
  }
  return env;
}
