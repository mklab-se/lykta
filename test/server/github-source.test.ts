import { describe, expect, test } from "bun:test";
import { deriveEntry } from "../../src/core/state.ts";
import type { EntryInput } from "../../src/core/types.ts";
import { parseConfig } from "../../src/server/config.ts";
import { AuthError } from "../../src/server/github/auth.ts";
import { GitHubError, RateLimitError, type RateState } from "../../src/server/github/client.ts";
import type { GhJob, GhRun } from "../../src/server/github/map.ts";
import { type GitHubApi, GitHubSource } from "../../src/server/github/source.ts";
import { Hub } from "../../src/server/hub.ts";

const fx = async <T>(name: string, file: string) =>
  (await Bun.file(`test/fixtures/github/${name}/${file}`).json()) as T;
const fxText = (name: string, file: string) =>
  Bun.file(`test/fixtures/github/${name}/${file}`).text();

const NOW = Date.UTC(2026, 11, 1, 12, 0);

/** A fake GitHub serving routes; counts requests per path. */
class FakeGitHub implements GitHubApi {
  calls: string[] = [];
  routes: [RegExp, (m: RegExpMatchArray) => unknown][] = [];
  texts: [RegExp, string][] = [];
  rates: Record<string, RateState> = {};
  spentByOrg: Record<string, number> = {};
  private warn: ((m: string) => void)[] = [];
  on(re: RegExp, fn: (m: RegExpMatchArray) => unknown) {
    this.routes.push([re, fn]);
  }
  async json<T>(_org: string, path: string) {
    this.calls.push(path);
    for (const [re, fn] of this.routes) {
      const m = path.match(re);
      if (m) {
        const out = await fn(m);
        if (out instanceof Error) throw out;
        return { data: out as T, notModified: false };
      }
    }
    throw new GitHubError(`GitHub API 404 for ${path}`, 404);
  }
  async text(_org: string, path: string) {
    this.calls.push(path);
    for (const [re, t] of this.texts) if (re.test(path)) return t;
    throw new GitHubError("no log", 404);
  }
  rate(org: string) {
    return this.rates[org];
  }
  spent(org: string) {
    return this.spentByOrg[org] ?? 0;
  }
  onWarning(fn: (m: string) => void) {
    this.warn.push(fn);
  }
  count(re: RegExp) {
    return this.calls.filter((c) => re.test(c)).length;
  }
}

const config = (extra = "") =>
  parseConfig(
    `
organizations:
  mklab-se:
    auth: token
monitor:
  - repo: mklab-se/lykta
    workflow: release.yml
  - repo: mklab-se/lykta
    workflow: live.yml
  - repo: mklab-se/lykta
    workflow: ci.yml
${extra}`,
    {},
  );

const shift = (iso: string, minutes: number) =>
  new Date(Date.parse(iso) + minutes * 60_000).toISOString();

async function setup(extra = "") {
  const release = await fx<GhRun>("lykta-release", "run.json");
  const releaseJobs = (await fx<{ jobs: GhJob[] }>("lykta-release", "jobs.json")).jobs;
  const failed = await fx<GhRun>("lykta-ci-failed", "run.json");
  const failedJobs = (await fx<{ jobs: GhJob[] }>("lykta-ci-failed", "jobs.json")).jobs;
  // five older successful runs of release.yml, for expected durations
  const history = [1, 2, 3, 4, 5].map((k) => ({
    ...release,
    id: release.id - k,
    created_at: shift(release.created_at, -60 * k),
    run_started_at: shift(release.run_started_at as string, -60 * k),
    updated_at: shift(release.updated_at, -60 * k),
  }));
  const running: GhRun = {
    ...release,
    id: 777,
    status: "in_progress",
    conclusion: null,
    path: ".github/workflows/live.yml",
  };
  const runningJobs = releaseJobs.map((j, i) => ({
    ...j,
    run_id: 777,
    status: i < 5 ? "completed" : "in_progress",
    conclusion: i < 5 ? "success" : null,
  }));

  const gh = new FakeGitHub();
  gh.on(/workflows\/release\.yml\/runs/, () => ({ workflow_runs: [release, ...history] }));
  gh.on(/workflows\/live\.yml\/runs/, () => ({ workflow_runs: [running, release] }));
  gh.on(/workflows\/ci\.yml\/runs/, () => ({ workflow_runs: [failed] }));
  gh.on(/runs\/777\/jobs/, () => ({ total_count: runningJobs.length, jobs: runningJobs }));
  gh.on(new RegExp(`runs/${failed.id}/jobs`), () => ({
    total_count: failedJobs.length,
    jobs: failedJobs,
  }));
  gh.on(/runs\/(\d+)\/jobs/, (m) => ({
    total_count: releaseJobs.length,
    jobs: releaseJobs.map((j) => ({ ...j, run_id: Number(m[1]) })),
  }));
  const b64 = (s: string) => ({ content: Buffer.from(s).toString("base64"), encoding: "base64" });
  const releaseYml = await fxText("lykta-release", "workflow.yml");
  const ciYml = await fxText("lykta-release", "called-ci.yml");
  gh.on(/contents\/\.github\/workflows\/ci\.yml/, () => b64(ciYml));
  gh.on(/contents\/\.github\/workflows\/(release|live)\.yml/, () => b64(releaseYml));
  gh.texts.push([
    /actions\/jobs\/131431121549\/logs/,
    await fxText("lykta-ci-failed", "logs-131431121549.txt"),
  ]);

  const scheduled: number[] = [];
  const src = new GitHubSource({
    config: config(extra),
    client: gh,
    now: () => NOW,
    schedule: (_fn, ms) => {
      scheduled.push(ms);
      return 0;
    },
  });
  let inputs: EntryInput[] = [];
  src.start((i) => {
    inputs = i;
  });
  await src.firstSync;
  return { gh, src, inputs: () => inputs, scheduled, failed, release };
}

const byWorkflow = (inputs: EntryInput[], wf: string) =>
  inputs.find((i) => i.entry.workflow === wf) as EntryInput;

describe("GitHubSource", () => {
  test("first sync yields every entry", async () => {
    const { inputs } = await setup();
    expect(inputs()).toHaveLength(3);
    expect(deriveEntry(byWorkflow(inputs(), "release.yml")).state).toBe("passed");
    expect(deriveEntry(byWorkflow(inputs(), "live.yml")).state).toBe("running");
    expect(deriveEntry(byWorkflow(inputs(), "ci.yml")).state).toBe("failed");
  });

  test("running run carries its graph", async () => {
    const { inputs } = await setup();
    const run = byWorkflow(inputs(), "live.yml").runs[0];
    const build = run?.jobs.find((j) => j.name === "Build aarch64-apple-darwin");
    expect(build?.group).toBe("Build");
    expect(build?.needs.length).toBeGreaterThan(0);
  });

  test("running run polls jobs, completed run is fetched once", async () => {
    const { gh, src, release } = await setup();
    await src.syncAll();
    expect(gh.count(/runs\/777\/jobs/)).toBe(2);
    expect(gh.count(new RegExp(`runs/${release.id}/jobs`))).toBe(1);
  });

  test("failed run gets a log excerpt and runner", async () => {
    const { inputs } = await setup();
    const f = byWorkflow(inputs(), "ci.yml").failure;
    expect(f?.job).toBe("Lint");
    expect(f?.step).toBe("Run bun run lint");
    expect(f?.runner?.kind).toBe("gh");
    expect(f?.logExcerpt.join("\n")).toContain("Provide an explicit type attribute");
  });

  test("history gives expected durations", async () => {
    const { inputs } = await setup();
    const hub = new Hub("1");
    hub.update(inputs());
    const release = hub.snapshot().entries.find((e) => e.key === "mklab-se/lykta:release.yml:main");
    expect(release?.expectedMs).toBeGreaterThan(0);
  });

  test("ignored events are dropped", async () => {
    const { gh, src, failed, release } = await setup();
    const extra = "    ignoreEvents: [workflow_dispatch]\n";
    const cfg = config();
    cfg.monitor[2] = {
      ...(cfg.monitor[2] as NonNullable<(typeof cfg.monitor)[2]>),
      ignoreEvents: ["workflow_dispatch"],
    };
    void extra;
    gh.routes.unshift([
      /workflows\/ci\.yml\/runs/,
      () => ({ workflow_runs: [{ ...failed, event: "workflow_dispatch" }, release] }),
    ]);
    const src2 = new GitHubSource({ config: cfg, client: gh, now: () => NOW, schedule: () => 0 });
    let got: EntryInput[] = [];
    src2.start((i) => {
      got = i;
    });
    await src2.firstSync;
    expect(deriveEntry(byWorkflow(got, "ci.yml")).state).toBe("passed");
    src.stop();
  });

  test("missing workflow becomes a problem, others continue", async () => {
    const { gh } = await setup();
    gh.routes.unshift([/workflows\/ci\.yml\/runs/, () => new GitHubError("404", 404)]);
    gh.routes.unshift([/actions\/workflows\/ci\.yml$/, () => new GitHubError("404", 404)]);
    const src = new GitHubSource({
      config: config(),
      client: gh,
      now: () => NOW,
      schedule: () => 0,
    });
    let got: EntryInput[] = [];
    src.start((i) => {
      got = i;
    });
    await src.firstSync;
    expect(byWorkflow(got, "ci.yml").problem).toContain("not found in mklab-se/lykta");
    expect(deriveEntry(byWorkflow(got, "release.yml")).state).toBe("passed");
  });

  test("a disabled workflow says so", async () => {
    const { gh } = await setup();
    gh.routes.unshift([/workflows\/ci\.yml\/runs/, () => new GitHubError("404", 404)]);
    gh.routes.unshift([/actions\/workflows\/ci\.yml$/, () => ({ state: "disabled_manually" })]);
    const src = new GitHubSource({
      config: config(),
      client: gh,
      now: () => NOW,
      schedule: () => 0,
    });
    let got: EntryInput[] = [];
    src.start((i) => {
      got = i;
    });
    await src.firstSync;
    expect(byWorkflow(got, "ci.yml").problem).toContain("disabled");
  });

  test("no access names the permission", async () => {
    const { gh } = await setup();
    gh.routes.unshift([
      /workflows\/ci\.yml\/runs/,
      () => new GitHubError("403", 403, "actions=read"),
    ]);
    const src = new GitHubSource({
      config: config(),
      client: gh,
      now: () => NOW,
      schedule: () => 0,
    });
    let got: EntryInput[] = [];
    src.start((i) => {
      got = i;
    });
    await src.firstSync;
    expect(byWorkflow(got, "ci.yml").problem).toContain("actions=read");
  });

  test("slows down early, leaving most of the rate limit to others", async () => {
    const { gh, src } = await setup();
    const idle = "mklab-se/lykta:release.yml:main";
    const active = "mklab-se/lykta:live.yml:main";
    const at = async (remaining: number) => {
      gh.rates["mklab-se"] = { remaining, limit: 5000, resetAt: NOW + 3_600_000 };
      await src.syncAll();
      return [src.nextPollIn(idle), src.nextPollIn(active)];
    };
    expect(await at(4000)).toEqual([60_000, 15_000]);
    expect(await at(2000)).toEqual([120_000, 30_000]); // under half left: already slower
    expect(await at(1000)).toEqual([240_000, 60_000]);
    expect(await at(400)).toEqual([480_000, 120_000]);
  });

  test("stays within its own share of the rate limit", async () => {
    const { gh, src } = await setup();
    const idle = "mklab-se/lykta:release.yml:main";
    gh.rates["mklab-se"] = { remaining: 5000, limit: 5000, resetAt: NOW + 3_600_000 };
    gh.spentByOrg["mklab-se"] = 800; // default budget: 20% of 5000 = 1000 per hour
    await src.syncAll();
    expect(src.nextPollIn(idle)).toBe(120_000);
    gh.spentByOrg["mklab-se"] = 1000;
    await src.syncAll();
    expect(src.nextPollIn(idle)).toBe(240_000);
  });

  test("a rate limit is a warning and keeps what the wall shows", async () => {
    const { gh, src } = await setup();
    let warnings: string[] = [];
    src.onWarnings((w) => {
      warnings = w;
    });
    let got: EntryInput[] = [];
    src.start((i) => {
      got = i;
    });
    gh.routes.unshift([
      /workflows\/ci\.yml\/runs/,
      () => new RateLimitError("GitHub rate limit for mklab-se", 403, NOW + 60_000),
    ]);
    await src.syncAll();
    const ci = byWorkflow(got, "ci.yml");
    expect(ci.problem).toBeUndefined();
    expect(deriveEntry(ci).state).toBe("failed");
    expect(warnings.join(" ")).toContain("rate limit");
  });

  test("re-running a failed run keeps the failure and shows only the new attempt's jobs", async () => {
    const { gh, src, failed } = await setup();
    const failedJobs = (await fx<{ jobs: GhJob[] }>("lykta-ci-failed", "jobs.json")).jobs;
    // GitHub re-runs in place: same run id, attempt 2, back to in_progress
    const rerun: GhRun = { ...failed, run_attempt: 2, status: "in_progress", conclusion: null };
    const attempt2 = failedJobs.slice(0, 2).map((j) => ({
      ...j,
      id: j.id + 1000,
      run_attempt: 2,
      status: "in_progress",
      conclusion: null,
    }));
    gh.routes.unshift([/workflows\/ci\.yml\/runs/, () => ({ workflow_runs: [rerun] })]);
    gh.routes.unshift([new RegExp(`runs/${failed.id}/attempts/1$`), () => failed]);
    gh.routes.unshift([
      new RegExp(`runs/${failed.id}/attempts/1/jobs`),
      () => ({ total_count: failedJobs.length, jobs: failedJobs }),
    ]);
    gh.routes.unshift([
      new RegExp(`runs/${failed.id}/jobs`),
      () => ({
        total_count: attempt2.length + failedJobs.length,
        jobs: [...attempt2, ...failedJobs],
      }),
    ]);
    let got: EntryInput[] = [];
    src.start((i) => {
      got = i;
    });
    await src.syncAll();
    const ci = byWorkflow(got, "ci.yml");
    const view = deriveEntry(ci);
    expect(view.state).toBe("running");
    expect(view.failing).toBe(true);
    expect(view.failure?.job).toBe("Lint");
    // attempt 2's own jobs only; the rest of its workflow waits (not attempt 1's results)
    const started = view.current?.jobs.filter((j) => !j.id.startsWith("wf:"));
    expect(started?.map((j) => j.name)).toEqual(["Test", "Build"]);
    expect(started?.every((j) => j.status === "running")).toBe(true);
    expect(
      view.current?.jobs.filter((j) => j.id.startsWith("wf:")).every((j) => j.status === "queued"),
    ).toBe(true);
  });

  test("a re-run that passes clears the failure", async () => {
    const { gh, src, failed } = await setup();
    const passed: GhRun = { ...failed, run_attempt: 2, conclusion: "success" };
    gh.routes.unshift([/workflows\/ci\.yml\/runs/, () => ({ workflow_runs: [passed] })]);
    let got: EntryInput[] = [];
    src.start((i) => {
      got = i;
    });
    await src.syncAll();
    const view = deriveEntry(byWorkflow(got, "ci.yml"));
    expect(view.state).toBe("passed");
    expect(view.failure).toBeUndefined();
  });

  test("a re-run that fails again shows the new attempt's failure", async () => {
    const { gh, src, failed } = await setup();
    const failedJobs = (await fx<{ jobs: GhJob[] }>("lykta-ci-failed", "jobs.json")).jobs;
    const again: GhRun = { ...failed, run_attempt: 2 };
    const attempt2 = failedJobs.map((j) => ({
      ...j,
      id: j.id + 1000,
      run_attempt: 2,
      conclusion: j.name === "Typecheck" ? "failure" : "success",
      steps: j.steps?.map((st) => ({ ...st, conclusion: "success" })),
    }));
    gh.routes.unshift([/workflows\/ci\.yml\/runs/, () => ({ workflow_runs: [again] })]);
    gh.routes.unshift([
      new RegExp(`runs/${failed.id}/jobs`),
      () => ({ total_count: attempt2.length, jobs: attempt2 }),
    ]);
    let got: EntryInput[] = [];
    src.start((i) => {
      got = i;
    });
    await src.syncAll();
    expect(deriveEntry(byWorkflow(got, "ci.yml")).failure?.job).toBe("Typecheck");
  });

  test("a sign-in failure marks every entry of that organization", async () => {
    const { gh } = await setup();
    gh.routes.unshift([/\/runs\?/, () => new AuthError("mklab-se", "Bad credentials (HTTP 401)")]);
    const src = new GitHubSource({
      config: config(),
      client: gh,
      now: () => NOW,
      schedule: () => 0,
    });
    let got: EntryInput[] = [];
    src.start((i) => {
      got = i;
    });
    await src.firstSync;
    for (const i of got) expect(i.problem).toContain("Cannot sign in to mklab-se");
  });

  test("one stuck entry does not hold up the others", async () => {
    const { gh, failed } = await setup();
    let now = NOW;
    const ticks: (() => void)[] = [];
    const src = new GitHubSource({
      config: config(),
      client: gh,
      now: () => now,
      schedule: (fn) => ticks.push(fn),
    });
    let got: EntryInput[] = [];
    let warnings: string[] = [];
    src.onWarnings((w) => {
      warnings = w;
    });
    src.start((i) => {
      got = i;
    });
    await src.firstSync;
    gh.routes.unshift([/workflows\/ci\.yml\/runs/, () => new Promise(() => {})]);
    gh.routes.unshift([/workflows\/release\.yml\/runs/, () => ({ workflow_runs: [failed] })]);
    now += 10 * 60_000;
    ticks.at(-1)?.();
    await Bun.sleep(20);
    expect(deriveEntry(byWorkflow(got, "release.yml")).state).toBe("failed");
    expect(warnings.join(" ")).toContain("Data for");
    // and the loop keeps ticking
    expect(ticks.length).toBeGreaterThan(1);
  });

  test("polling continues after an unexpected error", async () => {
    const { gh } = await setup();
    let now = NOW;
    const ticks: (() => void)[] = [];
    const src = new GitHubSource({
      config: config(),
      client: gh,
      now: () => now,
      schedule: (fn) => ticks.push(fn),
    });
    let calls = 0;
    src.start(() => {
      calls++;
      if (calls === 2) throw new Error("subscriber broke");
    });
    await src.firstSync;
    const before = ticks.length;
    now += 10 * 60_000;
    ticks.at(-1)?.();
    await Bun.sleep(20);
    expect(ticks.length).toBeGreaterThan(before);
  });

  test("a reusable workflow from another commit is fetched once, not every sync", async () => {
    const { gh, release } = await setup();
    const other = "0123456789abcdef0123456789abcdef01234567";
    const running: GhRun = {
      ...release,
      id: 888,
      status: "in_progress",
      conclusion: null,
      referenced_workflows: [
        {
          path: `mklab-se/lykta/.github/workflows/ci.yml@${other}`,
          sha: other,
          ref: "refs/heads/main",
        },
      ],
    };
    gh.routes.unshift([/workflows\/live\.yml\/runs/, () => ({ workflow_runs: [running] })]);
    const src = new GitHubSource({
      config: config(),
      client: gh,
      now: () => NOW,
      schedule: () => 0,
    });
    src.start(() => {});
    await src.firstSync;
    await src.syncAll();
    await src.syncAll();
    expect(gh.count(new RegExp(`contents/\\.github/workflows/ci\\.yml\\?ref=${other}`))).toBe(1);
  });

  test("a workflow file that failed to load is tried again", async () => {
    const { gh } = await setup();
    let fail = true;
    gh.routes.unshift([
      /contents\/\.github\/workflows\/live\.yml/,
      () => (fail ? new GitHubError("GitHub API 502", 502) : undefined),
    ]);
    const src = new GitHubSource({
      config: config(),
      client: gh,
      now: () => NOW,
      schedule: () => 0,
    });
    let got: EntryInput[] = [];
    src.start((i) => {
      got = i;
    });
    await src.firstSync;
    expect(byWorkflow(got, "live.yml").runs[0]?.jobs.some((j) => j.group === "Build")).toBe(false);
    fail = false;
    gh.routes.shift();
    await src.syncAll();
    expect(byWorkflow(got, "live.yml").runs[0]?.jobs.some((j) => j.group === "Build")).toBe(true);
  });

  test("a branch that does not exist is a problem", async () => {
    const { gh } = await setup();
    gh.routes.unshift([/workflows\/ci\.yml\/runs/, () => ({ workflow_runs: [] })]);
    gh.routes.unshift([/branches\/main$/, () => new GitHubError("GitHub API 404", 404)]);
    const src = new GitHubSource({
      config: config(),
      client: gh,
      now: () => NOW,
      schedule: () => 0,
    });
    let got: EntryInput[] = [];
    src.start((i) => {
      got = i;
    });
    await src.firstSync;
    expect(byWorkflow(got, "ci.yml").problem).toContain("Branch main not found in mklab-se/lykta");
  });

  test("an existing branch without runs is simply waiting", async () => {
    const { gh } = await setup();
    gh.routes.unshift([/workflows\/ci\.yml\/runs/, () => ({ workflow_runs: [] })]);
    gh.routes.unshift([/branches\/main$/, () => ({ name: "main" })]);
    const src = new GitHubSource({
      config: config(),
      client: gh,
      now: () => NOW,
      schedule: () => 0,
    });
    let got: EntryInput[] = [];
    src.start((i) => {
      got = i;
    });
    await src.firstSync;
    await src.syncAll();
    expect(deriveEntry(byWorkflow(got, "ci.yml")).state).toBe("never");
    expect(gh.count(/branches\/main$/)).toBe(1);
  });

  test("a job's log is downloaded once for details", async () => {
    const { gh, src, release } = await setup();
    gh.texts.push([/actions\/jobs\/\d+\/logs/, "line 1\nline 2"]);
    const before = gh.count(/\/logs$/); // the failure excerpt from the first sync
    await src.details("mklab-se/lykta:release.yml:main", release.id);
    await src.details("mklab-se/lykta:release.yml:main", release.id);
    expect(gh.count(/\/logs$/) - before).toBe(1);
  });

  test("details for a run", async () => {
    const { src, failed } = await setup();
    const d = await src.details("mklab-se/lykta:ci.yml:main", failed.id);
    expect(d?.runUrl).toBe(failed.html_url);
    expect(d?.logExcerpt.join("\n")).toContain("Provide an explicit type attribute");
    expect(await src.details("nope")).toBeNull();
  });
});
