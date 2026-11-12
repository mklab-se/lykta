import { describe, expect, test } from "bun:test";
import { runCheck } from "../../src/commands/check.ts";
import { parseConfig } from "../../src/server/config.ts";
import { GitHubError } from "../../src/server/github/client.ts";
import type { GitHubApi } from "../../src/server/github/source.ts";

const NOW = Date.UTC(2026, 10, 12, 12, 0);
const config = parseConfig(
  "organizations:\n  mklab-se:\n    auth: token\n  acme:\n    auth: app\nmonitor:\n  - repo: mklab-se/lykta\n    workflow: ci.yml\n  - repo: mklab-se/lykta\n    workflow: gone.yml\n  - repo: acme/billing\n    workflow: nightly.yml\n",
  {},
);

function api(): GitHubApi {
  return {
    json: async <T>(org: string, path: string) => {
      if (org === "acme")
        throw new Error(
          "No GitHub App installation for acme: install the App in that organization",
        );
      if (path === "/rate_limit")
        return { data: { rate: { remaining: 4990, limit: 5000 } } as T, notModified: false };
      if (path.includes("ci.yml/runs"))
        return {
          data: {
            workflow_runs: [
              {
                id: 1,
                html_url: "u",
                head_branch: "main",
                head_sha: "s",
                event: "push",
                status: "completed",
                conclusion: "success",
                created_at: new Date(NOW - 7_200_000).toISOString(),
                run_started_at: new Date(NOW - 7_200_000).toISOString(),
                updated_at: new Date(NOW - 7_000_000).toISOString(),
                run_attempt: 1,
                path: ".github/workflows/ci.yml",
              },
            ],
          } as T,
          notModified: false,
        };
      if (path.endsWith("/jobs?filter=latest&per_page=100&page=1"))
        return { data: { total_count: 0, jobs: [] } as T, notModified: false };
      throw new GitHubError("404", 404);
    },
    text: async () => "",
    rate: () => undefined,
    onWarning: () => {},
  };
}

describe("lykta check", () => {
  test("check reports each entry", async () => {
    const r = await runCheck(config, api(), () => NOW);
    expect(r.ok).toBe(false);
    expect(r.lines.some((l) => l.startsWith("✓ ci") && l.includes("last run success"))).toBe(true);
    expect(r.lines.some((l) => l.startsWith("✗ gone") && l.includes("not found"))).toBe(true);
  });

  test("check reports a missing installation per org", async () => {
    const r = await runCheck(config, api(), () => NOW);
    expect(
      r.lines.some((l) => l.startsWith("✗ acme") && l.includes("No GitHub App installation")),
    ).toBe(true);
    expect(r.lines.some((l) => l.startsWith("✓ mklab-se") && l.includes("4990/5000"))).toBe(true);
  });
});
