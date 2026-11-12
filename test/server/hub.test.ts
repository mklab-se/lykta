import { describe, expect, test } from "bun:test";
import type { EntryInput, RunRecord } from "../../src/core/types.ts";
import { Hub } from "../../src/server/hub.ts";

const input = (name: string): EntryInput => ({
  entry: { key: "k", repo: "o/r", workflow: "ci.yml", branch: "main", name },
  runs: [],
});

describe("Hub", () => {
  test("does not broadcast when nothing changed", () => {
    const hub = new Hub("1");
    let calls = 0;
    hub.subscribe(() => calls++);
    hub.update([input("CI")]);
    hub.update([input("CI")]);
    expect(calls).toBe(1);
    hub.update([input("Release")]);
    expect(calls).toBe(2);
  });

  test("serialises each snapshot once for every subscriber", () => {
    const hub = new Hub("1");
    const seen: string[] = [];
    hub.subscribe((json) => seen.push(json));
    hub.subscribe((json) => seen.push(json));
    hub.update([input("CI")]);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1] as string);
    expect(JSON.parse(seen[0] as string).entries[0].name).toBe("CI");
    expect(hub.serialized()).toBe(seen[0] as string);
  });

  test("warnings are broadcast and the snapshot says when synced", () => {
    const hub = new Hub("1");
    expect(hub.snapshot().synced).toBe(false);
    let last = "";
    hub.subscribe((json) => {
      last = json;
    });
    hub.update([input("CI")]);
    expect(hub.snapshot().synced).toBe(true);
    hub.setWarnings(["GitHub rate limit for acme: data delayed until 13:00"]);
    expect(JSON.parse(last).warnings).toEqual([
      "GitHub rate limit for acme: data delayed until 13:00",
    ]);
    let calls = 0;
    hub.subscribe(() => calls++);
    hub.setWarnings(["GitHub rate limit for acme: data delayed until 13:00"]);
    expect(calls).toBe(0);
  });

  test("finished runs keep their jobs while failing or recent, and drop them later", () => {
    const NOW = Date.UTC(2026, 10, 12, 12, 0);
    const run = (
      id: number,
      conclusion: "success" | "failure",
      endedSecondsAgo: number,
    ): RunRecord => {
      const at = new Date(NOW - endedSecondsAgo * 1000).toISOString();
      return {
        id,
        url: "",
        branch: "main",
        sha: "abc",
        actor: "a",
        event: "push",
        createdAt: at,
        startedAt: at,
        completedAt: at,
        status: "completed",
        conclusion,
        jobs: [
          {
            id: "j",
            name: "Build",
            status: conclusion,
            needs: [],
            steps: [],
            startedAt: at,
            completedAt: at,
          },
        ],
      };
    };
    const entry = (key: string, runs: RunRecord[]): EntryInput => ({
      entry: { key, repo: "o/r", workflow: `${key}.yml`, branch: "main", name: key },
      runs,
    });
    const hub = new Hub("1", { lowPower: "auto", demo: false }, undefined, () => NOW);
    hub.update([
      entry("failing", [run(1, "failure", 3600)]),
      entry("just-passed", [run(2, "success", 100)]),
      entry("old-pass", [run(3, "success", 3600)]),
    ]);
    const jobs = (key: string) =>
      hub.snapshot().entries.find((e) => e.key === key)?.latestCompleted?.jobs.length;
    expect(jobs("failing")).toBe(1);
    expect(jobs("just-passed")).toBe(1);
    expect(jobs("old-pass")).toBe(0);
  });
});
