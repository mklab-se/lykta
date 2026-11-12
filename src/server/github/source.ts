/**
 * Polls GitHub for every monitored entry and turns the answers into EntryInputs (spec 6.1).
 * Completed runs never change, so their jobs and workflow files are fetched once; running
 * runs are polled often, idle entries less often, and both slow down when the rate limit
 * runs low. Missing or inaccessible workflows become visible problems, never silent gaps.
 */
import { isFailureConclusion } from "../../core/state.ts";
import type { Conclusion, EntryInput, FailureInfo, RunRecord } from "../../core/types.ts";
import { entryKey, type LyktaConfig, type MonitorConfig } from "../config.ts";
import type { RunDetails, Source } from "../source.ts";
import { GitHubError, type RateState } from "./client.ts";
import { cleanLog, failureExcerpt } from "./logs.ts";
import { classifyRunner, type GhJob, type GhRun, mapRun } from "./map.ts";
import { attachGraph, parseWorkflow, type WorkflowDef } from "./workflow-file.ts";

/** What the source needs from the REST client (GitHubClient implements it). */
export interface GitHubApi {
  json<T>(org: string, path: string): Promise<{ data: T; notModified: boolean }>;
  text(org: string, path: string): Promise<string>;
  rate(org: string): RateState | undefined;
  onWarning(fn: (message: string) => void): void;
}

const LOOP_MS = 5_000;
const LOW_RATE = 0.2;
const RUNS_PER_ENTRY = 15;
const WARNING_TTL_MS = 10 * 60_000;
const DETAIL_LINES = 12;

interface EntryState {
  cfg: MonitorConfig;
  key: string;
  org: string;
  runs: GhRun[];
  failure?: FailureInfo;
  failureRunId?: number;
  problem?: string;
  intervalMs: number;
  nextAt: number;
}

const completed = (r: GhRun) => r.status === "completed";
const counted = (r: GhRun) =>
  completed(r) && (r.conclusion === "success" || isFailureConclusion(r.conclusion as Conclusion));

export class GitHubSource implements Source {
  firstSync: Promise<void>;
  private resolveFirst: () => void = () => {};
  private readonly entries: EntryState[];
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly runJobs = new Map<number, GhJob[]>(); // completed runs only
  private readonly liveJobs = new Map<number, GhJob[]>(); // latest poll of running runs
  private readonly workflows = new Map<string, WorkflowDef | null>();
  private readonly graphs = new Map<
    number,
    { caller: WorkflowDef | null; called: Record<string, WorkflowDef | null> }
  >();
  private readonly warnings = new Map<string, number>();
  private readonly warningListeners = new Set<(w: string[]) => void>();
  private onChange: ((inputs: EntryInput[]) => void) | undefined;
  private stopped = false;

  constructor(
    private readonly opts: {
      config: LyktaConfig;
      client: GitHubApi;
      now?: () => number;
      schedule?: (fn: () => void, ms: number) => unknown;
    },
  ) {
    this.now = opts.now ?? Date.now;
    this.schedule = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.entries = opts.config.monitor.map((cfg) => ({
      cfg,
      key: entryKey(cfg),
      org: cfg.repo.split("/")[0] as string,
      runs: [],
      intervalMs: opts.config.polling.idleSeconds * 1000,
      nextAt: 0,
    }));
    this.firstSync = new Promise((r) => {
      this.resolveFirst = r;
    });
    opts.client.onWarning((m) => this.warn(m));
  }

  start(onChange: (inputs: EntryInput[]) => void): void {
    this.onChange = onChange;
    this.syncAll().then(() => {
      this.resolveFirst();
      this.loop();
    });
  }

  stop(): void {
    this.stopped = true;
  }

  onWarnings(fn: (warnings: string[]) => void): void {
    this.warningListeners.add(fn);
  }

  nextPollIn(key: string): number | undefined {
    return this.entries.find((e) => e.key === key)?.intervalMs;
  }

  async syncAll(): Promise<void> {
    await Promise.all(this.entries.map((e) => this.syncEntry(e)));
    this.emit();
  }

  async details(key: string, runId?: number): Promise<RunDetails | null> {
    const e = this.entries.find((x) => x.key === key);
    const run = runId === undefined ? e?.runs[0] : e?.runs.find((r) => r.id === runId);
    if (!e || !run) return null;
    const jobs = await this.jobsFor(e, run).catch(() => [] as GhJob[]);
    let logExcerpt: string[] = [];
    if (e.failureRunId === run.id && e.failure) logExcerpt = e.failure.logExcerpt;
    else {
      const last = [...jobs].reverse().find((j) => j.status === "completed");
      if (last) {
        try {
          const lines = cleanLog(
            await this.opts.client.text(e.org, `/repos/${e.cfg.repo}/actions/jobs/${last.id}/logs`),
          );
          logExcerpt = lines.filter((l) => !l.startsWith("##[")).slice(-DETAIL_LINES);
        } catch {}
      }
    }
    return {
      entryKey: key,
      runUrl: run.html_url,
      logExcerpt,
      jobs: mapRun(run, jobs, this.opts.config.runners).jobs,
    };
  }

  // ---------- polling ----------

  private loop(): void {
    if (this.stopped) return;
    this.schedule(async () => {
      if (this.stopped) return;
      const due = this.entries.filter((e) => e.nextAt <= this.now());
      if (due.length) {
        await Promise.all(due.map((e) => this.syncEntry(e)));
        this.emit();
      }
      this.loop();
    }, LOOP_MS);
  }

  private async syncEntry(e: EntryState): Promise<void> {
    const { repo, workflow, branch, ignoreEvents } = e.cfg;
    try {
      const path = `/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?branch=${encodeURIComponent(branch)}&per_page=${RUNS_PER_ENTRY}&exclude_pull_requests=true`;
      const { data } = await this.opts.client.json<{ workflow_runs: GhRun[] }>(e.org, path);
      e.runs = data.workflow_runs.filter((r) => !ignoreEvents.includes(r.event));
      this.forgetUnlisted();
      e.problem = undefined;
      const newest = e.runs[0];
      if (newest) {
        await this.jobsFor(e, newest);
        if (!completed(newest)) await this.graphFor(e, newest);
      }
      await this.updateFailure(e);
    } catch (err) {
      await this.handleError(e, err);
    }
    const running = e.runs[0] !== undefined && !completed(e.runs[0]);
    const base =
      (running ? this.opts.config.polling.activeSeconds : this.opts.config.polling.idleSeconds) *
      1000;
    const rate = this.opts.client.rate(e.org);
    e.intervalMs =
      rate && rate.limit > 0 && rate.remaining / rate.limit < LOW_RATE ? base * 2 : base;
    e.nextAt = this.now() + e.intervalMs;
  }

  /** Bounded memory over weeks: drop cached data for runs no entry lists any more. */
  private forgetUnlisted(): void {
    const listed = new Set(this.entries.flatMap((x) => x.runs.map((r) => r.id)));
    for (const id of this.liveJobs.keys()) if (!listed.has(id)) this.liveJobs.delete(id);
    for (const id of this.graphs.keys()) if (!listed.has(id)) this.graphs.delete(id);
    for (const id of this.runJobs.keys()) if (!listed.has(id)) this.runJobs.delete(id);
    const shas = new Set(this.entries.flatMap((x) => x.runs.map((r) => r.head_sha)));
    for (const key of this.workflows.keys()) {
      const sha = key.slice(key.indexOf("@") + 1, key.indexOf(":"));
      if (!shas.has(sha)) this.workflows.delete(key);
    }
  }

  private async jobsFor(e: EntryState, run: GhRun): Promise<GhJob[]> {
    const cached = this.runJobs.get(run.id);
    if (cached) return cached;
    const jobs: GhJob[] = [];
    for (let page = 1; page <= 10; page++) {
      const { data } = await this.opts.client.json<{ total_count: number; jobs: GhJob[] }>(
        e.org,
        `/repos/${e.cfg.repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=100&page=${page}`,
      );
      jobs.push(...data.jobs);
      if (jobs.length >= data.total_count || data.jobs.length === 0) break;
    }
    if (completed(run)) this.runJobs.set(run.id, jobs);
    else this.liveJobs.set(run.id, jobs);
    return jobs;
  }

  private async fileAt(
    org: string,
    repo: string,
    path: string,
    sha: string,
  ): Promise<WorkflowDef | null> {
    const key = `${repo}@${sha}:${path}`;
    if (this.workflows.has(key)) return this.workflows.get(key) ?? null;
    let def: WorkflowDef | null = null;
    try {
      const { data } = await this.opts.client.json<{ content: string }>(
        org,
        `/repos/${repo}/contents/${path}?ref=${sha}`,
      );
      def = parseWorkflow(Buffer.from(data.content, "base64").toString("utf8"));
    } catch {}
    this.workflows.set(key, def);
    return def;
  }

  /** The caller's workflow file and the reusable workflows it calls, at the run's commits. */
  private async graphFor(
    e: EntryState,
    run: GhRun,
  ): Promise<{ caller: WorkflowDef | null; called: Record<string, WorkflowDef | null> }> {
    const caller = await this.fileAt(e.org, e.cfg.repo, run.path, run.head_sha);
    const called: Record<string, WorkflowDef | null> = {};
    for (const def of caller?.jobs ?? []) {
      if (!def.uses) continue;
      const wanted = def.uses.startsWith("./")
        ? `${e.cfg.repo}/${def.uses.slice(2)}`
        : def.uses.split("@")[0];
      const ref = run.referenced_workflows?.find((r) => r.path.split("@")[0] === wanted);
      if (!ref || !wanted) continue;
      const [owner, name, ...rest] = wanted.split("/");
      const org = owner && this.opts.config.organizations[owner] ? owner : e.org;
      called[def.uses] = await this.fileAt(org, `${owner}/${name}`, rest.join("/"), ref.sha);
    }
    this.graphs.set(run.id, { caller, called });
    return { caller, called };
  }

  private async updateFailure(e: EntryState): Promise<void> {
    const decisive = e.runs.find(counted);
    if (!decisive || !isFailureConclusion(decisive.conclusion as Conclusion)) {
      e.failure = undefined;
      e.failureRunId = undefined;
      return;
    }
    if (e.failureRunId === decisive.id) return;
    const jobs = await this.jobsFor(e, decisive);
    const job = jobs.find((j) => isFailureConclusion(j.conclusion as Conclusion));
    const step =
      job?.steps?.find((s) => isFailureConclusion(s.conclusion as Conclusion))?.name ?? "";
    let logExcerpt: string[] = [];
    if (job) {
      try {
        logExcerpt = failureExcerpt(
          cleanLog(
            await this.opts.client.text(e.org, `/repos/${e.cfg.repo}/actions/jobs/${job.id}/logs`),
          ),
          step,
        );
      } catch {}
    }
    e.failure = {
      job: job?.name ?? "workflow",
      step: step || (job ? "" : "setup"),
      runner: job ? classifyRunner(job, this.opts.config.runners) : undefined,
      logExcerpt,
    };
    e.failureRunId = decisive.id;
  }

  private async handleError(e: EntryState, err: unknown): Promise<void> {
    const { repo, workflow } = e.cfg;
    if (err instanceof GitHubError && err.status === 404) {
      try {
        const { data } = await this.opts.client.json<{ state: string }>(
          e.org,
          `/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}`,
        );
        e.problem =
          data.state && data.state !== "active"
            ? `Workflow ${workflow} is disabled (${data.state})`
            : `Workflow ${workflow} in ${repo} returned no runs (404)`;
      } catch {
        e.problem = `Workflow ${workflow} not found in ${repo} (renamed, deleted, or no access)`;
      }
      return;
    }
    if (err instanceof GitHubError && err.status === 403) {
      e.problem = `No access to ${repo}: needs ${err.acceptedPermissions ?? "actions=read"}`;
      return;
    }
    // network or server trouble: keep the last known state and say so
    this.warn(
      `Could not reach GitHub for ${repo} (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  // ---------- output ----------

  private warn(message: string): void {
    this.warnings.set(message, this.now());
    this.publishWarnings();
  }

  private publishWarnings(): void {
    const cutoff = this.now() - WARNING_TTL_MS;
    for (const [m, t] of this.warnings) if (t < cutoff) this.warnings.delete(m);
    const list = [...this.warnings.keys()];
    for (const fn of this.warningListeners) fn(list);
  }

  private emit(): void {
    this.publishWarnings();
    const rules = this.opts.config.runners;
    const inputs: EntryInput[] = this.entries.map((e) => {
      const runs: RunRecord[] = e.runs.map((run) => {
        const jobs = this.runJobs.get(run.id) ?? this.liveJobs.get(run.id) ?? [];
        const record = mapRun(run, jobs, rules);
        if (completed(run)) return record;
        const graph = this.graphs.get(run.id);
        if (!graph) return record;
        const { caller, called } = graph;
        return { ...record, jobs: attachGraph(record.jobs, caller, called) };
      });
      return {
        entry: {
          key: e.key,
          repo: e.cfg.repo,
          workflow: e.cfg.workflow,
          branch: e.cfg.branch,
          name: e.cfg.name,
        },
        runs,
        failure: e.failure,
        problem: e.problem,
      };
    });
    this.onChange?.(inputs);
  }
}
