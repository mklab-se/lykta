import { describe, expect, test } from "bun:test";
import type { EntryView, RunRecord } from "../../src/core/types.ts";
import { heldUntil, holdsFrom, partition } from "../../src/web/holds.ts";

const NOW = Date.UTC(2026, 10, 12, 12, 0);
const SEC = 1000;
const holds = { failedMs: 180 * SEC, passedMs: 45 * SEC, clockScale: 1 };

function run(conclusion: RunRecord["conclusion"], endedSecondsAgo: number): RunRecord {
  const at = new Date(NOW - endedSecondsAgo * SEC).toISOString();
  return {
    id: 1,
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
    jobs: [],
  };
}

function entry(key: string, state: EntryView["state"], last?: RunRecord): EntryView {
  return {
    key,
    name: key,
    repo: "o/r",
    branch: "main",
    state,
    failing: state === "failed",
    history: [],
    latestCompleted: last,
  };
}

describe("holds", () => {
  test("a failed run stays big for its hold, then shrinks", () => {
    expect(heldUntil(entry("a", "failed", run("failure", 10)), NOW, holds)).toBe(NOW + 170 * SEC);
    expect(heldUntil(entry("a", "failed", run("failure", 181)), NOW, holds)).toBeNull();
  });

  test("a passed run gets the short hold", () => {
    expect(heldUntil(entry("a", "passed", run("success", 30)), NOW, holds)).toBe(NOW + 15 * SEC);
    expect(heldUntil(entry("a", "passed", run("success", 46)), NOW, holds)).toBeNull();
  });

  test("a running entry is never held: the new run takes over its space", () => {
    expect(heldUntil(entry("a", "running", run("failure", 10)), NOW, holds)).toBeNull();
  });

  test("cancelled runs and missing workflows are not held", () => {
    expect(heldUntil(entry("a", "passed", run("cancelled", 5)), NOW, holds)).toBeNull();
    expect(heldUntil(entry("a", "missing", run("failure", 5)), NOW, holds)).toBeNull();
  });

  test("partition: held runs stay among the active ones, in wall order", () => {
    const entries = [
      entry("old-fail", "failed", run("failure", 600)),
      entry("new-fail", "failed", run("failure", 20)),
      entry("run", "running"),
      entry("new-pass", "passed", run("success", 5)),
      entry("old-pass", "passed", run("success", 600)),
    ];
    const p = partition(entries, NOW, holds);
    expect(p.active.map((e) => e.key)).toEqual(["new-fail", "run", "new-pass"]);
    expect([...p.held].sort()).toEqual(["new-fail", "new-pass"]);
    expect(p.failing.map((e) => e.key)).toEqual(["old-fail"]);
    expect(p.monitored.map((e) => e.key)).toEqual(["old-pass"]);
  });

  test("several failures keep their own holds side by side", () => {
    const entries = [
      entry("a", "failed", run("failure", 10)),
      entry("b", "failed", run("failure", 100)),
      entry("c", "failed", run("failure", 179)),
    ];
    expect(partition(entries, NOW, holds).active).toHaveLength(3);
    expect(partition(entries, NOW + 2 * SEC, holds).active).toHaveLength(2);
  });

  test("hold settings come from the server, in seconds, with defaults", () => {
    expect(holdsFrom({ holdFailedSeconds: 60, holdPassedSeconds: 0 })).toEqual({
      failedMs: 60_000,
      passedMs: 0,
      clockScale: 1,
    });
    expect(holdsFrom(undefined)).toEqual({ failedMs: 180_000, passedMs: 45_000, clockScale: 1 });
  });

  test("on a fast clock (the demo) holds and countdowns stay in real time", () => {
    const fast = { ...holds, clockScale: 60 };
    // finished 10 real seconds ago = 600 seconds on the fast clock: 170 real seconds left
    expect(heldUntil(entry("a", "failed", run("failure", 600)), NOW, fast)).toBe(NOW + 170 * SEC);
    expect(heldUntil(entry("a", "failed", run("failure", 181 * 60)), NOW, fast)).toBeNull();
  });
});
