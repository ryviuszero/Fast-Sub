const SCHEMA_VERSION = 1;
const PROVIDERS = new Set(["web-bing", "web-google"]);
const MAX_CHARS = {
  "web-bing": 1000,
  "web-google": 4000
};
const GOOGLE_HOSTS = ["translate.google.com", "translate.google.com.hk"];

const ACTION_HINTS = {
  invalid_input: "Review the translation settings and try again.",
  missing_dependency: "Reinstall Fast Sub or repair the packaged helper.",
  provider_timeout: "Try again later or choose local/API translation.",
  rate_limited: "Try again later or choose local/API translation.",
  region_blocked: "Try another network or choose local/API translation.",
  provider_response_changed: "Try again later or choose local/API translation.",
  provider_failed: "Try again later or choose local/API translation."
};

export async function translateRequest(payload, providerModules = {}) {
  const validated = validatePayload(payload);
  if (!validated.ok) {
    return failure(validated.code, validated.message);
  }

  const request = validated.request;
  try {
    const text = await withTimeout(
      callProvider(request, providerModules),
      request.timeout_seconds,
      `${request.provider} timed out after ${request.timeout_seconds}s.`
    );
    return {
      schema_version: SCHEMA_VERSION,
      ok: true,
      text
    };
  } catch (error) {
    const mapped = mapProviderError(error);
    return failure(mapped.code, mapped.message);
  }
}

export async function parseAndTranslate(raw, providerModules = {}) {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return failure("invalid_input", "Request body must be valid JSON.");
  }
  return translateRequest(payload, providerModules);
}

async function callProvider(request, providerModules) {
  if (request.provider === "web-bing") {
    const bing = providerModules.bing ?? (await import("bing-translate-api"));
    const translate = bing.translate ?? bing.default?.translate;
    if (typeof translate !== "function") {
      throw dependencyError("bing-translate-api does not export translate().");
    }
    const result = await translate(
      request.text,
      normalizeLanguage("web-bing", request.from_language, "from"),
      normalizeLanguage("web-bing", request.to_language, "to")
    );
    if (!result || typeof result.translation !== "string") {
      throw responseChangedError("Bing response did not contain translation text.");
    }
    return result.translation;
  }

  if (request.provider === "web-google") {
    const google = providerModules.google ?? (await import("@vitalets/google-translate-api"));
    const translate = google.translate ?? google.default?.translate;
    if (typeof translate !== "function") {
      throw dependencyError("@vitalets/google-translate-api does not export translate().");
    }
    let lastError;
    for (const host of GOOGLE_HOSTS) {
      try {
        const result = await translate(request.text, {
          from: normalizeLanguage("web-google", request.from_language, "from"),
          host,
          to: normalizeLanguage("web-google", request.to_language, "to")
        });
        if (!result || typeof result.text !== "string") {
          throw responseChangedError("Google response did not contain translation text.");
        }
        return result.text;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error("Google web translation failed.");
  }

  throw new Error(`Unsupported provider: ${request.provider}`);
}

function validatePayload(payload) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return invalid("Request body must be a JSON object.");
  }
  if (payload.schema_version !== SCHEMA_VERSION) {
    return invalid("Unsupported schema_version.");
  }
  if (typeof payload.provider !== "string" || !PROVIDERS.has(payload.provider)) {
    return invalid("Unsupported provider.");
  }
  if (typeof payload.text !== "string" || payload.text.trim() === "") {
    return invalid("Text must not be empty.");
  }
  if (payload.text.length > MAX_CHARS[payload.provider]) {
    return invalid(
      `${payload.provider} text is too long for one request. Split subtitles or choose local/API translation.`
    );
  }
  if (!isLanguage(payload.from_language, true) || !isLanguage(payload.to_language, false)) {
    return invalid("Language must be a supported language code.");
  }
  const timeout = Number(payload.timeout_seconds);
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 300) {
    return invalid("timeout_seconds must be between 1 and 300.");
  }
  return {
    ok: true,
    request: {
      provider: payload.provider,
      text: payload.text,
      from_language: payload.from_language.trim(),
      to_language: payload.to_language.trim(),
      timeout_seconds: timeout
    }
  };
}

function isLanguage(value, allowAuto) {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (allowAuto && normalized === "auto") {
    return true;
  }
  return ["zh", "zh-cn", "zh-hans", "en", "ja", "ko"].includes(normalized);
}

function normalizeLanguage(provider, value, direction) {
  const normalized = value.trim().toLowerCase();
  if (direction === "from" && normalized === "auto") {
    return provider === "web-bing" ? "auto-detect" : "auto";
  }
  if (["zh", "zh-cn", "zh-hans"].includes(normalized)) {
    return provider === "web-bing" ? "zh-Hans" : "zh-CN";
  }
  return normalized;
}

function withTimeout(promise, seconds, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(message);
      error.code = "provider_timeout";
      reject(error);
    }, seconds * 1000);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

function mapProviderError(error) {
  const message = safeMessage(error);
  const code = typeof error?.code === "string" ? error.code : "";
  const name = typeof error?.name === "string" ? error.name : "";
  const status = Number(error?.status ?? error?.statusCode ?? error?.response?.statusCode ?? 0);

  if (code === "missing_dependency" || code === "provider_response_changed" || code === "provider_timeout") {
    return { code, message };
  }
  if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND" || /cannot find (package|module)/i.test(message)) {
    return { code: "missing_dependency", message: "Web translation helper dependency is missing." };
  }
  if (code === "ETIMEDOUT" || /timed? out|timeout/i.test(message)) {
    return { code: "provider_timeout", message: "Web translation provider timed out." };
  }
  if (["EACCES", "ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(code) || /network|socket|proxy|dns|getaddrinfo|connect/i.test(message)) {
    return { code: "region_blocked", message: "Web translation provider is unavailable from this network region." };
  }
  if (status === 429 || name === "TooManyRequestsError" || /too many requests|rate limit|429/i.test(message)) {
    return { code: "rate_limited", message: "Web translation provider rate-limited the request." };
  }
  if (status === 403 || /forbidden|region|blocked|unsupported.*region/i.test(message)) {
    return { code: "region_blocked", message: "Web translation provider is unavailable from this network region." };
  }
  if (name === "SyntaxError" || /parse|unexpected token|response shape|cannot read/i.test(message)) {
    return { code: "provider_response_changed", message: "Web translation provider response format changed." };
  }
  return { code: "provider_failed", message: "Web translation provider failed." };
}

function dependencyError(message) {
  const error = new Error(message);
  error.code = "missing_dependency";
  return error;
}

function responseChangedError(message) {
  const error = new Error(message);
  error.code = "provider_response_changed";
  return error;
}

function safeMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error || "Web translation provider failed.");
}

function invalid(message) {
  return { ok: false, code: "invalid_input", message };
}

function failure(code, message) {
  return {
    schema_version: SCHEMA_VERSION,
    ok: false,
    error: {
      code,
      message,
      action_hint: ACTION_HINTS[code] ?? ACTION_HINTS.provider_failed
    }
  };
}
