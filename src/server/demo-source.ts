/**
 * Demo mode: a simulated set of workflows that start, run, fail and recover, so the dashboard
 * can be developed and shown without GitHub. Each run is fully scheduled when it starts
 * (every job's and step's start and end on a simulated clock), and its state at any moment is
 * read from that schedule. The simulated clock runs `speed` times faster than real time, and
 * timestamps are mapped so that "now" on the simulated clock is the real current time.
 */
import type {
  EntryInput,
  FailureInfo,
  JobRecord,
  JobStatus,
  MonitoredEntry,
  RunRecord,
  StepRecord,
} from "../core/types.ts";
import {
  ACTORS,
  type EntryTemplate,
  failLogFor,
  type JobTemplate,
  NAMES,
  ORGS,
  type PipelineName,
  pipeline,
  REPOS,
  STORY,
} from "./demo-data.ts";
import { failureErrors } from "./github/logs.ts";
import type { RunDetails, Source } from "./source.ts";

export interface DemoOptions {
  count: number;
  running: number;
  seed?: number;
  now?: () => number;
  tickMs?: number;
  speed?: number;
}

const MIN = 60_000;
const HISTORY = 14;
const FAIL_CHANCE = 0.12;
const FAIL_CHANCE_WHEN_BROKEN = 0.15;

interface SimStep {
  name: string;
  start: number;
  end: number;
  usualMs: number;
  fails: boolean;
}

interface SimJob {
  tpl: JobTemplate;
  start: number;
  end: number;
  steps: SimStep[];
  /** Never runs because something it needs failed. */
  blocked: boolean;
  fails: boolean;
}

interface SimRun {
  id: number;
  created: number;
  end: number;
  jobs: SimJob[];
  failed: boolean;
  sha: string;
  actor: string;
  event: string;
  finalized: boolean;
}

interface SimEntry {
  entry: MonitoredEntry;
  pipeline: PipelineName;
  runs: SimRun[];
  failure?: FailureInfo;
  problem?: string;
  cooldownUntil: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Teams sharing the demo wall: a label and a border color each; some workflows have none. */
const DEMO_TEAMS: Partial<MonitoredEntry>[] = [
  { labels: ["android"], color: "#a78bfa" },
  { labels: ["web"], color: "#38bdf8" },
  { labels: ["platform"], color: "#f472b6" },
  {},
];

export class DemoSource implements Source {
  private readonly rand: () => number;
  private readonly now: () => number;
  private readonly tickMs: number;
  readonly speed: number;
  private sim: number;
  private target: number;
  private entries: SimEntry[] = [];
  private nextRunId = 9000;
  private timer: ReturnType<typeof setInterval> | undefined;
  private onChange: ((inputs: EntryInput[]) => void) | undefined;

  constructor(opts: DemoOptions) {
    this.rand = mulberry32(opts.seed ?? Date.now());
    this.now = opts.now ?? Date.now;
    this.tickMs = opts.tickMs ?? 1000;
    this.speed = opts.speed ?? 60;
    this.sim = this.now();
    this.target = opts.running;
    this.seed(opts.count);
    this.setRunning(opts.running, false);
  }

  start(onChange: (inputs: EntryInput[]) => void): void {
    this.onChange = onChange;
    this.emit();
    this.timer = setInterval(() => this.tick(), this.tickMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  tick(): void {
    this.sim += this.tickMs * this.speed;
    for (const e of this.entries) this.finalize(e);
    this.refill();
    this.emit();
  }

  setRunning(n: number, emit = true): void {
    this.target = Math.max(0, n);
    const running = this.entries.filter((e) => this.isRunning(e));
    for (const e of running.slice(this.target)) {
      const run = e.runs[0];
      if (run) this.forceSuccessNow(run);
      this.finalize(e);
    }
    this.refill();
    if (emit) this.emit();
  }

  breakOne(): void {
    const candidates = this.entries.filter(
      (e) => !e.problem && !this.isRunning(e) && e.runs[0] && !e.runs[0].failed,
    );
    const e = this.pick(candidates);
    if (!e) return;
    const run = this.schedule(e, this.sim, true);
    this.shift(run, this.sim - run.end);
    e.runs.unshift(run);
    e.cooldownUntil = this.sim + 30 * MIN;
    this.finalize(e);
    this.emit();
  }

  async details(entryKey: string, runId?: number): Promise<RunDetails | null> {
    const e = this.entries.find((x) => x.entry.key === entryKey);
    const run = runId === undefined ? e?.runs[0] : e?.runs.find((r) => r.id === runId);
    if (!e || !run) return null;
    const record = this.record(e, run);
    const logExcerpt = run.failed
      ? failLogFor(run.jobs.find((j) => j.fails && !j.blocked)?.tpl.name ?? "")
      : [
          "Run actions/upload-artifact@v4",
          "Artifact upload complete",
          "Post job cleanup.",
          "Cleaning up orphan processes",
        ];
    return { entryKey, runUrl: record.url, logExcerpt, jobs: record.jobs };
  }

  // ---------- setup ----------

  private seed(count: number): void {
    const templates: EntryTemplate[] = [];
    for (let i = 0; i < count; i++) {
      const story = STORY[i];
      if (story) {
        templates.push(story);
        continue;
      }
      const repo = REPOS[i % REPOS.length] ?? "repo";
      const lap = Math.floor(i / REPOS.length);
      templates.push({
        repo: `${i < 14 ? "mklab-se" : this.pick(ORGS)}/${repo}${lap ? `-${lap + 1}` : ""}`,
        workflow: "ci.yml",
        name: NAMES[(i * 7) % NAMES.length] ?? "CI",
        pipeline: this.rand() < 0.1 ? "android" : this.rand() < 0.5 ? "medium" : "small",
      });
    }
    this.entries = templates.map((t, i) => this.makeEntry(t, i));
  }

  private makeEntry(t: EntryTemplate, i: number): SimEntry {
    const entry: MonitoredEntry = {
      key: `e${i}`,
      repo: t.repo,
      workflow: t.workflow,
      branch: "main",
      name: t.name,
      ...DEMO_TEAMS[t.pipeline === "android" ? 0 : (i % 3) + 1],
    };
    const e: SimEntry = { entry, pipeline: t.pipeline, runs: [], cooldownUntil: 0 };
    if (t.seed === "missing") {
      e.problem = `Workflow ${t.workflow} not found in ${t.repo} (404: renamed, deleted, or no access)`;
      return e;
    }
    if (t.seed === "never") return e;
    // history: completed runs going back in time, newest first
    let end = this.sim - (10 + this.rand() * 120) * MIN;
    const failingStreak = t.seed === "failed" ? (i === 0 ? 2 : 1) : 0;
    for (let k = 0; k < HISTORY; k++) {
      const fail = k < failingStreak || (k >= failingStreak && this.rand() < 0.08);
      const run = this.schedule(e, end, fail);
      this.shift(run, end - run.end);
      run.finalized = true;
      e.runs.push(run);
      end = run.created - (20 + this.rand() * 90) * MIN;
    }
    if (failingStreak) this.setFailure(e, e.runs[0] as SimRun);
    if (t.seed === "running") {
      const run = this.schedule(e, this.sim, false);
      this.shift(run, -(run.end - run.created) * (i === 2 ? 0.4 : 0.1));
      e.runs.unshift(run);
    }
    return e;
  }

  // ---------- scheduling ----------

  /** Plans a run starting at `start`; `fail` picks a job and step that will fail. */
  private schedule(e: SimEntry, start: number, fail: boolean): SimRun {
    const tpls = pipeline(e.pipeline, (xs) => this.pick(xs) as (typeof xs)[number]);
    const failJob = fail ? this.pick(tpls.filter((j) => j.steps.length > 1)) : undefined;
    const jobs = new Map<string, SimJob>();
    const plan = (tpl: JobTemplate): SimJob => {
      const known = jobs.get(tpl.id);
      if (known) return known;
      const needs = tpl.needs
        .map((n) => tpls.find((x) => x.id === n))
        .filter(Boolean) as JobTemplate[];
      const deps = needs.map(plan);
      const blocked = deps.some((d) => d.blocked || d.fails);
      const jobStart = Math.max(start + 5_000, ...deps.map((d) => d.end)) + this.rand() * 20_000;
      const weights = tpl.weights ?? tpl.steps.map(() => 1);
      const total = weights.reduce((a, b) => a + b, 0);
      const failStep = tpl === failJob ? 1 + Math.floor(this.rand() * (tpl.steps.length - 1)) : -1;
      const steps: SimStep[] = [];
      let t = jobStart;
      for (const [k, name] of tpl.steps.entries()) {
        const usualMs = ((weights[k] ?? 1) / total) * tpl.minutes * MIN;
        const len = usualMs * (0.85 + this.rand() * 0.4) * (k === failStep ? 0.5 : 1);
        steps.push({ name, start: t, end: t + len, usualMs, fails: k === failStep });
        t += len;
        if (k === failStep) break;
      }
      const job: SimJob = { tpl, start: jobStart, end: t, steps, blocked, fails: failStep >= 0 };
      jobs.set(tpl.id, job);
      return job;
    };
    const planned = tpls.map(plan);
    const ran = planned.filter((j) => !j.blocked);
    return {
      id: this.nextRunId++,
      created: start,
      end: Math.max(start, ...ran.map((j) => j.end)),
      jobs: planned,
      failed: planned.some((j) => j.fails && !j.blocked),
      sha: Math.floor(this.rand() * 0xfffffff)
        .toString(16)
        .padStart(7, "0"),
      actor: this.pick(ACTORS) ?? "kristofer",
      event: this.rand() < 0.8 ? "push" : "schedule",
      finalized: false,
    };
  }

  private shift(run: SimRun, delta: number): void {
    run.created += delta;
    run.end += delta;
    for (const j of run.jobs) {
      j.start += delta;
      j.end += delta;
      for (const s of j.steps) {
        s.start += delta;
        s.end += delta;
      }
    }
  }

  /** Ends a run right now as a success (used when the running target is lowered). */
  private forceSuccessNow(run: SimRun): void {
    for (const j of run.jobs) {
      j.blocked = false;
      j.fails = false;
      j.start = Math.min(j.start, this.sim);
      j.end = Math.min(j.end, this.sim);
      for (const s of j.steps) {
        s.fails = false;
        s.start = Math.min(s.start, this.sim);
        s.end = Math.min(s.end, this.sim);
      }
    }
    run.failed = false;
    run.end = this.sim;
  }

  // ---------- lifecycle ----------

  private isRunning(e: SimEntry): boolean {
    const r = e.runs[0];
    return r !== undefined && r.end > this.sim;
  }

  private finalize(e: SimEntry): void {
    const run = e.runs[0];
    if (!run || run.finalized || run.end > this.sim) return;
    run.finalized = true;
    if (run.failed) this.setFailure(e, run);
    else e.failure = undefined;
    e.cooldownUntil = this.sim + 5 * MIN;
    if (e.runs.length > HISTORY + 6) e.runs.length = HISTORY + 6;
  }

  private setFailure(e: SimEntry, run: SimRun): void {
    const job = run.jobs.find((j) => j.fails && !j.blocked);
    const step = job?.steps.find((s) => s.fails);
    if (!job || !step) return;
    e.failure = {
      job: job.tpl.name,
      step: step.name,
      runner: job.tpl.runner,
      logExcerpt: failLogFor(job.tpl.name),
      errors: failureErrors(failLogFor(job.tpl.name), step.name),
    };
  }

  private refill(): void {
    let running = this.entries.filter((e) => this.isRunning(e)).length;
    while (running < this.target) {
      const candidates = this.entries.filter(
        (e) => !e.problem && !this.isRunning(e) && e.cooldownUntil <= this.sim,
      );
      const e =
        this.pick(candidates) ??
        this.pick(this.entries.filter((x) => !x.problem && !this.isRunning(x)));
      if (!e) return;
      const broken = e.runs[0]?.failed ?? false;
      const fail = this.rand() < (broken ? FAIL_CHANCE_WHEN_BROKEN : FAIL_CHANCE);
      e.runs.unshift(this.schedule(e, this.sim, fail));
      running++;
    }
  }

  // ---------- output ----------

  private emit(): void {
    this.onChange?.(this.entries.map((e) => this.input(e)));
  }

  private input(e: SimEntry): EntryInput {
    // runs seeded as already failed never went through finalize: give them their details
    const last = e.runs.find((r) => r.end <= this.sim);
    if (last?.failed && !e.failure) this.setFailure(e, last);
    return {
      entry: e.entry,
      runs: e.runs.map((r) => this.record(e, r)),
      failure: e.failure,
      problem: e.problem,
    };
  }

  /** Timestamps here age `speed` times faster than real time; the wall's holds allow for it. */
  holdSettings(): { clockScale: number } {
    return { clockScale: this.speed };
  }

  /** Simulated time to a real ISO timestamp, so the browser's clock agrees with the run. */
  private iso(t: number): string {
    return new Date(this.now() - (this.sim - t)).toISOString();
  }

  private record(e: SimEntry, run: SimRun): RunRecord {
    const T = this.sim;
    const done = run.end <= T;
    const jobs: JobRecord[] = run.jobs.map((j) => {
      let status: JobStatus;
      if (j.blocked) status = done ? "skipped" : "queued";
      else if (T < j.start) status = "queued";
      else if (T >= j.end) status = j.fails ? "failure" : "success";
      else status = "running";
      const steps: StepRecord[] = j.blocked
        ? []
        : j.steps.map((s) => ({
            name: s.name,
            status:
              T < s.start ? "queued" : T >= s.end ? (s.fails ? "failure" : "success") : "running",
            startedAt: T >= s.start ? this.iso(s.start) : null,
            completedAt: T >= s.end ? this.iso(s.end) : null,
            usualMs: s.usualMs,
          }));
      return {
        id: j.tpl.id,
        name: j.tpl.name,
        status,
        needs: j.tpl.needs,
        group: j.tpl.group,
        runner: j.tpl.runner,
        steps,
        startedAt: !j.blocked && T >= j.start ? this.iso(j.start) : null,
        completedAt: !j.blocked && T >= j.end ? this.iso(j.end) : null,
      };
    });
    return {
      id: run.id,
      url: `https://github.com/${e.entry.repo}/actions/runs/${run.id}`,
      branch: e.entry.branch,
      sha: run.sha,
      actor: run.actor,
      event: run.event,
      createdAt: this.iso(run.created),
      startedAt: this.iso(run.created),
      completedAt: done ? this.iso(run.end) : null,
      status: done ? "completed" : "in_progress",
      conclusion: done ? (run.failed ? "failure" : "success") : null,
      jobs,
    };
  }

  private pick<T>(xs: T[]): T | undefined {
    return xs.length ? xs[Math.floor(this.rand() * xs.length)] : undefined;
  }
}
