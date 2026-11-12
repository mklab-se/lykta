/**
 * Turns an entry's runs into what the wall shows (spec section 3.1).
 */
import type { Conclusion, EntryInput, EntryView, RunRecord } from "./types.ts";

const FAILURES = new Set<Conclusion>(["failure", "timed_out", "startup_failure"]);
const HISTORY = 14;

export function isFailureConclusion(c: Conclusion): boolean {
  return FAILURES.has(c);
}

/** A completed run that decides passed or failed (cancelled, skipped, waiting etc. do not). */
function counts(run: RunRecord): boolean {
  return (
    run.status === "completed" &&
    (run.conclusion === "success" || isFailureConclusion(run.conclusion))
  );
}

const ms = (iso: string | null) => (iso ? Date.parse(iso) : Number.NaN);

export function deriveEntry(input: EntryInput): EntryView {
  const { entry, runs } = input;
  const newest = runs[0];
  const counted = runs.filter(counts);
  const latestCompleted = counted[0];
  const failing = latestCompleted ? isFailureConclusion(latestCompleted.conclusion) : false;

  let brokenSince: string | undefined;
  if (failing) {
    for (const r of counted) {
      if (!isFailureConclusion(r.conclusion)) break;
      brokenSince = r.completedAt ?? brokenSince;
    }
  }

  const running = newest !== undefined && newest.status !== "completed";
  const state = input.problem
    ? "missing"
    : running
      ? "running"
      : latestCompleted
        ? failing
          ? "failed"
          : "passed"
        : "never";

  const duration = latestCompleted
    ? ms(latestCompleted.completedAt) - ms(latestCompleted.startedAt)
    : Number.NaN;

  return {
    key: entry.key,
    name: entry.name,
    repo: entry.repo,
    branch: entry.branch,
    state,
    failing,
    current: running ? newest : undefined,
    latestCompleted,
    failure: failing ? input.failure : undefined,
    brokenSince,
    history: counted
      .slice(0, HISTORY)
      .reverse()
      .map((r) => (isFailureConclusion(r.conclusion) ? "f" : "p")),
    problem: input.problem,
    lastDurationMs: Number.isFinite(duration) ? duration : undefined,
  };
}
