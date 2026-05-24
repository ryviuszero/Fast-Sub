import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseAndTranslate, translateRequest } from "../web-translate-helper/helper.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const helperCli = resolve(__dirname, "..", "web-translate-helper", "cli.mjs");

function request(overrides = {}) {
  return {
    schema_version: 1,
    provider: "web-bing",
    text: "hello",
    from_language: "en",
    to_language: "zh",
    timeout_seconds: 10,
    ...overrides
  };
}

describe("web translate helper", () => {
  it("translates with mocked Bing provider", async () => {
    const response = await translateRequest(request(), {
      bing: {
        translate: async (text, from, to) => ({ translation: `${text}:${from}:${to}` })
      }
    });

    expect(response).toEqual({
      schema_version: 1,
      ok: true,
      text: "hello:en:zh-Hans"
    });
  });

  it("translates with mocked Google provider", async () => {
    const response = await translateRequest(
      request({ provider: "web-google", from_language: "auto", to_language: "zh" }),
      {
        google: {
          translate: async (text, options) => ({ text: `${text}:${options.from}:${options.host}:${options.to}` })
        }
      }
    );

    expect(response).toEqual({
      schema_version: 1,
      ok: true,
      text: "hello:auto:translate.google.com:zh-CN"
    });
  });

  it("falls back to the alternate Google host", async () => {
    const calls = [];
    const response = await translateRequest(request({ provider: "web-google" }), {
      google: {
        translate: async (text, options) => {
          calls.push(options.host);
          if (options.host === "translate.google.com") {
            const error = new Error("connect EACCES");
            error.code = "EACCES";
            throw error;
          }
          return { text: `${text}:${options.host}` };
        }
      }
    });

    expect(response).toEqual({
      schema_version: 1,
      ok: true,
      text: "hello:translate.google.com.hk"
    });
    expect(calls).toEqual(["translate.google.com", "translate.google.com.hk"]);
  });

  it("maps network failures to region_blocked", async () => {
    const response = await translateRequest(request({ provider: "web-google" }), {
      google: {
        translate: async () => {
          const error = new Error("connect EACCES 198.18.0.150:443");
          error.code = "EACCES";
          throw error;
        }
      }
    });

    expect(response).toMatchObject({
      schema_version: 1,
      ok: false,
      error: { code: "region_blocked" }
    });
  });

  it("maps missing packaged dependencies to missing_dependency", async () => {
    const response = await translateRequest(request({ provider: "web-google" }), {
      google: {
        translate: async () => {
          const error = new Error("Cannot find package '@vitalets/google-translate-api'");
          error.code = "ERR_MODULE_NOT_FOUND";
          throw error;
        }
      }
    });

    expect(response).toMatchObject({
      schema_version: 1,
      ok: false,
      error: { code: "missing_dependency" }
    });
  });

  it("maps provider rate limits to structured errors", async () => {
    const error = new Error("Too Many Requests");
    error.status = 429;
    const response = await translateRequest(request(), {
      bing: {
        translate: async () => {
          throw error;
        }
      }
    });

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("rate_limited");
    expect(response.error.action_hint).toContain("local/API");
  });

  it("maps parser failures to provider_response_changed", async () => {
    const response = await translateRequest(request({ provider: "web-google" }), {
      google: {
        translate: async () => {
          throw new SyntaxError("Unexpected token");
        }
      }
    });

    expect(response.ok).toBe(false);
    expect(response.error.code).toBe("provider_response_changed");
  });

  it("rejects invalid provider, empty text, invalid language, oversized text, and invalid JSON", async () => {
    await expect(translateRequest(request({ provider: "web-yandex" }))).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_input" }
    });
    await expect(translateRequest(request({ text: " " }))).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_input" }
    });
    await expect(translateRequest(request({ to_language: "xx" }))).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_input" }
    });
    await expect(translateRequest(request({ text: "x".repeat(1001) }))).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_input" }
    });
    await expect(parseAndTranslate("{")).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_input" }
    });
  });

  it("keeps CLI stdout JSON-only on validation failures", () => {
    const result = spawnSync(process.execPath, [helperCli], {
      input: JSON.stringify(request({ provider: "unknown" })),
      encoding: "utf8"
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema_version: 1,
      ok: false,
      error: { code: "invalid_input" }
    });
  });
});
