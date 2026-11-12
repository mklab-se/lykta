/**
 * The dashboard's data model, shared by the server and the browser.
 * Times are ISO 8601 strings; durations are milliseconds.
 */

export type JobStatus = "queued" | "running" | "success" | "failure" | "skipped" | "cancelled";

export type Conclusion =
  | "success"
  | "failure"
  | "timed_out"
  | "startup_failure"
  | "cancelled"
  | "skipped"
  | "neutral"
  | "stale"
  | "action_required"
  | null;

export type RunnerKind = "gh" | "k8s" | "lab" | "self";

export interface RunnerInfo {
  kind: RunnerKind;
  label: string;
  detail?: string;
}

export interface StepRecord {
  name: string;
  status: JobStatus;
  startedAt: string | null;
  completedAt: string | null;
  /** Usual duration of this step, from history; drives "slower than usual". */
  usualMs?: number;
}

export interface JobRecord {
  id: string;
  name: string;
  status: JobStatus;
  needs: string[];
  /** Jobs from one matrix or reusable workflow share a group, e.g. "Build". */
  group?: string;
  runner?: RunnerInfo;
  steps: StepRecord[];
  startedAt: string | null;
  completedAt: string | null;
}

export interface RunRecord {
  id: number;
  /** GitHub re-runs keep the id; each attempt is a run of its own (default 1). */
  attempt?: number;
  url: string;
  branch: string;
  sha: string;
  actor: string;
  event: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  status: "queued" | "in_progress" | "waiting" | "completed";
  conclusion: Conclusion;
  jobs: JobRecord[];
}

export interface FailureInfo {
  job: string;
  step: string;
  runner?: RunnerInfo;
  logExcerpt: string[];
  /** The error message itself (at most 3 lines), shown as the biggest text on the card. */
  errors?: string[];
  /** When there is no error line: why the job ended ("The job timed out"). */
  reason?: string;
}

/** One configured tile: one workflow on one branch. */
export interface MonitoredEntry {
  key: string;
  repo: string;
  workflow: string;
  branch: string;
  name: string;
  /** Shown as #hashtags in the tile's corner; for filtering (which team or area). */
  labels?: string[];
  /** A CSS color for the label tags. */
  color?: string;
}

/** What a source knows about an entry: its runs, newest first. */
export interface EntryInput {
  entry: MonitoredEntry;
  runs: RunRecord[];
  failure?: FailureInfo;
  /** Set when the entry cannot be found or read (shown as "not found"). */
  problem?: string;
}

export type EntryState = "never" | "passed" | "failed" | "running" | "missing";

export interface EntryView {
  key: string;
  name: string;
  repo: string;
  branch: string;
  state: EntryState;
  /** The newest counted completed run failed (true also while a fix is running). */
  failing: boolean;
  current?: RunRecord;
  latestCompleted?: RunRecord;
  failure?: FailureInfo;
  brokenSince?: string;
  /** Up to 14 counted completed results, oldest first. */
  history: ("p" | "f")[];
  problem?: string;
  expectedMs?: number;
  lastDurationMs?: number;
  labels?: string[];
  color?: string;
}

export interface DashboardState {
  version: string;
  generatedAt: string;
  title?: string;
  entries: EntryView[];
  warnings: string[];
}
