/**
 * Holds: a run that just finished stays big where people were watching it (the whole graph,
 * the failed job in red) for a few minutes, a pass for under a minute, before it shrinks to
 * a failure card or a passed tile. If the same workflow starts again, the new run takes over.
 * Pure, so it is tested without a browser.
 */
import { isFailureConclusion } from "../core/state.ts";
import type { EntryView } from "../core/types.ts";
import { isFailingEntry, isMonitoredOnly } from "./layout.ts";

export interface Holds {
  failedMs: number;
  passedMs: number;
}

export function holdsFrom(display?: {
  holdFailedSeconds?: number;
  holdPassedSeconds?: number;
}): Holds {
  return {
    failedMs: (display?.holdFailedSeconds ?? 180) * 1000,
    passedMs: (display?.holdPassedSeconds ?? 45) * 1000,
  };
}

/** Until when an entry's finished run is still shown big, or null when it is not held. */
export function heldUntil(e: EntryView, now: number, holds: Holds): number | null {
  if (e.state === "running" || e.state === "missing") return null;
  const run = e.latestCompleted;
  if (!run?.completedAt) return null;
  const ms = isFailureConclusion(run.conclusion)
    ? holds.failedMs
    : run.conclusion === "success"
      ? holds.passedMs
      : 0;
  const until = Date.parse(run.completedAt) + ms;
  return until > now ? until : null;
}

/** Which band each entry belongs in right now; held runs stay with the running ones. */
export function partition(entries: EntryView[], now: number, holds: Holds) {
  const held = new Set(entries.filter((e) => heldUntil(e, now, holds) !== null).map((e) => e.key));
  return {
    held,
    active: entries.filter((e) => e.state === "running" || held.has(e.key)),
    failing: entries.filter((e) => isFailingEntry(e) && !held.has(e.key)),
    monitored: entries.filter((e) => isMonitoredOnly(e) && !held.has(e.key)),
  };
}
