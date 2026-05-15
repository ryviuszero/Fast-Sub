import { app, safeStorage } from "electron";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UiError } from "../../shared/contracts/types";
import { uiError } from "./uiError";

type SecretRecord = {
  alias: string;
  providerId: string;
  encrypted: string;
  createdAt: string;
};

type TransientSecret = {
  value: string;
  sessionId: string;
  expiresAt: number;
  consumed: boolean;
};

export function defaultSecretStorePath(): string {
  return join(app.getPath("userData"), "provider-secrets");
}

export class SafeStorageSecretStore {
  constructor(private readonly root: string) {}

  isSecure(): boolean {
    if (!safeStorage.isEncryptionAvailable()) {
      return false;
    }
    const backend = process.platform === "linux" ? safeStorage.getSelectedStorageBackend() : "";
    return backend !== "basic_text";
  }

  async save(providerId: string, alias: string, rawSecret: string): Promise<void> {
    if (!this.isSecure()) {
      throw uiError("secret_storage_unavailable", "系统凭据不可用", "当前系统安全存储不可用，未保存 API key。");
    }
    await mkdir(this.root, { recursive: true });
    const encrypted = safeStorage.encryptString(rawSecret).toString("base64");
    const record: SecretRecord = { alias, providerId, encrypted, createdAt: new Date().toISOString() };
    await writeFile(this.path(providerId, alias), JSON.stringify(record, null, 2), { mode: 0o600 });
  }

  async read(providerId: string, alias: string): Promise<string | null> {
    if (!this.isSecure()) {
      throw uiError("secret_storage_unavailable", "系统凭据不可用", "当前系统安全存储不可用。");
    }
    try {
      const raw = await readFile(this.path(providerId, alias), "utf8");
      const record = JSON.parse(raw) as SecretRecord;
      return safeStorage.decryptString(Buffer.from(record.encrypted, "base64"));
    } catch {
      return null;
    }
  }

  async delete(providerId: string, alias: string): Promise<void> {
    await rm(this.path(providerId, alias), { force: true });
  }

  async listEnvSecrets(): Promise<Record<string, string>> {
    if (!this.isSecure()) {
      return {};
    }
    let files: string[];
    try {
      files = await readdir(this.root);
    } catch {
      return {};
    }
    const records: Record<string, { value: string; createdAt: string }> = {};
    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }
      try {
        const raw = await readFile(join(this.root, file), "utf8");
        const record = JSON.parse(raw) as SecretRecord;
        if (!isEnvName(record.alias)) {
          continue;
        }
        const value = safeStorage.decryptString(Buffer.from(record.encrypted, "base64"));
        const existing = records[record.alias];
        if (!existing || record.createdAt > existing.createdAt) {
          records[record.alias] = { value, createdAt: record.createdAt };
        }
      } catch {
        // Ignore corrupted or stale secret records. The provider check will report the missing key.
      }
    }
    return Object.fromEntries(Object.entries(records).map(([key, record]) => [key, record.value]));
  }

  private path(providerId: string, alias: string): string {
    const safe = `${providerId}--${alias}`.replace(/[^A-Za-z0-9._-]/g, "_");
    return join(this.root, `${safe}.json`);
  }
}

function isEnvName(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

export class TransientSecretReferences {
  private readonly secrets = new Map<string, TransientSecret>();

  create(sessionId: string, rawSecret: string, ttlMs = 5 * 60 * 1000): string {
    const ref = `secretref_${randomBytes(18).toString("hex")}`;
    this.secrets.set(ref, { value: rawSecret, sessionId, expiresAt: Date.now() + ttlMs, consumed: false });
    return ref;
  }

  consume(sessionId: string, ref: string): string | UiError {
    const secret = this.secrets.get(ref);
    if (!secret) {
      return uiError("secret_ref_not_found", "凭据引用不可用", "临时凭据引用不存在或已清理。");
    }
    if (secret.sessionId !== sessionId) {
      return uiError("secret_ref_invalid_session", "凭据会话不匹配", "临时凭据引用不属于当前本地服务会话。");
    }
    if (secret.consumed) {
      return uiError("secret_ref_consumed", "凭据引用已使用", "临时凭据引用只能使用一次。");
    }
    if (Date.now() > secret.expiresAt) {
      this.secrets.delete(ref);
      return uiError("secret_ref_expired", "凭据引用已过期", "临时凭据引用已过期，请重新创建任务。");
    }
    secret.consumed = true;
    const value = secret.value;
    this.secrets.delete(ref);
    return value;
  }

  clearSession(sessionId: string): void {
    for (const [ref, secret] of this.secrets) {
      if (secret.sessionId === sessionId) {
        this.secrets.delete(ref);
      }
    }
  }
}
