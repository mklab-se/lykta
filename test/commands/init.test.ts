import { describe, expect, test } from "bun:test";
import { buildConfigYaml, envVarsFor } from "../../src/commands/init.ts";
import { parseConfig } from "../../src/server/config.ts";

const answers = {
  title: "Android",
  orgs: [
    { name: "mklab-se", auth: "app" as const },
    { name: "acme-corp", auth: "token" as const },
  ],
  monitor: [
    { repo: "mklab-se/android-platform", workflow: "nightly.yml" },
    { repo: "mklab-se/android-platform", workflow: "nightly.yml", branch: "release/2.4" },
    { repo: "acme-corp/billing", workflow: "ci.yml" },
  ],
};

describe("lykta init", () => {
  test("init writes a config that parses", () => {
    const yaml = buildConfigYaml(answers);
    const c = parseConfig(yaml, {});
    expect(c.monitor).toHaveLength(3);
    expect(c.title).toBe("Android");
    expect(c.organizations["acme-corp"]?.auth).toBe("token");
    expect(yaml).not.toMatch(/token:\s*\S|ghp_|github_pat_/);
  });

  test("init lists the env vars to set", () => {
    expect(envVarsFor(answers)).toEqual([
      "LYKTA_APP_ID",
      "LYKTA_APP_PRIVATE_KEY (or LYKTA_APP_PRIVATE_KEY_FILE)",
      "LYKTA_TOKEN_ACME_CORP (or LYKTA_TOKEN_ACME_CORP_FILE)",
    ]);
  });
});
