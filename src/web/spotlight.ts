/**
 * The spotlight (spec section 3.2): running workflows take turns opening as a large diagram over
 * the track, and a run that just finished gets one last turn before a failure enters the pit.
 * Pure, so it is tested without a browser; the App calls it once per clock tick.
 */
import { isFailureConclusion } from "../core/state.ts";
import type { EntryView } from "../core/types.ts";

export interface Timings {
  showMs: number;
  everyMs: number;
  /** How much faster run timestamps age than real time (the demo's fast clock). */
  clockScale: number;
}

/** A finished run waits at most this long (real time) for its last turn. */
const RECENT_MS = 120_000;

export interface Spot {
  key: string;
  runKey: string;
  /** A finished run's last turn (pass or failure), not a running one. */
  final: boolean;
}

export interface SpotlightState {
  current: Spot | null;
  shownAt: number;
  /** When the last running workflow's turn began (the round robin's beat). */
  turnAt: number;
  endedAt: number;
  cursor: string | null;
  /** Finished runs that had their last turn (or were already finished at start). */
  done: Set<string>;
  seeded: boolean;
}

export function emptySpotlight(): SpotlightState {
  return {
    current: null,
    shownAt: 0,
    turnAt: Number.NEGATIVE_INFINITY,
    endedAt: Number.NEGATIVE_INFINITY,
    cursor: null,
    done: new Set(),
    seeded: false,
  };
}

const runKeyOf = (e: EntryView) => `${e.latestCompleted?.id}@${e.latestCompleted?.completedAt}`;

function ageMs(e: EntryView, now: number, t: Timings): number {
  const at = e.latestCompleted?.completedAt;
  return at ? (now - Date.parse(at)) / t.clockScale : Number.POSITIVE_INFINITY;
}

/** Runs that finished recently (pass or failure), oldest first. */
export function finishedRuns(entries: EntryView[], now: number, t: Timings) {
  return entries
    .filter((e) => {
      const c = e.latestCompleted?.conclusion ?? null;
      const decided = c === "success" || (c !== null && isFailureConclusion(c));
      return (
        e.state !== "running" && e.state !== "missing" && decided && ageMs(e, now, t) < RECENT_MS
      );
    })
    .sort((a, b) => ageMs(b, now, t) - ageMs(a, now, t))
    .map((e) => ({ key: e.key, runKey: runKeyOf(e) }));
}

export function nextSpotlight(
  prev: SpotlightState,
  entries: EntryView[],
  now: number,
  t: Timings,
): SpotlightState {
  const finished = finishedRuns(entries, now, t);
  let s = prev;
  // runs that had already finished when this screen started get no last turn
  if (!s.seeded) s = { ...s, seeded: true, done: new Set(finished.map((f) => f.runKey)) };
  if (s.current) {
    if (now - s.shownAt < t.showMs) return s;
    const done = new Set(s.done);
    if (s.current.final) done.add(s.current.runKey);
    s = { ...s, current: null, endedAt: now, done };
  }
  // a run that just finished gets its last turn at once
  const pending = finished.find((f) => !s.done.has(f.runKey));
  if (pending) return { ...s, current: { ...pending, final: true }, shownAt: now };
  const running = entries.filter((e) => e.state === "running").map((e) => e.key);
  const rested = now - s.endedAt >= t.everyMs - t.showMs && now - s.turnAt >= t.everyMs;
  if (!running.length || !rested) return s;
  const at = s.cursor ? running.indexOf(s.cursor) : -1;
  const key = running[(at + 1) % running.length] as string;
  return {
    ...s,
    current: { key, runKey: "", final: false },
    shownAt: now,
    turnAt: now,
    cursor: key,
  };
}

/**
 * Is this workflow in the pit? Not found: yes. Failed: once its last turn has been shown (or it
 * was already failed when the screen started, or it waited two minutes). Re-running: back on
 * the track.
 */
export function inPit(e: EntryView, s: SpotlightState, now: number, t: Timings): boolean {
  if (e.state === "missing") return true;
  if (!e.failing || e.state === "running") return false;
  if (!e.latestCompleted) return true;
  return s.done.has(runKeyOf(e)) || ageMs(e, now, t) >= RECENT_MS;
}
