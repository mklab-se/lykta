import { describe, expect, test } from "bun:test";
import {
  expectedDuration,
  expectedJobDurations,
  formatAgo,
  formatClock,
  formatDuration,
  isStepSlow,
  runProgress,
} from "../../src/core/timing.ts";
import type { RunRecord } from "../../src/core/types.ts";

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 12, 8, 0);
const iso = (t: number) => new Date(t).toISOString();

/** Completed runs, newest first, with the given durations in minutes. */
function runs(durations: number[], conclusion: RunRecord["conclusion"] = "success"): RunRecord[] {
  return durations.map((d, i) => {
    const start = T0 + (durations.length - i) * 1000 * MIN;
    return {
      id: i,
      url: "",
      branch: "main",
      sha: "s",
      actor: "a",
      event: "push",
      createdAt: iso(start),
      startedAt: iso(start),
      completedAt: iso(start + d * MIN),
      status: "completed",
      conclusion,
      jobs: [
        {
          id: "build",
          name: "Build",
          status: "success",
          needs: [],
          steps: [],
          startedAt: iso(start),
          completedAt: iso(start + d * MIN),
        },
      ],
    };
  });
}

describe("timing", () => {
  test("expected is median of last 5 successes", () => {
    expect(expectedDuration(runs([10, 20, 30, 40, 50, 900]))).toBe(30 * MIN);
    expect(expectedJobDurations(runs([10, 20, 30, 40, 50, 900])).get("Build")).toBe(30 * MIN);
  });

  test("no history gives undefined", () => {
    expect(expectedDuration([])).toBeUndefined();
    expect(expectedDuration(runs([10], "failure"))).toBeUndefined();
  });

  test("slow at 125 percent", () => {
    const live = {
      ...runs([1])[0],
      status: "in_progress",
      completedAt: null,
      conclusion: null,
    } as RunRecord;
    const start = Date.parse(live.startedAt as string);
    expect(runProgress(live, 60 * MIN, start + 76 * MIN).slow).toBe(true);
    expect(runProgress(live, 60 * MIN, start + 74 * MIN).slow).toBe(false);
    const p = runProgress(live, 60 * MIN, start + 30 * MIN);
    expect(p.fraction).toBeCloseTo(0.5);
    expect(p.etaMs).toBe(start + 60 * MIN);
  });

  test("timing handles missing start", () => {
    const queued = {
      ...runs([1])[0],
      status: "queued",
      startedAt: null,
      completedAt: null,
    } as RunRecord;
    const p = runProgress(queued, 60 * MIN, T0);
    expect(p.elapsedMs).toBe(0);
    expect(Number.isNaN(p.fraction ?? 0)).toBe(false);
    expect(runProgress(queued, undefined, T0).fraction).toBeNull();
  });

  test("step slow at 150 percent", () => {
    const step = {
      name: "m -j64",
      status: "running" as const,
      startedAt: iso(T0),
      completedAt: null,
    };
    expect(isStepSlow(step, 100 * MIN, T0 + 151 * MIN)).toBe(true);
    expect(isStepSlow(step, 100 * MIN, T0 + 149 * MIN)).toBe(false);
    expect(isStepSlow(step, undefined, T0 + 999 * MIN)).toBe(false);
  });

  test("formatDuration", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(725_000)).toBe("12m 05s");
    expect(formatDuration(8_040_000)).toBe("2h 14m");
    expect(formatDuration(-5)).toBe("0s");
  });

  test("formatAgo", () => {
    expect(formatAgo(30_000)).toBe("just now");
    expect(formatAgo(18 * 60_000)).toBe("18 min ago");
    expect(formatAgo(5 * 3_600_000)).toBe("5 h ago");
    expect(formatAgo(50 * 3_600_000)).toBe("2 d ago");
  });

  test("formatClock", () => {
    expect(formatClock(Date.UTC(2026, 10, 12, 16, 40), "UTC")).toBe("16:40");
  });
});
