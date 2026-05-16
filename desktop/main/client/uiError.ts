import type { UiError } from "../../shared/contracts/types";
import { redactSecretText } from "../../shared/privacy/redaction";

export function uiError(code: string, title: string, message: string, action = "打开诊断并重试"): UiError {
  const redacted = redactSecretText(message);
  return {
    code,
    title,
    message: redacted,
    action,
    recoveryActions: code.includes("daemon") || code === "unauthorized" ? ["repair_daemon", "open_diagnostics"] : ["retry", "open_diagnostics"],
    diagnostic: redactSecretText(`${code}: ${message}`)
  };
}

export function errorFromUnknown(error: unknown, fallbackCode = "desktop_client_error"): UiError {
  if (error !== null && typeof error === "object" && "code" in error && "title" in error) {
    return error as UiError;
  }
  const message = error instanceof Error ? error.message : String(error);
  return uiError(fallbackCode, "操作没有完成", message);
}
