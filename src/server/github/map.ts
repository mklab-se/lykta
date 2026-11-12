/**
 * Translates GitHub's REST vocabulary into Lykta's model. Pure; the state rules themselves
 * live in src/core/state.ts.
 */
import type { Conclusion, JobRecord, JobStatus, RunnerInfo, RunRecord } from "../../core/types.ts";
import type { RunnerRule } from "../config.ts";

export interface GhRun {
  id: number;
  html_url: string;
  head_branch: string;
  head_sha: string;
  event: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  run_started_at: string | null;
  updated_at: string;
  run_attempt: number;
  path: string;
  actor?: { login: string };
  triggering_actor?: { login: string };
  referenced_workflows?: { path: string; sha: string; ref?: string }[];
}

export interface GhStep {
  number: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface GhJob {
  id: number;
  run_id: number;
  run_attempt: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
  labels: string[];
  runner_name: string | null;
  runner_group_name: string | null;
  check_run_url: string;
  steps?: GhStep[];
}

const FAILED = new Set(["failure", "timed_out", "startup_failure"]);
const HOSTED_GROUP = "GitHub Actions";

export function mapJobStatus(status: string, conclusion: string | null): JobStatus {
  if (status === "in_progress") return "running";
  if (status !== "completed") return "queued";
  if (conclusion === "success") return "success";
  if (conclusion && FAILED.has(conclusion)) return "failure";
  if (conclusion === "skipped") return "skipped";
  return "cancelled";
}

function runStatus(status: string): RunRecord["status"] {
  if (status === "completed") return "completed";
  if (status === "in_progress") return "in_progress";
  if (status === "waiting") return "waiting";
  return "queued";
}

const glob = (pattern: string, value: string) =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(value);

/** Where a job runs: a configured rule, GitHub-hosted, or a self-hosted runner group. */
export function classifyRunner(job: GhJob, rules: RunnerRule[]): RunnerInfo | undefined {
  const name = job.runner_name ?? "";
  const group = job.runner_group_name ?? "";
  if (!name && !group) return undefined;
  for (const r of rules) {
    const m = r.match;
    const hit =
      (m.runnerName === undefined || glob(m.runnerName, name)) &&
      (m.label === undefined || job.labels.includes(m.label)) &&
      (m.group === undefined || m.group === group);
    if (hit && (m.runnerName || m.label || m.group)) {
      return {
        kind: r.kind,
        label: r.label ?? (group || job.labels[0] || name),
        detail: name || undefined,
      };
    }
  }
  if (group === HOSTED_GROUP) return { kind: "gh", label: job.labels[0] ?? "github-hosted" };
  return {
    kind: "self",
    label: group || job.labels[0] || "self-hosted",
    detail: name || undefined,
  };
}

export function mapJob(job: GhJob, rules: RunnerRule[]): JobRecord {
  return {
    id: String(job.id),
    name: job.name,
    status: mapJobStatus(job.status, job.conclusion),
    needs: [],
    runner: classifyRunner(job, rules),
    steps: [...(job.steps ?? [])]
      .sort((a, b) => a.number - b.number)
      .map((s) => ({
        name: s.name,
        status: mapJobStatus(s.status, s.conclusion),
        startedAt: s.started_at,
        completedAt: s.completed_at,
      })),
    startedAt: job.started_at,
    completedAt: job.completed_at,
  };
}

/** A run with its jobs; only the newest attempt's jobs, so a re-run never mixes with the old one. */
export function mapRun(run: GhRun, jobs: GhJob[], rules: RunnerRule[]): RunRecord {
  const latest = jobs.filter((j) => j.run_attempt === run.run_attempt);
  const status = runStatus(run.status);
  return {
    id: run.id,
    url: run.html_url,
    branch: run.head_branch,
    sha: run.head_sha,
    actor: run.triggering_actor?.login ?? run.actor?.login ?? "",
    event: run.event,
    createdAt: run.created_at,
    startedAt: run.run_started_at,
    completedAt: status === "completed" ? run.updated_at : null,
    status,
    conclusion: status === "completed" ? (run.conclusion as Conclusion) : null,
    jobs: latest.map((j) => mapJob(j, rules)),
  };
}
