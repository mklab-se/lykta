import { describe, expect, test } from "bun:test";
import {
  classifyRunner,
  type GhJob,
  type GhRun,
  mapJobStatus,
  mapRun,
} from "../../src/server/github/map.ts";

const load = async <T>(name: string, file: string): Promise<T> =>
  (await Bun.file(`test/fixtures/github/${name}/${file}`).json()) as T;

const job = (over: Partial<GhJob>): GhJob => ({
  id: 1,
  run_id: 1,
  run_attempt: 1,
  name: "Build",
  status: "completed",
  conclusion: "success",
  started_at: "2026-11-12T10:00:00Z",
  completed_at: "2026-11-12T10:05:00Z",
  labels: [],
  runner_name: null,
  runner_group_name: null,
  check_run_url: "https://api.github.com/repos/o/r/check-runs/1",
  steps: [],
  ...over,
});

describe("github map", () => {
  test("maps a completed run", async () => {
    const run = await load<GhRun>("lykta-release", "run.json");
    const { jobs } = await load<{ jobs: GhJob[] }>("lykta-release", "jobs.json");
    const r = mapRun(run, jobs, []);
    expect(r.jobs).toHaveLength(12);
    expect(r.conclusion).toBe("success");
    expect(r.status).toBe("completed");
    expect(r.url).toBe(run.html_url);
    expect(r.branch).toBe(run.head_branch);
    expect(r.sha).toBe(run.head_sha);
    expect(r.jobs.find((j) => j.name === "CI / Typecheck")?.steps.length).toBeGreaterThan(3);
  });

  test("maps job and step statuses", () => {
    const cases: [string, string | null, string][] = [
      ["queued", null, "queued"],
      ["waiting", null, "queued"],
      ["requested", null, "queued"],
      ["pending", null, "queued"],
      ["in_progress", null, "running"],
      ["completed", "success", "success"],
      ["completed", "failure", "failure"],
      ["completed", "timed_out", "failure"],
      ["completed", "startup_failure", "failure"],
      ["completed", "skipped", "skipped"],
      ["completed", "cancelled", "cancelled"],
      ["completed", "neutral", "cancelled"],
      ["completed", "stale", "cancelled"],
      ["completed", "action_required", "cancelled"],
    ];
    for (const [s, c, want] of cases) expect(mapJobStatus(s, c)).toBe(want as never);
  });

  test("hosted runners are GH", async () => {
    const { jobs } = await load<{ jobs: GhJob[] }>("lykta-release", "jobs.json");
    const win = jobs.find((j) => j.name === "Build x86_64-pc-windows-msvc") as GhJob;
    expect(classifyRunner(win, [])).toEqual({ kind: "gh", label: "windows-latest" });
  });

  test("runner rules win", () => {
    const j = job({
      runner_name: "lab-bench-2-a",
      runner_group_name: "lab",
      labels: ["self-hosted"],
    });
    expect(
      classifyRunner(j, [
        { match: { runnerName: "lab-bench-2*" }, kind: "lab", label: "lab-bench-2 · Pixel 9" },
      ]),
    ).toEqual({
      kind: "lab",
      label: "lab-bench-2 · Pixel 9",
      detail: "lab-bench-2-a",
    });
  });

  test("self-hosted without a rule", () => {
    const j = job({
      runner_name: "arc-aosp-xyz",
      runner_group_name: "arc-aosp",
      labels: ["arc-aosp"],
    });
    expect(classifyRunner(j, [])).toEqual({
      kind: "self",
      label: "arc-aosp",
      detail: "arc-aosp-xyz",
    });
  });

  test("a queued job has no runner yet", () => {
    expect(
      classifyRunner(job({ status: "queued", runner_name: null, runner_group_name: null }), []),
    ).toBeUndefined();
  });

  test("latest attempt only", async () => {
    const run = { ...(await load<GhRun>("lykta-release", "run.json")), run_attempt: 2 };
    const jobs = [
      job({ id: 1, run_attempt: 1, conclusion: "failure" }),
      job({ id: 2, run_attempt: 2 }),
    ];
    const r = mapRun(run, jobs, []);
    expect(r.jobs.map((j) => j.id)).toEqual(["2"]);
  });
});
