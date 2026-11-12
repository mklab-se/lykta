import { describe, expect, test } from "bun:test";
import type { EntryView, RunRecord } from "../../src/core/types.ts";
import { emptySpotlight, finishedRuns, inPit, nextSpotlight } from "../../src/web/spotlight.ts";

const T = Date.UTC(2026, 10, 12, 12, 0);
const S = 1000;
const timings = { showMs: 8 * S, everyMs: 20 * S, clockScale: 1 };

function run(id: number, conclusion: RunRecord["conclusion"], endedAt: number | null): RunRecord {
  const at = endedAt === null ? null : new Date(endedAt).toISOString();
  return {
    id,
    url: "",
    branch: "main",
    sha: "abc",
    actor: "a",
    event: "push",
    createdAt: "",
    startedAt: null,
    completedAt: at,
    status: endedAt === null ? "in_progress" : "completed",
    conclusion,
    jobs: [],
  };
}

const running = (key: string): EntryView => ({
  key,
  name: key,
  repo: "o/r",
  branch: "main",
  state: "running",
  failing: false,
  history: [],
  current: run(1, null, null),
});
const failed = (key: string, endedAt: number): EntryView => ({
  key,
  name: key,
  repo: "o/r",
  branch: "main",
  state: "failed",
  failing: true,
  history: [],
  latestCompleted: run(7, "failure", endedAt),
});
const passed = (key: string, endedAt: number): EntryView => ({
  ...failed(key, endedAt),
  state: "passed",
  failing: false,
  latestCompleted: run(8, "success", endedAt),
});

/** Advance the spotlight second by second, returning what it showed when. */
function play(entries: (now: number) => EntryView[], from: number, seconds: number) {
  let s = emptySpotlight();
  const shown: [number, string | null][] = [];
  for (let i = 0; i <= seconds; i++) {
    const now = from + i * S;
    s = nextSpotlight(s, entries(now), now, timings);
    shown.push([i, s.current?.key ?? null]);
  }
  return { s, shown };
}

describe("spotlight", () => {
  test("nothing running, nothing shown", () => {
    const { shown } = play(() => [passed("a", T - 3600 * S)], T, 30);
    expect(shown.every(([, k]) => k === null)).toBe(true);
  });

  test("running workflows take turns: 8 s on, the next 20 s after the last began", () => {
    const { shown } = play(() => [running("a"), running("b")], T, 45);
    const at = (i: number) => shown[i]?.[1];
    expect(at(0)).toBe("a");
    expect(at(7)).toBe("a");
    expect(at(8)).toBeNull();
    expect(at(19)).toBeNull();
    expect(at(20)).toBe("b");
    expect(at(28)).toBeNull();
    expect(at(40)).toBe("a");
  });

  test("a run that just finished gets the next turn, ahead of the round robin", () => {
    const entries = (now: number) =>
      now < T + 10 * S ? [running("a"), running("x")] : [running("a"), failed("x", T + 10 * S)];
    const { shown } = play(entries, T, 30);
    const keys = shown.map(([, k]) => k);
    // a is shown first (0-7); x finishes at 10 and takes the next turn at 20, not b
    expect(keys.slice(8, 20).every((k) => k === null)).toBe(true);
    expect(keys[20]).toBe("x");
  });

  test("the track is in focus most of the time, however many runs finish", () => {
    // twenty workflows finishing one after another, 5 s apart
    const entries = (now: number) =>
      Array.from({ length: 20 }, (_, i) => {
        const end = T + (i + 1) * 5 * S;
        return now >= end ? passed(`p${i}`, end) : running(`p${i}`);
      });
    const { shown } = play(entries, T, 120);
    const open = shown.filter(([, k]) => k !== null).length;
    expect(open / shown.length).toBeLessThan(0.45);
  });

  test("failures take their last turn before passes", () => {
    let s = nextSpotlight(emptySpotlight(), [running("r")], T, timings);
    const later = [passed("p", T + 5 * S), failed("f", T + 6 * S)];
    s = nextSpotlight(s, later, T + 20 * S, timings);
    expect(s.current?.key).toBe("f");
  });

  test("failures already there when the wall starts go straight to the pit", () => {
    const e = failed("x", T - 3600 * S);
    const s = nextSpotlight(emptySpotlight(), [e], T, timings);
    expect(s.current).toBeNull();
    expect(inPit(e, s, T, timings)).toBe(true);
  });

  test("a new failure stays on the track for its last turn, then enters the pit", () => {
    const e = failed("x", T + 5 * S);
    let s = nextSpotlight(emptySpotlight(), [running("x")], T, timings);
    s = nextSpotlight(s, [e], T + 9 * S, timings);
    expect(s.current).toBeNull();
    expect(inPit(e, s, T + 9 * S, timings)).toBe(false); // red on the track, waiting
    s = nextSpotlight(s, [e], T + 20 * S, timings);
    expect(s.current?.key).toBe("x");
    expect(s.current?.final).toBe(true);
    s = nextSpotlight(s, [e], T + 28 * S, timings);
    expect(s.current).toBeNull();
    expect(inPit(e, s, T + 28 * S, timings)).toBe(true);
  });

  test("a failure waits at most two minutes for its turn", () => {
    const e = failed("x", T);
    expect(inPit(e, emptySpotlight(), T + 30 * S, timings)).toBe(false);
    expect(inPit(e, emptySpotlight(), T + 121 * S, timings)).toBe(true);
  });

  test("restarted from the pit: back on the track; not found: in the pit", () => {
    const s = emptySpotlight();
    expect(inPit({ ...running("x"), failing: true }, s, T, timings)).toBe(false);
    expect(inPit({ ...passed("m", T), state: "missing" }, s, T, timings)).toBe(true);
  });

  test("finishedRuns: recent passes and failures, oldest first, on a fast clock too", () => {
    const list = finishedRuns(
      [passed("p", T - 30 * S), failed("f", T - 50 * S), passed("old", T - 600 * S), running("r")],
      T,
      timings,
    );
    expect(list.map((x) => x.key)).toEqual(["f", "p"]);
    const fast = finishedRuns([passed("p", T - 600 * S)], T, { ...timings, clockScale: 60 });
    expect(fast.map((x) => x.key)).toEqual(["p"]);
  });

  test("a run stays the same run when its timestamps drift (the demo's fast clock)", () => {
    const at = (endedAt: number) => failed("x", endedAt);
    let s = nextSpotlight(emptySpotlight(), [at(T - 10 * S)], T, timings);
    // already finished at start: straight to the pit, and it stays there as timestamps move
    s = nextSpotlight(s, [at(T - 30 * S)], T + S, timings);
    expect(s.current).toBeNull();
    expect(inPit(at(T - 30 * S), s, T + S, timings)).toBe(true);
  });

  test("a re-run attempt of the same run id is a new run", () => {
    const e = failed("x", T - 10 * S);
    let s = nextSpotlight(emptySpotlight(), [e], T, timings);
    const again: EntryView = {
      ...e,
      latestCompleted: { ...(e.latestCompleted as RunRecord), attempt: 2 },
    };
    s = nextSpotlight(s, [again], T + S, timings);
    expect(s.current?.final).toBe(true);
    expect(inPit(again, s, T + S, timings)).toBe(false);
  });
});
