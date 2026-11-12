import { describe, expect, test } from "bun:test";
import { deriveEntry, isFailureConclusion } from "../../src/core/state.ts";
import type { Conclusion, EntryInput, RunRecord } from "../../src/core/types.ts";

const entry = { key: "k", repo: "mklab-se/x", workflow: "ci.yml", branch: "main", name: "CI" };
let nextId = 1;
const at = (min: number) => new Date(Date.UTC(2026, 10, 12, 10, min)).toISOString();

function run(o: Partial<RunRecord> & { t?: number } = {}): RunRecord {
  const t = o.t ?? 0;
  return {
    id: nextId++,
    url: "https://github.com/mklab-se/x/actions/runs/1",
    branch: "main",
    sha: "abc1234",
    actor: "kristofer",
    event: "push",
    createdAt: at(t),
    startedAt: at(t),
    completedAt: at(t + 5),
    status: "completed",
    conclusion: "success",
    jobs: [],
    ...o,
  };
}
const derive = (runs: RunRecord[], extra: Partial<EntryInput> = {}) =>
  deriveEntry({ entry, runs, ...extra });

describe("deriveEntry", () => {
  test("never run", () => {
    const v = derive([]);
    expect(v.state).toBe("never");
    expect(v.history).toEqual([]);
  });

  test("passed", () => {
    const v = derive([run()]);
    expect(v.state).toBe("passed");
    expect(v.failing).toBe(false);
  });

  test("failed conclusions", () => {
    for (const c of ["failure", "timed_out", "startup_failure"] as Conclusion[]) {
      expect(derive([run({ conclusion: c })]).state).toBe("failed");
      expect(isFailureConclusion(c)).toBe(true);
    }
  });

  test("ignored conclusions", () => {
    for (const c of [
      "cancelled",
      "skipped",
      "neutral",
      "stale",
      "action_required",
    ] as Conclusion[]) {
      const v = derive([run({ conclusion: c, t: 10 }), run({ conclusion: "success", t: 0 })]);
      expect(v.state).toBe("passed");
      expect(isFailureConclusion(c)).toBe(false);
    }
  });

  test("queued run is running", () => {
    const q = run({
      status: "queued",
      startedAt: null,
      completedAt: null,
      conclusion: null,
      t: 10,
    });
    const v = derive([q, run()]);
    expect(v.state).toBe("running");
    expect(v.current?.id).toBe(q.id);
  });

  test("failing and re-running", () => {
    const v = derive(
      [
        run({ status: "in_progress", completedAt: null, conclusion: null, t: 20 }),
        run({ conclusion: "failure", t: 10 }),
      ],
      { failure: { job: "Build", step: "m -j64", logExcerpt: ["error"] } },
    );
    expect(v.state).toBe("running");
    expect(v.failing).toBe(true);
    expect(v.failure?.job).toBe("Build");
  });

  test("broken since", () => {
    const t2 = run({ conclusion: "failure", t: 20 });
    const v = derive([
      run({ conclusion: "failure", t: 30 }),
      t2,
      run({ conclusion: "success", t: 10 }),
    ]);
    expect(v.brokenSince).toBe(t2.completedAt as string);
  });

  test("history", () => {
    const runs = Array.from({ length: 20 }, (_, i) =>
      run({ conclusion: i === 0 ? "failure" : "success", t: 100 - i }),
    );
    const v = derive(runs);
    expect(v.history).toHaveLength(10); // the wall shows the last 10 results
    expect(v.history[9]).toBe("f");
    expect(v.history[0]).toBe("p");
  });

  test("missing", () => {
    const v = derive([run()], { problem: "404" });
    expect(v.state).toBe("missing");
    expect(v.problem).toBe("404");
  });

  test("last duration of latest completed", () => {
    expect(derive([run({ t: 0 })]).lastDurationMs).toBe(5 * 60_000);
  });

  test("labels and color travel to the wall; none stays none", () => {
    const v = deriveEntry({ entry: { ...entry, labels: ["android"], color: "#3b82f6" }, runs: [] });
    expect(v.labels).toEqual(["android"]);
    expect(v.color).toBe("#3b82f6");
    const plain = derive([]);
    expect(plain.labels).toBeUndefined();
    expect(plain.color).toBeUndefined();
  });
});
