import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseConfig } from "../../src/server/config.ts";
import type { GitHubApi } from "../../src/server/github/source.ts";
import { GitHubSource } from "../../src/server/github/source.ts";
import { startServer } from "../../src/server/http.ts";
import { Hub } from "../../src/server/hub.ts";

let cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanup) await c();
  cleanup = [];
});

describe("lykta serve", () => {
  test("serve fails clearly on a bad config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "serve-"));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const file = join(dir, "lykta.yaml");
    await writeFile(
      file,
      "organizations:\n  mklab-se:\n    auth: maybe\nmonitor:\n  - repo: nope\n",
    );
    const proc = Bun.spawn(["bun", "src/cli.ts", "serve", "--config", file], {
      env: { ...process.env, LYKTA_NO_UPDATE_CHECK: "1" },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code).toBe(2);
    expect(err).toContain('auth must be "app" or "token"');
    expect(err).toContain("repo must be owner/name");
  });

  test("readyz waits for the first sync", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const api: GitHubApi = {
      json: async <T>() => {
        await gate;
        return { data: { workflow_runs: [] } as T, notModified: false };
      },
      text: async () => "",
      rate: () => undefined,
      spent: () => 0,
      onWarning: () => {},
    };
    const config = parseConfig(
      "organizations:\n  o:\n    auth: token\nmonitor:\n  - repo: o/r\n    workflow: ci.yml\n",
      {},
    );
    const hub = new Hub("1");
    const source = new GitHubSource({ config, client: api, schedule: () => 0 });
    source.start((inputs) => hub.update(inputs));
    const server = startServer({ port: 0, hostname: "127.0.0.1", hub, source });
    cleanup.push(() => {
      source.stop();
      server.stop(true);
    });
    const base = `http://127.0.0.1:${server.port}`;
    expect((await fetch(`${base}/readyz`)).status).toBe(503);
    release();
    await source.firstSync;
    expect((await fetch(`${base}/readyz`)).status).toBe(200);
  });
});
