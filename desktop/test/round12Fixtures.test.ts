import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { containsSecret } from "../shared/privacy/redaction";

const fixtureRoot = join(process.cwd(), "test", "fixtures", "daemon", "round12");

describe("Round 12 daemon fixtures", () => {
  it("cover model install, translate, burn, config, and secret states without raw secrets", () => {
    const modelInstall = JSON.parse(readFileSync(join(fixtureRoot, "model-install-success.json"), "utf8")) as unknown;
    const translateBurn = JSON.parse(readFileSync(join(fixtureRoot, "translate-burn-config-secret.json"), "utf8")) as unknown;
    const serialized = JSON.stringify([modelInstall, translateBurn]);
    expect(serialized).toContain("model_install");
    expect(serialized).toContain("translate_srt");
    expect(serialized).toContain("burn_in");
    expect(serialized).toContain("secret_ref_expired");
    expect(containsSecret(serialized)).toBe(false);
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("sk-");
  });
});
