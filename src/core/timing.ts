/**
 * Expected durations, slow detection and time labels (spec section 3.5).
 */
import type { RunRecord, StepRecord } from "./types.ts";

const SAMPLE = 5;
const SLOW_RUN = 1.25;
const SLOW_STEP = 1.5;

const t = (iso: string | null): number => (iso ? Date.parse(iso) : Number.NaN);

function median(values: number[]): number | undefined {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return undefined;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : ((v[mid - 1] as number) + (v[mid] as number)) / 2;
}

const recentSuccesses = (runs: RunRecord[]) =>
  runs.filter((r) => r.status === "completed" && r.conclusion === "success").slice(0, SAMPLE);

/** Median duration of the newest 5 successful runs, or undefined without history. */
export function expectedDuration(runs: RunRecord[]): number | undefined {
  return median(recentSuccesses(runs).map((r) => t(r.completedAt) - t(r.startedAt)));
}

/** Per job name, the median duration over the same runs. */
export function expectedJobDurations(runs: RunRecord[]): Map<string, number> {
  const byName = new Map<string, number[]>();
  for (const r of recentSuccesses(runs)) {
    for (const j of r.jobs) {
      const d = t(j.completedAt) - t(j.startedAt);
      if (Number.isFinite(d)) byName.set(j.name, [...(byName.get(j.name) ?? []), d]);
    }
  }
  const out = new Map<string, number>();
  for (const [name, ds] of byName) {
    const m = median(ds);
    if (m !== undefined) out.set(name, m);
  }
  return out;
}

export interface Progress {
  elapsedMs: number;
  fraction: number | null;
  slow: boolean;
  etaMs: number | null;
}

export function runProgress(run: RunRecord, expectedMs: number | undefined, now: number): Progress {
  const start = t(run.startedAt);
  const elapsedMs = Number.isFinite(start) ? Math.max(0, now - start) : 0;
  if (!expectedMs || expectedMs <= 0)
    return { elapsedMs, fraction: null, slow: false, etaMs: null };
  return {
    elapsedMs,
    fraction: Math.min(0.999, elapsedMs / expectedMs),
    slow: elapsedMs > SLOW_RUN * expectedMs,
    // past the usual duration there is no honest finish estimate
    etaMs: elapsedMs <= expectedMs ? now + (expectedMs - elapsedMs) : null,
  };
}

export function isStepSlow(step: StepRecord, usualMs: number | undefined, now: number): boolean {
  const start = t(step.startedAt);
  if (step.status !== "running" || !usualMs || !Number.isFinite(start)) return false;
  return now - start > SLOW_STEP * usualMs;
}

/** "45s", "12m 05s", "2h 14m". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${s}s`;
}

/** 24-hour clock, "17:40". */
export function formatClock(epochMs: number, timeZone?: string): string {
  return new Date(epochMs).toLocaleTimeString("sv-SE", {
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });
}

/** "just now", "18 min ago", "5 h ago", "2 d ago". */
export function formatAgo(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}
