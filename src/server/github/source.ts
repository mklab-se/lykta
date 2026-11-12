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
import { GitHubError, RateLimitError, type RateState } from "./client.ts";
import { cleanLog, failureExcerpt } from "./logs.ts";
import { classifyRunner, type GhJob, type GhRun, mapRun } from "./map.ts";
import { attachGraph, parseWorkflow, type WorkflowDef } from "./workflow-file.ts";

/** What the source needs from the REST client (GitHubClient implements it). */
export interface GitHubApi {
  json<T>(org: string, path: string): Promise<{ data: T; notModified: boolean }>;
  text(org: string, path: string): Promise<string>;
  rate(org: string): RateState | undefined;
  /** Requests Lykta made against the org's rate limit in the last hour. */
  spent(org: string): number;
  onWarning(fn: (message: string) => void): void;
}

const LOOP_MS = 5_000;
const RUNS_PER_ENTRY = 15;
const WARNING_TTL_MS = 10 * 60_000;
const DETAIL_LINES = 12;

interface EntryState {
  cfg: MonitorConfig;
  key: string;
  org: string;
  runs: GhRun[];
  failure?: FailureInfo;
  failureRunId?: string;
  problem?: string;
  intervalMs: number;
  nextAt: number;
}

const completed = (r: GhRun) => r.status === "completed";
/** Caches are per attempt: a re-run keeps the run id but is a new attempt with new jobs. */
const runKey = (r: GhRun) => `${r.id}#${r.run_attempt}`;
const MAX_ATTEMPT_LOOKBACK = 3;
const counted = (r: GhRun) =>
  completed(r) && (r.conclusion === "success" || isFailureConclusion(r.conclusion as Conclusion));

export class GitHubSource implements Source {
  firstSync: Promise<void>;
  private resolveFirst: () => void = () => {};
  private readonly entries: EntryState[];
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly runJobs = new Map<string, GhJob[]>(); // completed attempts only
  private readonly liveJobs = new Map<string, GhJob[]>(); // latest poll of running attempts
  /** Earlier, completed attempts of runs being re-run (they never change). */
  private readonly prevAttempts = new Map<string, GhRun | null>();
  private readonly workflows = new Map<string, WorkflowDef | null>();
  private readonly graphs = new Map<
    string,
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
    if (e.failureRunId === runKey(run) && e.failure) logExcerpt = e.failure.logExcerpt;
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
      e.runs = await this.withPreviousAttempts(
        e,
        data.workflow_runs.filter((r) => !ignoreEvents.includes(r.event)),
      );
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
    e.intervalMs = base * this.slowdown(e.org);
    e.nextAt = this.now() + e.intervalMs;
  }

  /**
   * A re-run puts the same run id back to running, and the list then no longer says it
   * failed. Insert the newest decisive earlier attempt after it, so the wall keeps showing
   * the failure (and since when) until the re-run decides.
   */
  private async withPreviousAttempts(e: EntryState, runs: GhRun[]): Promise<GhRun[]> {
    const out: GhRun[] = [];
    for (const run of runs) {
      out.push(run);
      if (completed(run)) continue;
      for (
        let n = run.run_attempt - 1;
        n >= Math.max(1, run.run_attempt - MAX_ATTEMPT_LOOKBACK);
        n--
      ) {
        const key = `${run.id}#${n}`;
        if (!this.prevAttempts.has(key)) {
          try {
            const { data } = await this.opts.client.json<GhRun>(
              e.org,
              `/repos/${e.cfg.repo}/actions/runs/${run.id}/attempts/${n}`,
            );
            this.prevAttempts.set(key, data);
          } catch (err) {
            if (!(err instanceof GitHubError && err.status === 404)) throw err;
            this.prevAttempts.set(key, null);
          }
        }
        const prev = this.prevAttempts.get(key);
        if (prev && counted(prev)) {
          out.push(prev);
          break;
        }
      }
    }
    return out;
  }

  /**
   * Other teams and other Lykta installations share the org's rate limit, so Lykta slows
   * down long before it runs out: as soon as under half is left, and whenever its own use
   * nears its budget (a share of the hourly limit).
   */
  private slowdown(org: string): number {
    const rate = this.opts.client.rate(org);
    if (!rate || rate.limit <= 0) return 1;
    const left = rate.remaining / rate.limit;
    const shared = left < 0.1 ? 8 : left < 0.25 ? 4 : left < 0.5 ? 2 : 1;
    const own = this.opts.client.spent(org) / (this.opts.config.polling.budget * rate.limit);
    return Math.max(shared, own >= 1 ? 4 : own >= 0.75 ? 2 : 1);
  }

  /** Bounded memory over weeks: drop cached data for runs no entry lists any more. */
  private forgetUnlisted(): void {
    const listed = new Set(this.entries.flatMap((x) => x.runs.map(runKey)));
    const ids = new Set(this.entries.flatMap((x) => x.runs.map((r) => String(r.id))));
    for (const k of this.liveJobs.keys()) if (!listed.has(k)) this.liveJobs.delete(k);
    for (const k of this.graphs.keys()) if (!listed.has(k)) this.graphs.delete(k);
    for (const k of this.runJobs.keys()) if (!listed.has(k)) this.runJobs.delete(k);
    for (const k of this.prevAttempts.keys())
      if (!ids.has(k.slice(0, k.indexOf("#")))) this.prevAttempts.delete(k);
    const shas = new Set(this.entries.flatMap((x) => x.runs.map((r) => r.head_sha)));
    for (const key of this.workflows.keys()) {
      const sha = key.slice(key.indexOf("@") + 1, key.indexOf(":"));
      if (!shas.has(sha)) this.workflows.delete(key);
    }
  }

  private async jobsFor(e: EntryState, run: GhRun): Promise<GhJob[]> {
    const key = runKey(run);
    const cached = this.runJobs.get(key);
    if (cached) return cached;
    const previous = this.prevAttempts.get(key) === run;
    const jobs: GhJob[] = [];
    for (let page = 1; page <= 10; page++) {
      const { data } = await this.opts.client.json<{ total_count: number; jobs: GhJob[] }>(
        e.org,
        previous
          ? `/repos/${e.cfg.repo}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`
          : `/repos/${e.cfg.repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=100&page=${page}`,
      );
      jobs.push(...data.jobs);
      if (jobs.length >= data.total_count || data.jobs.length === 0) break;
    }
    if (completed(run)) this.runJobs.set(key, jobs);
    else this.liveJobs.set(key, jobs);
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
    this.graphs.set(runKey(run), { caller, called });
    return { caller, called };
  }

  private async updateFailure(e: EntryState): Promise<void> {
    const decisive = e.runs.find(counted);
    if (!decisive || !isFailureConclusion(decisive.conclusion as Conclusion)) {
      e.failure = undefined;
      e.failureRunId = undefined;
      return;
    }
    if (e.failureRunId === runKey(decisive)) return;
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
    e.failureRunId = runKey(decisive);
  }

  private async handleError(e: EntryState, err: unknown): Promise<void> {
    const { repo, workflow } = e.cfg;
    if (err instanceof RateLimitError) {
      this.warn(err.message); // keep the last known state; the client pauses the org
      return;
    }
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
        const jobs = this.runJobs.get(runKey(run)) ?? this.liveJobs.get(runKey(run)) ?? [];
        const record = mapRun(run, jobs, rules);
        if (completed(run)) return record;
        const graph = this.graphs.get(runKey(run));
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
