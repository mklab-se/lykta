import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ConfigError,
  entryKey,
  loadConfig,
  loadSecrets,
  parseConfig,
} from "../../src/server/config.ts";

const base = `
organizations:
  mklab-se:
    auth: token
monitor:
  - repo: mklab-se/lykta
    workflow: ci.yml
`;

describe("config", () => {
  test("defaults fill entries", () => {
    const c = parseConfig(base, {});
    expect(c.monitor[0]).toEqual({
      repo: "mklab-se/lykta",
      workflow: "ci.yml",
      branch: "main",
      name: "ci",
      ignoreEvents: [],
    });
    expect(c.server).toEqual({ port: 8080, host: "0.0.0.0" });
    expect(c.polling).toEqual({ activeSeconds: 15, idleSeconds: 60, budget: 0.2 });
    expect(c.display.lowPower).toBe("auto");
    expect(entryKey(c.monitor[0] as NonNullable<(typeof c.monitor)[0]>)).toBe(
      "mklab-se/lykta:ci.yml:main",
    );
  });

  test("name shows a non-default branch", () => {
    const c = parseConfig(`${base}    branch: release/2.4\n`, {});
    expect(c.monitor[0]?.name).toBe("ci · release/2.4");
  });

  test("every problem is reported", () => {
    const yaml = `
organizations:
  mklab-se:
    auth: token
monitor:
  - repo: acme-corp/billing
    workflow: nightly.yml
  - repo: mklab-se/lykta
    workflow: ci.yml
  - repo: mklab-se/lykta
    workflow: ci.yml
`;
    try {
      parseConfig(yaml, {});
      throw new Error("expected ConfigError");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).problems).toHaveLength(2);
    }
  });

  test("inline LYKTA_CONFIG wins", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cfg-"));
    const file = join(dir, "lykta.yaml");
    await writeFile(file, base.replace("ci.yml", "other.yml"));
    const c = await loadConfig({ path: file, env: { LYKTA_CONFIG: base } });
    expect(c.monitor[0]?.workflow).toBe("ci.yml");
    const fromFile = await loadConfig({ path: file, env: {} });
    expect(fromFile.monitor[0]?.workflow).toBe("other.yml");
    await rm(dir, { recursive: true, force: true });
  });

  test("env overrides port and title", () => {
    const c = parseConfig(base, {
      LYKTA_PORT: "9090",
      LYKTA_TITLE: "Android",
      LYKTA_HOST: "127.0.0.1",
    });
    expect(c.server).toEqual({ port: 9090, host: "127.0.0.1" });
    expect(c.title).toBe("Android");
  });

  test("token from LYKTA_TOKEN_ACME_CORP for org acme-corp", async () => {
    const c = parseConfig(
      "organizations:\n  acme-corp:\n    auth: token\nmonitor:\n  - repo: acme-corp/x\n    workflow: ci.yml\n",
      {},
    );
    const s = await loadSecrets(c, { LYKTA_TOKEN_ACME_CORP: "t0k" });
    expect(s.tokens["acme-corp"]).toBe("t0k");
  });

  test("_FILE variant is read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sec-"));
    const file = join(dir, "token");
    await writeFile(file, "from-file\n");
    const s = await loadSecrets(parseConfig(base, {}), { LYKTA_TOKEN_MKLAB_SE_FILE: file });
    expect(s.tokens["mklab-se"]).toBe("from-file");
    await rm(dir, { recursive: true, force: true });
  });

  test("missing token names the variable", async () => {
    try {
      await loadSecrets(parseConfig(base, {}), {});
      throw new Error("expected ConfigError");
    } catch (e) {
      expect((e as Error).message).toContain("LYKTA_TOKEN_MKLAB_SE");
    }
  });

  test("app key has escaped newlines restored", async () => {
    const c = parseConfig(base.replace("auth: token", "auth: app"), {});
    const s = await loadSecrets(c, {
      LYKTA_APP_ID: "123",
      LYKTA_APP_PRIVATE_KEY:
        "-----BEGIN RSA PRIVATE KEY-----\\nabc\\n-----END RSA PRIVATE KEY-----",
    });
    expect(s.appId).toBe("123");
    expect(s.appPrivateKey).toContain("\nabc\n");
  });

  test("example config parses", async () => {
    const c = await loadConfig({ path: "lykta.example.yaml", env: {} });
    expect(c.monitor.length).toBeGreaterThan(0);
  });
});
